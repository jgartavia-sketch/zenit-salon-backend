import nodemailer from "nodemailer";
import { lookup } from "node:dns/promises";
import { config } from "../config.js";

let transporterPromise;

function emailIsConfigured() {
  return Boolean(config.emailUser && config.emailPass);
}

async function getTransporter() {
  if (!transporterPromise) {
    transporterPromise = (async () => {
      const { address } = await lookup(config.emailHost, { family: 4 });

      return nodemailer.createTransport({
        host: address,
        port: config.emailPort,
        secure: config.emailSecure,
        auth: {
          user: config.emailUser,
          pass: config.emailPass,
        },
        tls: {
          servername: config.emailHost,
        },
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 15_000,
      });
    })().catch((error) => {
      transporterPromise = undefined;
      throw error;
    });
  }
  return transporterPromise;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('\"', "&quot;")
    .replaceAll("'", "&#039;");
}

function emailFrom() {
  return config.emailFrom || `System Lab <${config.emailUser}>`;
}

export async function sendWelcomeEmail(customer) {
  if (!emailIsConfigured()) {
    console.warn("Correo de bienvenida omitido: EMAIL_USER o EMAIL_PASS no están configurados.");
    return { sent: false, reason: "not_configured" };
  }

  const safeName = escapeHtml(customer.name);
  const mailer = await getTransporter();
  const info = await mailer.sendMail({
    from: emailFrom(),
    to: customer.email,
    subject: "¡Bienvenido al Club Zénit!",
    text: `Hola ${customer.name},\n\nTu cuenta en el Club Zénit fue creada correctamente.\n\nTu identificación de cliente es ${customer.customerCode}. Desde ahora podés acumular puntos por tus compras y por tus referidos.\n\nIngresá en https://zenitsalon.com/login\n\nZénit Salón\nCorreo enviado por System Lab.`,
    html: `
      <div style="margin:0;background:#f3f4f6;padding:32px 16px;font-family:Arial,sans-serif;color:#172033">
        <div style="max-width:600px;margin:auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb">
          <div style="background:#111827;padding:28px;text-align:center">
            <h1 style="margin:0;color:#ffffff;font-size:25px">Zénit Salón</h1>
            <p style="margin:8px 0 0;color:#b9c0c8;font-weight:700">CLUB ZÉNIT</p>
          </div>
          <div style="padding:32px">
            <h2 style="margin:0 0 16px">¡Bienvenido, ${safeName}!</h2>
            <p style="line-height:1.6">Tu cuenta y tu tarjeta digital fueron creadas correctamente.</p>
            <div style="margin:24px 0;padding:18px;background:#f9fafb;border-left:4px solid #b9c0c8;border-radius:8px">
              <span style="display:block;color:#6b7280;font-size:12px;text-transform:uppercase">Identificación de cliente</span>
              <strong style="display:block;margin-top:6px;font-size:20px">${escapeHtml(customer.customerCode)}</strong>
            </div>
            <p style="line-height:1.6">Desde ahora podés acumular puntos por tus compras y también por tus referidos.</p>
            <p style="margin:28px 0;text-align:center">
              <a href="https://zenitsalon.com/login" style="display:inline-block;background:#b9c0c8;color:#111827;text-decoration:none;font-weight:700;padding:13px 22px;border-radius:8px">Ingresar a mi cuenta</a>
            </p>
            <p style="margin-bottom:0;color:#6b7280;font-size:13px">Este correo fue enviado por System Lab para Zénit Salón.</p>
          </div>
        </div>
      </div>
    `,
  });

  console.info(`Correo de bienvenida enviado a ${customer.email}: ${info.messageId}`);
  return { sent: true };
}

