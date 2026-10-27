import { createHash, timingSafeEqual } from "node:crypto";
export function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}
export const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function secretEqual(a, b) {
  if (!a || !b) return false;
  return timingSafeEqual(
    createHash("sha256").update(a).digest(),
    createHash("sha256").update(b).digest(),
  );
}
export function safeImage(value) {
  if (/^\/(?!\/)[a-zA-Z0-9_./%-]+$/.test(value) && !value.includes(".."))
    return true;
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password;
  } catch {
    return false;
  }
}
