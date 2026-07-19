import { config as loadDotenv } from 'dotenv';

/**
 * Test environment bootstrap.
 *
 * Runs before any test file imports `src/config.ts`, which validates and freezes
 * its config at import time. A local `.env` wins where present; these defaults just
 * mean `npm test` works on a fresh clone with no setup, since every value here is
 * public testnet infrastructure and none of it is a secret.
 */
loadDotenv();

const defaults: Record<string, string> = {
  STELLAR_NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
  SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
  HORIZON_URL: 'https://horizon-testnet.stellar.org',
  // A syntactically valid (StrKey-decodable) but non-deployed contract id, so
  // `new Contract(...)` in sorobanClient.ts doesn't throw at import time in unit
  // tests that never actually reach the network.
  GIFT_ESCROW_CONTRACT_ID: 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526',
  ANCHOR_HOME_DOMAIN: 'testanchor.stellar.org',
  SOROBAN_TX_POLL_TIMEOUT_MS: '30000',
  HORIZON_REQUEST_TIMEOUT_MS: '15000',
};

for (const [key, value] of Object.entries(defaults)) {
  process.env[key] ??= value;
}
