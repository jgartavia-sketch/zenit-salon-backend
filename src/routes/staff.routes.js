import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { config } from "../config.js";
import { prisma } from "../lib/prisma.js";
import { pointsFromColones } from "../lib/points.js";
import { publicUser } from "../lib/public-user.js";
import { sendPointsAddedEmail } from "../lib/email.js";
import { requireStaff } from "../middleware/auth.js";

const router = Router();

const loginSchema = z.object({
  email: z.email().trim().toLowerCase(),
  password: z.string().min(1).max(100),
});

function createStaffToken(staff) {
  return jwt.sign(
    { sub: staff.id, kind: "staff" },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn },
  );
}

function publicStaff(staff) {
  return { id: staff.id, name: staff.name, email: staff.email };
}

router.post("/login", async (req, res, next) => {
  try {
    const input = loginSchema.parse(req.body);
    const staff = await prisma.staffAccount.findUnique({ where: { email: input.email } });

    if (!staff || !staff.active || !(await bcrypt.compare(input.password, staff.passwordHash))) {
      return res.status(401).json({ error: "Correo o contraseña incorrectos." });
    }

    res.json({ token: createStaffToken(staff), staff: publicStaff(staff) });
  } catch (error) {
    next(error);
  }
});

router.get("/me", requireStaff, (req, res) => {
  res.json({ staff: publicStaff(req.staff) });
});

const customerSearchSchema = z.object({
  email: z.email().trim().toLowerCase(),
});

router.get("/customers/search", requireStaff, async (req, res, next) => {
  try {
    const input = customerSearchSchema.parse({ email: req.query.email });
    const customer = await prisma.user.findUnique({ where: { email: input.email } });

    if (!customer || customer.role !== "CUSTOMER") {
      return res.status(404).json({ error: "No existe un cliente con ese correo." });
    }

    res.json({ customer: publicUser(customer) });
  } catch (error) {
    next(error);
  }
});

const awardPointsSchema = z.object({
  customerId: z.uuid(),
  amountColones: z.coerce.number().int().min(100).max(100_000_000),
  invoiceNumber: z.string().trim().max(100).optional().or(z.literal("")),
  description: z.string().trim().min(3).max(200).default("Compra o servicio confirmado"),
});

router.post("/points", requireStaff, async (req, res, next) => {
  try {
    const input = awardPointsSchema.parse(req.body);
    const invoiceNumber = input.invoiceNumber
      ? input.invoiceNumber.replace(/\s+/g, " ").toUpperCase()
      : null;
    const points = pointsFromColones(input.amountColones);

    if (points <= 0) {
      return res.status(400).json({ error: "El monto no genera puntos." });
    }

    if (invoiceNumber) {
      const duplicate = await prisma.pointMovement.findUnique({ where: { invoiceNumber } });
      if (duplicate) {
        return res.status(409).json({ error: "Esa factura ya fue utilizada para acreditar puntos." });
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const customer = await tx.user.findUnique({ where: { id: input.customerId } });
      if (!customer || customer.role !== "CUSTOMER") {
        const error = new Error("CUSTOMER_NOT_FOUND");
        error.code = "CUSTOMER_NOT_FOUND";
        throw error;
      }

      const updated = await tx.user.update({
        where: { id: customer.id },
        data: { purchasePoints: { increment: points } },
      });

      const movement = await tx.pointMovement.create({
        data: {
          userId: customer.id,
          type: "PURCHASE",
          points,
          amountColones: input.amountColones,
          description: input.description,
          invoiceNumber,
          createdByStaffId: req.staff.id,
        },
      });

      return { customer: updated, movement };
    });

    let emailSent = false;
    try {
      const notification = await sendPointsAddedEmail(result.customer, {
        points,
        amountColones: input.amountColones,
        invoiceNumber,
        newPurchasePoints: result.customer.purchasePoints,
      });
      emailSent = notification.sent;
    } catch (emailError) {
      console.error("No se pudo enviar el aviso de puntos:", emailError?.message || emailError);
    }

    res.status(201).json({
      ok: true,
      points,
      customer: publicUser(result.customer),
      movementId: result.movement.id,
      notifications: { emailSent },
    });
  } catch (error) {
    if (error?.code === "CUSTOMER_NOT_FOUND") {
      return res.status(404).json({ error: "El cliente ya no existe." });
    }
    if (error?.code === "P2002" && error?.meta?.target?.includes("invoiceNumber")) {
      return res.status(409).json({ error: "Esa factura ya fue utilizada para acreditar puntos." });
    }
    next(error);
  }
});

export default router;