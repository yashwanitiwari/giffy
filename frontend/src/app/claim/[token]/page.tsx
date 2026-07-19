'use client';

import { Check, ExternalLink, Gift, HeartCrack } from 'lucide-react';
import { use, useState } from 'react';

import { ClaimCountdown } from '@/components/ClaimCountdown';
import { NetworkGuard } from '@/components/NetworkGuard';
import { THEME_META } from '@/components/ThemePicker';
import { useTransactionErrorToast } from '@/components/TransactionErrorToast';
import { TriviaAnswerPrompt } from '@/components/TriviaAnswerPrompt';
import { TrustlinePrompt } from '@/components/TrustlinePrompt';
import { GlassButton } from '@/components/ui/GlassButton';
import { GlassCard } from '@/components/ui/GlassCard';
import { StepUnlockTracker } from '@/components/StepUnlockTracker';
import { WalletConnectButton } from '@/components/WalletConnectButton';
import { useClaim } from '@/hooks/useClaim';
import { useFreighter } from '@/hooks/useFreighter';
import { explorerTxUrl, formatAmount } from '@/lib/formatters';
import type { GiftTheme } from '@/types/api';

/**
 * Receiver claim page (README §13.3, §7.3), unified: status branching first
 * (claimed/refunded/expired are terminal states, active proceeds), then
 * condition gating (none/trivia/stepGate per §13.3's flowchart), then a
 * trustline check before the claim button regardless of condition type (§6.3).
 */

