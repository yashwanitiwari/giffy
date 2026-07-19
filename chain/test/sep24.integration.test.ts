import { beforeAll, describe, expect, it } from 'vitest';

import { config } from '../src/config.js';
import { AnchorError } from '../src/errors.js';
import { resolveStellarToml } from '../src/sep1.js';
import { requestChallenge, submitSignedChallenge } from '../src/sep10.js';
import { initiateInteractiveDeposit, pollTransactionStatus } from '../src/sep24.js';
import { isSep24Terminal, type StellarTomlInfo } from '../src/types.js';
import { fundedKeypair, signXdr } from './helpers.js';

/**
 * The real SEP-24 deposit initiation against the SDF reference anchor.
 *
 * The test stops where a human takes over: the anchor's hosted form is the anchor's
 * surface, not Giffy's, and driving it here would couple this suite to UI Giffy
 * neither owns nor controls (README §18.5). What is asserted is everything Giffy's
 * own client is responsible for — authenticating, obtaining a real interactive URL,
 * and reading status back.
 */
describe('SEP-24 interactive deposit (live anchor)', () => {
  let toml: StellarTomlInfo;
  let jwt: string;
  let account: string;

  beforeAll(async () => {
    toml = await resolveStellarToml(config.ANCHOR_HOME_DOMAIN);

    const keypair = await fundedKeypair();
    account = keypair.publicKey();

    const challengeXdr = await requestChallenge(
      toml.webAuthEndpoint,
      account,
      config.ANCHOR_HOME_DOMAIN,
      toml.signingKey,
    );
    jwt = await submitSignedChallenge(toml.webAuthEndpoint, signXdr(challengeXdr, keypair));
  });

  it('starts a deposit and returns the anchor-hosted interactive URL', async () => {
    const { id, interactiveUrl } = await initiateInteractiveDeposit({
      transferServerUrl: toml.transferServerSep24,
      jwt,
      assetCode: 'SRT',
      account,
    });

    expect(id).toBeTruthy();

    // The URL the OnrampModal will host in an iframe/popup. It is served by the
    // anchor, not by Giffy.
    expect(interactiveUrl).toMatch(/^https:\/\//);
    expect(new URL(interactiveUrl).host).toContain('testanchor.stellar.org');
  });

  it('reads back the status of a freshly started deposit', async () => {
    const { id } = await initiateInteractiveDeposit({
      transferServerUrl: toml.transferServerSep24,
      jwt,
      assetCode: 'SRT',
      account,
    });

    const { status } = await pollTransactionStatus({
      transferServerUrl: toml.transferServerSep24,
      jwt,
      transactionId: id,
    });

    // Nobody has filled in the anchor's form, so this deposit cannot be finished:
    // it is necessarily still in a non-terminal state.
    expect(status).toBeTruthy();
    expect(isSep24Terminal(status)).toBe(false);
  });

  it('is refused by the anchor without a valid JWT', async () => {
    await expect(
      initiateInteractiveDeposit({
        transferServerUrl: toml.transferServerSep24,
        jwt: 'not.a.valid.jwt',
        assetCode: 'SRT',
        account,
      }),
    ).rejects.toBeInstanceOf(AnchorError);
  });

  it('reports an unknown transaction id', async () => {
    await expect(
      pollTransactionStatus({
        transferServerUrl: toml.transferServerSep24,
        jwt,
        transactionId: '00000000-0000-0000-0000-000000000000',
      }),
    ).rejects.toBeInstanceOf(AnchorError);
  });
});
