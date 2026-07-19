import type { Request, Response } from 'express';
import type { z } from 'zod';

import { validated } from '../middleware/validateRequest.js';
import * as conditionService from '../services/conditionService.js';
import type { buildUnlockStepSchema, submitUnlockStepSchema } from '../validation/conditionSchemas.js';

/** Step-gate unlock routes (README §12.9, §15.3). */

export async function buildUnlock(req: Request, res: Response): Promise<void> {
  const { params, body } = validated<z.infer<typeof buildUnlockStepSchema>>(req);

  res
    .status(200)
    .json(await conditionService.buildUnlockStepTransaction(params.id, body.unlockerPublicKey));
}

export async function submitUnlock(req: Request, res: Response): Promise<void> {
  const { params, body } = validated<z.infer<typeof submitUnlockStepSchema>>(req);

  res.status(200).json(await conditionService.submitUnlockStepTransaction(params.id, body.signedXdr));
}