export default function ClaimPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const { publicKey } = useFreighter();
  const showError = useTransactionErrorToast();
  const { preview, error, isClaiming, claim } = useClaim(token);

  const [claimedTx, setClaimedTx] = useState<string | null>(null);
  const [countdownDone, setCountdownDone] = useState(false);
  const [trustlineOk, setTrustlineOk] = useState(false);
  const [verifiedAnswer, setVerifiedAnswer] = useState<string | null>(null);

  /** §7.3 steps 4–5: trustline check (bundled server-side into the build) → sign → submit. */
  const doClaim = async () => {
    if (!publicKey) return;

    try {
      const result = await claim(publicKey, verifiedAnswer ?? undefined);
      setClaimedTx(result.txHash);
    } catch (err) {
      showError(err);
    }
  };

  // ---- Invalid / unknown token: deliberately non-specific (§17.2). ----
  if (error) {
    return (
      <Centered>
        <GlassCard className="w-full max-w-md">
          <div className="p-8 flex flex-col items-center text-center space-y-4">
            <div className="w-12 h-12 bg-white/20 backdrop-blur-sm border border-white/30 rounded-full flex items-center justify-center">
              <HeartCrack className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-2xl font-semibold text-white">This gift link isn&apos;t valid</h1>
            <p className="text-white/70 text-sm">
              Double-check the link you were sent — it may be incomplete or no longer available.
            </p>
          </div>
        </GlassCard>
      </Centered>
    );
  }

  if (!preview) {
    return (
      <Centered>
        <div className="w-8 h-8 rounded-full border-2 border-white/30 border-t-white animate-spin" />
      </Centered>
    );
  }

  const theme = THEME_META[preview.theme as GiftTheme] ?? THEME_META.custom;
  const ThemeIcon = theme.Icon;
  const expired =
    countdownDone ||
    preview.status === 'refunded' ||
    preview.status === 'refund_pending' ||
    new Date(preview.expiresAt).getTime() <= Date.now();

  // ---- Success (this session) ----
  if (claimedTx) {
    return (
      <Centered>
        <GlassCard className="w-full max-w-md">
          <div className="p-8 flex flex-col items-center text-center space-y-5">
            <div className="w-16 h-16 bg-white/20 backdrop-blur-sm border border-white/30 rounded-full flex items-center justify-center">
              <Check className="w-8 h-8 text-white" />
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold text-white">
                {formatAmount(preview.amount)} {preview.assetCode} is yours
              </h1>
              <p className="text-white/70 text-sm">
                The gift has been claimed into your wallet — verified on the Stellar network.
              </p>
            </div>
            <a
              href={explorerTxUrl(claimedTx)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-white/80 hover:text-white text-sm inline-flex items-center gap-1 transition-colors"
            >
              View transaction <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </GlassCard>
      </Centered>
    );
  }

  // ---- Already claimed ----
  if (preview.status === 'claimed') {
    return (
      <TerminalState
        title="This gift has already been claimed"
        body="The funds were claimed into the receiver's wallet. If that was you — enjoy!"
      />
    );
  }

  // ---- Expired / refunded ----
  if (expired) {
    return (
      <TerminalState
        title="This gift has expired"
        body="The claim window closed, so the funds returned to the sender's control. Reach out to them if you think this was a mistake."
      />
    );
  }

  const condition = preview.condition;
  const conditionSatisfied =
    condition.type === 'none' ||
    (condition.type === 'trivia' && verifiedAnswer !== null) ||
    (condition.type === 'stepGate' &&
      (condition.stepsCompleted ?? 0) >= (condition.totalSteps ?? condition.steps?.length ?? 0));

  const claimReady = conditionSatisfied && trustlineOk;

  // ---- Live claim UI ----
  return (
    <Centered>
      <div className="w-full max-w-md space-y-4">
        <NetworkGuard>
          <GlassCard>
            <div
              className={`absolute inset-0 rounded-3xl bg-gradient-to-br ${theme.accent} to-transparent pointer-events-none`}
            />
            <div className="p-8 space-y-6">
              <div className="text-center space-y-3">
                <div className="mx-auto w-14 h-14 bg-white/20 backdrop-blur-sm border border-white/30 rounded-full flex items-center justify-center">
                  <ThemeIcon className="w-7 h-7 text-white" />
                </div>
                <p className="text-white/70 text-sm">{preview.senderLabel} sent you a gift</p>
                <h1 className="text-4xl font-semibold text-white">
                  {formatAmount(preview.amount)} {preview.assetCode}
                </h1>
              </div>

              <div className="rounded-2xl bg-white/10 border border-white/20 px-5 py-4">
                <p className="text-white/90 text-center italic">“{preview.message}”</p>
              </div>

              <div className="space-y-2">
                <p className="text-center text-xs uppercase tracking-wider text-white/60">
                  Time left to claim
                </p>
                <ClaimCountdown
                  expiresAt={preview.expiresAt}
                  onExpire={() => setCountdownDone(true)}
                />
              </div>

              {condition.type === 'trivia' && (
                <TriviaAnswerPrompt
                  token={token}
                  question={condition.question}
                  onVerified={setVerifiedAnswer}
                />
              )}

              {condition.type === 'stepGate' && condition.steps && (
                <StepUnlockTracker
                  steps={condition.steps}
                  stepsCompleted={condition.stepsCompleted ?? 0}
                />
              )}
              {condition.type === 'stepGate' && !conditionSatisfied && (
                <p className="text-center text-xs text-white/60">
                  Waiting on the sender to unlock the remaining steps before this can be claimed.
                </p>
              )}

              {publicKey ? (
                <div className="space-y-3">
                  <TrustlinePrompt
                    assetCode={preview.assetCode}
                    onSatisfied={() => setTrustlineOk(true)}
                  />
                  <GlassButton
                    className="w-full"
                    disabled={isClaiming || !claimReady}
                    onClick={() => void doClaim()}
                  >
                    <Gift className="w-4 h-4" />
                    {isClaiming ? 'Waiting for signature…' : 'Claim into my wallet'}
                  </GlassButton>
                </div>
              ) : (
                <div className="flex flex-col items-center space-y-3">
                  <WalletConnectButton className="w-full" />
                  <p className="text-center text-xs text-white/50">
                    Connect the Freighter wallet this gift was addressed to.
                  </p>
                </div>
              )}
            </div>
          </GlassCard>
        </NetworkGuard>
      </div>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 flex items-center justify-center">{children}</div>;
}

function TerminalState({ title, body }: { title: string; body: string }) {
  return (
    <Centered>
      <GlassCard className="w-full max-w-md">
        <div className="p-8 flex flex-col items-center text-center space-y-4">
          <div className="w-12 h-12 bg-white/20 backdrop-blur-sm border border-white/30 rounded-full flex items-center justify-center">
            <Gift className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl font-semibold text-white">{title}</h1>
          <p className="text-white/70 text-sm">{body}</p>
        </div>
      </GlassCard>
    </Centered>
  );
}
