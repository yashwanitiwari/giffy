/* tslint:disable */
/* eslint-disable */

/**
 * `Poseidon2(secret, 0)` as hex — the note commitment the sender publishes.
 */
export function note_commitment_hex(secret_hex: string): string;

/**
 * 2-to-1 Poseidon2 of two 32-byte hex field elements — the same hash the
 * pool uses on-chain. Lets the indexer/browser rebuild the Merkle tree and
 * extract a note's authentication path.
 */
export function poseidon_hash2_hex(a_hex: string, b_hex: string): string;

/**
 * Generate a withdraw proof in the browser.
 *
 * `siblings_hex` is a `\n`-joined list of DEPTH 32-byte hex siblings;
 * `index_bits` is a DEPTH-length string of '0'/'1' (leaf→root). Returns a
 * JSON string `{proof, root, nullifier}` with `proof` compressed-hex.
 */
export function prove_withdraw_js(pk_bytes: Uint8Array, secret_hex: string, siblings_hex: string, index_bits: string, recipient_hex: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly note_commitment_hex: (a: number, b: number) => [number, number];
    readonly poseidon_hash2_hex: (a: number, b: number, c: number, d: number) => [number, number];
    readonly prove_withdraw_js: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number];
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
