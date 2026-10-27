import { createHash } from "node:crypto";
import { prisma } from "../lib/prisma.js";
export function rateLimit(scope, limit, minutes = 15, account = false) {
  return async (req, res, next) => {
    try {
      const identity = account
        ? String(req.body?.email || "")
            .trim()
            .toLowerCase()
        : req.ip;
      const bucket = Math.floor(Date.now() / (minutes * 60000));
      const key = createHash("sha256")
        .update(`${scope}:${identity}:${bucket}`)
        .digest("hex");
      const expiresAt = new Date((bucket + 2) * minutes * 60000);
      const value = await prisma.rateBucket.upsert({
        where: { key },
        create: { key, expiresAt },
        update: { count: { increment: 1 } },
      });
      if (Math.random() < 0.01)
        void prisma.rateBucket
          .deleteMany({ where: { expiresAt: { lt: new Date() } } })
          .catch(() => {});
      if (value.count > limit)
        return res
          .set("Retry-After", String(minutes * 60))
          .status(429)
          .json({ error: "Demasiados intentos. Esperá unos minutos." });
      next();
    } catch (error) {
      next(error);
    }
  };
}
