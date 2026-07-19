import { assertValidPublicKey } from './accounts.js';
import { AnchorError } from './errors.js';
import { fetchWithTimeout } from './horizonClient.js';
import type {
  InitiateInteractiveDepositParams,
  InteractiveDepositResult,
  PollTransactionStatusParams,
  Sep24TransactionStatus,
} from './types.js';

/**
 * SEP-24 hosted deposit (README §5.4).
 *
 * Giffy never renders the deposit form itself — the anchor hosts it, and this
 * client's job is to obtain the interactive URL and then report status.
 */

interface InteractiveResponse {
  id?: string;
  url?: string;
  type?: string;
  error?: string;
}

interface TransactionResponse {
  transaction?: {
    id?: string;
    status?: string;
    stellar_transaction_id?: string;
    message?: string;
    more_info_url?: string;
  };
  error?: string;
}

/**
 * Starts an interactive deposit and returns the anchor-hosted URL to open.
 *
 * For `testanchor.stellar.org` the hosted page is a mock bank-transfer form that
 * auto-approves. The protocol exchange is real; the money is not (README §5.5).
 */
export async function initiateInteractiveDeposit(
  params: InitiateInteractiveDepositParams,
): Promise<InteractiveDepositResult> {
  const { transferServerUrl, jwt, assetCode, account } = params;

  assertValidPublicKey(account);

  if (!jwt) {
    throw new AnchorError('A SEP-10 JWT is required before initiating a deposit.');
  }

  let response: Response;
  try {
    response = await fetchWithTimeout(`${transferServerUrl}/transactions/deposit/interactive`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ asset_code: assetCode, account }),
    });
  } catch (err) {
    throw new AnchorError('Could not reach the anchor to start a deposit.', err);
  }

  const body = (await readJson(response)) as InteractiveResponse;

  if (!response.ok || !body.id || !body.url) {
    throw new AnchorError(
      body.error ?? `The anchor refused to start a deposit (HTTP ${response.status}).`,
      body,
    );
  }

  return { id: body.id, interactiveUrl: body.url };
}

/**
 * Reads the current status of a SEP-24 transaction.
 *
 * The anchor's status string is passed through verbatim rather than re-mapped to a
 * Giffy enum (README §14.3): an unrecognized status from a spec-compliant anchor
 * must remain representable rather than collapsing into "error".
 */
export async function pollTransactionStatus(
  params: PollTransactionStatusParams,
): Promise<Sep24TransactionStatus> {
  const { transferServerUrl, jwt, transactionId } = params;

  if (!jwt) {
    throw new AnchorError('A SEP-10 JWT is required to read a deposit status.');
  }

  const url = new URL(`${transferServerUrl}/transaction`);
  url.searchParams.set('id', transactionId);

  let response: Response;
  try {
    response = await fetchWithTimeout(url.toString(), {
      method: 'GET',
      headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/json' },
    });
  } catch (err) {
    throw new AnchorError('Could not reach the anchor to read the deposit status.', err);
  }

  const body = (await readJson(response)) as TransactionResponse;

  if (!response.ok || !body.transaction?.status) {
    throw new AnchorError(
      body.error ?? `The anchor could not report this deposit's status (HTTP ${response.status}).`,
      body,
    );
  }

  const { status, stellar_transaction_id, message } = body.transaction;

  return {
    status,
    ...(stellar_transaction_id ? { stellarTransactionId: stellar_transaction_id } : {}),
    ...(message ? { message } : {}),
  };
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AnchorError(
      `The anchor returned a non-JSON response (HTTP ${response.status}): ${text.slice(0, 200)}`,
    );
  }
}
