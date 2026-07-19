import type {
  ApiErrorBody,
  BuiltTransaction,
  ContributeBuildResponse,
  ContributeSubmitResponse,
  CreateGiftRequest,
  CreateGiftResponse,
  GiftDTO,
  GiftPreviewDTO,
  GroupSummaryDTO,
  SubmitResult,
  SubmittedGift,
  UnlockStepSubmitResponse,
  VerifyAnswerResponse,
} from '@/types/api';

/**
 * Typed fetch wrapper for the backend API (README §11.5).
 *
 * Single place that prefixes the base URL, sets JSON headers, and converts non-2xx
 * responses into a typed `ApiError` carrying the backend's structured error code —
 * which is what lets error toasts map codes to specific copy without every hook
 * repeating parse/try/catch boilerplate.
 */

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api';

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;

  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the Giffy server. Is it running?');
  }

  if (!res.ok) {
    let code = 'UNKNOWN';
    let message = `Request failed (${res.status}).`;

    try {
      const body = (await res.json()) as ApiErrorBody;
      if (body?.error) {
        code = body.error.code ?? code;
        message = body.error.message ?? message;
        if (body.error.issues?.length) {
          message = body.error.issues.map((i) => i.message).join(' ');
        }
      }
    } catch {
      // Non-JSON error body — keep the generic message.
    }

    throw new ApiError(res.status, code, message);
  }

  return (await res.json()) as T;
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path);
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/**
 * Typed wrappers for every endpoint in README §15 — one function per route, so
 * hooks never hand-assemble a path string or repeat a body shape.
 */

// §15.1 Gift creation
export const createGift = (body: CreateGiftRequest) => apiPost<CreateGiftResponse>('/gifts', body);

export const buildCreateGiftTx = (giftId: string) =>
  apiPost<BuiltTransaction>(`/gifts/${giftId}/build-transaction`);

export const submitCreateGiftTx = (giftId: string, signedXdr: string) =>
  apiPost<SubmittedGift>(`/gifts/${giftId}/submit`, { signedXdr });

export const listGifts = (senderPublicKey: string) =>
  apiGet<{ gifts: GiftDTO[] }>(`/gifts?senderPublicKey=${encodeURIComponent(senderPublicKey)}`);

// §15.5 Refund
export const buildRefundTx = (giftId: string, callerPublicKey: string) =>
  apiPost<BuiltTransaction>(`/gifts/${giftId}/refund/build-transaction`, { callerPublicKey });

export const submitRefundTx = (giftId: string, signedXdr: string) =>
  apiPost<SubmitResult>(`/gifts/${giftId}/refund/submit`, { signedXdr });

// §15.2 Contribution
export const getGroupSummary = (giftId: string) =>
  apiGet<GroupSummaryDTO>(`/gifts/${giftId}/group-summary`);

export const buildContributeTx = (giftId: string, contributorPublicKey: string, amount: string) =>
  apiPost<ContributeBuildResponse>(`/gifts/${giftId}/contribute/build-transaction`, {
    contributorPublicKey,
    amount,
  });

export const submitContributeTx = (
  giftId: string,
  contributorPublicKey: string,
  amount: string,
  signedXdr: string,
) =>
  apiPost<ContributeSubmitResponse>(`/gifts/${giftId}/contribute/submit`, {
    contributorPublicKey,
    amount,
    signedXdr,
  });

// §15.3 Conditions
export const verifyAnswer = (token: string, answer: string) =>
  apiPost<VerifyAnswerResponse>(`/claim/${token}/verify-answer`, { answer });

export const buildUnlockStepTx = (giftId: string, unlockerPublicKey: string) =>
  apiPost<BuiltTransaction>(`/gifts/${giftId}/steps/unlock/build-transaction`, {
    unlockerPublicKey,
  });

export const submitUnlockStepTx = (giftId: string, signedXdr: string) =>
  apiPost<UnlockStepSubmitResponse>(`/gifts/${giftId}/steps/unlock/submit`, { signedXdr });

// §15.4 Claim
export const getClaimPreview = (token: string) => apiGet<GiftPreviewDTO>(`/claim/${token}`);

export const buildClaimTx = (token: string, claimantPublicKey: string, answer?: string) =>
  apiPost<BuiltTransaction>(`/claim/${token}/build-transaction`, {
    claimantPublicKey,
    ...(answer !== undefined ? { answer } : {}),
  });

export const submitClaimTx = (token: string, signedXdr: string) =>
  apiPost<SubmitResult>(`/claim/${token}/submit`, { signedXdr });
