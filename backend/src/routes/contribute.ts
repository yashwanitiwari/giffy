import { Router } from 'express';

import * as contributeController from '../controllers/contributeController.js';
import { giftRoutesLimiter } from '../middleware/rateLimit.js';
import { validateRequest } from '../middleware/validateRequest.js';
import {
  contributeSchema,
  contributeSubmitSchema,
  giftIdParamSchema,
} from '../validation/contributeSchemas.js';

/**
 * Group-contribution routes (README §12.9, §15.2).
 *
 * Mounted alongside the sender routes under `/gifts/:id/...` — a contribution is an
 * action against an existing gift, not a resource of its own. `group-summary` is
 * public (no sender/receiver-private data), unlike the rest of `/gifts`.
 */

export const contributeRoutes = Router();

contributeRoutes.use(giftRoutesLimiter);

contributeRoutes.get(
  '/:id/group-summary',
  validateRequest(giftIdParamSchema),
  contributeController.publicSummary,
);

contributeRoutes.post(
  '/:id/contribute/build-transaction',
  validateRequest(contributeSchema),
  contributeController.build,
);

contributeRoutes.post(
  '/:id/contribute/submit',
  validateRequest(contributeSubmitSchema),
  contributeController.submit,
);
