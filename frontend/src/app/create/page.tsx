'use client';

import { ArrowLeft, Check, Coins, Gift, Lock, Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';

import { ConditionPicker } from '@/components/ConditionPicker';
import { ContributionToggle } from '@/components/ContributionToggle';
import { NetworkGuard } from '@/components/NetworkGuard';
import { OnrampModal } from '@/components/OnrampModal';
import { QrCodeCard } from '@/components/QrCodeCard';
import { StepGateForm } from '@/components/StepGateForm';
import { SealAmountToggle } from '@/components/SealAmountToggle';
import { ThemePicker } from '@/components/ThemePicker';
import { useToast } from '@/components/Toast';
import { useTransactionErrorToast } from '@/components/TransactionErrorToast';
import { TriviaQuestionForm } from '@/components/TriviaQuestionForm';
import { TrustlinePrompt } from '@/components/TrustlinePrompt';
import { GhostButton, GlassButton } from '@/components/ui/GlassButton';
import { GlassCard } from '@/components/ui/GlassCard';
import { GlassInput, GlassLabel, GlassSelect, GlassTextarea } from '@/components/ui/GlassInput';
import { WalletConnectButton } from '@/components/WalletConnectButton';
import { useFreighter } from '@/hooks/useFreighter';
import { useGift } from '@/hooks/useGift';
import { useSealedDeposit } from '@/hooks/useSealedDeposit';
import { fetchBalances, GIFTABLE_ASSETS, type AccountBalance } from '@/lib/assets';
import { formatAmount } from '@/lib/formatters';
import { isValidPublicKey, truncateKey } from '@/lib/stellarAddress';
import type { ConditionInput, ConditionType, GiftStep, GiftTheme, SubmittedGift } from '@/types/api';

/**
 * Sender wizard (README §13.2), unified: every gift composer shows the same
 * fields — contribution and condition settings are ordinary, first-class parts
 * of composing a gift, not a separate "advanced mode."
 *
 * Connect → [optional] Buy Funds → Compose → Trustline check → Review →
 * Sign & Submit (always `create_gift`, no branching) → Success.
 */

type WizardStep = 'connect' | 'compose' | 'trustline' | 'review' | 'success';

const EXPIRY_PRESETS = [
  { label: '1 hour', seconds: 3600 },
  { label: '24 hours', seconds: 86400 },
  { label: '3 days', seconds: 3 * 86400 },
  { label: '7 days', seconds: 7 * 86400 },
];

const MESSAGE_MAX = 280;

interface ComposeState {
  assetCode: string;
  amount: string;
  message: string;
  theme: GiftTheme;
  receiverPublicKey: string;
  expiresInSeconds: number;
  contributionsEnabled: boolean;
  goalAmount: string;
  sealAmount: boolean;
  conditionType: ConditionType;
  triviaQuestion: string;
  triviaAnswer: string;
  steps: GiftStep[];
  stepUnlockerPublicKey: string;
}

const initialCompose: ComposeState = {
  assetCode: 'XLM',
  amount: '',
  message: '',
  theme: 'birthday',
  receiverPublicKey: '',
  expiresInSeconds: 86400,
  contributionsEnabled: false,
  goalAmount: '',
  sealAmount: false,
  conditionType: 'none',
  triviaQuestion: '',
  triviaAnswer: '',
  steps: [],
  stepUnlockerPublicKey: '',
};

export default function CreatePage() {
  const { publicKey } = useFreighter();
  const { toast } = useToast();
  const showError = useTransactionErrorToast();
  const { send, isSubmitting } = useGift(publicKey);
  const sealedDeposit = useSealedDeposit();

  const [step, setStep] = useState<WizardStep>('connect');
  const [form, setForm] = useState<ComposeState>(initialCompose);
  const [balances, setBalances] = useState<AccountBalance[]>([]);
  const [onrampOpen, setOnrampOpen] = useState(false);
  const [trustlineOk, setTrustlineOk] = useState(false);
  const [result, setResult] = useState<SubmittedGift | null>(null);

  // Skip the connect step automatically once a wallet is present.
  useEffect(() => {
    setStep((s) => {
      if (publicKey && s === 'connect') return 'compose';
      if (!publicKey && s !== 'success') return 'connect';
      return s;
    });
  }, [publicKey]);

  const refreshBalances = () => {
    if (!publicKey) return;
    fetchBalances(publicKey)
      .then(setBalances)
      .catch(() => setBalances([]));
  };

  useEffect(refreshBalances, [publicKey]);

  const set = <K extends keyof ComposeState>(key: K, value: ComposeState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const receiverValid = isValidPublicKey(form.receiverPublicKey);
  const receiverIsSelf = receiverValid && form.receiverPublicKey === publicKey;
  const amountValid = /^\d+(\.\d{1,7})?$/.test(form.amount) && Number(form.amount) > 0;
  const goalValid =
    !form.contributionsEnabled ||
    form.goalAmount === '' ||
    (/^\d+(\.\d{1,7})?$/.test(form.goalAmount) && Number(form.goalAmount) > 0);
  const triviaValid =
    form.conditionType !== 'trivia' ||
    (form.triviaQuestion.trim().length > 0 && form.triviaAnswer.trim().length > 0);
  const stepGateValid =
    form.conditionType !== 'stepGate' ||
    (form.steps.length > 0 && form.steps.every((s) => s.label.trim().length > 0));

  const composeValid =
    amountValid &&
    form.message.trim().length > 0 &&
    receiverValid &&
    !receiverIsSelf &&
    goalValid &&
    triviaValid &&
    stepGateValid;

  const assetBalance = balances.find((b) => b.assetCode === form.assetCode);

  const buildCondition = (): ConditionInput => {
    switch (form.conditionType) {
      case 'trivia':
        return {
          type: 'trivia',
          question: form.triviaQuestion.trim(),
          answer: form.triviaAnswer.trim(),
        };
      case 'stepGate':
        return {
          type: 'stepGate',
          steps: form.steps,
          stepUnlockerPublicKey: form.stepUnlockerPublicKey.trim() || undefined,
        };
      default:
        return { type: 'none' };
    }
  };

  /** §13.2 steps 5–6: review → build → Freighter sign → submit. */
  const sendGift = async () => {
    if (!publicKey) return;

    try {
      const submitted = await send({
        senderPublicKey: publicKey,
        receiverPublicKey: form.receiverPublicKey,
        assetCode: form.assetCode,
        amount: form.amount,
        message: form.message.trim(),
        theme: form.theme,
        expiresInSeconds: form.expiresInSeconds,
        isGroupGift: form.contributionsEnabled,
        goalAmount: form.contributionsEnabled && form.goalAmount ? form.goalAmount : null,
        condition: buildCondition(),
      });

      setResult(submitted);
      setStep('success');
      refreshBalances();
    } catch (err) {
      showError(err);
    }
  };

  const restart = () => {
    setForm(initialCompose);
    setResult(null);
    setTrustlineOk(false);
    setStep(publicKey ? 'compose' : 'connect');
  };

  const copyContributeLink = async () => {
    if (!result?.contributeUrl) return;
    await navigator.clipboard.writeText(result.contributeUrl);
    toast('success', 'Contribution link copied.');
  };

  return (
    <div className="flex-1 flex items-start justify-center">
      <div className="w-full max-w-xl space-y-6">
        <NetworkGuard>
          {step === 'connect' && (
            <GlassCard>
              <div className="p-8 flex flex-col items-center text-center space-y-6">
                <div className="w-14 h-14 bg-white/20 backdrop-blur-sm border border-white/30 rounded-full flex items-center justify-center">
                  <Wallet className="w-7 h-7 text-white" />
                </div>
                <div className="space-y-2">
                  <h1 className="text-2xl font-semibold text-white">Connect your wallet</h1>
                  <p className="text-white/70 text-sm max-w-sm">
                    Giffy never holds your keys — every transaction is signed locally in
                    Freighter. Connect to start composing a gift.
                  </p>
                </div>
                <WalletConnectButton />
              </div>
            </GlassCard>
          )}

          {step === 'compose' && (
            <GlassCard>
              <div className="p-8 space-y-6">
                <div className="text-center space-y-2">
                  <h1 className="text-2xl font-semibold text-white">Compose your gift</h1>
                  <p className="text-white/70 text-sm">Everything can be reviewed before signing</p>
                </div>

                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <GlassLabel htmlFor="asset">Asset</GlassLabel>
                      <GlassSelect
                        id="asset"
                        value={form.assetCode}
                        onChange={(e) => set('assetCode', e.target.value)}
                      >
                        {GIFTABLE_ASSETS.map((a) => (
                          <option key={a.code} value={a.code}>
                            {a.label}
                          </option>
                        ))}
                      </GlassSelect>
                    </div>
                    <div className="space-y-2">
                      <GlassLabel htmlFor="amount">Amount</GlassLabel>
                      <GlassInput
                        id="amount"
                        inputMode="decimal"
                        placeholder="25"
                        value={form.amount}
                        onChange={(e) => set('amount', e.target.value.trim())}
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs text-white/60">
                    <span>
                      Balance:{' '}
                      {assetBalance ? `${formatAmount(assetBalance.balance)} ${form.assetCode}` : '—'}
                    </span>
                    <button
                      type="button"
                      onClick={() => setOnrampOpen(true)}
                      className="inline-flex items-center gap-1 text-white/80 hover:text-white transition-colors"
                    >
                      <Coins className="w-3.5 h-3.5" />
                      Buy funds
                    </button>
                  </div>

                  <div className="space-y-2">
                    <GlassLabel htmlFor="receiver">Receiver&apos;s Stellar address</GlassLabel>
                    <GlassInput
                      id="receiver"
                      placeholder="G..."
                      className="font-mono"
                      value={form.receiverPublicKey}
                      onChange={(e) => set('receiverPublicKey', e.target.value.trim())}
                    />
                    {form.receiverPublicKey && !receiverValid && (
                      <p className="text-xs text-red-300">
                        Not a valid Stellar public key (should start with G, 56 characters).
                      </p>
                    )}
                    {receiverIsSelf && (
                      <p className="text-xs text-red-300">
                        A gift can&apos;t be sent to your own connected account.
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <GlassLabel htmlFor="message">Message</GlassLabel>
                    <GlassTextarea
                      id="message"
                      placeholder="Happy birthday! 🎉"
                      maxLength={MESSAGE_MAX}
                      value={form.message}
                      onChange={(e) => set('message', e.target.value)}
                    />
                    <p className="text-right text-xs text-white/50">
                      {form.message.length}/{MESSAGE_MAX}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <GlassLabel>Theme</GlassLabel>
                    <ThemePicker value={form.theme} onChange={(theme) => set('theme', theme)} />
                  </div>

                  <div className="space-y-2">
                    <GlassLabel>Claimable for</GlassLabel>
                    <div className="grid grid-cols-4 gap-2">
                      {EXPIRY_PRESETS.map((preset) => (
                        <button
                          key={preset.seconds}
                          type="button"
                          onClick={() => set('expiresInSeconds', preset.seconds)}
                          className={`rounded-xl border px-2 py-2 text-xs transition-all duration-200 backdrop-blur-sm ${
                            form.expiresInSeconds === preset.seconds
                              ? 'bg-white/25 border-white/40 text-white'
                              : 'bg-white/10 border-white/20 text-white/70 hover:bg-white/15 hover:text-white'
                          }`}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-white/50">
                      After this, the receiver can no longer claim and the funds become
                      reclaimable.
                    </p>
                  </div>

                  <ContributionToggle
                    enabled={form.contributionsEnabled}
                    goalAmount={form.goalAmount}
                    onEnabledChange={(v) => set('contributionsEnabled', v)}
                    onGoalAmountChange={(v) => set('goalAmount', v)}
                  />

                  <SealAmountToggle
                    enabled={form.sealAmount}
                    supported={!form.contributionsEnabled}
                    onEnabledChange={(v) => set('sealAmount', v)}
                  />

                  <ConditionPicker
                    value={form.conditionType}
                    onChange={(v) => set('conditionType', v)}
                  />

                  {form.conditionType === 'trivia' && (
                    <TriviaQuestionForm
                      question={form.triviaQuestion}
                      answer={form.triviaAnswer}
                      onQuestionChange={(v) => set('triviaQuestion', v)}
                      onAnswerChange={(v) => set('triviaAnswer', v)}
                    />
                  )}

                  {form.conditionType === 'stepGate' && (
                    <StepGateForm
                      steps={form.steps}
                      onChange={(s) => set('steps', s)}
                      stepUnlockerPublicKey={form.stepUnlockerPublicKey}
                      onStepUnlockerChange={(v) => set('stepUnlockerPublicKey', v)}
                      defaultUnlocker={publicKey}
                    />
                  )}
                </div>

                <GlassButton
                  className="w-full"
                  disabled={!composeValid}
                  onClick={() => setStep('trustline')}
                >
                  Continue
                </GlassButton>
              </div>
            </GlassCard>
          )}

          {step === 'trustline' && (
            <div className="space-y-4">
              <TrustlinePrompt
                assetCode={form.assetCode}
                onSatisfied={() => {
                  setTrustlineOk(true);
                  setStep('review');
                }}
              />
              {!trustlineOk && (
                <div className="flex justify-center">
                  <div className="w-8 h-8 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                </div>
              )}
            </div>
          )}

          {step === 'review' && sealedDeposit.phase === 'done' && sealedDeposit.claimLink && (
            <GlassCard>
              <div className="p-8 space-y-6">
                <div className="text-center space-y-3">
                  <div className="mx-auto w-14 h-14 bg-white/20 border border-white/30 rounded-full flex items-center justify-center">
                    <Check className="w-7 h-7 text-white" />
                  </div>
                  <h1 className="text-2xl font-semibold text-white inline-flex items-center gap-2">
                    <Lock className="w-5 h-5" /> Sealed gift is live
                  </h1>
                  <p className="text-white/70 text-sm">
                    The amount is hidden in the confidential pool. Share this private link — whoever
                    opens it claims the gift with a browser-side proof.
                  </p>
                </div>
                <QrCodeCard claimUrl={sealedDeposit.claimLink} />
                <p className="text-center text-xs text-white/40">
                  The secret lives only in the link&apos;s <code>#</code> fragment — Giffy&apos;s
                  server never sees it. Save it now; it can&apos;t be recovered.
                </p>
              </div>
            </GlassCard>
          )}

          {step === 'review' && !(sealedDeposit.phase === 'done' && sealedDeposit.claimLink) && (
            <GlassCard>
              <div className="p-8 space-y-6 relative">
                <button
                  onClick={() => setStep('compose')}
                  className="absolute top-0 left-0 text-white/70 hover:text-white transition-colors"
                  aria-label="Back"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>

                <div className="text-center space-y-2">
                  <h1 className="text-2xl font-semibold text-white">Review &amp; sign</h1>
                  <p className="text-white/70 text-sm">
                    This is exactly what will be locked on-chain — your last chance to catch a
                    typo&apos;d address.
                  </p>
                </div>

                <dl className="space-y-3 text-sm">
                  {[
                    ['Amount', `${formatAmount(form.amount)} ${form.assetCode}`],
                    ['To', truncateKey(form.receiverPublicKey, 8)],
                    ['Theme', form.theme],
                    [
                      'Claimable for',
                      EXPIRY_PRESETS.find((p) => p.seconds === form.expiresInSeconds)?.label ??
                        `${form.expiresInSeconds}s`,
                    ],
                    ['Message', form.message.trim()],
                    [
                      'Others can contribute',
                      form.contributionsEnabled
                        ? form.goalAmount
                          ? `Yes — goal ${formatAmount(form.goalAmount)} ${form.assetCode}`
                          : 'Yes'
                        : 'No',
                    ],
                    [
                      'Claim condition',
                      form.conditionType === 'none'
                        ? 'None'
                        : form.conditionType === 'trivia'
                          ? 'Trivia question'
                          : `Step-by-step (${form.steps.length} steps)`,
                    ],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      className="flex justify-between gap-6 rounded-xl bg-white/10 border border-white/20 px-4 py-3"
                    >
                      <dt className="text-white/60 shrink-0">{label}</dt>
                      <dd className="text-white/90 text-right break-all">{value}</dd>
                    </div>
                  ))}
                </dl>

                <div className="space-y-3">
                  {form.sealAmount ? (
                    <>
                      <GlassButton
                        className="w-full"
                        disabled={sealedDeposit.phase === 'signing' || sealedDeposit.phase === 'submitting'}
                        onClick={() => void sealedDeposit.deposit()}
                      >
                        <Lock className="w-4 h-4" />
                        {sealedDeposit.phase === 'signing'
                          ? 'Waiting for signature…'
                          : sealedDeposit.phase === 'submitting'
                            ? 'Sealing into the pool…'
                            : 'Seal & send gift'}
                      </GlassButton>
                      <p className="text-center text-xs text-white/50">
                        The amount is locked into the confidential pool as a private note. The
                        recipient claims with a zero-knowledge proof.
                      </p>
                      {sealedDeposit.error && (
                        <p className="text-center text-xs text-red-300">{sealedDeposit.error}</p>
                      )}
                    </>
                  ) : (
                    <>
                      <GlassButton
                        className="w-full"
                        disabled={isSubmitting}
                        onClick={() => void sendGift()}
                      >
                        {isSubmitting ? 'Waiting for signature…' : 'Sign & send gift'}
                      </GlassButton>
                      <p className="text-center text-xs text-white/50">
                        Freighter will open to approve the transaction. Nothing moves until you sign.
                      </p>
                    </>
                  )}
                </div>
              </div>
            </GlassCard>
          )}

          {step === 'success' && result && (
            <GlassCard>
              <div className="p-8 space-y-6">
                <div className="text-center space-y-3">
                  <div className="mx-auto w-14 h-14 bg-white/20 backdrop-blur-sm border border-white/30 rounded-full flex items-center justify-center">
                    <Gift className="w-7 h-7 text-white" />
                  </div>
                  <h1 className="text-2xl font-semibold text-white">Gift is live on-chain</h1>
                  <p className="text-white/70 text-sm">
                    Share this link — the funds stay locked until it&apos;s claimed or expires
                    back to you.
                  </p>
                </div>

                <QrCodeCard claimUrl={result.claimUrl} />

                {result.contributeUrl && (
                  <div className="rounded-xl bg-white/10 border border-white/20 px-4 py-3 space-y-2">
                    <p className="text-xs uppercase tracking-wider text-white/60">
                      Separate contribution link
                    </p>
                    <p className="text-xs font-mono text-white/80 break-all">
                      {result.contributeUrl}
                    </p>
                    <GhostButton onClick={() => void copyContributeLink()}>
                      Copy contribution link
                    </GhostButton>
                  </div>
                )}

                <div className="flex justify-center">
                  <GhostButton onClick={restart}>Send another gift</GhostButton>
                </div>
              </div>
            </GlassCard>
          )}
        </NetworkGuard>

        <OnrampModal
          open={onrampOpen}
          onClose={() => setOnrampOpen(false)}
          onCompleted={refreshBalances}
        />
      </div>
    </div>
  );
}