export async function sendReferralRegistrationEmail(owner, referredCustomer, points) {
  if (!emailIsConfigured()) {
    console.warn("Aviso de referido omitido: EMAIL_USER o EMAIL_PASS no están configurados.");
    return { sent: false, reason: "not_configured" };
  }

  const safeOwnerName = escapeHtml(owner.name);
  const safeReferredName = escapeHtml(referredCustomer.name);
  const mailer = await getTransporter();
  const info = await mailer.sendMail({
    from: emailFrom(),
    to: owner.email,
    subject: "¡Tu código de referido fue utilizado!",
    text: `Hola ${owner.name},\n\n${referredCustomer.name} se registró en el Club Zénit usando tu código. Sumaste ${points} puntos por referido.\n\nIngresá en https://zenitsalon.com/login para consultar tu saldo.\n\nZénit Salón\nCorreo enviado por System Lab.`,
    html: `
      <div style="margin:0;background:#f3f4f6;padding:32px 16px;font-family:Arial,sans-serif;color:#172033">
        <div style="max-width:600px;margin:auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb">
          <div style="background:#111827;padding:28px;text-align:center">
            <h1 style="margin:0;color:#ffffff;font-size:25px">Zénit Salón</h1>
            <p style="margin:8px 0 0;color:#b9c0c8;font-weight:700">NUEVO REFERIDO</p>
          </div>
          <div style="padding:32px">
            <h2 style="margin:0 0 16px">¡Buenas noticias, ${safeOwnerName}!</h2>
            <p style="line-height:1.6"><strong>${safeReferredName}</strong> se registró en el Club Zénit usando tu código.</p>
            <div style="margin:24px 0;padding:18px;background:#f9fafb;border-left:4px solid #b9c0c8;border-radius:8px">
              <span style="display:block;color:#6b7280;font-size:12px;text-transform:uppercase">Puntos ganados</span>
              <strong style="display:block;margin-top:6px;font-size:24px">+${points} puntos</strong>
            </div>
            <p style="margin:28px 0;text-align:center">
              <a href="https://zenitsalon.com/login" style="display:inline-block;background:#b9c0c8;color:#111827;text-decoration:none;font-weight:700;padding:13px 22px;border-radius:8px">Ver mi cuenta</a>
            </p>
            <p style="margin-bottom:0;color:#6b7280;font-size:13px">Este correo fue enviado por System Lab para Zénit Salón.</p>
          </div>
        </div>
      </div>
    `,
  });

  console.info(`Aviso de referido enviado a ${owner.email}: ${info.messageId}`);
  return { sent: true };
}

export async function sendPointsAddedEmail(customer, award) {
  if (!emailIsConfigured()) {
    console.warn("Aviso de puntos omitido: EMAIL_USER o EMAIL_PASS no están configurados.");
    return { sent: false, reason: "not_configured" };
  }

  const invoiceText = award.invoiceNumber
    ? `Factura: ${award.invoiceNumber}\n`
    : "";
  const invoiceHtml = award.invoiceNumber
    ? `<p style="margin:8px 0 0;color:#4b5563">Factura: <strong>${escapeHtml(award.invoiceNumber)}</strong></p>`
    : "";

  const mailer = await getTransporter();
  const info = await mailer.sendMail({
    from: emailFrom(),
    to: customer.email,
    subject: `¡Sumaste ${award.points} puntos en Club Zénit!`,
    text: `Hola ${customer.name},\n\nAgregamos ${award.points} puntos por una compra o servicio de ₡${award.amountColones.toLocaleString("es-CR")}.\n${invoiceText}\nTu nuevo saldo por compras es de ${award.newPurchasePoints} puntos.\n\nPodés revisar tu cuenta en https://zenitsalon.com/login\n\nZénit Salón\nCorreo enviado por System Lab.`,
    html: `
      <div style="margin:0;background:#f3f4f6;padding:32px 16px;font-family:Arial,sans-serif;color:#172033">
        <div style="max-width:600px;margin:auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb">
          <div style="background:#111827;padding:28px;text-align:center">
            <h1 style="margin:0;color:#ffffff;font-size:25px">Zénit Salón</h1>
            <p style="margin:8px 0 0;color:#b9c0c8;font-weight:700">PUNTOS ACREDITADOS</p>
          </div>
          <div style="padding:32px">
            <h2 style="margin:0 0 16px">¡Hola, ${escapeHtml(customer.name)}!</h2>
            <p style="line-height:1.6">Tu visita sigue moviendo tus recompensas.</p>
            <div style="margin:24px 0;padding:20px;background:#f9fafb;border-left:4px solid #b9c0c8;border-radius:8px">
              <span style="display:block;color:#6b7280;font-size:12px;text-transform:uppercase">Puntos añadidos</span>
              <strong style="display:block;margin-top:6px;font-size:30px;color:#111827">+${award.points} puntos</strong>
              <p style="margin:10px 0 0;color:#4b5563">Monto registrado: <strong>₡${award.amountColones.toLocaleString("es-CR")}</strong></p>
              ${invoiceHtml}
            </div>
            <p style="line-height:1.6">Tu nuevo saldo por compras es de <strong>${award.newPurchasePoints} puntos</strong>.</p>
            <p style="margin:28px 0;text-align:center">
              <a href="https://zenitsalon.com/login" style="display:inline-block;background:#b9c0c8;color:#111827;text-decoration:none;font-weight:700;padding:13px 22px;border-radius:8px">Ver mis puntos</a>
            </p>
            <p style="margin-bottom:0;color:#6b7280;font-size:13px">Este correo fue enviado por System Lab para Zénit Salón.</p>
          </div>
        </div>
      </div>
    `,
  });

  console.info(`Aviso de puntos enviado a ${customer.email}: ${info.messageId}`);
  return { sent: true };
}