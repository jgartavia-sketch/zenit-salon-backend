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

import agendaRoutes from './routes/agenda.routes.js';
import orderRoutes from './routes/orders.routes.js';
import connectRoutes from './routes/pos-connect.routes.js';
import { rateLimit } from './middleware/rate-limit.js';
export const app = express();
// Set only to a known number of trusted reverse proxies. Never trust arbitrary X-Forwarded-For.
const proxyHops = Number(process.env.TRUST_PROXY_HOPS || 0);
if (Number.isInteger(proxyHops) && proxyHops > 0 && proxyHops <= 3) app.set('trust proxy', proxyHops);

app.disable("x-powered-by");
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || config.frontendUrls.includes(origin)) return callback(null, true);
    callback(Object.assign(new Error("Origen no autorizado."), {status:403}));
  },
}));

app.use(express.json({ limit: "100kb" }));
app.use(morgan(':method :url :status :response-time ms', {skip:req=>req.path.includes('/customers')}));
app.use('/api', rateLimit('api', 600, 5));
app.use('/api', (_req,res,next)=>{res.set('Cache-Control','no-store');next();});
app.use('/api/agenda', agendaRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/pos-connect', connectRoutes);

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

  if (error?.status >= 400 && error.status < 500) return res.status(error.status).json({error:error.message});
  if (error?.type === 'entity.too.large') return res.status(413).json({error:'La solicitud es demasiado grande.'});
  if (error instanceof SyntaxError && 'body' in error) return res.status(400).json({error:'JSON inválido.'});
  if (error?.code === 'P2025') return res.status(404).json({error:'Registro no encontrado.'});
  if (error?.code === 'P2003') return res.status(409).json({error:'Ese registro tiene información relacionada.'});
  console.error('API_ERROR', error?.code || error?.name || 'UNKNOWN');

  res.status(500).json({
    error: "Ocurrió un error interno. Reintentá o contactá al salón.",
  });
});