// Disabled until the POS implements this provider. Never exposed to browser code.
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { secretEqual } from "../lib/security.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { validDate, instant } from "../lib/agenda.js";
import { z } from "zod";
const router = Router();
router.use(
  (req, res, next) => {
    const key = process.env.ZENIT_CONNECT_KEY;
    if (!key || key.length < 32)
      return res
        .status(503)
        .json({ error: "Integración pendiente de configuración." });
    if (!secretEqual(req.get("x-systemlab-key"), key))
      return res.status(401).json({ error: "Acceso no autorizado." });
    next();
  },
  rateLimit("pos-connect", 300, 1),
);
router.get("/catalog", async (_req, res, next) => {
  try {
    res.json({
      provider: "zenit",
      products: await prisma.product.findMany({
        where: { active: true, category: { active: true } },
      }),
      services: await prisma.salonService.findMany({
        where: { active: true, category: { active: true } },
      }),
    });
  } catch (e) {
    next(e);
  }
});
router.get("/appointments", async (req, res, next) => {
  try {
    const date = z.string().refine(validDate).parse(req.query.date);
    res.json({
      provider: "zenit",
      timeZone: "America/Costa_Rica",
      appointments: await prisma.appointment.findMany({
        where: {
          startAt: {
            gte: instant(date, "00:00"),
            lt: new Date(+instant(date, "00:00") + 86400000),
          },
        },
        orderBy: { startAt: "asc" },
      }),
    });
  } catch (e) {
    next(e);
  }
});
export default router;
