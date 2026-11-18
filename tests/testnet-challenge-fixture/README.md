# Testnet challenge fixture

Creates the live state needed for the Console deadline-clarity check (P1-2):
a sponsored NEAR commitment with an accepted compliant evaluation and an open
challenge. Testnet only.

## Prerequisites

- `npm ci` (the script uses the pinned `near-api-js` dev dependency).
- `.env.testnet` with `MAINTAINER_PRIVATE_KEY` and `SPONSOR_PRIVATE_KEY`.
  Account defaults are `lcpmaintainer.testnet`, `lcpsponsor.testnet`,
  `lcparbiter.testnet`, and `lcprecipient.testnet`. Override with
  `MAINTAINER_ACCOUNT_ID`, `SPONSOR_ACCOUNT_ID`, `ARBITER_ACCOUNT_ID`, and
  `BENEFICIARY_ACCOUNT_ID`.
- The sponsor needs roughly 0.5 NEAR for storage, escrow, and operations.

The script verifies each signing key against the account's on-chain access key
before sending anything. It never prints key material.

## Run

```sh
npm run fixture:challenge -- --dry-run   # key/account and balance checks only
npm run fixture:challenge                # create, fund, evaluate, challenge
```

Useful options:

```sh
--commitment-id=44   # resume an existing fixture instead of creating one
--no-challenge       # stop after the accepted evaluation
--stop-after-request # exit immediately after requesting evaluation (pending state)
--usdc               # settle the tranche in testnet USDC
--unregistered-beneficiary  # create/reuse a sponsor subaccount without USDC storage
--slow-evaluator     # use a deliberately delayed, non-WASM evaluator fetch
--setup-only         # stop after activation, before requesting evaluation
```

Temporal windows can be shortened for a quick expiry test:

```sh
CHALLENGE_WINDOW_SECONDS=600 RESOLUTION_TIMEOUT_SECONDS=90 \
  npm run fixture:challenge
```

The contract requires `challenge_window < evidence_ttl`, so keep
`EVIDENCE_TTL_SECONDS` (default 172800) larger than the challenge window.

On success the script prints the commitment, evaluation, challenge, and
transaction hashes plus the preview URL. Open the preview, enter the commitment
ID, and check:

- the localized resolution deadline;
- the countdown under "Anyone can expire this challenge in …";
- the expiry button label (`Available in …`, disabled) and its transition once
  the resolution deadline passes;
- the technical timestamp disclosure, including the raw nanosecond value.

## USDC registration shortfall

```sh
CHALLENGE_WINDOW_SECONDS=30 EVIDENCE_TTL_SECONDS=3600 \
  npm run fixture:challenge -- --usdc --unregistered-beneficiary --no-challenge
```

Escrow is funded with `ft_transfer_call` against the verified testnet USDC
contract. The beneficiary defaults to `usdc-unregistered.<sponsor>`; the script
creates it if missing and refuses to reuse an account that already has USDC
storage. Wait for the challenge window to close, then open the commitment. The
claim card should say the tranche is eligible and show “The beneficiary needs
sufficient storage with the token contract to receive this payout.”

## Pending evaluation

```sh
npm run fixture:challenge -- --slow-evaluator --setup-only --no-challenge
npm run fixture:challenge -- --commitment-id=<id> --slow-evaluator \
  --stop-after-request --no-challenge
```

The second command exits immediately after `request_evaluation`. Refresh the
already-open Console commitment within ten seconds to see the pending card; the
evaluation then fails because the delayed body is not a WASM module.

To clean up, close the commitment as the sponsor after the challenge is
resolved or expired, then refund remaining escrow and unused operations.
