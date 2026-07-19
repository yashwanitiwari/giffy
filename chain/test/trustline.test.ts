import { describe, expect, it } from 'vitest';

import { resolveAsset } from '../src/assets.js';
import { ChainError } from '../src/errors.js';
import { buildChangeTrustTx } from '../src/trustline.js';

const ACCOUNT = 'GDQK2MW24YTQO6QCP2JXWXLCDNLNQMDRZQHTAFNCAQ7JCZK64Q7MPEDU';

/**
 * `buildChangeTrustTx` loads a real account via classic Horizon (README §11.4),
 * so only its input validation and rejection paths — which run before any
 * network call — are covered at the unit tier. Actually building a trustline
 * transaction against a live, funded account is covered by
 * `trustline.integration.test.ts`.
 */
describe('buildChangeTrustTx', () => {
  it('refuses to build a trustline for native XLM, which never needs one', async () => {
    await expect(
      buildChangeTrustTx({ publicKey: ACCOUNT, asset: resolveAsset('XLM') }),
    ).rejects.toThrow(ChainError);
  });

  it('rejects a malformed public key', async () => {
    await expect(
      buildChangeTrustTx({ publicKey: 'nope', asset: resolveAsset('SRT') }),
    ).rejects.toThrow(ChainError);
  });
});
