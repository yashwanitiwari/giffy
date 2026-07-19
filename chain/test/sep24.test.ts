import { Keypair } from '@stellar/stellar-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AnchorError } from '../src/errors.js';
import { initiateInteractiveDeposit, pollTransactionStatus } from '../src/sep24.js';
import { isSep24Terminal } from '../src/types.js';

const TRANSFER_SERVER = 'https://testanchor.stellar.org/sep24';
const JWT = 'anchor.jwt.token';
const ACCOUNT = Keypair.random().publicKey();

function mockFetch(response: { ok?: boolean; status?: number; body: unknown; text?: string }): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Promise.resolve({
        ok: response.ok ?? true,
        status: response.status ?? 200,
        text: async () => response.text ?? JSON.stringify(response.body),
      } as Response),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('initiateInteractiveDeposit', () => {
  it('returns the anchor-hosted interactive URL and transaction id', async () => {
    mockFetch({
      body: {
        id: 'txn-123',
        url: 'https://testanchor.stellar.org/sep24/deposit/webapp?token=abc',
        type: 'interactive_customer_info_needed',
      },
    });

    const result = await initiateInteractiveDeposit({
      transferServerUrl: TRANSFER_SERVER,
      jwt: JWT,
      assetCode: 'SRT',
      account: ACCOUNT,
    });

    expect(result).toEqual({
      id: 'txn-123',
      interactiveUrl: 'https://testanchor.stellar.org/sep24/deposit/webapp?token=abc',
    });
  });

  it('authenticates with the SEP-10 JWT as a bearer token', async () => {
    mockFetch({ body: { id: 'txn-123', url: 'https://anchor.example/webapp' } });

    await initiateInteractiveDeposit({
      transferServerUrl: TRANSFER_SERVER,
      jwt: JWT,
      assetCode: 'SRT',
      account: ACCOUNT,
    });

    const [url, init] = vi.mocked(fetch).mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(`${TRANSFER_SERVER}/transactions/deposit/interactive`);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${JWT}`);
    expect(JSON.parse(init.body as string)).toEqual({ asset_code: 'SRT', account: ACCOUNT });
  });

  it('refuses to start a deposit without a JWT', async () => {
    mockFetch({ body: {} });

    await expect(
      initiateInteractiveDeposit({
        transferServerUrl: TRANSFER_SERVER,
        jwt: '',
        assetCode: 'SRT',
        account: ACCOUNT,
      }),
    ).rejects.toBeInstanceOf(AnchorError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a malformed account before making a request', async () => {
    mockFetch({ body: {} });

    await expect(
      initiateInteractiveDeposit({
        transferServerUrl: TRANSFER_SERVER,
        jwt: JWT,
        assetCode: 'SRT',
        account: 'not-an-address',
      }),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('surfaces the anchor error message', async () => {
    mockFetch({ ok: false, status: 403, body: { error: 'asset not supported' } });

    await expect(
      initiateInteractiveDeposit({
        transferServerUrl: TRANSFER_SERVER,
        jwt: JWT,
        assetCode: 'NOPE',
        account: ACCOUNT,
      }),
    ).rejects.toThrow(/asset not supported/);
  });

  it('errors when the anchor omits the interactive URL', async () => {
    mockFetch({ body: { id: 'txn-123' } });

    await expect(
      initiateInteractiveDeposit({
        transferServerUrl: TRANSFER_SERVER,
        jwt: JWT,
        assetCode: 'SRT',
        account: ACCOUNT,
      }),
    ).rejects.toBeInstanceOf(AnchorError);
  });
});

describe('pollTransactionStatus', () => {
  it('reports an in-progress status', async () => {
    mockFetch({ body: { transaction: { id: 'txn-123', status: 'pending_user_transfer_start' } } });

    const result = await pollTransactionStatus({
      transferServerUrl: TRANSFER_SERVER,
      jwt: JWT,
      transactionId: 'txn-123',
    });

    expect(result.status).toBe('pending_user_transfer_start');
    expect(result.stellarTransactionId).toBeUndefined();
  });

  it('reports the Stellar transaction id once completed', async () => {
    mockFetch({
      body: {
        transaction: {
          id: 'txn-123',
          status: 'completed',
          stellar_transaction_id: 'b4c9f1',
          message: 'deposit received',
        },
      },
    });

    const result = await pollTransactionStatus({
      transferServerUrl: TRANSFER_SERVER,
      jwt: JWT,
      transactionId: 'txn-123',
    });

    expect(result).toEqual({
      status: 'completed',
      stellarTransactionId: 'b4c9f1',
      message: 'deposit received',
    });
  });

  it('passes an unrecognized status through verbatim', async () => {
    // README §14.3: the anchor's enum is stored as-is rather than remapped, so a
    // status this client has never heard of must survive the round trip intact
    // instead of collapsing into 'error'.
    mockFetch({ body: { transaction: { id: 'txn-123', status: 'pending_customer_info_update' } } });

    const result = await pollTransactionStatus({
      transferServerUrl: TRANSFER_SERVER,
      jwt: JWT,
      transactionId: 'txn-123',
    });

    expect(result.status).toBe('pending_customer_info_update');
  });

  it('queries by transaction id with the JWT', async () => {
    mockFetch({ body: { transaction: { status: 'incomplete' } } });

    await pollTransactionStatus({
      transferServerUrl: TRANSFER_SERVER,
      jwt: JWT,
      transactionId: 'txn-123',
    });

    const [url, init] = vi.mocked(fetch).mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(`${TRANSFER_SERVER}/transaction?id=txn-123`);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${JWT}`);
  });

  it('refuses to poll without a JWT', async () => {
    mockFetch({ body: {} });

    await expect(
      pollTransactionStatus({
        transferServerUrl: TRANSFER_SERVER,
        jwt: '',
        transactionId: 'txn-123',
      }),
    ).rejects.toBeInstanceOf(AnchorError);
  });

  it('errors when the anchor returns no transaction', async () => {
    mockFetch({ ok: false, status: 404, body: { error: 'transaction not found' } });

    await expect(
      pollTransactionStatus({
        transferServerUrl: TRANSFER_SERVER,
        jwt: JWT,
        transactionId: 'nope',
      }),
    ).rejects.toThrow(/transaction not found/);
  });
});

describe('isSep24Terminal', () => {
  it.each(['completed', 'error', 'refunded', 'expired', 'no_market', 'too_small', 'too_large'])(
    'treats %s as terminal',
    (status) => {
      expect(isSep24Terminal(status)).toBe(true);
    },
  );

  it.each(['incomplete', 'pending_user_transfer_start', 'pending_anchor', 'pending_stellar'])(
    'keeps polling on %s',
    (status) => {
      expect(isSep24Terminal(status)).toBe(false);
    },
  );

  it('keeps polling on an unrecognized status rather than stopping early', () => {
    expect(isSep24Terminal('pending_customer_info_update')).toBe(false);
  });
});
