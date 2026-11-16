import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const U32 = (value) => {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value);
  return out;
};

const U64 = (value) => {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(BigInt(value));
  return out;
};

const U128 = (value) => {
  let n = BigInt(value);
  if (n < 0n || n >= (1n << 128n)) throw new RangeError('u128 out of range');
  const out = Buffer.alloc(16);
  for (let i = 0; i < 16; i += 1) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return out;
};

const borshString = (value) => {
  const data = Buffer.from(value, 'utf8');
  return Buffer.concat([U32(data.length), data]);
};

const borshBytes = (value) => Buffer.concat([U32(value.length), value]);
const sha256 = (value) => createHash('sha256').update(value).digest();
const domain = (name) => Buffer.concat([Buffer.from(name, 'ascii'), Buffer.from([0])]);
const domainHash = (name, data) => sha256(Buffer.concat([domain(name), data]));
const repeated = (byte, length = 32) => Buffer.alloc(length, byte);
const hex = (data) => data.toString('hex');

function testKey(label) {
  // Public, deterministic test material. Never use these keys outside vectors.
  const seed = sha256(Buffer.from(`LCP/NEP141/VECTORS/NOT-A-SECRET/${label}`, 'ascii'));
  const privateKey = createPrivateKey({
    key: Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'),
      seed,
    ]),
    format: 'der',
    type: 'pkcs8',
  });
  const publicDer = createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
  return { privateKey, publicKey: publicDer.subarray(publicDer.length - 32) };
}

function signersFor(digest, keys, count = 4) {
  return [...keys]
    .sort((a, b) => Buffer.compare(a.publicKey, b.publicKey))
    .slice(0, count)
    .map(({ privateKey, publicKey }) => ({
      publicKey,
      signature: sign(null, digest, privateKey),
    }));
}

function envelope(messageBytes, signatures) {
  return Buffer.concat([
    borshBytes(messageBytes),
    U32(signatures.length),
    ...signatures.flatMap(({ publicKey, signature }) => [publicKey, signature]),
  ]);
}

function serializeIntent(fields) {
  return Buffer.concat([
    Buffer.from([fields.schema_version]),
    borshString(fields.chain_id),
    Buffer.from(fields.genesis_hash, 'hex'),
    borshString(fields.core_account_id),
    Buffer.from(fields.instance_id, 'hex'),
    U32(fields.committee_epoch),
    U64(fields.transfer_id),
    U64(fields.commitment_id),
    Buffer.from([fields.kind]),
    Buffer.from([1]),
    U32(fields.tranche_epoch),
    borshString(fields.token_account_id),
    borshString(fields.recipient_id),
    U128(fields.amount_raw),
    Buffer.from([fields.origin_method]),
    Buffer.from(fields.token_code_hash, 'hex'),
    U128(fields.ft_transfer_deposit_yocto),
    U64(fields.ft_transfer_gas_tgas),
  ]);
}

function serializeCertificate(fields, intentBytes) {
  return Buffer.concat([
    Buffer.from([fields.schema_version]),
    intentBytes,
    Buffer.from(fields.intent_hash, 'hex'),
    Buffer.from(fields.origin_transaction_hash, 'hex'),
    Buffer.from(fields.origin_receipt_id, 'hex'),
    Buffer.from(fields.origin_block_hash, 'hex'),
    U64(fields.origin_block_height),
    Buffer.from(fields.token_receipt_id, 'hex'),
    U32(fields.token_action_index),
    Buffer.from(fields.outcome_block_hash, 'hex'),
    U64(fields.outcome_block_height),
    Buffer.from([fields.outcome]),
  ]);
}

function serializeRotation(fields) {
  return Buffer.concat([
    Buffer.from([fields.schema_version]),
    borshString(fields.chain_id),
    Buffer.from(fields.genesis_hash, 'hex'),
    borshString(fields.core_account_id),
    Buffer.from(fields.instance_id, 'hex'),
    U32(fields.old_epoch),
    U32(fields.new_epoch),
    U64(fields.proposal_generation),
    ...fields.new_keys.map((key) => Buffer.from(key, 'hex')),
    U64(fields.activate_at_ns),
  ]);
}

