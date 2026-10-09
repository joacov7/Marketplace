import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Cifrado simétrico de secretos guardados en la base (p. ej. el Access Token de Mercado Pago
 * de cada comercio). AES-256-GCM con nonce aleatorio: confidencialidad + integridad (si alguien
 * altera el texto cifrado, `openSecret` falla en vez de devolver basura).
 *
 * La clave sale de una env var de la plataforma (nunca de la base): quien lea un backup de la
 * base no puede usar los tokens. Se acepta cualquier frase larga; se deriva a 32 bytes con
 * SHA-256. Formato almacenado: `v1$<nonceB64>$<tagB64>$<cipherB64>`.
 */
const MIN_KEY_LEN = 32;

function deriveKey(keyMaterial: string): Buffer {
  if (!keyMaterial || keyMaterial.length < MIN_KEY_LEN) {
    throw new Error(`secretbox_key_too_short: la clave de cifrado debe tener al menos ${MIN_KEY_LEN} caracteres`);
  }
  return createHash("sha256").update(keyMaterial, "utf8").digest();
}

export function sealSecret(plain: string, keyMaterial: string): string {
  const key = deriveKey(keyMaterial);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1$${nonce.toString("base64")}$${tag.toString("base64")}$${enc.toString("base64")}`;
}

/** Descifra. Lanza si la clave no corresponde o el texto fue alterado. */
export function openSecret(sealed: string, keyMaterial: string): string {
  const parts = sealed.split("$");
  if (parts.length !== 4 || parts[0] !== "v1") throw new Error("secretbox_bad_format");
  const key = deriveKey(keyMaterial);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(parts[1]!, "base64"));
  decipher.setAuthTag(Buffer.from(parts[2]!, "base64"));
  try {
    return Buffer.concat([decipher.update(Buffer.from(parts[3]!, "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("secretbox_cannot_open");
  }
}
