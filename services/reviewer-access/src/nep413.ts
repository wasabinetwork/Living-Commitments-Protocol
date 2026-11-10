import { borshString, concatBytes, decodeBase58, decodeBase64, u32le } from "./encoding.js";

const NEP413_PREFIX = 2_147_484_061;

export interface SignedWalletMessage {
  account_id: string;
  public_key: string;
  signature: string;
  nonce_hex: string;
  recipient: string;
  callback_url?: string;
}

export async function verifyNep413Message(
  message: string,
  signed: SignedWalletMessage,
  recipient: string,
  allowedOrigins: string[],
): Promise<boolean> {
  if (!signed || signed.recipient !== recipient) return false;
  if (!/^[a-z0-9._-]{2,64}$/.test(signed.account_id)) return false;
  if (!signed.public_key.startsWith("ed25519:")) return false;
  if (signed.callback_url !== undefined) {
    try {
      const callback = new URL(signed.callback_url);
      if (!allowedOrigins.includes(callback.origin) || callback.username || callback.password) return false;
    } catch {
      return false;
    }
  }

  let publicKey: Uint8Array;
  let signature: Uint8Array;
  let nonce: Uint8Array;
  try {
    publicKey = decodeBase58(signed.public_key.slice("ed25519:".length), 32);
    signature = decodeBase64(signed.signature, 64);
    nonce = Uint8Array.from(signed.nonce_hex.match(/.{2}/g)?.map((pair) => Number.parseInt(pair, 16)) ?? []);
    if (nonce.byteLength !== 32 || !/^[0-9a-f]{64}$/.test(signed.nonce_hex)) return false;
  } catch {
    return false;
  }

  const callback = signed.callback_url === undefined
    ? new Uint8Array([0])
    : concatBytes(new Uint8Array([1]), borshString(signed.callback_url));
  const payload = concatBytes(
    borshString(message),
    nonce,
    borshString(recipient),
    callback,
  );
  const digest = await crypto.subtle.digest(
    "SHA-256",
    Uint8Array.from(concatBytes(u32le(NEP413_PREFIX), payload)).buffer,
  );
  try {
    const key = await crypto.subtle.importKey("raw", Uint8Array.from(publicKey).buffer, { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "Ed25519" }, key, Uint8Array.from(signature).buffer, digest);
  } catch {
    return false;
  }
}
