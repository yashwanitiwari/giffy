import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

// The chain layer is consumed both as a library (by /backend, which loads its own
// .env) and standalone (by the integration tests). Loading here is a no-op when the
// host process already populated process.env, since dotenv never overrides.
loadDotenv();

const configSchema = z.object({
  STELLAR_NETWORK_PASSPHRASE: z.string().min(1),
  SOROBAN_RPC_URL: z.string().url(),
  // Classic Horizon is still needed for trustline management (README §6 / §11.4) —
  // it is the one deliberate exception to this module otherwise being Soroban-only.
  HORIZON_URL: z.string().url(),
  GIFT_ESCROW_CONTRACT_ID: z.string().min(1),
  // The confidential (ZK-sealed) gift pool. Optional: sealed gifts are a separate
  // feature and the rest of the chain layer works without it configured.
  SHIELDED_POOL_CONTRACT_ID: z.string().min(1).optional(),
  ANCHOR_HOME_DOMAIN: z.string().min(1),
  SOROBAN_TX_POLL_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  HORIZON_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
});

export type ChainConfig = Readonly<z.infer<typeof configSchema>>;

function loadConfig(): ChainConfig {
  const parsed = configSchema.safeParse(process.env);

  if (!parsed.success) {
    // Per §16.4: fail immediately and loudly at import time. A config value that is
    // silently undefined until it surfaces mid-transaction is far harder to debug.
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid chain layer configuration:\n${issues}`);
  }

  return Object.freeze(parsed.data);
}

export const config: ChainConfig = loadConfig();

/**
 * Base fee, in stroops, used for every transaction this layer builds.
 *
 * Stellar's minimum is 100 stroops per operation. Testnet surge pricing is
 * effectively nonexistent, but bidding a small multiple of the minimum costs
 * fractions of a cent and avoids `tx_insufficient_fee` rejections during the
 * occasional testnet load spike.
 */
export const BASE_FEE_STROOPS = '1000';

/**
 * How long a built transaction stays valid before Horizon rejects it as too late.
 *
 * This bounds the window between "backend builds the XDR" and "user finishes
 * approving it in Freighter". Five minutes is generous for a human approval step
 * while still ensuring an abandoned, half-signed transaction cannot be submitted
 * hours later against a sequence number the sender has since moved past.
 */
export const TRANSACTION_TIMEOUT_SECONDS = 300;
