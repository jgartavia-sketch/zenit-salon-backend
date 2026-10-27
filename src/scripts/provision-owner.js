import "dotenv/config";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
const input = z
  .object({
    name: z.string().min(3),
    email: z.email(),
    password: z
      .string()
      .min(12)
      .max(72)
      .refine((v) => Buffer.byteLength(v, "utf8") <= 72),
  })
  .parse({
    name: process.env.OWNER_NAME,
    email: process.env.OWNER_EMAIL?.trim().toLowerCase(),
    password: process.env.OWNER_PASSWORD,
  });
try {
  const current = await prisma.user.findUnique({
    where: { email: input.email },
  });
  await prisma.user.upsert({
    where: { email: input.email },
    create: {
      name: input.name,
      email: input.email,
      phone: process.env.OWNER_PHONE || "",
      passwordHash: await bcrypt.hash(input.password, 12),
      customerCode: `ZEN-${crypto.randomUUID()}`,
      role: "ADMIN",
    },
    update: {
      name: input.name,
      role: "ADMIN",
      active: true,
      passwordHash: await bcrypt.hash(input.password, 12),
      sessionVersion: { increment: 1 },
    },
  });
  console.info(
    current
      ? "Acceso de propietaria actualizado; sesiones anteriores revocadas."
      : "Acceso de propietaria creado.",
  );
} finally {
  await prisma.$disconnect();
}
