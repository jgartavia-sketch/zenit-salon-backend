import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { prisma } from "../lib/prisma.js";
export const tokenOptions = {
  algorithms: ["HS256"],
  issuer: "zenit-salon",
  audience: "zenit-web",
};
export function signToken(account, kind = "customer") {
  return jwt.sign(
    { sub: account.id, kind, sv: account.sessionVersion },
    config.jwtSecret,
    {
      algorithm: "HS256",
      issuer: tokenOptions.issuer,
      audience: tokenOptions.audience,
      expiresIn: kind === "customer" && account.role !== "ADMIN" ? "7d" : "8h",
    },
  );
}
function authenticate(kind) {
  return async (req, res, next) => {
    let payload;
    try {
      const token = (req.get("authorization") || "").replace(/^Bearer /, "");
      payload = jwt.verify(token, config.jwtSecret, tokenOptions);
      if (
        typeof payload !== "object" ||
        payload.kind !== kind ||
        typeof payload.sub !== "string"
      )
        throw Error();
    } catch {
      return res
        .status(401)
        .json({ error: "La sesión venció o no es válida." });
    }
    try {
      const account = await (
        kind === "staff" ? prisma.staffAccount : prisma.user
      ).findUnique({ where: { id: payload.sub } });
      if (!account || !account.active || payload.sv !== account.sessionVersion)
        return res.status(401).json({ error: "La sesión ya no es válida." });
      if (kind === "staff") req.staff = account;
      else req.user = account;
      next();
    } catch (error) {
      next(error);
    }
  };
}
export const requireAuth = authenticate("customer");
export const requireStaff = authenticate("staff");
// Kept export name to avoid disrupting existing routes. Shared API keys are no longer accepted.
export function requireAdminKey(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== "ADMIN")
      return res
        .status(403)
        .json({ error: "Acceso exclusivo para la administración." });
    next();
  });
}
