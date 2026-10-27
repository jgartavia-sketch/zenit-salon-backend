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
} from "../lib/agenda.js";
const router = Router();
router.use(requireAuth);
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
  return tx.agendaConfig.upsert({
    where: { id: 1 },
    create: { id: 1 },
    update: {},
  });
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
router.get(
  "/availability",
  wrap(async (req, res) => {
    const date = dateSchema.parse(req.query.date);
    const ids = z
      .array(z.string().min(1).max(100))
      .min(1)
      .max(10)
      .parse(String(req.query.services || "").split(","));
    if (new Set(ids).size !== ids.length)
      throw httpError(400, "Hay servicios repetidos.");
    if (
      date < crDate() ||
      instant(date, "00:00") > new Date(Date.now() + 90 * 86400000)
    )
      throw httpError(400, "Elegí una fecha dentro de los próximos 90 días.");
    const { duration } = await servicesFor(prisma, ids);
    const config = await settings();
    res.json({
      date,
      timeZone: "America/Costa_Rica",
      durationMinutes: duration,
      slots: buildSlots(config, date, duration, await busyFor(prisma, date)),
    });
  }),
);
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
      return tx.appointment.create({
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
    });
    res.status(201).json({ appointment });
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
    });
    res.json({ ok: true });
  }),
);
router.use(requireAdminKey);
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
    phone: z.string().trim().max(30).default(""),
    customerId: z.uuid().optional(),
    customerEmail: z.email().trim().toLowerCase().optional(),
    notes: z.string().trim().max(1000).default(""),
    blocked: z.boolean().default(false),
    requestKey: z.uuid(),
  })
  .strict();
router.post(
  "/manual",
  wrap(async (req, res) => {
    const input = manual.parse(req.body);
    const start = instant(input.date, input.time),
      end = new Date(+start + input.durationMinutes * 60000);
    if (start < new Date() || crDate(start) !== crDate(new Date(+end - 1)))
      throw httpError(400, "La cita debe ser futura y terminar el mismo día.");
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
      const created = await tx.appointment.create({
        data: {
          customerId: linked?.id || input.customerId,
          customerName: linked?.name || input.customerName,
          phone: linked?.phone || input.phone,
          startAt: start,
          endAt: end,
          status: input.blocked ? "BLOCKED" : "CONFIRMED",
          notes: input.notes,
          services: [],
          requestKey: input.requestKey,
          requestDigest: hash,
        },
      });
      await tx.auditEvent.create({
        data: {
          actorId: req.user.id,
          action: input.blocked ? "AGENDA_BLOCK" : "AGENDA_MANUAL",
          targetId: created.id,
        },
      });
      return created;
    });
    res.status(201).json({ appointment });
  }),
);
router.patch(
  "/appointments/:id",
  wrap(async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const input = z
      .object({
        status: z.enum(["CONFIRMED", "COMPLETED", "CANCELLED"]).optional(),
        date: dateSchema.optional(),
        time: time.optional(),
        durationMinutes: z.number().int().min(15).max(720).optional(),
      })
      .strict()
      .refine(
        (x) => x.status || (x.date && x.time),
        "Elegí un estado o una nueva fecha y hora.",
      )
      .parse(req.body);
    const appointment = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(724030)`;
      const old = await tx.appointment.findUnique({ where: { id } });
      if (!old) throw httpError(404, "Cita no encontrada.");
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
          ...(input.status ? { status: input.status } : {}),
          ...(input.status === "CONFIRMED" || input.status === "CANCELLED"
            ? { expiresAt: null }
            : {}),
        },
      });
      await tx.auditEvent.create({
        data: { actorId: req.user.id, action: "AGENDA_UPDATE", targetId: id },
      });
      return updated;
    });
    res.json({ appointment });
  }),
);
export default router;
