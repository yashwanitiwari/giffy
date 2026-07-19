# `@giffy/chain` — On-Chain Layer

Giffy's Stellar interaction layer: Claimable Balances, trustlines, and the SEP-1 /
SEP-10 / SEP-24 anchor protocol clients.

This module is **a pure library, not a service**. It exposes functions, not
endpoints. It has no knowledge of MongoDB, HTTP, or Giffy's domain model — it knows
only Stellar primitives, which is what keeps it independently testable and reusable
(README §7.3, principle 2).

## The one invariant

**Nothing in `src/` ever touches a private key.** Every function here either builds
*unsigned* XDR or forwards XDR that someone else has already signed. Signing happens
client-side, in the user's own wallet. Any change that would require a secret key in
this module is a design error, not an implementation detail to work around
(README §15.3).

The only code in this package that signs anything is `test/helpers.ts`, which stands
in for Freighter using throwaway Friendbot-funded keypairs, because a test has no
browser extension to sign for it.

## Setup

```bash
npm install
cp .env.example .env
npm test                 # unit tier: pure, offline, fast
npm run test:integration # integration tier: live Horizon testnet + live anchor
```

`npm test` needs no `.env` — the test setup falls back to public testnet defaults.

| Script | What it does |
|---|---|
| `npm test` | Unit tests: predicates, error mapping, XDR decoding, SEP clients vs. mocked responses |
| `npm run test:integration` | Live tests against Horizon testnet and `testanchor.stellar.org` |
| `npm run build` | Compiles to `dist/` |
| `npm run typecheck` | Types only, no emit |

## Public API

Import from the barrel (`src/index.ts`); nothing outside this module should reach
into individual files.

```ts
import {
  buildCreateClaimableBalanceTx,  // sender locks a gift  -> unsigned XDR
  buildClaimTx,                   // receiver claims / sender reclaims -> unsigned XDR
  submitSignedTx,                 // signed XDR -> { hash, balanceId?, ledger }
  extractBalanceIdFromResult,     // Horizon result_xdr -> balanceId
  resolveAsset,                   // 'XLM' | 'SRT' | 'USDC' (+issuer) -> Asset
  needsTrustline,
  parseHorizonError,              // unknown -> typed ChainError
  resolveStellarToml,             // SEP-1
  requestChallenge,               // SEP-10
  submitSignedChallenge,          // SEP-10
  initiateInteractiveDeposit,     // SEP-24
  pollTransactionStatus,          // SEP-24
} from '@giffy/chain';
```

Every state-changing flow is **build → sign → submit**, with the signature step
happening somewhere this module cannot see.

## Implementation notes

### The gift is two claimants with complementary predicates

`buildCreateClaimableBalanceTx` always names exactly two claimants against the same
instant (README §4.2):

```
receiver: beforeAbsoluteTime(expiresAt)
sender:   not(beforeAbsoluteTime(expiresAt))
```

Because the predicates are exact complements, at any instant precisely one side can
claim — never both, never neither. The escrow needs no application-level enforcement:
a receiver claiming one second late is rejected by the network itself, regardless of
what any frontend does or doesn't check. `test/predicates.test.ts` asserts this
mutual exclusivity across the expiry boundary.

### There is no "refund" operation

The refund path is the same `ClaimClaimableBalanceOp` as the claim path — it is just
the sender claiming their own complementary predicate. `buildClaimTx` serves both;
only the `intent` passed to `submitSignedTx` differs, and only to pick an error
message.

### `extractBalanceIdFromResult` is the highest-risk code here

The `balanceId` is not a plain field anywhere in Horizon's response. It is embedded
in the `CreateClaimableBalanceResult` inside the transaction result XDR and must be
decoded through the SDK's XDR types. It is derived by the network from the
operation's position and the source account's sequence number, so it cannot be
predicted or chosen client-side — reading it back out of the result is the only way
to learn it.

