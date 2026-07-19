'use client';

import { Gift as GiftIcon, HeartCrack } from 'lucide-react';
import { use } from 'react';

import { ContributeForm } from '@/components/ContributeForm';
import { GroupGiftContributors } from '@/components/GroupGiftContributors';
import { NetworkGuard } from '@/components/NetworkGuard';
import { GlassCard } from '@/components/ui/GlassCard';
import { useContribute } from '@/hooks/useContribute';

/**
 * Group contribution page (README §13.4). Public — fetches
 * `GET /api/gifts/:id/group-summary` (no sender/receiver-private data, §15.2)
 * and renders `GroupGiftContributors` + `ContributeForm`.
 */
export default function ContributePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { summary, isLoading } = useContribute(id);

  if (isLoading || summary === undefined) {
    return (
      <Centered>
        <div className="w-8 h-8 rounded-full border-2 border-white/30 border-t-white animate-spin" />
      </Centered>
    );
  }

  if (!summary) {
    return (
      <Centered>
        <GlassCard className="w-full max-w-md">
          <div className="p-8 flex flex-col items-center text-center space-y-4">
            <div className="w-12 h-12 bg-white/20 backdrop-blur-sm border border-white/30 rounded-full flex items-center justify-center">
              <HeartCrack className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-2xl font-semibold text-white">This link isn&apos;t valid</h1>
            <p className="text-white/70 text-sm">
              Double-check the link you were sent, or ask the sender for a fresh one.
            </p>
          </div>
        </GlassCard>
      </Centered>
    );
  }

  const closed = summary.status !== 'active';

  return (
    <Centered>
      <div className="w-full max-w-md space-y-6">
        <GlassCard>
          <div className="p-8 space-y-6">
            <div className="text-center space-y-2">
              <div className="mx-auto w-14 h-14 bg-white/20 backdrop-blur-sm border border-white/30 rounded-full flex items-center justify-center">
                <GiftIcon className="w-7 h-7 text-white" />
              </div>
              <h1 className="text-2xl font-semibold text-white">Chip in on this gift</h1>
              <p className="text-white/70 text-sm">
                Anyone with this link can contribute — the sender chose to make this a group
                gift.
              </p>
            </div>

            <GroupGiftContributors summary={summary} />
          </div>
        </GlassCard>

        {closed ? (
          <GlassCard>
            <div className="p-6 text-center">
              <p className="text-white/70 text-sm">
                This gift is no longer accepting contributions
                {summary.status === 'claimed'
                  ? ' — it has already been claimed.'
                  : summary.status === 'refunded' || summary.status === 'refund_pending'
                    ? ' — it has expired.'
                    : '.'}
              </p>
            </div>
          </GlassCard>
        ) : (
          <GlassCard>
            <div className="p-6">
              <NetworkGuard>
                <ContributeForm giftId={id} assetCode={summary.assetCode} />
              </NetworkGuard>
            </div>
          </GlassCard>
        )}
      </div>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 flex items-center justify-center">{children}</div>;
}
