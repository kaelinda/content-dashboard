import { randomBytes, scryptSync } from "node:crypto";
import { writeFileSync, existsSync } from "node:fs";
if (existsSync(".env.local")) {
  console.error(
    ".env.local already exists; it was NOT overwritten. Edit it manually to rotate credentials.",
  );
  process.exit(1);
}
const password = randomBytes(18).toString("base64url");
const salt = randomBytes(16).toString("hex");
const hash = `scrypt:${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
writeFileSync(
  ".env.local",
  `APP_URL=http://localhost:3000\nOWNER_PASSWORD_HASH=${hash}\nDATABASE_URL=\nDATA_DIR=.data\nSTORAGE_DRIVER=local\nOAUTH_CLIENTS_JSON=[]\n`,
  { mode: 0o600, flag: "wx" },
);
console.log(
  `\nContent Hub initialized.\nOwner password (shown only now): ${password}\n\nStore it in your password manager. Start with: npm run dev\nOpen: http://localhost:3000\n`,
);
