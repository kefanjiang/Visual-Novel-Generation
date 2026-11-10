const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** Short URL-safe random id, e.g. "p_k3j9x0a1b2c3". */
export function newId(prefix: string, length = 12): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `${prefix}_${out}`;
}