function serializeCancellation(fields) {
  return Buffer.concat([
    Buffer.from([fields.schema_version]),
    borshString(fields.chain_id),
    Buffer.from(fields.genesis_hash, 'hex'),
    borshString(fields.core_account_id),
    Buffer.from(fields.instance_id, 'hex'),
    U32(fields.old_epoch),
    U32(fields.new_epoch),
    U64(fields.proposal_generation),
    Buffer.from(fields.proposal_digest, 'hex'),
  ]);
}

const oldKeys = Array.from({ length: 5 }, (_, i) => testKey(`OLD-COMMITTEE-${i + 1}`));
const newKeys = Array.from({ length: 5 }, (_, i) => testKey(`NEW-COMMITTEE-${i + 1}`))
  .sort((a, b) => Buffer.compare(a.publicKey, b.publicKey));

const intent = {
  schema_version: 1,
  chain_id: 'lcp-vector-test',
  genesis_hash: hex(repeated(0xa1)),
  core_account_id: 'lcp-core-vector.testnet',
  instance_id: hex(repeated(0x22)),
  committee_epoch: 7,
  transfer_id: '9007199254740993',
  commitment_id: '42',
  kind: 0,
  tranche_epoch: 2,
  token_account_id: 'usdc-vector.testnet',
  recipient_id: 'beneficiary-vector.testnet',
  amount_raw: '9007199254740993',
  origin_method: 0,
  token_code_hash: hex(repeated(0x33)),
  ft_transfer_deposit_yocto: '1',
  ft_transfer_gas_tgas: '25',
};
const intentBytes = serializeIntent(intent);
const intentHash = domainHash('LCP/NEP141/INTENT/V1', intentBytes);

const certificate = {
  schema_version: 1,
  intent,
  intent_hash: hex(intentHash),
  origin_transaction_hash: hex(repeated(0x44)),
  origin_receipt_id: hex(repeated(0x55)),
  origin_block_hash: hex(repeated(0x66)),
  origin_block_height: '300000000',
  token_receipt_id: hex(repeated(0x77)),
  token_action_index: 0,
  outcome_block_hash: hex(repeated(0x88)),
  outcome_block_height: '300000001',
  outcome: 0,
};
const certificateBytes = serializeCertificate(certificate, intentBytes);
const certificateDigest = domainHash('LCP/NEP141/RECOVERY/V1', certificateBytes);
const recoverySignatures = signersFor(certificateDigest, oldKeys);
const recoveryEnvelope = envelope(certificateBytes, recoverySignatures);

const rotation = {
  schema_version: 2,
  chain_id: intent.chain_id,
  genesis_hash: intent.genesis_hash,
  core_account_id: intent.core_account_id,
  instance_id: intent.instance_id,
  old_epoch: 7,
  new_epoch: 8,
  proposal_generation: '3',
  new_keys: newKeys.map(({ publicKey }) => hex(publicKey)),
  activate_at_ns: '1800000000000000000',
};
const rotationBytes = serializeRotation(rotation);
const rotationDigest = domainHash('LCP/NEP141/COMMITTEE-ROTATION/V2', rotationBytes);
const rotationSignatures = signersFor(rotationDigest, oldKeys);
const rotationEnvelope = envelope(rotationBytes, rotationSignatures);

const cancellation = {
  schema_version: 2,
  chain_id: intent.chain_id,
  genesis_hash: intent.genesis_hash,
  core_account_id: intent.core_account_id,
  instance_id: intent.instance_id,
  old_epoch: 7,
  new_epoch: 8,
  proposal_generation: '3',
  proposal_digest: hex(rotationDigest),
};
const cancellationBytes = serializeCancellation(cancellation);
const cancellationDigest = domainHash('LCP/NEP141/ROTATION-CANCEL/V2', cancellationBytes);
const cancellationSignatures = signersFor(cancellationDigest, oldKeys);
const cancellationEnvelope = envelope(cancellationBytes, cancellationSignatures);

