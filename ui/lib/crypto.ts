import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

// Secrets kept in the database (the Resend API key) are sealed with a key
// derived from BETTER_AUTH_SECRET, so a database dump alone does not reveal them.
function key(purpose: string): Buffer {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not set");
  return Buffer.from(hkdfSync("sha256", secret, "k8s-agents-service", purpose, 32));
}

/** AES-256-GCM; the result is `v1.<iv>.<tag>.<ciphertext>` in base64url. */
export function seal(plaintext: string, purpose: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(purpose), iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), data].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

export function unseal(sealed: string, purpose: string): string {
  const [version, iv, tag, data] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || data === undefined) throw new Error("Unrecognized sealed value");
  const decipher = createDecipheriv("aes-256-gcm", key(purpose), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
