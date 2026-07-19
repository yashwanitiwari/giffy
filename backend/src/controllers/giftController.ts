import type { Request, Response } from 'express';
import type { z } from 'zod';

import { validated } from '../middleware/validateRequest.js';
import type { GiftDocument } from '../models/Gift.js';
import * as giftService from '../services/giftService.js';
import * as refundService from '../services/refundService.js';
import type {
  buildRefundSchema,
  createGiftSchema,
  giftIdParamSchema,
  listGiftsSchema,
  submitSignedXdrSchema,
} from '../validation/giftSchemas.js';

/**
 * Sender-facing gift routes (README §12.9, §15.1, §15.5).
 *
 * Thin by design: read the validated request, call exactly one service method, shape
 * the response. Business logic stays in services so it remains testable without
 * standing up Express. Async throws propagate to `errorHandler` — Express 5 forwards
 * rejected promises from handlers automatically, so there is no try/catch here.
 */

export async function create(req: Request, res: Response): Promise<void> {
  const { body } = validated<z.infer<typeof createGiftSchema>>(req);

  const gift = await giftService.createDraft(body);

  res.status(201).json({ giftId: gift.id, status: gift.status });
}

export async function buildTransaction(req: Request, res: Response): Promise<void> {
  const { params } = validated<z.infer<typeof giftIdParamSchema>>(req);

  res.status(200).json(await giftService.buildCreateTransaction(params.id));
}

export async function submit(req: Request, res: Response): Promise<void> {
  const { params, body } = validated<z.infer<typeof submitSignedXdrSchema>>(req);

  res.status(200).json(await giftService.submitCreateTransaction(params.id, body.signedXdr));
}

export async function listMine(req: Request, res: Response): Promise<void> {
  const { query } = validated<z.infer<typeof listGiftsSchema>>(req);

  const gifts = await giftService.listGiftsBySender(query.senderPublicKey);

  res.status(200).json({ gifts: gifts.map(toGiftDTO) });
}

export async function buildRefund(req: Request, res: Response): Promise<void> {
  const { params, body } = validated<z.infer<typeof buildRefundSchema>>(req);

  // The caller's key identifies who is asking. It is a scoping value, not an
  // authenticated identity (§17.10) — the contract's own `require_auth` is what
  // actually ensures only an eligible address can reclaim, since only they can sign
  // this transaction.
  res.status(200).json(await refundService.buildRefundTransaction(params.id, body.callerPublicKey));
}

export async function submitRefund(req: Request, res: Response): Promise<void> {
  const { params, body } = validated<z.infer<typeof submitSignedXdrSchema>>(req);

  res.status(200).json(await refundService.submitRefundTransaction(params.id, body.signedXdr));
}

/**
 * The sender-facing view of a gift.
 *
 * Explicit rather than serializing the document: `claimTokenHash` is in the row and
 * must never travel, and an allowlist is the only shape of this function that stays
 * correct when someone adds a field to the schema later.
 */
function toGiftDTO(gift: GiftDocument): Record<string, unknown> {
  return {
    giftId: gift.id,
    receiverPublicKey: gift.receiverPublicKey,
    assetCode: gift.assetCode,
    assetIssuer: gift.assetIssuer,
    amount: gift.amount,
    message: gift.message,
    theme: gift.theme,
    status: gift.status,
    contractGiftId: gift.contractGiftId,
    isGroupGift: gift.isGroupGift,
    goalAmount: gift.goalAmount,
    contributions: gift.contributions.map((c) => ({
      contributorPublicKey: c.contributorPublicKey,
      amount: c.amount,
      contributedAt: c.contributedAt.toISOString(),
    })),
    condition: {
      type: gift.condition.type,
      question: gift.condition.question,
      steps: gift.condition.steps,
      stepsCompleted: gift.condition.stepsCompleted,
    },
    txHashCreate: gift.txHashCreate,
    txHashClaim: gift.txHashClaim,
    txHashRefund: gift.txHashRefund,
    expiresAt: gift.expiresAt.toISOString(),
    createdAt: gift.createdAt.toISOString(),
  };
}
