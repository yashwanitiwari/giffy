'use client';

import { Copy, ExternalLink, Inbox, RotateCcw, Unlock } from 'lucide-react';
import { useState } from 'react';

import { NetworkGuard } from '@/components/NetworkGuard';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { useTransactionErrorToast } from '@/components/TransactionErrorToast';
import { WalletConnectButton } from '@/components/WalletConnectButton';
import { GlassButton } from '@/components/ui/GlassButton';
import { GlassCard } from '@/components/ui/GlassCard';
import { useCondition } from '@/hooks/useCondition';
import { useFreighter } from '@/hooks/useFreighter';
import { useGift } from '@/hooks/useGift';
import { explorerTxUrl, formatAmount, formatRemaining } from '@/lib/formatters';
import { truncateKey } from '@/lib/stellarAddress';
import type { GiftDTO } from '@/types/api';

/**
 * Sender's gift dashboard (README §13.5), unified: every gift row uniformly can
 * show a "Contribution link" copy action (if group contributions are enabled)
 * and an "Unlock next step" action (if step-gated with steps remaining) — no
 * more distinct simple-vs-advanced dashboard views, since every gift can, in
 * principle, have any combination of features enabled.
 */
export default function DashboardPage() {
  const { publicKey } = useFreighter();
  const { gifts, isLoading, refund, refresh } = useGift(publicKey);
  const { toast } = useToast();
  const showError = useTransactionErrorToast();
  const [refundingId, setRefundingId] = useState<string | null>(null);

  /** §7.5: build refund → Freighter sign → submit. */
  const reclaim = async (gift: GiftDTO) => {
    if (!publicKey) return;
    setRefundingId(gift.giftId);

    try {
      await refund(gift.giftId, publicKey);
      toast('success', `Reclaimed ${formatAmount(gift.amount)} ${gift.assetCode} to your wallet.`);
      void refresh();
    } catch (err) {
      showError(err);
    } finally {
      setRefundingId(null);
    }
  };

  const reclaimable = (gift: GiftDTO) =>
    gift.status === 'refund_pending' ||
    (gift.status === 'active' && new Date(gift.expiresAt).getTime() <= Date.now());

  return (
    <div className="flex-1 w-full max-w-4xl mx-auto space-y-6">
      <NetworkGuard>
        <GlassCard>
          <div className="p-6 sm:p-8 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-white">Your gifts</h1>
              <p className="text-white/70 text-sm mt-1">
                Everything sent from{' '}
                {publicKey ? (
                  <span className="font-mono text-white/90">{truncateKey(publicKey)}</span>
                ) : (
                  'your wallet'
                )}
              </p>
            </div>
            {!publicKey && <WalletConnectButton />}
          </div>
        </GlassCard>

        {publicKey && isLoading && (
          <GlassCard>
            <div className="p-10 flex justify-center">
              <div className="w-8 h-8 rounded-full border-2 border-white/30 border-t-white animate-spin" />
            </div>
          </GlassCard>
        )}

        {publicKey && !isLoading && gifts.length === 0 && (
          <GlassCard>
            <div className="p-10 flex flex-col items-center text-center space-y-4">
              <div className="w-12 h-12 bg-white/20 backdrop-blur-sm border border-white/30 rounded-full flex items-center justify-center">
                <Inbox className="w-6 h-6 text-white" />
              </div>
              <p className="text-white/70 text-sm">
                No gifts yet — your sent gifts and their live status will appear here.
              </p>
            </div>
          </GlassCard>
        )}

        {gifts.map((gift) => (
          <DashboardGiftRow
            key={gift.giftId}
            gift={gift}
            reclaimable={reclaimable(gift)}
            isReclaiming={refundingId === gift.giftId}
            onReclaim={() => void reclaim(gift)}
            onUnlocked={() => void refresh()}
          />
        ))}
      </NetworkGuard>
    </div>
  );
}

function DashboardGiftRow({
  gift,
  reclaimable,
  isReclaiming,
  onReclaim,
  onUnlocked,
}: {
  gift: GiftDTO;
  reclaimable: boolean;
  isReclaiming: boolean;
  onReclaim: () => void;
  onUnlocked: () => void;
}) {
  const { publicKey } = useFreighter();
  const { toast } = useToast();
  const showError = useTransactionErrorToast();
  const { unlockNextStep, isUnlocking } = useCondition(gift.giftId);

  const stepsRemaining =
    gift.condition.type === 'stepGate' &&
    (gift.condition.steps?.length ?? 0) > gift.condition.stepsCompleted;

  const copyContributeLink = async () => {
    if (!gift.contributeUrl) return;
    await navigator.clipboard.writeText(gift.contributeUrl);
    toast('success', 'Contribution link copied.');
  };

  const unlockNext = async () => {
    if (!publicKey) return;
    try {
      await unlockNextStep(publicKey);
      toast('success', 'Next step unlocked.');
      onUnlocked();
    } catch (err) {
      showError(err);
    }
  };

  const txHash = gift.txHashClaim ?? gift.txHashRefund ?? gift.txHashCreate;

  return (
    <GlassCard>
      <div className="p-5 sm:p-6 flex flex-wrap items-center gap-4">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-lg font-semibold text-white">
              {formatAmount(gift.amount)} {gift.assetCode}
            </span>
            <StatusBadge status={gift.status} />
            {gift.isGroupGift && (
              <span className="rounded-full bg-white/10 border border-white/20 px-2 py-0.5 text-xs text-white/70">
                Group gift
              </span>
            )}
            {gift.condition.type !== 'none' && (
              <span className="rounded-full bg-white/10 border border-white/20 px-2 py-0.5 text-xs text-white/70">
                {gift.condition.type === 'trivia' ? 'Trivia' : 'Step-gated'}
              </span>
            )}
          </div>
          <p className="text-sm text-white/60">
            To <span className="font-mono text-white/80">{truncateKey(gift.receiverPublicKey)}</span>
            {' · '}
            {gift.status === 'active'
              ? `${formatRemaining(gift.expiresAt)} left`
              : gift.status === 'refund_pending'
                ? 'Expired — funds are yours to reclaim'
                : new Date(gift.createdAt).toLocaleDateString()}
          </p>
          <p className="text-sm text-white/50 truncate italic">“{gift.message}”</p>
          {gift.condition.type === 'stepGate' && (
            <p className="text-xs text-white/50">
              Steps unlocked: {gift.condition.stepsCompleted}/{gift.condition.steps?.length ?? 0}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 ml-auto">
          {txHash && (
            <a
              href={explorerTxUrl(txHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-white/60 hover:text-white transition-colors inline-flex items-center gap-1 text-xs"
            >
              Explorer <ExternalLink className="w-3 h-3" />
            </a>
          )}

          {gift.isGroupGift && gift.contributeUrl && (
            <GlassButton className="!h-9 !px-4" onClick={() => void copyContributeLink()}>
              <Copy className="w-3.5 h-3.5" />
              Contribution link
            </GlassButton>
          )}

          {stepsRemaining && (
            <GlassButton className="!h-9 !px-4" disabled={isUnlocking} onClick={() => void unlockNext()}>
              <Unlock className="w-3.5 h-3.5" />
              {isUnlocking ? 'Unlocking…' : 'Unlock next step'}
            </GlassButton>
          )}

          {reclaimable && (
            <GlassButton className="!h-9 !px-4" disabled={isReclaiming} onClick={onReclaim}>
              <RotateCcw className="w-3.5 h-3.5" />
              {isReclaiming ? 'Reclaiming…' : 'Reclaim'}
            </GlassButton>
          )}
        </div>
      </div>
    </GlassCard>
  );
}
