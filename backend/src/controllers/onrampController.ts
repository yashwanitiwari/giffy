import type { Request, Response } from 'express';
import type { z } from 'zod';

import { validated } from '../middleware/validateRequest.js';
import * as onrampService from '../services/onrampService.js';
import type {
  challengeSchema,
  depositStatusSchema,
  initiateDepositSchema,
  submitChallengeSchema,
} from '../validation/onrampSchemas.js';

/** SEP-10/SEP-24 on-ramp routes (README §10.5, §13.3). */

export async function challenge(req: Request, res: Response): Promise<void> {
  const { body } = validated<z.infer<typeof challengeSchema>>(req);

  res.status(200).json(await onrampService.requestChallenge(body.publicKey));
}

export async function submitChallenge(req: Request, res: Response): Promise<void> {
  const { body } = validated<z.infer<typeof submitChallengeSchema>>(req);

  // Returns an opaque session token. The anchor's JWT stays server-side (§15.7).
  res.status(200).json(await onrampService.submitChallenge(body.publicKey, body.signedXdr));
}

export async function initiateDeposit(req: Request, res: Response): Promise<void> {
  const { body } = validated<z.infer<typeof initiateDepositSchema>>(req);

  res.status(200).json(await onrampService.initiateDeposit(body.sessionToken, body.assetCode));
}

export async function status(req: Request, res: Response): Promise<void> {
  const { params } = validated<z.infer<typeof depositStatusSchema>>(req);

  res.status(200).json(await onrampService.getDepositStatus(params.id));
}
