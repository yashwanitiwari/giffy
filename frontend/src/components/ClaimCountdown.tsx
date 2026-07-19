'use client';

import { useEffect, useState } from 'react';

/**
 * Live countdown to `expiresAt` (README §11.3 `ClaimCountdown`).
 *
 * Ticks client-side from the server-provided timestamp and flips to an expired
 * state without a reload. Cosmetic only — actual claim eligibility is enforced
 * server-side and on-ledger (§7.3 principle 3).
 */

function partsUntil(target: number, now: number) {
  const total = Math.max(0, Math.floor((target - now) / 1000));
  return {
    total,
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

export function ClaimCountdown({
  expiresAt,
  onExpire,
}: {
  expiresAt: string;
  onExpire?: () => void;
}) {
  const target = new Date(expiresAt).getTime();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const { total, days, hours, minutes, seconds } = partsUntil(target, now);

  useEffect(() => {
    if (total === 0) onExpire?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total === 0]);

  if (total === 0) {
    return <p className="text-white/70 text-sm text-center">This gift has expired.</p>;
  }

  const cells = [
    { value: days, label: 'days' },
    { value: hours, label: 'hrs' },
    { value: minutes, label: 'min' },
    { value: seconds, label: 'sec' },
  ];

  return (
    <div className="flex justify-center gap-3" aria-label="Time remaining to claim">
      {cells.map((cell) => (
        <div
          key={cell.label}
          className="w-16 py-2 rounded-xl bg-white/10 border border-white/20 backdrop-blur-sm text-center"
        >
          <div className="text-xl font-semibold text-white tabular-nums">
            {String(cell.value).padStart(2, '0')}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-white/60">{cell.label}</div>
        </div>
      ))}
    </div>
  );
}
