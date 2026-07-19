import { TransactionBuilder, type Transaction } from '@stellar/stellar-sdk';
import { beforeAll, describe, expect, it } from 'vitest';

import { config } from '../src/config.js';
import { AnchorError } from '../src/errors.js';
import { networkPassphrase } from '../src/horizonClient.js';
import { resolveStellarToml } from '../src/sep1.js';
import { requestChallenge, submitSignedChallenge } from '../src/sep10.js';
import type { StellarTomlInfo } from '../src/types.js';
import { fundedKeypair, signXdr } from './helpers.js';

/**
 * The real SEP-10 handshake against the SDF reference anchor.
 *
 * This is what makes the integration honest (README §5.5): the same client code
 * would authenticate against any spec-compliant production anchor by pointing at a
 * different home domain.
 */
describe('SEP-10 web authentication (live anchor)', () => {
  let toml: StellarTomlInfo;

  beforeAll(async () => {
    toml = await resolveStellarToml(config.ANCHOR_HOME_DOMAIN);
  });

  it('completes the challenge/response handshake and returns a JWT', async () => {
    const keypair = await fundedKeypair();

    const challengeXdr = await requestChallenge(
      toml.webAuthEndpoint,
      keypair.publicKey(),
      config.ANCHOR_HOME_DOMAIN,
      toml.signingKey, // verifies the anchor's own signature on the challenge
    );

    // The challenge is a signable artifact, never submitted to the network.
    const challenge = TransactionBuilder.fromXDR(challengeXdr, networkPassphrase) as Transaction;
    expect(challenge.operations[0]!.type).toBe('manageData');
    expect(challenge.source).toBe(toml.signingKey);

    // In production this signature happens in Freighter; nothing in src/ ever signs.
    const jwt = await submitSignedChallenge(toml.webAuthEndpoint, signXdr(challengeXdr, keypair));

    expect(jwt.split('.')).toHaveLength(3); // header.payload.signature

    const payload = JSON.parse(
      Buffer.from(jwt.split('.')[1]!, 'base64url').toString('utf8'),
    ) as { sub: string };

    // The JWT is scoped to the account that signed the challenge.
    expect(payload.sub).toBe(keypair.publicKey());
  });

  it('is rejected by the anchor when the challenge is unsigned', async () => {
    const keypair = await fundedKeypair();

    const challengeXdr = await requestChallenge(
      toml.webAuthEndpoint,
      keypair.publicKey(),
      config.ANCHOR_HOME_DOMAIN,
      toml.signingKey,
    );

    // No client signature means no proof of key ownership, so no JWT.
    await expect(submitSignedChallenge(toml.webAuthEndpoint, challengeXdr)).rejects.toBeInstanceOf(
      AnchorError,
    );
  });

  it("rejects the anchor's challenge when verified against the wrong signing key", async () => {
    const keypair = await fundedKeypair();
    const wrongKey = (await fundedKeypair()).publicKey();

    await expect(
      requestChallenge(
        toml.webAuthEndpoint,
        keypair.publicKey(),
        config.ANCHOR_HOME_DOMAIN,
        wrongKey,
      ),
    ).rejects.toBeInstanceOf(AnchorError);
  });
});
