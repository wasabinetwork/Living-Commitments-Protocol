# Private Reviewer Access

This separate Cloudflare Worker provides signed, consent-based access to encrypted evidence artifacts. It does not add email addresses, chat handles, or public upload inboxes. Its NEP-413 authorization policy requires current FullAccess keys, reads commitment roles from finalized NEAR state, stores access metadata in a dedicated D1 database, and stores ciphertext in a private R2 bucket.

The browser encrypts a selected artifact with a fresh AES-256-GCM key and wraps that key to the requesting reviewer’s X25519 key using HPKE. The maintainer signs a grant bound to the exact request, artifact digest, reviewer key fingerprint, scope, and expiry. The Worker cannot decrypt the file or wrapped content key. D1 retains each request and approval/rejection's canonical payload and complete NEP-413 signature envelope for the consent-retention period; API list responses do not expose those records. A reviewer must sign a one-time download request; the maintainer can reject a request or revoke a grant. Revocation blocks later downloads but cannot erase a copy already received.

## Deployment status

The preview/testnet Worker is deployed at `https://lcp-reviewer-access.wasabinetwork.workers.dev` as version `b1882f4b-0c2c-4646-8956-f7795bb8c167`, with the local security remediations and the 2-of-3 RPC quorum. It uses a dedicated `lcp-reviewer-access-preview` D1 database (`5fa2e1a4-1e56-420e-a1bd-4f20d28be89d`) and private `lcp-reviewer-private-artifacts-preview` R2 bucket, plus rate-limit namespace `1004` (production uses `1002`). Migrations 0001–0004 are applied; `/health` returned `ok` on 2026-11-14. Health confirms availability only; manual authorization and quorum acceptance remain pending. Preview records, rate-limit counters, and ciphertext are isolated from production. Console integration remains disabled until the remediations pass acceptance and follow-up review.

Production is deployed at `https://reviewer-access.lcp.gama.works` as version `70b4c65b-e247-43be-8e55-12e0f61c2d46`, with the local security remediations. It uses the `lcp-reviewer-access` D1 database (`db61970b-8e54-452c-bec3-07668e25828b`), private `lcp-reviewer-private-artifacts` R2 bucket, and rate-limit namespace `1002`. It allows only `https://lcp.gama.works`, disables `workers.dev` and version preview URLs, and binds a custom domain in the `gama.works` zone so zone-level WAF rules can cover it. The separate preview config allows only `https://preview.lcp-preview.pages.dev`, uses dedicated D1/R2/rate-limit resources, and retains the `workers.dev` endpoint. Neither config contains localhost or a wildcard Pages origin. Migrations 0001–0004 are applied independently to production and preview databases; both `/health` endpoints returned `ok` on 2026-11-14. Finding-specific acceptance and independent follow-up review remain pending, so keep Console integration and production use gated.

For a new environment, create a dedicated private R2 bucket and D1 database, set their names and IDs in Wrangler configuration, and apply the migrations. Do not enable public R2 access. Keep reviewer storage separate from public evaluator artifacts and the event indexer.

## Local development

The preview Wrangler config uses local D1/R2 emulation. Production and preview each bind their own D1 database and private R2 bucket; keep those resources separate when creating another environment and apply migrations to that environment's database. Do not enable public R2 access. The reviewer-access bucket must remain separate from public evaluator artifacts and the event indexer.

Reviewer authorization reads require a 2-of-3 quorum from `NEAR_RPC_URL` and the comma-separated `NEAR_RPC_FALLBACK_URLS`. The testnet defaults are FastNear, dRPC, and Intear; all three must use HTTPS and distinct origins and the same NEAR network. Each request first requires two providers to agree on the highest finalized block, then pins access-key, maintainer, and evaluation reads to that block hash. The Worker accepts a result only when two providers return the same canonical response and the matching block hash and height. A rate limit or outage at one provider is tolerated while the other two agree; disagreement, an isolated higher block, invalid configuration, or fewer than two responses fails closed with `NEAR_UNAVAILABLE`. Distinct origins do not prove independent infrastructure, so production configuration and review must confirm provider/operator diversity. This quorum is for authorization reads and does not replace the event indexer's archival block source.

Rate limiting runs in stages: Cloudflare's per-IP binding allows at most 60 signed API requests per minute before the Worker reads the request body; a D1 counter limits each verified NEP-413 public key to 10 requests per minute before NEAR authorization reads; and a verified account is limited to 30 actions per hour. The D1 authorization cap of 30 per minute is charged only after key validation and any required maintainer-role check, so an unregistered key cannot consume that authenticated allowance. D1 counters are exact within each environment and isolated between production and preview. Cloudflare's per-IP binding is approximate and local to the receiving data center, so it provides burst control rather than a global quota. If the edge binding is unavailable, the Worker fails closed.

Reviewer request and grant lists use signed authorizations that expire within ten minutes of finalized NEAR time; the Console creates them with a five-minute lifetime. This prevents a list signature from becoming valid again after its one-time nonce record is eventually pruned.

```sh
npm install
npx wrangler d1 migrations apply lcp-reviewer-access --local --config services/reviewer-access/wrangler.preview.jsonc
npm run types --workspace=@lcp/reviewer-access
npm run dev:reviewer-access
```

Local development overrides `APP_ORIGINS` to `http://localhost:3000`; deployed configs remain exact-origin only. Set `NEXT_PUBLIC_LCP_REVIEWER_ACCESS_URL` in the Console environment to the local Worker URL to enable the panel. The recipient string must match `ACCESS_RECIPIENT` in Wrangler configuration. Local request signatures use the same testnet contract and account state as the LCP Console. The Worker only accepts exact configured app origins and only returns ciphertext after a valid reviewer NEP-413 signature, unexpired grant, matching account, scope, and unused nonce.

Production and preview each have an isolated D1 database, private R2 bucket, rate-limit namespace, and `*/15 * * * *` cleanup Cron. They can be deployed independently after applying migrations to their respective databases:

```sh
npm run deploy --workspace=@lcp/reviewer-access
npm run deploy:preview --workspace=@lcp/reviewer-access
```

Before deploying another environment, configure its exact Console origin and apply all four migrations remotely. Do not enable public R2 access. Each environment's cleanup Cron expires pending requests, deletes ciphertext for revoked or expired grants, and retries deletion of unlinked ciphertext left by an interrupted grant write. Active grant/request metadata is retained while access is valid; terminal grant and request metadata, including consent signatures, is deleted after 90 days from the later of closure and last access. Rejected/expired requests without grants are retained 90 days from resolution. Access-event rows are kept for 90 days; nonce and rate-limit rows are removed after their replay and throttle windows.

## Data boundary

- R2 contains only AES-GCM ciphertext, addressed by a random opaque key with no public bucket URL.
- D1 contains request/grant metadata, encrypted HPKE key envelopes, bounded access counters, and access timestamps. It never stores a plaintext artifact, data-encryption key, wallet private key, or reviewer decryption private key.
- NEAR transaction arguments and public LCP views do not contain reviewer contact details or artifact plaintext.
- Access logs record reviewer account and time, not source IP addresses.
- Rate limits and one-time nonce records protect signed actions from replay and automated abuse.
- Every NEP-413 signed action requires a current FullAccess wallet key, checked against finalized NEAR state. FunctionCall keys are rejected in the local source even when they remain valid transaction keys for other purposes.

This is an implementation boundary, not a claim that recipients cannot copy a file after decrypting it. A production deployment still needs a custom authenticated domain, operational backup/retention rules, and security review.
