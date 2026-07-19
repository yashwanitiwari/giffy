'use client';

import { Users } from 'lucide-react';

import { formatAmount } from '@/lib/formatters';
import { truncateKey } from '@/lib/stellarAddress';
import type { GroupSummaryDTO } from '@/types/api';

/**
 * Progress bar + contributor list (README §13.4), labeled where a label is
 * available rather than showing raw addresses (§7.2 step 1).
 */
export function GroupGiftContributors({ summary }: { summary: GroupSummaryDTO }) {
  const total = Number(summary.total);
  const goal = summary.goal ? Number(summary.goal) : null;
  const pct = goal && goal > 0 ? Math.min(100, Math.round((total / goal) * 100)) : null;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <span className="text-2xl font-semibold text-white">
            {formatAmount(summary.total)} {summary.assetCode}
          </span>
          {summary.goal && (
            <span className="text-sm text-white/60">
              of {formatAmount(summary.goal)} {summary.assetCode} goal
            </span>
          )}
        </div>
        {pct !== null && (
          <div className="h-2 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-white/60 to-white/90 transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <p className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-white/50">
          <Users className="w-3.5 h-3.5" />
          Contributors ({summary.contributions.length})
        </p>
        {summary.contributions.length === 0 ? (
          <p className="text-sm text-white/60">No contributions yet — be the first!</p>
        ) : (
          <ul className="space-y-1.5">
            {summary.contributions.map((c, i) => (
              <li
                key={i}
                className="flex items-center justify-between rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm"
              >
                <span className="text-white/80 font-mono truncate">
                  {isLikelyAddress(c.contributorLabel)
                    ? truncateKey(c.contributorLabel)
                    : c.contributorLabel}
                </span>
                <span className="text-white/90 shrink-0 ml-3">
                  {formatAmount(c.amount)} {summary.assetCode}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function isLikelyAddress(label: string): boolean {
  return /^G[A-Z2-7]{55}$/.test(label);
}
