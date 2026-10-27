import { prisma } from "./prisma.js";
import { config } from "../config.js";
import { sendBookingMail } from "./email.js";
const safe = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const dateLabel = (d) =>
  new Date(d).toLocaleString("es-CR", {
    timeZone: "America/Costa_Rica",
    dateStyle: "full",
    timeStyle: "short",
  });
function siteLink(path, values) {
  const url = new URL(path, config.bookingSiteUrl);
  if (!["http:", "https:"].includes(url.protocol))
    throw Error("BOOKING_SITE_URL inválida");
  for (const [k, v] of Object.entries(values)) url.searchParams.set(k, v);
  return url.toString();
}
export async function queueBookingMail(tx, appointment, kind, actorId) {
  const customer = appointment.customerId
    ? await tx.user.findUnique({
        where: { id: appointment.customerId },
        select: { email: true, active: true },
      })
    : null;
  const date = new Date(+appointment.startAt - 6 * 3600000)
    .toISOString()
    .slice(0, 10);
  const detail = `${dateLabel(appointment.startAt)}\n${appointment.services.map((s) => s.name).join(" + ")}`;
  const ownerLink = siteLink("/admin", { date, appointment: appointment.id });
  const customerLink = siteLink("/mi-cuenta", { appointment: appointment.id });
  const ownerTargets = config.bookingOwnerEmail
    ? [{ email: config.bookingOwnerEmail }]
    : await tx.user.findMany({
        where: { role: "ADMIN", active: true },
        select: { email: true },
      });
  const clientText =
    kind === "REQUESTED"
      ? "Recibimos tu solicitud. Está pendiente de confirmación del salón."
      : kind === "CONFIRMED"
        ? "¡Tu cita está confirmada!"
        : kind === "CANCELLED"
          ? "El salón no podrá atender tu cita en el horario solicitado."
          : kind === "CUSTOMER_CANCELLED"
            ? "Cancelaste tu cita."
            : "El salón actualizó el horario de tu cita.";
  const proposal = appointment.proposedStartAt
    ? `\nPropuesta: ${dateLabel(appointment.proposedStartAt)}. Para aceptarla, ingresá a Mis citas. Es una propuesta; el cupo se comprueba al aceptar y aún requiere confirmación.`
    : "";
  const messages = [];
  if (customer?.active)
    messages.push({
      audience: "customer",
      recipient: customer.email,
      subject:
        kind === "REQUESTED"
          ? "Recibimos tu reserva · Zénit Salón"
          : kind === "CONFIRMED"
            ? "Cita confirmada · Zénit Salón"
            : kind === "CANCELLED"
              ? "Respuesta a tu reserva · Zénit Salón"
              : "Actualización de tu cita · Zénit Salón",
      body: `Hola ${appointment.customerName},\n\n${clientText}\n\n${detail}${appointment.responseMessage ? "\n\nMensaje del salón: " + appointment.responseMessage : ""}${proposal}`,
      links: [["Ver mis citas", customerLink]],
    });
  if (["REQUESTED", "CUSTOMER_CANCELLED"].includes(kind))
    for (const owner of ownerTargets)
      messages.push({
        audience: "owner",
        recipient: owner.email,
        subject:
          kind === "REQUESTED"
            ? "Nueva reserva por revisar · Zénit Salón"
            : "La clienta canceló su cita · Zénit Salón",
        body: `${kind === "REQUESTED" ? "Nueva solicitud" : "Cancelación"} de ${appointment.customerName}\n${detail}\nWhatsApp: ${appointment.phone}\n${appointment.notes ? "Notas de la clienta: " + appointment.notes : ""}\n\nIngresá con tu cuenta de propietaria para revisar y responder.`,
        links:
          kind === "REQUESTED"
            ? [
                ["Confirmar o responder", ownerLink],
                [
                  "Rechazar / proponer otra fecha",
                  siteLink("/admin", {
                    date,
                    appointment: appointment.id,
                    action: "respond",
                  }),
                ],
              ]
            : [["Ver agenda", ownerLink]],
      });
  for (const m of messages) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.recipient))
      throw Error("Correo de notificaciones inválido");
    const html = `<div style="background:#eef3f7;padding:24px;font-family:Arial;color:#102e4b"><div style="max-width:580px;margin:auto;background:white;border:1px solid #cbd7e2;border-radius:20px;padding:28px"><h2>Zénit Salón</h2><p style="white-space:pre-line;line-height:1.7">${safe(m.body)}</p>${m.links.map(([label, url]) => `<p><a style="display:inline-block;background:#173e64;color:white;border-radius:18px;padding:14px 20px;text-decoration:none" href="${safe(url)}">${safe(label)}</a></p>`).join("")}<p style="font-size:12px">Hora de Costa Rica · Las decisiones se guardan únicamente al confirmar dentro del sitio.</p></div></div>`;
    await tx.emailDelivery.create({
      data: {
        eventKey: `${appointment.id}:${kind}:${actorId}:${m.audience}:${m.recipient}`,
        recipient: m.recipient,
        subject: m.subject,
        text:
          m.body + "\n\n" + m.links.map(([l, u]) => `${l}: ${u}`).join("\n"),
        html,
      },
    });
  }
}
let running = false;
export async function deliverBookingMail({
  send = sendBookingMail,
  now = new Date(),
} = {}) {
  if (running) return;
  running = true;
  try {
    const jobs = await prisma.emailDelivery.findMany({
      where: {
        sentAt: null,
        nextAttemptAt: { lte: now },
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
      },
      orderBy: { createdAt: "asc" },
      take: 10,
    });
    for (const job of jobs) {
      const claim = await prisma.emailDelivery.updateMany({
        where: {
          id: job.id,
          sentAt: null,
          attempts: job.attempts,
          OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
        },
        data: {
          leaseUntil: new Date(+now + 300000),
          attempts: { increment: 1 },
        },
      });
      if (!claim.count) continue;
      try {
        await send({
          to: job.recipient,
          subject: job.subject,
          text: job.text,
          html: job.html,
          messageId: `<zenit-${job.id}@zenitsalon.com>`,
        });
        await prisma.emailDelivery.update({
          where: { id: job.id },
          data: { sentAt: new Date(), leaseUntil: null, lastError: null },
        });
      } catch (error) {
        await prisma.emailDelivery.update({
          where: { id: job.id },
          data: {
            leaseUntil: null,
            lastError: String(error.code || "DELIVERY_FAILED").slice(0, 80),
            nextAttemptAt: new Date(
              +now + Math.min(3600000, 30000 * 2 ** Math.min(job.attempts, 7)),
            ),
          },
        });
        console.warn(
          "BOOKING_EMAIL_RETRY",
          job.id,
          error.code || "DELIVERY_FAILED",
        );
      }
    }
  } finally {
    running = false;
  }
}
export function startBookingMailWorker() {
  const tick = () =>
    void deliverBookingMail().catch(() =>
      console.error("BOOKING_EMAIL_WORKER_FAILED"),
    );
  tick();
  const timer = setInterval(tick, 30000);
  timer.unref();
  return () => clearInterval(timer);
}
