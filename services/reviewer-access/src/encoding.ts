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
  if (value.length % 4 !== 0) {
    throw new Error("Malformed base64 data.");
  }
  if (expectedBytes !== undefined) {
    if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0 || value.length !== 4 * Math.ceil(expectedBytes / 3)) {
      throw new Error("Base64 data has an invalid encoded length.");
    }
  }
  const hasDoublePadding = value.endsWith("==");
  const hasPadding = hasDoublePadding || value.endsWith("=");
  const paddingLength = hasDoublePadding ? 2 : hasPadding ? 1 : 0;
  const contentLength = value.length - paddingLength;
  if ((paddingLength === 2 && contentLength % 4 !== 2)
      || (paddingLength === 1 && contentLength % 4 !== 3)
      || (paddingLength === 0 && contentLength % 4 !== 0)) {
    throw new Error("Malformed base64 padding.");
  }
  for (let index = 0; index < contentLength; index += 1) {
    const code = value.charCodeAt(index);
    const alphabetic = (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
    const numeric = code >= 48 && code <= 57;
    if (!alphabetic && !numeric && code !== 43 && code !== 47) {
      throw new Error("Malformed base64 data.");
    }
  }
  for (let index = contentLength; index < value.length; index += 1) {
    if (value.charCodeAt(index) !== 61) throw new Error("Malformed base64 padding.");
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
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 1
      || value.length === 0 || value.length > Math.ceil(expectedBytes * Math.log(256) / Math.log(58))) {
    throw new Error("Base58 value has an invalid encoded length.");
  }
  if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(value)) throw new Error("Malformed base58 value.");
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
