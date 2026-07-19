'use client';

/**
 * Level 1 — self-contained Freighter wallet panel (Requirements 1–4).
 *
 * Walks a reviewer through the full flow on a single surface:
 * detect → connect → balance → send → tx hash. State and every async action come
 * from `useWallet()`; the Freighter/SDK layers live in `stellar-wallet.ts` and
 * `stellar-sdk.ts`. Styled with the app's frosted-glass UI kit.
 */
import { CheckCircle2, ExternalLink, Loader2, RotateCcw, Send, Wallet, XCircle } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { GlassButton } from '@/components/ui/GlassButton';
import { GlassCard } from '@/components/ui/GlassCard';
import { GlassInput, GlassLabel } from '@/components/ui/GlassInput';
import { useWallet } from '@/hooks/use-stellar-wallet';
import { HORIZON_TESTNET_URL, STELLAR_TESTNET_PASSPHRASE } from '@/lib/stellar-wallet';

function explorerTxUrl(hash: string): string {
  return `https://stellar.expert/explorer/testnet/tx/${hash}`;
}

export function StellarWalletPanel() {
  const {
    installed,
    address,
    balance,
    isConnected,
    isLoading,
    error,
    connect,
    disconnect,
    refreshBalance,
    sendXlm,
  } = useWallet();

  const [destination, setDestination] = useState('');
  const [amount, setAmount] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sentHash, setSentHash] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  async function handleSend(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSentHash(null);
    setSendError(null);
    setIsSending(true);
    try {
      const { hash } = await sendXlm(destination.trim(), amount.trim());
      setSentHash(hash);
      setDestination('');
      setAmount('');
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Failed to send XLM.');
    } finally {
      setIsSending(false);
    }
  }

  return (
    <GlassCard className="w-full max-w-xl mx-auto">
      <div className="p-6 sm:p-8 space-y-6">
        <header className="flex items-center gap-3">
          <span className="w-11 h-11 bg-white/20 border border-white/30 rounded-xl flex items-center justify-center text-white">
            <Wallet className="w-5 h-5" />
          </span>
          <div>
            <h1 className="text-lg font-semibold text-white">Stellar Wallet</h1>
            <p className="text-sm text-white/60">Freighter integration · Testnet</p>
          </div>
        </header>

        {/* Requirement 1 — extension not detected. */}
        {installed === false && (
          <div className="rounded-xl border border-amber-300/30 bg-amber-400/10 p-4 space-y-3">
            <p className="text-sm text-white/90">
              Freighter extension not detected. Install it to connect your wallet.
            </p>
            <a
              href="https://freighter.app"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm font-medium text-white bg-white/20 hover:bg-white/30 border border-white/30 rounded-xl h-10 px-4 transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
              Install Freighter
            </a>
          </div>
        )}

        {/* Requirement 1 — detecting. */}
        {installed === null && (
          <div className="flex items-center gap-2 text-sm text-white/70">
            <Loader2 className="w-4 h-4 animate-spin" />
            Detecting Freighter…
          </div>
        )}

        {/* Requirement 2 — connect. */}
        {installed && !isConnected && (
          <GlassButton onClick={() => void connect()} disabled={isLoading} className="w-full">
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wallet className="w-4 h-4" />}
            {isLoading ? 'Connecting…' : 'Connect Wallet'}
          </GlassButton>
        )}

        {/* Requirements 2 & 3 — connected: address, balance, refresh, disconnect. */}
        {isConnected && (
          <div className="space-y-6">
            <div className="rounded-xl border border-white/20 bg-white/5 p-4 space-y-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-white/50 mb-1">Address</p>
                <p className="font-mono text-sm text-white break-all">{address}</p>
              </div>

              <div>
                <p className="text-xs uppercase tracking-wide text-white/50 mb-1">Balance</p>
                <p className="text-2xl font-semibold text-white">
                  {balance === null ? (
                    <span className="inline-flex items-center gap-2 text-base text-white/60">
                      <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                    </span>
                  ) : balance === '0' ? (
                    <>
                      0 XLM{' '}
                      <span className="text-sm font-normal text-white/50">(account not funded)</span>
                    </>
                  ) : (
                    <>{balance} XLM</>
                  )}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <GlassButton onClick={() => void refreshBalance()} disabled={isLoading} className="!h-10">
                  {isLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <RotateCcw className="w-4 h-4" />
                  )}
                  Refresh Balance
                </GlassButton>
                <GlassButton onClick={disconnect} className="!h-10">
                  <span className="w-2 h-2 rounded-full bg-green-400" />
                  Disconnect
                </GlassButton>
              </div>
            </div>

            {/* Requirement 4 — send XLM. */}
            <form onSubmit={handleSend} className="space-y-4">
              <div className="space-y-1.5">
                <GlassLabel htmlFor="destination">Destination address</GlassLabel>
                <GlassInput
                  id="destination"
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  placeholder="G…"
                  autoComplete="off"
                  spellCheck={false}
                  required
                  disabled={isSending}
                />
              </div>

              <div className="space-y-1.5">
                <GlassLabel htmlFor="amount">Amount (XLM)</GlassLabel>
                <GlassInput
                  id="amount"
                  type="number"
                  min="0"
                  step="0.0000001"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.0000000"
                  required
                  disabled={isSending}
                />
              </div>

              <GlassButton type="submit" disabled={isSending} className="w-full">
                {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {isSending ? 'Sending…' : 'Send XLM'}
              </GlassButton>
            </form>

            {/* Requirement 4 (step 6) — success banner. */}
            {sentHash && (
              <div className="rounded-xl border border-green-300/40 bg-green-400/15 p-4 space-y-2">
                <p className="flex items-center gap-2 text-sm font-medium text-white">
                  <CheckCircle2 className="w-4 h-4 text-green-300" />
                  Transaction sent!
                </p>
                <p className="font-mono text-xs text-white/80 break-all">Hash: {sentHash}</p>
                <a
                  href={explorerTxUrl(sentHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-green-200 hover:text-white transition-colors"
                >
                  View on Stellar Expert
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            )}

            {/* Requirement 4 (step 7) — failure banner. */}
            {sendError && (
              <div className="rounded-xl border border-red-300/40 bg-red-500/15 p-4">
                <p className="flex items-start gap-2 text-sm text-white">
                  <XCircle className="w-4 h-4 text-red-300 mt-0.5 shrink-0" />
                  {sendError}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Non-send errors (connect / balance). */}
        {error && !sendError && (
          <div className="rounded-xl border border-red-300/40 bg-red-500/15 p-4">
            <p className="flex items-start gap-2 text-sm text-white">
              <XCircle className="w-4 h-4 text-red-300 mt-0.5 shrink-0" />
              {error}
            </p>
          </div>
        )}

        {/* Requirement 1 — network transparency. */}
        <footer className="border-t border-white/10 pt-4 space-y-1 text-xs text-white/50">
          <p className="break-all">Horizon: {HORIZON_TESTNET_URL}</p>
          <p className="break-all">Network: {STELLAR_TESTNET_PASSPHRASE}</p>
        </footer>
      </div>
    </GlassCard>
  );
}
