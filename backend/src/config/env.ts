import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/**
 * Typed, validated environment (README §16.4).
 *
 * Parsed at import time and thrown on immediately if anything is missing or
 * malformed, so the process dies before it listens, connects, or schedules a cron.
 * A config value that stays silently `undefined` until it surfaces mid-transaction
 * is one of the most painful classes of bug in a system this dependent on precise
 * external configuration — a wrong Horizon URL fails very differently, and far more
 * confusingly, than a missing one.
 */

loadDotenv();

const envSchema = z.object({
  // Server
  PORT: z.coerce.number().int().positive().default(4000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  CORS_ORIGIN: z.string().min(1).default('http://localhost:3000'),

  // MongoDB
  MONGODB_URI: z.string().min(1),

  // Stellar / chain layer. Re-declared here rather than deferred to @giffy/chain's
  // own loader so a misconfigured network fails during this parse, alongside every
  // other config error, instead of separately at first chain import.
  STELLAR_NETWORK_PASSPHRASE: z.string().min(1),
  SOROBAN_RPC_URL: z.string().url(),
  HORIZON_URL: z.string().url(),
  GIFT_ESCROW_CONTRACT_ID: z.string().min(1),
  // Confidential (ZK-sealed) gift pool. Optional — sealed gifts are off unless set.
  SHIELDED_POOL_CONTRACT_ID: z.string().min(1).optional(),
  // How many ledgers back the deposit indexer scans on its first run (no cursor).
  SHIELDED_POOL_START_LOOKBACK: z.coerce.number().int().positive().default(100_000),
  ANCHOR_HOME_DOMAIN: z.string().min(1),

  // Giffy domain config
  CLAIM_LINK_BASE_URL: z.string().url(),
  CONTRIBUTE_LINK_BASE_URL: z.string().url(),
  CLAIM_TOKEN_BYTES: z.coerce.number().int().min(16).default(32),
  GIFT_MESSAGE_MAX_LENGTH: z.coerce.number().int().positive().default(280),
  MIN_CONTRIBUTION_AMOUNT: z.coerce.number().positive().default(1),

  REFUND_CRON_SCHEDULE: z.string().min(1).default('*/15 * * * *'),
  RECONCILIATION_CRON_SCHEDULE: z.string().min(1).default('*/5 * * * *'),
  POOL_INDEXER_CRON_SCHEDULE: z.string().min(1).default('*/1 * * * *'),

  // Rate limiting
  CLAIM_PREVIEW_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  CLAIM_PREVIEW_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  GIFT_ROUTES_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  GIFT_ROUTES_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),

  // Logging
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Env = Readonly<z.infer<typeof envSchema>>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid backend configuration:\n${issues}`);
  }

  return Object.freeze(parsed.data);
}

export const env: Env = loadEnv();

export const isProduction = env.NODE_ENV === 'production';
