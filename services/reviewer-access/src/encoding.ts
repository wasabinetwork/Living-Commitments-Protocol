const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

export function u32le(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error("Length is outside the Borsh u32 range.");
  }
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]);
}

export function borshString(value: string): Uint8Array {
  const bytes = utf8(value);
  return concatBytes(u32le(bytes.byteLength), bytes);
}

export function decodeHex(value: string, bytes: number): Uint8Array {
  if (value.length !== bytes * 2 || !/^[0-9a-f]+$/.test(value)) {
    throw new Error("Expected lowercase hexadecimal with the required byte length.");
  }
  return Uint8Array.from({ length: bytes }, (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16));
}

export function encodeHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function decodeBase64(value: string, expectedBytes?: number): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error("Malformed base64 data.");
  }
  const decoded = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  if (encodeBase64(decoded) !== value || (expectedBytes !== undefined && decoded.byteLength !== expectedBytes)) {
    throw new Error("Base64 data is not canonical or has an invalid length.");
  }
  return decoded;
}

export function encodeBase64(value: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < value.byteLength; offset += 0x8000) {
    binary += String.fromCharCode(...value.subarray(offset, Math.min(offset + 0x8000, value.byteLength)));
  }
  return btoa(binary);
}

export function decodeBase58(value: string, expectedBytes: number): Uint8Array {
  if (!value || !/^[1-9A-HJ-NP-Za-km-z]+$/.test(value)) throw new Error("Malformed base58 value.");
  let integer = 0n;
  for (const character of value) {
    integer = integer * 58n + BigInt(BASE58_ALPHABET.indexOf(character));
  }
  const reversed: number[] = [];
  while (integer > 0n) {
    reversed.push(Number(integer & 0xffn));
    integer >>= 8n;
  }
  reversed.reverse();
  const leadingZeroes = value.match(/^1*/)?.[0].length ?? 0;
  const decoded = new Uint8Array(leadingZeroes + reversed.length);
  decoded.set(reversed, leadingZeroes);
  if (decoded.byteLength !== expectedBytes) throw new Error("Base58 value has an invalid byte length.");
  return decoded;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Canonical JSON cannot contain a non-finite number.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  throw new Error("Canonical JSON contains an unsupported value.");
}

export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer);
  return new Uint8Array(digest);
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return encodeHex(await sha256(bytes));
}
