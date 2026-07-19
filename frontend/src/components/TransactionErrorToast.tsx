'use client';

import { useCallback } from 'react';

import { ApiError } from '@/lib/apiClient';

import { useToast } from './Toast';

/**
 * Maps chain error codes (README §11.5's 13 codes) to human-readable messages.
 *
 * `Toast.tsx` already renders whatever message it's handed (it carries the role
 * described for `TransactionErrorToast` in the earlier draft); this module is the
 * missing piece — the code → copy table plus a hook that fires it — rather than a
 * duplicate toast renderer.
 */
const CONTRACT_ERROR_MESSAGES: Record<string, string> = {
  GIFT_NOT_FOUND: 'This gift does not exist on-chain.',
  GIFT_NOT_OPEN: 'This gift is no longer open.',
  GIFT_EXPIRED: "This gift's claim window has passed.",
  GIFT_NOT_YET_EXPIRED: 'This gift has not expired yet.',
  NOT_RECEIVER: 'Only the designated receiver can claim this gift.',
  WRONG_ANSWER: "That answer isn't quite right — try again.",
  STEPS_NOT_COMPLETE: 'Not all unlock steps have been completed yet.',
  NOT_AUTHORIZED_UNLOCKER: 'This account is not authorized to unlock steps for this gift.',
  ALL_STEPS_ALREADY_COMPLETE: 'All steps are already unlocked.',
  INVALID_CONTRIBUTION_AMOUNT: 'Amount must be greater than zero.',
  INVALID_EXPIRY: 'Expiry must be in the future.',
  NOT_STEP_GATED: 'This gift has no step-based condition.',
  NOT_SENDER_OR_CONTRIBUTOR: 'Only the sender or a contributor can trigger a refund.',
};

/** Resolves the best available human-readable message for a thrown error. */
export function describeTransactionError(err: unknown): string {
  if (err instanceof ApiError) {
    return CONTRACT_ERROR_MESSAGES[err.code] ?? err.message;
  }
  if (err instanceof Error) return err.message;
  return 'The transaction could not be completed.';
}

/** `toast('error', describeTransactionError(err))` in one call. */
export function useTransactionErrorToast() {
  const { toast } = useToast();
  return useCallback((err: unknown) => toast('error', describeTransactionError(err)), [toast]);
}