`test/claimableBalance.test.ts` pins it against a **real** captured testnet result,
with the expected id taken from Horizon's own `/claimable_balances` endpoint rather
than from our decoder, so the assertion is independent rather than circular.

### Horizon result codes were verified, not recalled

`parseHorizonError`'s mappings were confirmed by provoking each failure against live
testnet. Worth knowing if you extend it:

| Code | Meaning | Maps to |
|---|---|---|
| `op_cannot_claim` | Claim not permitted **right now** | `ClaimExpiredError` / `ClaimNotYetAvailableError` |
| `op_does_not_exist` | Balance is gone (likely already claimed) | `BalanceNotFoundError` |
| `op_no_trust` | Account cannot hold the asset yet | `TrustlineMissingError` |
| `op_underfunded` | Not enough of the asset | `InsufficientBalanceError` |
| `tx_bad_seq` | Stale sequence number | `BadSequenceError` |

`op_cannot_claim` is deliberately ambiguous on Horizon's side: the same code covers
"receiver too late", "sender too early", and "not a claimant at all". The `intent`
argument disambiguates the first two. The third should be prevented upstream — the
backend checks the requester against the gift's stored receiver before building
anything.

### Amounts are strings, always

Stellar amounts are fixed-point to 7 decimal places. They stay decimal strings from
the API through to XDR construction, and `assertValidAmount` rejects a `number`
outright — routing a value through a float to validate it would reintroduce exactly
the precision loss the string exists to avoid (README §12.4).

### Trustlines are batched, not chained

When a party needs a trustline and is creating or claiming in the same action, both
operations go into a **single** transaction (`includeTrustlineOp`), keeping the UX at
one wallet approval instead of two (README §9.4). The trustline op always comes
first — the balance is funded out of it. The claim operation does not auto-create
trustlines, so for a non-native asset this is required, not an optimization.

### `KNOWN_TESTNET_ASSETS` is a fallback, not the source of truth

The issuers in `assets.ts` were verified live against the anchor's `stellar.toml`,
but `resolveStellarToml` is authoritative at runtime and wins if the two ever
disagree. `test/sep1.integration.test.ts` fails if the table drifts from what the
anchor publishes.

## Testing

Two tiers, per README §9.3:

- **Unit** (`npm test`) — pure functions, no network. Runs on every commit.
- **Integration** (`npm run test:integration`) — live Horizon testnet and the live
  reference anchor. Slower, and legitimately flaky when testnet itself is unwell.

Integration tests fund fresh keypairs via Friendbot at run time rather than using
fixture accounts, because testnet resets periodically and a hardcoded account would
silently go stale (README §18.3).

### What the integration tier deliberately does not test

The SEP-24 tests stop at the point a human would take over the anchor's hosted
deposit form. That form is the anchor's surface, not Giffy's, and driving it would
couple this suite to UI we neither own nor control (README §18.5). What is asserted
is everything Giffy's client is responsible for: authenticating, obtaining a real
interactive URL, and reading status back.

This means the end-to-end "SRT actually lands in an account" path is not covered
automatically — exercise it by hand through the frontend's `OnrampModal`. The
non-native gifting path itself *is* covered end-to-end in
`test/trustline.integration.test.ts`, using a throwaway issuer so it doesn't depend
on the anchor's form.

## Configuration

All four variables are required; the module throws at import time if any is missing
or malformed, rather than failing later mid-transaction (README §16.4).

```
STELLAR_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
HORIZON_URL=https://horizon-testnet.stellar.org
ANCHOR_HOME_DOMAIN=testanchor.stellar.org
HORIZON_REQUEST_TIMEOUT_MS=15000
```

Pointing at a different network is a matter of changing the passphrase and Horizon
URL. Pointing at a different anchor — including a real production one — is a matter
of changing `ANCHOR_HOME_DOMAIN`; nothing in the SEP clients hardcodes an endpoint.
