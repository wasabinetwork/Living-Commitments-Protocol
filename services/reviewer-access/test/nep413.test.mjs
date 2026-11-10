import assert from "node:assert/strict";
import test from "node:test";
import { webcrypto } from "node:crypto";
import { borshString, concatBytes, encodeBase64, u32le } from "../dist/src/encoding.js";
import { verifyNep413Message } from "../dist/src/nep413.js";

globalThis.crypto ??= webcrypto;
const recipient = "console.example.test/reviewer-access";
const message = "{\"commitment_id\":\"24\",\"nonce_hex\":\"00\"}";
const nonce = new Uint8Array(32).fill(7);
const nonceHex = Array.from(nonce, (byte) => byte.toString(16).padStart(2, "0")).join("");

function encodeBase58(bytes) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let integer = BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
  let encoded = "";
  while (integer > 0n) {
    const digit = Number(integer % 58n);
    encoded = alphabet[digit] + encoded;
    integer /= 58n;
  }
  const zeroes = bytes.findIndex((byte) => byte !== 0);
  return "1".repeat(zeroes < 0 ? bytes.length : zeroes) + (encoded || "");
}

async function signNep413(keyPair, publicKeyBytes, callbackUrl) {
  const callback = callbackUrl === undefined
    ? new Uint8Array([0])
    : concatBytes(new Uint8Array([1]), borshString(callbackUrl));
  const payload = concatBytes(borshString(message), nonce, borshString(recipient), callback);
  const digest = await crypto.subtle.digest("SHA-256", concatBytes(u32le(2_147_484_061), payload));
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, keyPair.privateKey, digest));
  return {
    account_id: "maintainer.testnet",
    public_key: `ed25519:${encodeBase58(publicKeyBytes)}`,
    signature: encodeBase64(signature),
    nonce_hex: nonceHex,
    recipient,
    ...(callbackUrl === undefined ? {} : { callback_url: callbackUrl }),
  };
}

test("NEP-413 verifier accepts the bound Ed25519 message", async () => {
  const keyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const publicKeyBytes = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));
  const signed = await signNep413(keyPair, publicKeyBytes, "https://console.example.test/callback");
  assert.equal(await verifyNep413Message(message, signed, recipient, ["https://console.example.test"]), true);
});

test("NEP-413 verifier rejects changed payload, recipient, and untrusted callback origin", async () => {
  const keyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const publicKeyBytes = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));
  const signed = await signNep413(keyPair, publicKeyBytes);
  assert.equal(await verifyNep413Message(`${message} `, signed, recipient, []), false);
  assert.equal(await verifyNep413Message(message, { ...signed, recipient: "other.example.test" }, recipient, []), false);

  const untrustedCallback = await signNep413(keyPair, publicKeyBytes, "https://attacker.example.test/callback");
  assert.equal(await verifyNep413Message(message, untrustedCallback, recipient, ["https://console.example.test"]), false);
});