const signatureVector = (entries) => entries.map(({ publicKey, signature }) => ({
  public_key_hex: hex(publicKey),
  signature_hex: hex(signature),
}));

const output = {
  format: 'lcp.receipt-recovery.v1.golden-vectors',
  generated_by: 'generate.mjs using Node.js built-in Ed25519 and SHA-256',
  test_only: true,
  warning: 'All fields, hashes, accounts, keys, and signatures are synthetic. Public deterministic seeds are embedded in the generator. Never use these vectors or keys for a real NEAR network or committee.',
  encodings: {
    integer_endianness: 'little-endian',
    strings: 'u32 byte length followed by UTF-8 bytes',
    hashes_and_keys: 'raw bytes in field order',
    signed_message: 'Ed25519 signs the 32-byte domain-separated SHA-256 digest directly',
    signatures_sorted_by: 'raw public-key bytes ascending',
  },
  committee_public_keys_hex: oldKeys.map(({ publicKey }) => hex(publicKey)).sort(),
  recovery: {
    intent,
    intent_domain_hex: hex(domain('LCP/NEP141/INTENT/V1')),
    intent_borsh_hex: hex(intentBytes),
    intent_sha256_hex: hex(intentHash),
    certificate,
    certificate_domain_hex: hex(domain('LCP/NEP141/RECOVERY/V1')),
    certificate_borsh_hex: hex(certificateBytes),
    certificate_digest_hex: hex(certificateDigest),
    signatures: signatureVector(recoverySignatures),
    envelope_borsh_hex: hex(recoveryEnvelope),
    envelope_base64: recoveryEnvelope.toString('base64'),
  },
  governance: {
    rotation: {
      message: rotation,
      domain_hex: hex(domain('LCP/NEP141/COMMITTEE-ROTATION/V2')),
      borsh_hex: hex(rotationBytes),
      digest_hex: hex(rotationDigest),
      signatures: signatureVector(rotationSignatures),
      envelope_borsh_hex: hex(rotationEnvelope),
      envelope_base64: rotationEnvelope.toString('base64'),
    },
    cancellation: {
      message: cancellation,
      domain_hex: hex(domain('LCP/NEP141/ROTATION-CANCEL/V2')),
      borsh_hex: hex(cancellationBytes),
      digest_hex: hex(cancellationDigest),
      signatures: signatureVector(cancellationSignatures),
      envelope_borsh_hex: hex(cancellationEnvelope),
      envelope_base64: cancellationEnvelope.toString('base64'),
    },
  },
  negative_cases_for_future_consumers: [
    { case: 'change_intent_amount_without_resigning', expected: 'intent-hash or signature rejection' },
    { case: 'remove_domain_nul_byte', expected: 'digest mismatch' },
    { case: 'flip_one_signature_bit', expected: 'signature rejection' },
    { case: 'set_ed25519_s_to_group_order_or_larger', expected: 'strict verifier rejection' },
    { case: 'use_small_order_committee_public_key', expected: 'configuration and strict verifier rejection' },
    { case: 'use_noncanonical_public_key_encoding', expected: 'strict verifier rejection' },
    { case: 'use_small_order_signature_r', expected: 'strict verifier rejection' },
    { case: 'use_noncanonical_signature_r_encoding', expected: 'strict verifier rejection' },
    { case: 'sort_signatures_by_text_not_raw_key_bytes', expected: 'canonical-order rejection' },
    { case: 'append_trailing_borsh_byte', expected: 'exact-slice rejection' },
    { case: 'replace_vec_length_with_oversized_value', expected: 'bounded-parser rejection before allocation' },
    { case: 'set_schema_version_to_unsupported_value', expected: 'version rejection' },
    { case: 'repeat_a_signer_key', expected: 'duplicate-key rejection' },
    { case: 'submit_only_three_signatures', expected: 'quorum rejection' },
  ],
};

const outPath = join(dirname(fileURLToPath(import.meta.url)), 'golden-vectors.json');
await writeFile(outPath, `${JSON.stringify(output, null, 2)}\n`);
process.stdout.write(`Wrote ${outPath}\n`);
