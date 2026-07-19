import { Router } from 'express';

import * as conditionController from '../controllers/conditionController.js';
import { giftRoutesLimiter } from '../middleware/rateLimit.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { buildUnlockStepSchema, submitUnlockStepSchema } from '../validation/conditionSchemas.js';

/**
 * Step-gate unlock routes (README §12.9, §13.5, §15.3).
 *
 * Sender-side (or whoever `condition.stepUnlockerPublicKey` names, §17.6) — this is
 * the action that advances a step-gated gift, distinct from the receiver-side
 * trivia pre-check that lives under `/claim/:token/verify-answer`.
 */

export const conditionRoutes = Router();

conditionRoutes.use(giftRoutesLimiter);

conditionRoutes.post(
  '/:id/steps/unlock/build-transaction',
  validateRequest(buildUnlockStepSchema),
  conditionController.buildUnlock,
);

conditionRoutes.post(
  '/:id/steps/unlock/submit',
  validateRequest(submitUnlockStepSchema),
  conditionController.submitUnlock,
);
