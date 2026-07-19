# `contracts/gift-escrow`

The Soroban smart contract that is the sole source of truth for Giffy gift
state and funds. See Section 4 and Section 10 of the top-level `readme.md`
for the full design writeup; this file only covers build/test/deploy
mechanics.

## Prerequisites

- Rust toolchain (stable) — `rustc --version` / `cargo --version`.
- The `wasm32v1-none` target, **not** `wasm32-unknown-unknown`:
  ```bash
  rustup target add wasm32v1-none
  ```
  (Rust 1.82+ enables `reference-types`/`multi-value` on
  `wasm32-unknown-unknown` by default, which `soroban-sdk` 27.x does not yet
  support; `wasm32v1-none`, available since Rust 1.84, is the target the SDK
  itself requires. If you're on an older toolchain that predates this split,
  `wasm32-unknown-unknown` with Rust 1.81 or earlier still works.)
- `stellar-cli` (the current name for what used to be `soroban-cli`) for
  deployment: see https://developers.stellar.org/docs/tools/cli

## Build & Test

From the `contracts/` workspace root:

```bash
cd contracts

# Fast, network-free contract test suite (in-process Soroban test environment)
cargo test

# Optimized release WASM, ready to deploy
cargo build --target wasm32v1-none --release
# -> target/wasm32v1-none/release/gift_escrow.wasm
```

Or from `contracts/gift-escrow` directly — the workspace root one directory
up is still detected by Cargo:

```bash
cd contracts/gift-escrow
cargo test
cargo build --target wasm32v1-none --release
```

## Deploy (Testnet)

```bash
cd contracts/gift-escrow
stellar contract build
stellar contract deploy \
  --wasm ../target/wasm32v1-none/release/gift_escrow.wasm \
  --source <deployer-keypair> \
  --network testnet
# Record the returned C... contract ID into every module's env config
# (chain/.env, backend/.env, frontend/.env.local — GIFT_ESCROW_CONTRACT_ID /
# NEXT_PUBLIC_GIFT_ESCROW_CONTRACT_ID).
```

Note: `stellar contract build` also invokes the WASM build itself, targeting
whichever wasm target the installed `stellar-cli`/SDK version expects; the
explicit `cargo build --target wasm32v1-none --release` above is for local
verification and CI without requiring `stellar-cli` to be installed.

## Layout

- `src/types.rs` — `GiftRecord`, `GiftStatus`, `ClaimCondition`.
- `src/errors.rs` — `GiftEscrowError` (`#[contracterror]`).
- `src/storage.rs` — persistent storage helpers (`get_gift`, `set_gift`,
  `next_gift_id`), including the TTL-extension bump on every write.
- `src/lib.rs` — the `GiftEscrowContract` entry point: `create_gift`,
  `contribute`, `unlock_step`, `claim`, `refund`, `get_gift`.
- `src/test.rs` — in-process unit tests covering the full lifecycle (base
  case, group contributions, trivia/step-gate conditions, pro-rata refund,
  expiry boundaries).
