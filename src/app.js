import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { ZodError } from "zod";
import { config } from "./config.js";
import authRoutes from "./routes/auth.routes.js";
import referralRoutes from "./routes/referral.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import staffRoutes from "./routes/staff.routes.js";
import serviceRequestRoutes from "./routes/service-request.routes.js";
import catalogRoutes from "./routes/catalog.routes.js";
import uploadRoutes from "./routes/upload.routes.js";

export const app = express();

app.disable("x-powered-by");
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || config.frontendUrls.includes(origin)) return callback(null, true);
    callback(new Error("Origen no autorizado."));
  },
}));

app.use(express.json({ limit: "100kb" }));
app.use(morgan(config.nodeEnv === "production" ? "combined" : "dev"));

app.get("/", (_req, res) => res.json({
  service: "Zénit Salón API",
  status: "online",
  supportEmail: config.supportEmail,
}));

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.use("/api/auth", authRoutes);
app.use("/api/referrals", referralRoutes);
app.use("/api/service-requests", serviceRequestRoutes);
app.use("/api/catalog", catalogRoutes);
app.use("/api/staff", staffRoutes);
app.use("/api/uploads", uploadRoutes);
app.use("/api/admin", adminRoutes);

app.use((_req, res) => res.status(404).json({
  error: "Ruta no encontrada.",
}));

app.use((error, _req, res, _next) => {
  if (error instanceof ZodError) {
    return res.status(400).json({
      error: "Revisá los datos enviados.",
      details: error.issues,
    });
  }

  if (error?.code === "P2002") {
    return res.status(409).json({
      error: "Ese registro ya existe.",
    });
  }

  if (error?.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({
      error: "La imagen supera el tamaño máximo permitido de 5 MB.",
    });
  }

  console.error(error);

  res.status(500).json({
    error: error?.message || "Ocurrió un error interno.",
  });
});