import { Router } from "express";
import bcrypt from "bcryptjs";
import { signToken } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { httpError } from "../lib/security.js";
import { z } from "zod";
import { config } from "../config.js";
import { prisma } from "../lib/prisma.js";
import { publicUser } from "../lib/public-user.js";
import { sendReferralRegistrationEmail, sendWelcomeEmail } from "../lib/email.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
const registerSchema = z.object({
  name: z.string().trim().min(3).max(100),
  email: z.email().trim().toLowerCase(),
  phone: z.string().trim().min(8).max(30),
  password: z.string().min(8).max(72).refine(value=>Buffer.byteLength(value,"utf8")<=72,"La contraseña supera los 72 bytes."),
  referral: z.string().trim().max(30).optional().or(z.literal("")),
});
const loginSchema = z.object({
  email: z.email().trim().toLowerCase(),
  password: z.string().min(1).max(100),
});

router.post("/register", rateLimit("register", 8, 60), async (req, res, next) => {
  try {
    const input = registerSchema.parse(req.body);
    const exists = await prisma.user.findUnique({ where: { email: input.email } });
    if (exists) return res.status(409).json({ error: "Ese correo ya tiene una cuenta." });

    let referralCode = null;
    if (input.referral) {
      referralCode = await prisma.referralCode.findUnique({
        where: { code: input.referral.toUpperCase() },
      });
      if (!referralCode || referralCode.usedAt || referralCode.expiresAt <= new Date()) {
        return res.status(400).json({ error: "El código de referido no es válido o ya venció." });
      }
    }

    const passwordHash = await bcrypt.hash(input.password,12);
    const registration = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(724032)`;
      const created = await tx.user.create({
        data: {
          customerCode: `ZEN-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
          name: input.name,
          email: input.email,
          phone: input.phone,
          passwordHash,
          referredById: referralCode?.ownerId,
        },
      });

      if (referralCode) {
        const claimed = await tx.referralCode.updateMany({
          where: { id: referralCode.id, usedAt: null, expiresAt: { gt: new Date() } },
          data: { usedAt: new Date(), usedById: created.id },
        });
        if (claimed.count !== 1) throw httpError(409, "Ese referido ya se utilizó o venció.");
        await tx.user.update({
          where: { id: referralCode.ownerId },
          data: {
            referralPoints: { increment: config.referralRewardPoints },
            referralCount: { increment: 1 },
          },
        });
        await tx.pointMovement.create({
          data: {
            userId: referralCode.ownerId,
            type: "REFERRAL",
            points: config.referralRewardPoints,
            description: `Referido confirmado: ${created.name}`,
            referenceId: `referral:${referralCode.id}`,
          },
        });
      }
      const referralOwner = referralCode
        ? await tx.user.findUnique({ where: { id: referralCode.ownerId } })
        : null;
      return { user: created, referralOwner };
    });

    const { user, referralOwner } = registration;
    const notificationJobs = [sendWelcomeEmail(user)];
    if (referralOwner) {
      notificationJobs.push(
        sendReferralRegistrationEmail(referralOwner, user, config.referralRewardPoints),
      );
    }

    const customer = publicUser(user);
    res.status(201).json({
      token: signToken(user),
      customer,
      notifications: {
        welcomeEmailQueued: true,
        referralEmailQueued: Boolean(referralOwner),
      },
    });

    // El registro ya está confirmado en la base de datos. El correo es una tarea
    // secundaria y nunca debe mantener bloqueada la respuesta al navegador.
    void Promise.allSettled(notificationJobs).then((notificationResults) => {
      notificationResults.forEach((result, index) => {
        if (result.status === "rejected") {
          const label = index === 0 ? "bienvenida" : "aviso de referido";
          console.error(`No se pudo enviar el correo de ${label}:`, result.reason?.message || result.reason);
        }
      });
    });
  } catch (error) {
    next(error);
  }
});

router.post("/login", rateLimit("login-ip", 40), rateLimit("login-account", 12, 15, true), async (req, res, next) => {
  try {
    const input = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: input.email } });
    if (!user || !user.active || !(await bcrypt.compare(input.password, user.passwordHash))) {
      return res.status(401).json({ error: "Correo o contraseña incorrectos." });
    }
    res.json({ token: signToken(user), customer: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const movements = await prisma.pointMovement.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const referral = await prisma.referralCode.findFirst({
      where: { ownerId: req.user.id, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    res.json({
      customer: publicUser(req.user),
      movements: movements.map((item) => ({
        id: item.id,
        kind: item.type,
        points: item.points,
        amount_colones: item.amountColones,
        description: item.description,
        created_at: item.createdAt,
      })),
      referral: referral ? { code: referral.code, expiry: referral.expiresAt } : null,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/logout', requireAuth, async (req,res,next) => {
  try { await prisma.user.update({where:{id:req.user.id},data:{sessionVersion:{increment:1}}}); res.json({ok:true}); } catch(error){next(error);}
});
router.post('/password', requireAuth, rateLimit('password', 8), async (req,res,next) => {
  try {
    const input = z.object({currentPassword:z.string().min(1).max(100),password:z.string().min(12).max(72).refine(v=>Buffer.byteLength(v,"utf8")<=72)}).parse(req.body);
    if (!await bcrypt.compare(input.currentPassword,req.user.passwordHash)) return res.status(401).json({error:'La contraseña actual no coincide.'});
    await prisma.user.update({where:{id:req.user.id},data:{passwordHash:await bcrypt.hash(input.password,12),sessionVersion:{increment:1}}});
    res.json({ok:true});
  } catch(error){next(error);}
});

export default router;