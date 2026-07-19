# `@giffy/backend`

The Giffy REST API: gift lifecycle, claim links, SEP-24 on-ramp sessions, and the
refund-eligibility sweep. Implements README §10 and §13.

Depends on `@giffy/chain` (as a local `file:` dependency) and MongoDB. Nothing else
in the stack reads or writes the database.

## The invariant

**The backend never handles a private key** (§15.3). Every endpoint that changes
on-chain state is one leg of the same three-step handshake:

```
build  →  POST .../build-transaction   backend returns unsigned XDR
sign   →  (in the user's wallet)       backend is not involved
submit →  POST .../submit              backend forwards signed XDR to Horizon
```

If a change here ever seems to need a private key server-side, the design has drifted
— re-read §15 rather than working around it.

## Layout

```
src/
  config/env.ts          Typed env, validated at import time; throws before anything starts
  db/mongoose.ts         Connection with bounded retry + backoff
  models/                Gift, Sep24Session, ClaimEvent (§12)
  services/              All business logic. Testable without Express.
  controllers/           Thin: parse validated request → one service call → response
  routes/                Route table + per-family rate limiters
  middleware/            validateRequest, rateLimit, errorHandler, requestLogger
  jobs/refundCron.ts     Status-flip sweep. Submits nothing.
  utils/                 claimToken, qrPayload, logger, domain errors
  validation/            zod schemas for every request body/params/query
  app.ts                 Express assembly (no port, no db, no cron — mountable in tests)
  server.ts              Bootstrap: env → mongo → app → cron → listen
```

## Running it

```bash
npm install
cp .env.example .env     # set MONGODB_URI; the defaults target testnet + localhost
npm run dev
```

Expect:

```
MongoDB connected
Refund cron scheduled
Listening on port 4000
```

`npm run build && npm start` for the compiled build. `npm run typecheck` for types
only.

## Endpoints

All under `/api`. Full request/response shapes in root README §13.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness + database reachability (503 when Mongo is down) |
| `POST` | `/gifts` | Create a `draft` gift |
| `GET` | `/gifts?senderPublicKey=G...` | List a sender's gifts |
| `POST` | `/gifts/:id/build-transaction` | Unsigned create-balance XDR |
| `POST` | `/gifts/:id/submit` | Submit signed XDR; mints the claim link |
| `POST` | `/gifts/:id/refund/build-transaction` | Unsigned reclaim XDR (once expired) |
| `POST` | `/gifts/:id/refund/submit` | Submit signed reclaim |
| `GET` | `/claim/:token` | Public gift preview |
| `POST` | `/claim/:token/build-transaction` | Unsigned claim XDR |
| `POST` | `/claim/:token/submit` | Submit signed claim |
| `POST` | `/onramp/sep10-challenge` | SEP-10 challenge to sign |
| `POST` | `/onramp/sep10-submit` | Exchange signed challenge → opaque session token |
| `POST` | `/onramp/sep24-deposit` | Start interactive deposit |
| `GET` | `/onramp/sep24-status/:id` | Poll deposit status |

Errors are uniform: `{ "error": { "code": "CLAIM_EXPIRED", "message": "…" } }`.
Codes come from `utils/errors.ts` (Giffy's refusals) and `@giffy/chain`'s
`ChainError` (the network's), mapped to statuses in `middleware/errorHandler.ts`.

## Two things that differ from a first reading of the spec

Both are deviations from the letter of the root README, made to keep its intent
intact. Flagging them here rather than burying them in a diff:

**The claim token is minted at submit, not at draft.** §12.5 requires
`claimTokenHash` at insert, but only the *hash* is ever persisted (§15.2) — so the
raw token cannot be recovered later to build the `claimUrl` that `POST /:id/submit`
must return. The draft therefore stores the hash of a token that is generated and
immediately discarded (nobody holds its preimage, so it can never resolve), and the
real token is minted once the funds are provably locked on-chain. A link only ever
exists for a gift that actually has a balance behind it.

**`Sep24Session` has two fields §12.2 doesn't list.** `sessionTokenHash`, because
§10.4's indirection requires the frontend to present *something* that isn't the JWT;
and `expiresAt` with a TTL index, so anchor JWTs are reaped rather than accumulating
in the database forever as credentials worth stealing.

## Testing

`test/` holds unit tests for the pieces worth pinning independently of the network —
token hashing, error mapping, state-machine guards. Per §18.2, service-layer logic is
verifiable without a live chain; the real create → claim → refund loop against Horizon
testnet is exercised by the manual smoke checklist in root README §17.4.
