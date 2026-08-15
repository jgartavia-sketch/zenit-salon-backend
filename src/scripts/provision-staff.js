import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";

function readStaff(number) {
  const name = String(process.env[`STAFF_${number}_NAME`] || "").trim();
  const email = String(process.env[`STAFF_${number}_EMAIL`] || "").trim().toLowerCase();
  const password = String(process.env[`STAFF_${number}_PASSWORD`] || "");

  if (!name || !email || !password) {
    throw new Error(`Faltan STAFF_${number}_NAME, STAFF_${number}_EMAIL o STAFF_${number}_PASSWORD.`);
  }
  if (password.length < 8) {
    throw new Error(`STAFF_${number}_PASSWORD debe tener al menos 8 caracteres.`);
  }

  return { name, email, password };
}

async function provision() {
  const accounts = [readStaff(1), readStaff(2)];

  if (accounts[0].email === accounts[1].email) {
    throw new Error("Los dos empleados deben usar correos diferentes.");
  }

  for (const account of accounts) {
    const passwordHash = await bcrypt.hash(account.password, 12);
    await prisma.staffAccount.upsert({
      where: { email: account.email },
      update: { name: account.name, passwordHash, active: true },
      create: {
        name: account.name,
        email: account.email,
        passwordHash,
        active: true,
      },
    });
    console.info(`Cuenta staff lista: ${account.email}`);
  }
}

try {
  await provision();
} finally {
  await prisma.$disconnect();
}