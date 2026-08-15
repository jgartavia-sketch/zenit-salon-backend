import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { pointsFromColones } from "../lib/points.js";
import { publicUser } from "../lib/public-user.js";
import { requireAdminKey } from "../middleware/auth.js";

const router = Router();
router.use(requireAdminKey);

router.get("/customers", async (req, res, next) => {
  try {
    const q = String(req.query.q || "").trim();
    const users = await prisma.user.findMany({
      where: q ? { OR: [
        { email: { contains: q, mode: "insensitive" } },
        { name: { contains: q, mode: "insensitive" } },
        { phone: { contains: q } },
        { customerCode: { contains: q, mode: "insensitive" } },
      ] } : undefined,
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    res.json({ customers: users.map(publicUser) });
  } catch (error) {
    next(error);
  }
});

const purchaseSchema = z.object({
  email: z.email().trim().toLowerCase(),
  amountColones: z.coerce.number().int().min(100),
  description: z.string().trim().min(3).max(200).default("Compra o servicio confirmado"),
  referenceId: z.string().trim().min(3).max(100).optional(),
});

router.post("/points/purchase", async (req, res, next) => {
  try {
    const input = purchaseSchema.parse(req.body);
    const points = pointsFromColones(input.amountColones);
    const user = await prisma.user.findUnique({ where: { email: input.email } });
    if (!user) return res.status(404).json({ error: "No existe un cliente con ese correo." });

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.user.update({
        where: { id: user.id },
        data: { purchasePoints: { increment: points } },
      });
      await tx.pointMovement.create({
        data: {
          userId: user.id,
          type: "PURCHASE",
          points,
          amountColones: input.amountColones,
          description: input.description,
          referenceId: input.referenceId,
        },
      });
      return result;
    });
    res.json({ ok: true, points, customer: publicUser(updated) });
  } catch (error) {
    next(error);
  }
});

const adjustmentSchema = z.object({
  email: z.email().trim().toLowerCase(),
  points: z.coerce.number().int().refine((value) => value !== 0),
  description: z.string().trim().min(3).max(200),
});

router.post("/points/adjust", async (req, res, next) => {
  try {
    const input = adjustmentSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: input.email } });
    if (!user) return res.status(404).json({ error: "No existe un cliente con ese correo." });
    if (user.purchasePoints + input.points < 0) {
      return res.status(400).json({ error: "El cliente no tiene suficientes puntos." });
    }
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.user.update({
        where: { id: user.id },
        data: { purchasePoints: { increment: input.points } },
      });
      await tx.pointMovement.create({
        data: {
          userId: user.id,
          type: input.points > 0 ? "ADJUSTMENT" : "REDEMPTION",
          points: input.points,
          description: input.description,
        },
      });
      return result;
    });
    res.json({ ok: true, customer: publicUser(updated) });
  } catch (error) {
    next(error);
  }
});

const serviceRequestStatusSchema = z.enum(["PENDING", "CONTACTED", "SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]);

router.get("/service-requests", async (req, res, next) => {
  try {
    const status = String(req.query.status || "").trim().toUpperCase();
    const where = status ? { status: serviceRequestStatusSchema.parse(status) } : undefined;
    const requests = await prisma.serviceRequest.findMany({ where, orderBy: { createdAt: "desc" }, take: 200 });
    res.json({ requests });
  } catch (error) {
    next(error);
  }
});

router.patch("/service-requests/:id/status", async (req, res, next) => {
  try {
    const status = serviceRequestStatusSchema.parse(req.body.status);
    const request = await prisma.serviceRequest.update({ where: { id: req.params.id }, data: { status } });
    res.json({ ok: true, request });
  } catch (error) {
    next(error);
  }
});

export default router;
