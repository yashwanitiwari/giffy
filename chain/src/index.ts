/**
 * @giffy/chain — Giffy's on-chain interaction layer.
 *
 * A pure library, not a service (README §7.3). It knows about Soroban and the
 * SEP protocols (plus classic Horizon, solely for trustline management — README
 * §11.4); it knows nothing about MongoDB, HTTP, or Giffy's domain model, and it
 * never holds a private key — every function here either builds unsigned XDR
 * or forwards XDR someone else has already signed.
 *
 * This module is Soroban-only (README §11.1): there is no Claimable Balance
 * code path anywhere in it. Every gift action — `create`, `contribute`,
 * `unlock_step`, `claim`, `refund` — has exactly one implementation, in
 * `giftEscrow.ts`.
 */

export { config, BASE_FEE_STROOPS, TRANSACTION_TIMEOUT_SECONDS } from './config.js';
export type { ChainConfig } from './config.js';

export { horizon, networkPassphrase } from './horizonClient.js';

export { accountExists, assertValidPublicKey, hasTrustline, loadAccount } from './accounts.js';

export {
  buildAndSimulate,
  buildReadOnlyInvocation,
  giftEscrowContract,
  sorobanServer,
  submitSignedInvocation,
} from './sorobanClient.js';
export type { SubmitResult } from './sorobanClient.js';

export {
  buildClaimTx,
  buildContributeTx,
  buildCreateGiftTx,
  buildRefundTx,
  buildUnlockStepTx,
  decodeCondition,
  encodeCondition,
  getGift,
} from './giftEscrow.js';
export type {
  BuildClaimTxParams,
  BuildContributeTxParams,
  BuildCreateGiftTxParams,
  BuildRefundTxParams,
  BuildUnlockStepTxParams,
  ConditionInput,
} from './giftEscrow.js';

export { buildChangeTrustTx, needsTrustline } from './trustline.js';
export type { BuildChangeTrustTxParams } from './trustline.js';

export {
  assertValidAmount,
  describeAsset,
  KNOWN_TESTNET_ASSETS,
  NATIVE_ASSET_CODE,
  resolveAsset,
} from './assets.js';

export {
  AccountNotFoundError,
  AnchorError,
  BadSequenceError,
  BalanceNotFoundError,
  ChainError,
  ClaimExpiredError,
  ClaimNotYetAvailableError,
  GiftEscrowError,
  InsufficientBalanceError,
  TrustlineMissingError,
  extractContractErrorCode,
  parseContractError,
  parseHorizonError,
} from './errors.js';
export type { ChainErrorCode, ClaimIntent } from './errors.js';

export {
  clearStellarTomlCache,
  resolveAnchoredAssetIssuer,
  resolveStellarToml,
} from './sep1.js';

export { requestChallenge, submitSignedChallenge } from './sep10.js';

export { initiateInteractiveDeposit, pollTransactionStatus } from './sep24.js';

export { isSep24Terminal, SEP24_TERMINAL_STATUSES } from './types.js';
export type {
  ClaimCondition,
  ClaimConditionType,
  GiftContribution,
  GiftRecord,
  GiftStatus,
  InitiateInteractiveDepositParams,
  InteractiveDepositResult,
  PollTransactionStatusParams,
  Sep24Status,
  Sep24TransactionStatus,
  StellarTomlInfo,
  Xdr,
} from './types.js';

export {
  buildPoolDepositTx,
  buildPoolWithdrawTx,
  getLatestLedger,
  getPoolDepositEvents,
  isShieldedPoolConfigured,
  shieldedPoolContractId,
} from './shieldedPool.js';
export type {
  BuildDepositParams,
  BuildWithdrawParams,
  DepositEvent,
  DepositEventPage,
  WithdrawProofInput,
} from './shieldedPool.js';
