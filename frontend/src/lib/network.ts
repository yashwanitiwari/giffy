/**
 * The single network passphrase this app ever signs against (README §18.4
 * `NEXT_PUBLIC_STELLAR_NETWORK=TESTNET`).
 *
 * Most `build-transaction` endpoints (§15.2–§15.5) only return `{ xdr }`, unlike
 * gift creation (§15.1) which also returns `networkPassphrase` — since Giffy is
 * testnet-only end to end, this constant fills that gap for every other endpoint
 * rather than each hook hardcoding the literal string.
 */
export const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';
