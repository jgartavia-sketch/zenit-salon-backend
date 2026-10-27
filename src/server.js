import { startBookingMailWorker } from "./lib/booking-mail.js";
import { app } from "./app.js";
import { config } from "./config.js";
import { prisma } from "./lib/prisma.js";

const stopMailWorker = startBookingMailWorker();
const server = app.listen(config.port, () => {
  console.log(`Zénit API activa en puerto ${config.port}`);
});

async function shutdown(signal) {
  stopMailWorker();
  console.log(`${signal}: cerrando Zénit API`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
