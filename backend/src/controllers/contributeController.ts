import type { Request, Response } from 'express';
import type { z } from 'zod';

import { validated } from '../middleware/validateRequest.js';
import * as contributeService from '../services/contributeService.js';
import type {
  contributeSchema,
  contributeSubmitSchema,
  giftIdParamSchema,
} from '../validation/contributeSchemas.js';

/** Group-contribution routes (README §12.9, §13.4, §15.2). */

export async function publicSummary(req: Request, res: Response): Promise<void> {
  const { params } = validated<z.infer<typeof giftIdParamSchema>>(req);

  res.status(200).json(await contributeService.getPublicSummary(params.id));
}

export async function build(req: Request, res: Response): Promise<void> {
  const { params, body } = validated<z.infer<typeof contributeSchema>>(req);

  res
    .status(200)
    .json(
      await contributeService.buildContributeTransaction(
        params.id,
        body.contributorPublicKey,
        body.amount,
      ),
    );
}

export async function submit(req: Request, res: Response): Promise<void> {
  const { params, body } = validated<z.infer<typeof contributeSubmitSchema>>(req);

  res
    .status(200)
    .json(
      await contributeService.submitContributeTransaction(
        params.id,
        body.contributorPublicKey,
        body.amount,
        body.signedXdr,
      ),
    );
}
