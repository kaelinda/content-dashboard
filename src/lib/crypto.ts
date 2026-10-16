import {
  randomBytes,
  createHash,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
export const digestToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export const randomToken = () => "hub_" + randomBytes(32).toString("base64url");
export function equalSecret(a: string, b: string): boolean {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `scrypt:${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function verifyPassword(password: string, encoded: string): boolean {
  const [kind, salt, hash] = encoded.split(":");
  if (
    kind !== "scrypt" ||
    !salt ||
    !hash ||
    !/^[a-f0-9]{32}$/.test(salt) ||
    !/^[a-f0-9]{128}$/.test(hash) ||
    password.length > 1024
  )
    return false;
  return equalSecret(scryptSync(password, salt, 64).toString("hex"), hash);
}
export const pkceChallenge = (verifier: string) =>
  createHash("sha256").update(verifier).digest("base64url");
