/**
 * Real transaction results captured from Stellar testnet.
 *
 * These are genuine Horizon `result_xdr` payloads, not hand-constructed XDR — the
 * point of testing the decoder is to prove it handles what the network actually
 * returns, which a synthetic fixture built with the same SDK types would not.
 *
 * `CREATE_BALANCE_RESULT.expectedBalanceId` was read from Horizon's own
 * /claimable_balances endpoint rather than from our decoder, so the assertion is an
 * independent check rather than a circular one.
 */

/** A successful CreateClaimableBalanceOp: 12.5 XLM, two complementary claimants. */
export const CREATE_BALANCE_RESULT = {
  txHash: '804d4a3ce03ff96a1dcae0816ec325e57bb03961265fc8fa53f7e44c80b6e418',
  resultXdr:
    'AAAAAAAAAGQAAAAAAAAAAQAAAAAAAAAOAAAAAAAAAACZMtOLMwAa4KOaLcE2wzrkVRU8eeCJYFBM4/A5xtRnTgAAAAA=',
  expectedBalanceId: '000000009932d38b33001ae0a39a2dc136c33ae455153c79e08960504ce3f039c6d4674e',
  senderPublicKey: 'GDQK2MW24YTQO6QCP2JXWXLCDNLNQMDRZQHTAFNCAQ7JCZK64Q7MPEDU',
  receiverPublicKey: 'GDE7XGX224URB25XKXVHNCWFJBN2WBVMRKV5WGCQ7BUMTN5C6FXTDA35',
} as const;

/** A successful ClaimClaimableBalanceOp — contains no create-balance result. */
export const CLAIM_RESULT = {
  txHash: '54e6b1224ee1c39ec9ed2eb44c810c1bd8fc344d7e067ba9142c0d90f4f3852a',
  resultXdr: 'AAAAAAAAAGQAAAAAAAAAAQAAAAAAAAAPAAAAAAAAAAA=',
} as const;

/** A ClaimClaimableBalanceOp rejected because the claimant's predicate was false. */
export const FAILED_CLAIM_RESULT = {
  resultXdr: 'AAAAAAAAAGT/////AAAAAQAAAAAAAAAP/////gAAAAA=',
} as const;

/** Horizon's error shape for that same rejection, as thrown by the SDK. */
export const CANNOT_CLAIM_ERROR = {
  response: {
    status: 400,
    data: {
      type: 'https://stellar.org/horizon-errors/transaction_failed',
      title: 'Transaction Failed',
      status: 400,
      extras: {
        result_codes: { transaction: 'tx_failed', operations: ['op_cannot_claim'] },
        result_xdr: FAILED_CLAIM_RESULT.resultXdr,
      },
    },
  },
} as const;
