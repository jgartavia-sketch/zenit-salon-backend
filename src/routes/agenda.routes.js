import { queueBookingMail } from "../lib/booking-mail.js";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireAdminKey } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { digest, httpError } from "../lib/security.js";
import {
  validDate,
  instant,
  crDate,
  buildSlots,
  validateRanges,
  overlaps,
  rangesFor,
} from "../lib/agenda.js";
const router = Router();
const dateSchema = z.string().refine(validDate, "Fecha inválida.");
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const range = z.object({ start: time, end: time }).strict();
const settingsSchema = z
  .object({
    weekly: z
      .array(
        z
          .object({
            day: z.number().int().min(0).max(6),
            ranges: z.array(range).max(8),
          })
          .strict(),
      )
      .max(7),
    overrides: z
      .array(
        z.object({ date: dateSchema, ranges: z.array(range).max(8) }).strict(),
      )
      .max(180),
    holdHours: z.number().int().min(1).max(48),
    noticeMinutes: z.number().int().min(0).max(10080),
  })
  .strict();
async function settings(tx = prisma) {
  return (
    (await tx.agendaConfig.findUnique({ where: { id: 1 } })) || {
      id: 1,
      weekly: [],
      overrides: [],
      holdHours: 24,
      noticeMinutes: 120,
    }
  );
}
const activeWhere = () => ({
  OR: [
    { status: { in: ["CONFIRMED", "BLOCKED"] } },
    { status: "PENDING", expiresAt: { gt: new Date() } },
  ],
});
async function busyFor(tx, date) {
  return tx.appointment.findMany({
    where: {
      ...activeWhere(),
      startAt: { lt: instant(date, "23:59") },
      endAt: { gt: instant(date, "00:00") },
    },
    select: { startAt: true, endAt: true },
  });
}
async function servicesFor(tx, ids, owner = false) {
  const services = await tx.salonService.findMany({
    where: { slug: { in: ids }, active: true, category: { active: true } },
  });
  if (services.length !== ids.length || !ids.length)
    throw httpError(400, "Seleccioná servicios vigentes.");
  if (!owner && services.some((x) => x.mode === "QUOTE"))
    throw httpError(
      409,
      "Los servicios cotizados deben ser agendados por el salón después de acordar su duración.",
    );
  if (services.some((x) => !x.durationMinutes))
    throw httpError(
      409,
      "El salón debe configurar la duración de este servicio antes de reservarlo.",
    );
  return {
    services: services.map((x) => ({
      id: x.id,
      slug: x.slug,
      name: x.name,
      durationMinutes: x.durationMinutes,
    })),
    duration: services.reduce((n, x) => n + x.durationMinutes, 0),
  };
}
const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res)).catch(next);
function requestedServices(value) {
  if (!value) return [];
  const ids = z
    .array(z.string().min(1).max(100))
    .min(1)
    .max(10)
    .parse(String(value).split(","));
  if (new Set(ids).size !== ids.length)
    throw httpError(400, "Hay servicios repetidos.");
  return ids;
}
const monthSchema = z.string().regex(/^20[2-9]\d-(0[1-9]|1[0-2])$/);
function monthDates(month) {
  const [year, m] = month.split("-").map(Number);
  return Array.from(
    { length: new Date(Date.UTC(year, m, 0)).getUTCDate() },
    (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`,
  );
}
async function monthSnapshot(month, ids, owner = false) {
  const dates = monthDates(month);
  const now = new Date();
  const first = instant(dates[0], "00:00");
  const end = new Date(+instant(dates.at(-1), "00:00") + 86400000);
  const config = await settings();
  let duration = 15,
    bookingUnavailableReason = "";
  try {
    if (ids.length) duration = (await servicesFor(prisma, ids)).duration;
  } catch (e) {
    if (e.status !== 409) throw e;
    bookingUnavailableReason = e.message;
  }
  // Only privileged callers may retrieve names, services, or appointment identifiers.
  const appointments = await prisma.appointment.findMany({
    where: { startAt: { lt: end }, endAt: { gt: first } },
    select: owner
      ? {
          id: true,
          customerName: true,
          startAt: true,
          endAt: true,
          status: true,
          expiresAt: true,
          services: true,
          notes: true,
        }
      : { startAt: true, endAt: true, status: true, expiresAt: true },
    orderBy: { startAt: "asc" },
  });
  const live = appointments.filter(
    (x) =>
      ["CONFIRMED", "BLOCKED"].includes(x.status) ||
      (x.status === "PENDING" && +x.expiresAt > +now),
  );
  const days = dates.map((date) => {
    const slots = bookingUnavailableReason
      ? []
      : buildSlots(config, date, duration, live, now);
    const free = slots.filter((s) => s.available).length;
    const state =
      date < crDate(now)
        ? "past"
        : !owner && instant(date, "00:00") > new Date(+now + 90 * 86400000)
          ? "outside"
          : !rangesFor(config, date).length
            ? "closed"
            : free
              ? "available"
              : "full";
    return { date, state, availableSlots: free, totalSlots: slots.length };
  });
  return {
    month,
    timeZone: "America/Costa_Rica",
    durationMinutes: duration,
    bookingUnavailableReason,
    days,
    ...(owner
      ? {
          appointments: appointments.map((a) => ({
            ...a,
            status:
              a.status === "PENDING" && +a.expiresAt <= +now
                ? "EXPIRED"
                : a.status,
          })),
        }
      : {}),
  };
}
router.get(
  "/calendar",
  rateLimit("public-calendar", 180, 5),
  wrap(async (req, res) => {
    const month = monthSchema.parse(req.query.month);
    const dates = monthDates(month);
    if (
      dates.at(-1) < crDate() ||
      instant(dates[0], "00:00") > new Date(Date.now() + 90 * 86400000)
    )
      throw httpError(400, "Consultá los próximos 90 días de agenda.");
    res.json(await monthSnapshot(month, requestedServices(req.query.services)));
  }),
);
router.get(
  "/availability",
  rateLimit("public-availability", 180, 5),
  wrap(async (req, res) => {
    const date = dateSchema.parse(req.query.date);
    const ids = requestedServices(req.query.services);
    if (
      date < crDate() ||
      instant(date, "00:00") > new Date(Date.now() + 90 * 86400000)
    )
      throw httpError(400, "Elegí una fecha dentro de los próximos 90 días.");
    let duration = 15;
    try {
      if (ids.length) duration = (await servicesFor(prisma, ids)).duration;
    } catch (e) {
      if (e.status !== 409) throw e;
      return res.json({
        date,
        timeZone: "America/Costa_Rica",
        durationMinutes: null,
        slots: [],
        bookingUnavailableReason: e.message,
      });
    }
    const config = await settings();
    res.json({
      date,
      timeZone: "America/Costa_Rica",
      durationMinutes: duration,
      slots: buildSlots(config, date, duration, await busyFor(prisma, date)),
    });
  }),
);
router.use(requireAuth);
router.get(
  "/mine",
  wrap(async (req, res) => {
    const appointments = await prisma.appointment.findMany({
      where: { customerId: req.user.id },
      orderBy: { startAt: "desc" },
      take: 100,
    });
    res.json({
      appointments: appointments.map((x) => ({
        ...x,
        status:
          x.status === "PENDING" && +x.expiresAt <= Date.now()
            ? "EXPIRED"
            : x.status,
      })),
    });
  }),
);
const booking = z
  .object({
    date: dateSchema,
    time,
    services: z.array(z.string().min(1).max(100)).min(1).max(10),
    notes: z.string().trim().max(1000).default(""),
    requestKey: z.uuid(),
  })
  .strict();
router.post(
  "/appointments",
  rateLimit("booking", 30, 60),
  wrap(async (req, res) => {
    const input = booking.parse(req.body);
    if (new Set(input.services).size !== input.services.length)
      throw httpError(400, "Hay servicios repetidos.");
    const hash = digest({ customerId: req.user.id, ...input });
    const appointment = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(724030)`;
      const existing = await tx.appointment.findUnique({
        where: { requestKey: input.requestKey },
      });
      if (existing) {
        if (existing.requestDigest !== hash)
          throw httpError(409, "La solicitud ya existe con otros datos.");
        return existing;
      }
      if (
        input.date < crDate() ||
        instant(input.date, "00:00") > new Date(Date.now() + 90 * 86400000)
      )
        throw httpError(400, "Fecha fuera del período de reservas.");
      const pending = await tx.appointment.count({
        where: {
          customerId: req.user.id,
          status: "PENDING",
          expiresAt: { gt: new Date() },
        },
      });
      if (pending >= 3)
        throw httpError(
          409,
          "Ya tenés tres solicitudes pendientes. Revisá Mis citas.",
        );
      const config = await settings(tx);
      const { services, duration } = await servicesFor(tx, input.services);
      const slot = buildSlots(
        config,
        input.date,
        duration,
        await busyFor(tx, input.date),
      ).find((x) => x.time === input.time && x.available);
      if (!slot)
        throw httpError(
          409,
          "Ese horario ya no está disponible. Elegí otro cupo.",
        );
      const created = await tx.appointment.create({
        data: {
          customerId: req.user.id,
          customerName: req.user.name,
          phone: req.user.phone,
          startAt: new Date(slot.startAt),
          endAt: new Date(slot.endAt),
          services,
          notes: input.notes,
          requestKey: input.requestKey,
          requestDigest: hash,
          expiresAt: new Date(Date.now() + config.holdHours * 3600000),
        },
      });
      await queueBookingMail(tx, created, "REQUESTED", "created");
      return created;
    });
    res
      .status(201)
      .json({
        appointment,
        message:
          "Solicitud enviada con éxito. El salón te responderá por correo.",
      });
  }),
);
router.patch(
  "/appointments/:id/cancel",
  wrap(async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(724030)`;
      const result = await tx.appointment.updateMany({
        where: {
          id,
          customerId: req.user.id,
          status: { in: ["PENDING", "CONFIRMED"] },
          startAt: { gt: new Date() },
        },
        data: { status: "CANCELLED", expiresAt: null },
      });
      if (!result.count)
        throw httpError(409, "No se puede cancelar esta cita.");
      await queueBookingMail(
        tx,
        await tx.appointment.findUnique({ where: { id } }),
        "CUSTOMER_CANCELLED",
        new Date().toISOString(),
      );
    });
    res.json({ ok: true });
  }),
);
router.post(
  "/appointments/:id/accept-proposal",
  rateLimit("accept-proposal", 30, 60),
  wrap(async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const appointment = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(724030)`;
      const old = await tx.appointment.findFirst({
        where: { id, customerId: req.user.id },
      });
      if (!old) throw httpError(404, "Cita no encontrada.");
      if (old.proposalAppointmentId)
        return tx.appointment.findUnique({
          where: { id: old.proposalAppointmentId },
        });
      if (
        old.status !== "CANCELLED" ||
        !old.proposedStartAt ||
        !old.proposedEndAt
      )
        throw httpError(409, "Esta cita no tiene propuesta disponible.");
      const date = crDate(old.proposedStartAt);
      if (date < crDate() || +old.proposedStartAt > Date.now() + 90 * 86400000)
        throw httpError(
          409,
          "La propuesta ya no está vigente. Elegí otro horario.",
        );
      if (
        (await tx.appointment.count({
          where: {
            customerId: req.user.id,
            status: "PENDING",
            expiresAt: { gt: new Date() },
          },
        })) >= 3
      )
        throw httpError(
          409,
          "Revisá tus solicitudes pendientes antes de aceptar otra.",
        );
      const cfg = await settings(tx),
        duration = (+old.proposedEndAt - +old.proposedStartAt) / 60000;
      const slot = buildSlots(
        cfg,
        date,
        duration,
        await busyFor(tx, date),
      ).find(
        (x) => +new Date(x.startAt) === +old.proposedStartAt && x.available,
      );
      if (!slot)
        throw httpError(
          409,
          "La propuesta ya no tiene cupo. Elegí otro horario en Reservar.",
        );
      const created = await tx.appointment.create({
        data: {
          customerId: req.user.id,
          customerName: req.user.name,
          phone: req.user.phone,
          startAt: old.proposedStartAt,
          endAt: old.proposedEndAt,
          services: old.services,
          notes: old.notes,
          requestKey: crypto.randomUUID(),
          requestDigest: digest({ proposal: id, customerId: req.user.id }),
          expiresAt: new Date(Date.now() + cfg.holdHours * 3600000),
        },
      });
      await tx.appointment.update({
        where: { id },
        data: { proposalAppointmentId: created.id },
      });
      await tx.auditEvent.create({
        data: {
          actorId: req.user.id,
          action: "AGENDA_ACCEPT_PROPOSAL",
          targetId: created.id,
        },
      });
      await queueBookingMail(tx, created, "REQUESTED", "created");
      return created;
    });
    res.status(201).json({ appointment });
  }),
);
router.use(requireAdminKey);
router.get(
  "/notifications",
  wrap(async (_req, res) => {
    const pending = await prisma.emailDelivery.count({
      where: { sentAt: null },
    });
    const failed = await prisma.emailDelivery.count({
      where: { sentAt: null, lastError: { not: null } },
    });
    res.json({ pending, failed });
  }),
);
router.get(
  "/admin/calendar",
  wrap(async (req, res) => {
    res.json(await monthSnapshot(monthSchema.parse(req.query.month), [], true));
  }),
);
router.get(
  "/settings",
  wrap(async (_req, res) => res.json({ settings: await settings() })),
);
router.put(
  "/settings",
  wrap(async (req, res) => {
    const input = settingsSchema.parse(req.body);
    if (
      new Set(input.weekly.map((x) => x.day)).size !== input.weekly.length ||
      new Set(input.overrides.map((x) => x.date)).size !==
        input.overrides.length
    )
      throw httpError(400, "Hay días repetidos.");
    [...input.weekly, ...input.overrides].forEach((x) =>
      validateRanges(x.ranges),
    );
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(724030)`;
      await tx.agendaConfig.upsert({
        where: { id: 1 },
        create: { id: 1, ...input },
        update: input,
      });
      await tx.auditEvent.create({
        data: { actorId: req.user.id, action: "AGENDA_SETTINGS" },
      });
    });
    res.json({ ok: true });
  }),
);
router.get(
  "/services",
  wrap(async (_req, res) =>
    res.json({
      services: await prisma.salonService.findMany({
        orderBy: { name: "asc" },
      }),
    }),
  ),
);
router.patch(
  "/services/:id",
  wrap(async (req, res) => {
    const input = z
      .object({ durationMinutes: z.number().int().min(15).max(720) })
      .strict()
      .parse(req.body);
    await prisma.salonService.update({
      where: { id: z.uuid().parse(req.params.id) },
      data: input,
    });
    res.json({ ok: true });
  }),
);
router.get(
  "/appointments",
  wrap(async (req, res) => {
    const date = dateSchema.parse(req.query.date || crDate());
    const appointments = await prisma.appointment.findMany({
      where: {
        startAt: {
          gte: instant(date, "00:00"),
          lt: new Date(+instant(date, "00:00") + 86400000),
        },
      },
      orderBy: { startAt: "asc" },
    });
    res.json({
      appointments: appointments.map((x) => ({
        ...x,
        status:
          x.status === "PENDING" && +x.expiresAt <= Date.now()
            ? "EXPIRED"
            : x.status,
      })),
    });
  }),
);
const manual = z
  .object({
    date: dateSchema,
    time,
    durationMinutes: z.number().int().min(15).max(720),
    customerName: z.string().trim().min(2).max(100),
    serviceSlug: z.string().trim().min(1).max(100).optional(),
    phone: z.string().trim().max(30).default(""),
    customerId: z.uuid().optional(),
    customerEmail: z.email().trim().toLowerCase().optional(),
    notes: z.string().trim().max(1000).default(""),
    blocked: z.boolean().default(false),
    requestKey: z.uuid(),
  })
  .strict();
export async function createManual(input, actorId) {
    input = manual.parse(input);
    const start = instant(input.date, input.time),
      end = new Date(+start + input.durationMinutes * 60000);
    const hash = digest(input);
    const appointment = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(724030)`;
      const old = await tx.appointment.findUnique({
        where: { requestKey: input.requestKey },
      });
      if (old) {
        if (old.requestDigest !== hash)
          throw httpError(409, "Solicitud repetida con otros datos.");
        return old;
      }
    if (start < new Date() || crDate(start) !== crDate(new Date(+end - 1)))
      throw httpError(400, "La cita debe ser futura y terminar el mismo día.");
      const busy = await busyFor(tx, input.date);
      if (busy.some((x) => overlaps(start, end, x.startAt, x.endAt)))
        throw httpError(409, "Ese horario se cruza con otra cita o bloqueo.");
      if (
        input.customerId &&
        !(await tx.user.findFirst({
          where: { id: input.customerId, active: true, role: "CUSTOMER" },
        }))
      )
        throw httpError(400, "Cliente no válido.");
      const linked = input.customerEmail
        ? await tx.user.findFirst({
            where: {
              email: input.customerEmail,
              active: true,
              role: "CUSTOMER",
            },
          })
        : null;
      if (input.customerEmail && !linked)
        throw httpError(
          400,
          "Ese correo no corresponde a un cliente registrado activo.",
        );
      const service =
        input.serviceSlug && !input.blocked
          ? await tx.salonService.findFirst({
              where: {
                slug: input.serviceSlug,
                active: true,
                category: { active: true },
              },
            })
          : null;
      if (input.serviceSlug && !input.blocked && !service)
        throw httpError(400, "Seleccioná un servicio vigente.");
      const created = await tx.appointment.create({
        data: {
          customerId: linked?.id || input.customerId,
          customerName: linked?.name || input.customerName,
          phone: linked?.phone || input.phone,
          startAt: start,
          endAt: end,
          status: input.blocked ? "BLOCKED" : "CONFIRMED",
          notes: input.notes,
          services: service
            ? [
                {
                  id: service.id,
                  slug: service.slug,
                  name: service.name,
                  durationMinutes: input.durationMinutes,
                },
              ]
            : [],
          requestKey: input.requestKey,
          requestDigest: hash,
        },
      });
      await tx.auditEvent.create({
        data: {
          actorId: actorId,
          action: input.blocked ? "AGENDA_BLOCK" : "AGENDA_MANUAL",
          targetId: created.id,
        },
      });
      return created;
    });
    return appointment;
}
router.post(
  "/manual",
  wrap(async (req, res) => {
    const appointment = await createManual(req.body, req.user.id);
    res.status(201).json({ appointment });
  }),
);
export async function updateAppointment(id, input, actorId, operationKey=null) {
    id = z.uuid().parse(id);
    input = z
      .object({
        status: z.enum(["CONFIRMED", "COMPLETED", "CANCELLED"]).optional(),
        date: dateSchema.optional(),
        time: time.optional(),
        durationMinutes: z.number().int().min(15).max(720).optional(),
        responseMessage: z.string().trim().max(1000).optional(),
        proposedDate: dateSchema.optional(),
        proposedTime: time.optional(),
      })
      .strict()
      .refine(
        (x) => x.status || (x.date && x.time),
        "Elegí un estado o una nueva fecha y hora.",
      )
      .parse(input);
    const appointment = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(724030)`;
      const requestHash=digest({id,input,actorId});
      if(operationKey){
        const previous=await tx.posOperation.findUnique({where:{key:operationKey}});
        if(previous){if(previous.digest!==requestHash)throw httpError(409,'Operación repetida con otros datos.');return previous.result.appointment;}
      }
      const old = await tx.appointment.findUnique({ where: { id } });
      if (!old) throw httpError(404, "Cita no encontrada.");
      if (
        input.status === old.status &&
        !input.date &&
        !input.time &&
        !input.durationMinutes &&
        !input.proposedDate &&
        (!input.responseMessage ||
          input.responseMessage === old.responseMessage)
      )
        return old;
      if (
        input.status === "CANCELLED" &&
        old.customerId &&
        !input.responseMessage?.trim()
      )
        throw httpError(400, "Escribí el motivo para la clienta.");
      if (Boolean(input.proposedDate) !== Boolean(input.proposedTime))
        throw httpError(400, "Completá fecha y hora de la propuesta.");
      if (
        (input.proposedDate || input.proposedTime) &&
        input.status !== "CANCELLED"
      )
        throw httpError(
          400,
          "La propuesta acompaña el rechazo de la cita original.",
        );
      const proposedStartAt = input.proposedDate
        ? instant(input.proposedDate, input.proposedTime)
        : null;
      const proposedEndAt = proposedStartAt
        ? new Date(+proposedStartAt + (+old.endAt - +old.startAt))
        : null;
      if (proposedStartAt) {
        if (
          +proposedStartAt < Date.now() ||
          +proposedStartAt > Date.now() + 90 * 86400000
        )
          throw httpError(
            400,
            "La propuesta debe estar dentro de los próximos 90 días.",
          );
        const cfg = await settings(tx);
        const others = (await busyFor(tx, input.proposedDate)).filter(
          (x) => !(+x.startAt === +old.startAt && +x.endAt === +old.endAt),
        );
        if (
          !buildSlots(
            cfg,
            input.proposedDate,
            (+old.endAt - +old.startAt) / 60000,
            others,
          ).some(
            (x) => +new Date(x.startAt) === +proposedStartAt && x.available,
          )
        )
          throw httpError(
            409,
            "La propuesta no cabe en los horarios abiertos o está ocupada.",
          );
      }
      const expired = old.status === "PENDING" && +old.expiresAt <= Date.now();
      const allowed = {
        PENDING: ["CONFIRMED", "CANCELLED"],
        CONFIRMED: ["COMPLETED", "CANCELLED"],
        BLOCKED: ["CANCELLED"],
      };
      if (
        expired ||
        !allowed[old.status] ||
        (input.status && !allowed[old.status].includes(input.status))
      )
        throw httpError(409, "Este cambio de estado ya no está disponible.");
      const start =
        input.date && input.time
          ? instant(input.date, input.time)
          : old.startAt;
      const end = new Date(
        +start +
          (input.durationMinutes || (+old.endAt - +old.startAt) / 60000) *
            60000,
      );
      if (
        (input.date || input.time || input.durationMinutes) &&
        (+start < Date.now() || crDate(start) !== crDate(new Date(+end - 1)))
      )
        throw httpError(400, "Revisá la fecha y duración.");
      if (input.status === "COMPLETED" && +start > Date.now())
        throw httpError(409, "La cita todavía no ha empezado.");
      if (input.status !== "CANCELLED" && input.status !== "COMPLETED") {
        const other = await tx.appointment.findMany({
          where: {
            ...activeWhere(),
            id: { not: id },
            startAt: { lt: end },
            endAt: { gt: start },
          },
        });
        if (other.length)
          throw httpError(409, "El nuevo horario ya está ocupado.");
      }
      const updated = await tx.appointment.update({
        where: { id },
        data: {
          startAt: start,
          endAt: end,
          ...(input.responseMessage !== undefined
            ? { responseMessage: input.responseMessage }
            : {}),
          ...(input.status === "CANCELLED"
            ? { proposedStartAt, proposedEndAt }
            : {}),
          ...(input.status ? { status: input.status } : {}),
          ...(input.status === "CONFIRMED" || input.status === "CANCELLED"
            ? { expiresAt: null }
            : {}),
        },
      });
      await tx.auditEvent.create({
        data: { actorId: actorId, action: "AGENDA_UPDATE", targetId: id },
      });
      if (
        ["CONFIRMED", "CANCELLED"].includes(input.status) ||
        input.date ||
        input.time
      )
        await queueBookingMail(
          tx,
          updated,
          input.status || "RESCHEDULED",
          updated.updatedAt.toISOString(),
        );
      if(operationKey)await tx.posOperation.create({data:{key:operationKey,digest:requestHash,result:{appointment:JSON.parse(JSON.stringify(updated))}}});
      return updated;
    });
    return appointment;
}
router.patch(
  "/appointments/:id",
  wrap(async (req, res) => {
    const appointment = await updateAppointment(req.params.id, req.body, req.user.id);
    res.json({ appointment });
  }),
);
export default router;
