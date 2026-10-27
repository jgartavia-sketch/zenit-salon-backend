import "dotenv/config";

const required = ["DATABASE_URL", "JWT_SECRET"];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Falta ${key} en las variables de entorno.`);
  }
}

if (process.env.JWT_SECRET.length < 32 || /reemplazar|example|changeme/i.test(process.env.JWT_SECRET)) throw new Error('JWT_SECRET debe ser aleatorio y tener al menos 32 caracteres.');
export const config = {
  port: Number(process.env.PORT || 4000),
  nodeEnv: process.env.NODE_ENV || "development",
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",

  frontendUrls: String(
    process.env.FRONTEND_URL || "http://localhost:3000",
  )
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean),

  resendApiKey: String(process.env.RESEND_API_KEY || "").trim(),
  bookingEmailFrom: String(process.env.BOOKING_EMAIL_FROM || process.env.EMAIL_FROM || "").trim(),
  bookingOwnerEmail: String(process.env.BOOKING_OWNER_EMAIL || process.env.OWNER_EMAIL || "").trim().toLowerCase(),
  bookingSiteUrl: String(process.env.BOOKING_SITE_URL || "https://zenitsalon.com").replace(/\/$/, ""),

  supportEmail: process.env.SUPPORT_EMAIL || "systemlabcr@gmail.com",

  emailHost: process.env.EMAIL_HOST || "smtp.gmail.com",
  emailPort: Number(process.env.EMAIL_PORT || 465),
  emailSecure:
    String(process.env.EMAIL_SECURE || "true").toLowerCase() === "true",
  emailUser: String(process.env.EMAIL_USER || "").trim(),
  emailPass: String(process.env.EMAIL_PASS || "").trim(),
  emailFrom: String(process.env.EMAIL_FROM || "").trim(),

  referralRewardPoints: Math.max(
    0,
    Number(process.env.REFERRAL_REWARD_POINTS || 100),
  ),
  referralExpiryHours: Math.max(
    1,
    Number(process.env.REFERRAL_EXPIRY_HOURS || 72),
  ),

  cloudinaryCloudName: String(
    process.env.CLOUDINARY_CLOUD_NAME || "",
  ).trim(),

  cloudinaryApiKey: String(
    process.env.CLOUDINARY_API_KEY || "",
  ).trim(),

  cloudinaryApiSecret: String(
    process.env.CLOUDINARY_API_SECRET || "",
  ).trim(),
};