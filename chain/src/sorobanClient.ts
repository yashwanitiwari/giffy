import { BASE_FEE, Contract, TransactionBuilder, rpc, scValToNative } from '@stellar/stellar-sdk';
import type { Transaction, xdr } from '@stellar/stellar-sdk';

import { config, TRANSACTION_TIMEOUT_SECONDS } from './config.js';
import { parseContractError } from './errors.js';

/**
 * The shared Soroban RPC server + contract instance every other file in this
 * module builds invocations against (README §11.2). Every other file imports
 * these rather than constructing its own, exactly like `horizonClient.ts` does
 * for classic Horizon.
 */
export const sorobanServer = new rpc.Server(config.SOROBAN_RPC_URL, {
  allowHttp: config.SOROBAN_RPC_URL.startsWith('http://'),
});

export const giftEscrowContract = new Contract(config.GIFT_ESCROW_CONTRACT_ID);

export interface SubmitResult {
  status: 'SUCCESS';
  returnValue?: unknown;
  txHash: string;
}

/**
 * Builds a `gift-escrow` invocation and simulates it, returning the fully
 * prepared (auth-tree-resolved), unsigned, signable transaction as XDR.
 *
 * Simulation is what resolves the full Soroban authorization tree, including
 * the nested token-transfer call inside `create_gift`/`contribute`/`claim`/
 * `refund` — never skip this step (README §4.4 / §8.3 principle 3).
 */
export async function buildAndSimulate(params: {
  sourcePublicKey: string;
  method: string;
  args: xdr.ScVal[];
}): Promise<string> {
  const account = await sorobanServer.getAccount(params.sourcePublicKey);
  const operation = giftEscrowContract.call(params.method, ...params.args);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: config.STELLAR_NETWORK_PASSPHRASE,
  })
    .addOperation(operation)
    .setTimeout(TRANSACTION_TIMEOUT_SECONDS)
    .build();

  const simulated = await sorobanServer.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(simulated)) {
    throw parseContractError(simulated);
  }

  const prepared = rpc.assembleTransaction(tx, simulated).build();
  return prepared.toXDR();
}

/**
 * Builds a simulation-only, read-only invocation of a contract method — used by
 * `getGift` (README §4.3), which never needs a real fee-paying signature since
 * the result of simulating is all that's needed and it's never submitted.
 *
 * Soroban RPC's `simulateTransaction` doesn't require the source account to be
 * the caller in any meaningful sense for a read, so a syntactically valid
 * "dummy" source account works here just as well as a real one — the contract
 * function itself (`get_gift`) requires no auth (README §4.3).
 */
export async function buildReadOnlyInvocation(
  sourcePublicKey: string,
  method: string,
  args: xdr.ScVal[],
): Promise<Transaction> {
  const account = await sorobanServer.getAccount(sourcePublicKey);
  const operation = giftEscrowContract.call(method, ...args);

  return new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: config.STELLAR_NETWORK_PASSPHRASE,
  })
    .addOperation(operation)
    .setTimeout(TRANSACTION_TIMEOUT_SECONDS)
    .build();
}

/**
 * Submits a signed Soroban invocation and polls until it reaches a terminal
 * status, per README §8.2's request lifecycle. Every state-changing chain-layer
 * action (`create_gift`, `contribute`, `unlock_step`, `claim`, `refund`) ends up
 * here — there is exactly one submission code path for the whole module.
 */
export async function submitSignedInvocation(signedXdr: string): Promise<SubmitResult> {
  const tx = TransactionBuilder.fromXDR(signedXdr, config.STELLAR_NETWORK_PASSPHRASE);
  const sendResult = await sorobanServer.sendTransaction(tx);

  if (sendResult.status === 'ERROR') {
    throw parseContractError(sendResult);
  }

  let getResult = await sorobanServer.getTransaction(sendResult.hash);
  const start = Date.now();
  while (
    getResult.status === rpc.Api.GetTransactionStatus.NOT_FOUND &&
    Date.now() - start < config.SOROBAN_TX_POLL_TIMEOUT_MS
  ) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    getResult = await sorobanServer.getTransaction(sendResult.hash);
  }

  if (getResult.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw parseContractError(getResult);
  }

  return {
    status: 'SUCCESS',
    // `getResult.returnValue` is a raw `xdr.ScVal` (e.g. an `SCV_U64` for
    // `create_gift`'s id) — decode it to a native JS value (bigint/string/etc.)
    // here, once, so every caller gets a value it can actually use rather than
    // an opaque XDR object.
    returnValue: getResult.returnValue ? scValToNative(getResult.returnValue) : undefined,
    txHash: sendResult.hash,
  };
}
