import type { GiftStatus } from '@/types/api';

/** Glass pill for a gift's lifecycle state (README §11.3 `StatusBadge`). */

const LABELS: Record<GiftStatus, string> = {
  draft: 'Draft',
  pending_chain: 'Pending',
  active: 'Active',
  claimed: 'Claimed',
  refund_pending: 'Reclaim available',
  refunded: 'Refunded',
};

const DOTS: Record<GiftStatus, string> = {
  draft: 'bg-white/40',
  pending_chain: 'bg-yellow-400',
  active: 'bg-green-400',
  claimed: 'bg-sky-400',
  refund_pending: 'bg-amber-400',
  refunded: 'bg-white/60',
};

export function StatusBadge({ status }: { status: GiftStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 border border-white/20 backdrop-blur-sm px-2.5 py-1 text-xs font-medium text-white/90">
      <span className={`w-1.5 h-1.5 rounded-full ${DOTS[status] ?? 'bg-white/40'}`} />
      {LABELS[status] ?? status}
    </span>
  );
}
