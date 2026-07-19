/** An unsigned or signed transaction envelope, base64-encoded. */
export type Xdr = string;

/**
 * Mirrors the contract's `GiftStatus` enum (README §4.1) one-to-one — the chain
 * layer never invents its own status vocabulary, since `reconciliationService`
 * (README §12.6) maps this directly onto the backend's own `active`/`claimed`/
 * `refunded` cache field.
 */
export type GiftStatus = 'Open' | 'Claimed' | 'Refunded';

export type ClaimConditionType = 'none' | 'trivia' | 'stepGate';

/**
 * The TypeScript-side mirror of the contract's `ClaimCondition` enum (README §4.1).
 *
 * Every gift has exactly one of these — including the simple, single-contributor,
 * no-condition case, which is just `{ type: 'none' }` rather than a special-cased
 * absence of a condition (README §2.2).
 */
export interface ClaimCondition {
  type: ClaimConditionType;
  /** SHA-256 of the expected (normalized) answer. Present only when `type === 'trivia'`. */
  answerHash?: Buffer;
  /** Total number of unlock steps required. Present only when `type === 'stepGate'`. */
  totalSteps?: number;
}

/** One entry of the contract's `contributions` map, decoded to plain JS. */
export interface GiftContribution {
  address: string;
  /** i128 stroop amount, kept as a decimal string end-to-end (never `number`). */
  amount: string;
}

/**
 * The chain layer's decoded view of a contract `GiftRecord` (README §4.1), as
 * returned by `getGift`.
 */
export interface GiftRecord {
  contractGiftId: bigint;
  sender: string;
  receiver: string;
  /** Stellar Asset Contract address for the gifted asset. */
  token: string;
  totalAmount: string;
  contributions: GiftContribution[];
  expiresAt: Date;
  status: GiftStatus;
  condition: ClaimCondition;
  stepsCompleted: number;
  stepUnlocker: string;
}

/** The subset of an anchor's stellar.toml that Giffy consumes. */
export interface StellarTomlInfo {
  webAuthEndpoint: string;
  transferServerSep24: string;
  signingKey: string;
  currencies: { code: string; issuer?: string }[];
}

export interface InitiateInteractiveDepositParams {
  transferServerUrl: string;
  jwt: string;
  assetCode: string;
  account: string;
}

export interface InteractiveDepositResult {
  id: string;
  interactiveUrl: string;
}

export interface PollTransactionStatusParams {
  transferServerUrl: string;
  jwt: string;
  transactionId: string;
}

/**
 * SEP-24 transaction statuses. Kept as a union with a `string` escape hatch on
 * purpose: per README §14.3 Giffy stores whatever the anchor reports verbatim
 * rather than re-mapping it, so an unrecognized status must stay representable.
 */
export type Sep24Status =
  | 'incomplete'
  | 'pending_user_transfer_start'
  | 'pending_user_transfer_complete'
  | 'pending_external'
  | 'pending_anchor'
  | 'pending_stellar'
  | 'pending_trust'
  | 'pending_user'
  | 'completed'
  | 'refunded'
  | 'expired'
  | 'no_market'
  | 'too_small'
  | 'too_large'
  | 'error'
  | (string & {});

export interface Sep24TransactionStatus {
  status: Sep24Status;
  stellarTransactionId?: string;
  message?: string;
}

/** Terminal SEP-24 statuses: polling should stop once one of these is reached. */
export const SEP24_TERMINAL_STATUSES: readonly string[] = [
  'completed',
  'refunded',
  'expired',
  'no_market',
  'too_small',
  'too_large',
  'error',
];

export function isSep24Terminal(status: string): boolean {
  return SEP24_TERMINAL_STATUSES.includes(status);
}
