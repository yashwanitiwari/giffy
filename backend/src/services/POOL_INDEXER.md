# Deposit indexer + pool client (sealed-gift flow)

The confidential-pool contract keeps note commitments in an on-chain Merkle tree.
To withdraw, a recipient's browser must rebuild its note's **authentication path**,
which needs the full ordered list of commitments. That list is what this indexer
serves.

## Data flow

```
pool contract  --deposit events-->  indexer (this backend)  --/pool/leaves-->  browser
   (on-chain tree, authoritative)      (poolleaves cache)       (rebuild path + prove)
```

## Pieces

| Piece | File |
|---|---|
| RPC event decode | `chain/src/shieldedPool.ts` — `getPoolDepositEvents(startLedger)` |
| Leaf cache model | `backend/src/models/PoolLeaf.ts` (unique on `poolId+leafIndex`) |
| Sync cursor | `backend/src/models/PoolSyncState.ts` |
| Sync + serve | `backend/src/services/poolIndexerService.ts` |
| Poll job | `backend/src/jobs/poolIndexerCron.ts` (`POOL_INDEXER_CRON_SCHEDULE`, default 1 min) |
| Read routes | `backend/src/routes/pool.ts` — `GET /api/pool/info`, `GET /api/pool/leaves` |
| Client orchestration | `frontend/src/lib/poolClient.ts` (+ `merkleTree.ts`, `zkProver.ts`, `shieldedNote.ts`) |

## Correctness properties

- **Idempotent**: leaves upsert by `(poolId, leafIndex)`, so re-scanning overlapping
  ledgers never double-inserts.
- **Gap-checked**: `getOrderedCommitments` refuses to serve a list with a hole
  (`0..n-1`); a gap means events were missed and any path built on it would be
  wrong. The route returns 409 `INDEXER_BEHIND` in that case.
- **Cross-verified**: the browser recomputes the Merkle root from the served leaves
  and asserts it equals the proof's root before submitting (`poolClient.prepareWithdraw`).
  The tree math was proven against the real wasm prover
  (`zk-prover-wasm/test_tree.mjs`: reconstructed root == prover root).

## Config

Set in `backend/.env` (feature is off if `SHIELDED_POOL_CONTRACT_ID` is unset):

```
SHIELDED_POOL_CONTRACT_ID=CDDF4SNZ...   # the deployed pool
SHIELDED_POOL_START_LOOKBACK=17000      # first-sync scan window (ledgers)
POOL_INDEXER_CRON_SCHEDULE=*/1 * * * *
```

Note: Soroban RPC only retains events for a limited window (~testnet retention),
so for a real deployment the indexer must run continuously from the pool's
deployment ledger, or be seeded from an archive. The gap-check is what makes a
retention miss fail loudly instead of silently serving a bad path.

## Remaining wiring (not yet built)

`prepareWithdraw` returns the proof + public signals; the **withdraw transaction
build/sign/submit** (assembling the pool's `withdraw` invocation with the nested
`Proof` ScVal, signing via Freighter) and the **deposit transaction** flow are the
next layer — plus the claim-page branch that runs `prepareWithdraw` behind a
progress UI. The crypto and data plumbing they build on are proven end-to-end.
