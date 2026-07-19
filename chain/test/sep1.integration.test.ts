import { describe, expect, it } from 'vitest';

import { KNOWN_TESTNET_ASSETS } from '../src/assets.js';
import { config } from '../src/config.js';
import { AnchorError } from '../src/errors.js';
import { clearStellarTomlCache, resolveAnchoredAssetIssuer, resolveStellarToml } from '../src/sep1.js';

/** Live SEP-1 resolution against the SDF reference anchor. */
describe('resolveStellarToml (live anchor)', () => {
  it('resolves the anchor SEP-10 and SEP-24 endpoints', async () => {
    const toml = await resolveStellarToml(config.ANCHOR_HOME_DOMAIN);

    expect(toml.webAuthEndpoint).toMatch(/^https:\/\//);
    expect(toml.transferServerSep24).toMatch(/^https:\/\//);
    expect(toml.signingKey).toMatch(/^G[A-Z2-7]{55}$/);
  });

  it('lists SRT with the issuer our known-assets table falls back to', async () => {
    // Guards the hardcoded fallback in assets.ts against drifting away from what
    // the anchor actually publishes (README §9.2). If this ever fails, the anchor
    // is authoritative and the table is what needs updating.
    const issuer = await resolveAnchoredAssetIssuer(config.ANCHOR_HOME_DOMAIN, 'SRT');

    expect(issuer).toBe(KNOWN_TESTNET_ASSETS.SRT!.issuer);
  });

  it('caches per domain instead of refetching on every call', async () => {
    clearStellarTomlCache();

    const first = await resolveStellarToml(config.ANCHOR_HOME_DOMAIN);
    const second = await resolveStellarToml(config.ANCHOR_HOME_DOMAIN);

    expect(second).toBe(first); // same object identity: served from cache
  });

  it('accepts a home domain given as a URL', async () => {
    const toml = await resolveStellarToml(`https://${config.ANCHOR_HOME_DOMAIN}/`);

    expect(toml.webAuthEndpoint).toMatch(/^https:\/\//);
  });

  it('reports a domain that publishes no stellar.toml', async () => {
    await expect(
      resolveStellarToml('example.invalid'),
    ).rejects.toBeInstanceOf(AnchorError);
  });

  it('reports an asset the anchor does not anchor', async () => {
    await expect(
      resolveAnchoredAssetIssuer(config.ANCHOR_HOME_DOMAIN, 'NOTANASSET'),
    ).rejects.toBeInstanceOf(AnchorError);
  });
});
