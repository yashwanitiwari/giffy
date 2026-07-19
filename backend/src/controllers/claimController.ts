import type { Request, Response } from 'express';
import type { z } from 'zod';

import { validated } from '../middleware/validateRequest.js';
import * as claimService from '../services/claimService.js';
import type {
  buildClaimSchema,
  claimTokenSchema,
  submitClaimSchema,
  verifyAnswerSchema,
} from '../validation/giftSchemas.js';

/** Receiver-facing claim routes (README §12.9, §13.3, §15.3, §15.4). */

export async function preview(req: Request, res: Response): Promise<void> {
  const { params } = validated<z.infer<typeof claimTokenSchema>>(req);

  res.status(200).json(await claimService.resolveClaimToken(params.token));
}

/** Trivia pre-check (§15.3): advisory only, so the UI can gate the claim button. */
export async function verifyAnswer(req: Request, res: Response): Promise<void> {
  const { params, body } = validated<z.infer<typeof verifyAnswerSchema>>(req);

  res.status(200).json(await claimService.verifyAnswer(params.token, body.answer));
}

export async function buildTransaction(req: Request, res: Response): Promise<void> {
  const { params, body } = validated<z.infer<typeof buildClaimSchema>>(req);

  res
    .status(200)
    .json(
      await claimService.buildClaimTransaction(
        params.token,
        body.claimantPublicKey,
        body.answer ?? undefined,
      ),
    );
}

export async function submit(req: Request, res: Response): Promise<void> {
  const { params, body } = validated<z.infer<typeof submitClaimSchema>>(req);

  res.status(200).json(await claimService.submitClaimTransaction(params.token, body.signedXdr));
}
