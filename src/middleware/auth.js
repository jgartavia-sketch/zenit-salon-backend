import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { prisma } from "../lib/prisma.js";

function bearerToken(req) {
  const header = req.get("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

export async function requireAuth(req, res, next) {
  try {
    const token = bearerToken(req);
    if (!token) return res.status(401).json({ error: "Debés iniciar sesión." });

    const payload = jwt.verify(token, config.jwtSecret);
    if (payload.kind === "staff") {
      return res.status(401).json({ error: "Esta sesión no corresponde a un cliente." });
    }

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) return res.status(401).json({ error: "La sesión ya no es válida." });

    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: "La sesión venció o no es válida." });
  }
}

export async function requireStaff(req, res, next) {
  try {
    const token = bearerToken(req);
    if (!token) return res.status(401).json({ error: "Debés iniciar sesión como empleado." });

    const payload = jwt.verify(token, config.jwtSecret);
    if (payload.kind !== "staff") {
      return res.status(401).json({ error: "Esta sesión no corresponde al personal." });
    }

    const staff = await prisma.staffAccount.findUnique({ where: { id: payload.sub } });
    if (!staff || !staff.active) {
      return res.status(401).json({ error: "La cuenta del empleado no está activa." });
    }

    req.staff = staff;
    next();
  } catch {
    return res.status(401).json({ error: "La sesión venció o no es válida." });
  }
}

export function requireAdminKey(req, res, next) {
  if (req.get("x-admin-key") !== config.adminApiKey) {
    return res.status(401).json({ error: "Acceso administrativo no autorizado." });
  }
  next();
}