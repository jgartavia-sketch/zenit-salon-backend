import { PrismaClient } from "@prisma/client";

export const prisma = globalThis.__zenitPrisma || new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__zenitPrisma = prisma;
}

