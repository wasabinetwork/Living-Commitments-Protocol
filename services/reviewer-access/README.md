# Private Reviewer Access

This separate Cloudflare Worker provides signed, consent-based access to encrypted evidence artifacts. It does not add email addresses, chat handles, or public upload inboxes. The Worker uses NEP-413 account signatures, reads current commitment roles from finalized NEAR state, stores access metadata in a dedicated D1 database, and stores ciphertext in a private R2 bucket.

The browser encrypts a selected artifact with a fresh AES-256-GCM key and wraps that key to the requesting reviewer’s X25519 key using HPKE. The maintainer signs a grant bound to the exact request, artifact digest, reviewer key fingerprint, scope, and expiry. The Worker cannot decrypt the file or wrapped content key. D1 retains the reviewer request and maintainer approval/rejection NEP-413 signature envelopes for consent audit; API list responses do not expose those signatures. A reviewer must sign a one-time download request; the maintainer can reject a request or revoke a grant. Revocation blocks later downloads but cannot erase a copy already received.

## Local development

The checked-in Wrangler config uses local D1/R2 emulation. Before deploying, create a dedicated private R2 bucket and D1 database, replace the placeholder database ID, and apply the migrations. Do not enable public R2 access. The reviewer-access bucket must remain separate from public evaluator artifacts and the event indexer.

```sh
npm install
npx wrangler d1 migrations apply lcp-reviewer-access --local --config services/reviewer-access/wrangler.jsonc
npm run types --workspace=@lcp/reviewer-access
npm run dev:reviewer-access
```

Set `NEXT_PUBLIC_LCP_REVIEWER_ACCESS_URL` in the Console environment to the local Worker URL to enable the panel. The recipient string must match `ACCESS_RECIPIENT` in Wrangler configuration. Local request signatures use the same testnet contract and account state as the LCP Console. The Worker only accepts exact configured app origins and only returns ciphertext after a valid reviewer NEP-413 signature, unexpired grant, matching account, scope, and unused nonce.

Before a remote deploy, create a dedicated private R2 bucket and D1 database, replace the placeholder database ID and bucket name, add the Console’s exact production origin, and apply all three migrations remotely. Do not enable public R2 access. The `*/15 * * * *` Worker trigger expires pending requests, deletes ciphertext for revoked or expired grants, and retries deletion of unlinked ciphertext left by an interrupted grant write. Active grant/request metadata is retained while access is valid; terminal grant and request metadata, including consent signatures, is deleted after 90 days from the later of closure and last access. Rejected/expired requests without grants are retained 90 days from resolution. Access-event rows are kept for 90 days; nonce and rate-limit rows are removed after their replay and throttle windows.

## Data boundary

- R2 contains only AES-GCM ciphertext, addressed by a random opaque key with no public bucket URL.
- D1 contains request/grant metadata, encrypted HPKE key envelopes, bounded access counters, and access timestamps. It never stores a plaintext artifact, data-encryption key, wallet private key, or reviewer decryption private key.
- NEAR transaction arguments and public LCP views do not contain reviewer contact details or artifact plaintext.
- Access logs record reviewer account and time, not source IP addresses.
- Rate limits and one-time nonce records protect signed actions from replay and automated abuse.
- The Worker rejects pending requests only after a maintainer FullAccess wallet key signs the rejection. Access-key identity is checked against finalized NEAR state on each signed action.

This is an implementation boundary, not a claim that recipients cannot copy a file after decrypting it. A production deployment still needs a custom authenticated domain, operational backup/retention rules, and security review.
