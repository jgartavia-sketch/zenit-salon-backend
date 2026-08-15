import { Router } from "express";
import { config } from "../config.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.post("/", requireAuth, async (req, res, next) => {
  try {
    const active = await prisma.referralCode.findFirst({
      where: { ownerId: req.user.id, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    if (active) return res.json({ code: active.code, expiry: active.expiresAt });

    const code = `ZEN-${crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
    const expiry = new Date(Date.now() + config.referralExpiryHours * 60 * 60 * 1000);
    const created = await prisma.referralCode.create({
      data: { code, ownerId: req.user.id, expiresAt: expiry },
    });
    res.status(201).json({ code: created.code, expiry: created.expiresAt });
  } catch (error) {
    next(error);
  }
});

export default router;

