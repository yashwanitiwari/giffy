/** Amount/date/asset display formatting (README §11 `lib/formatters.ts`). */

/** Trims trailing zeros from a decimal-string amount: "25.5000000" → "25.5". */
export function formatAmount(amount: string): string {
  if (!amount.includes('.')) return amount;
  return amount.replace(/\.?0+$/, '');
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/** "2d 4h", "3h 12m", "45s" — coarse remaining-time label for lists. */
export function formatRemaining(expiresAtIso: string, now = Date.now()): string {
  const ms = new Date(expiresAtIso).getTime() - now;
  if (ms <= 0) return 'Expired';

  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);

  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

const EXPLORER_BASE = 'https://stellar.expert/explorer/testnet';

export function explorerTxUrl(txHash: string): string {
  return `${EXPLORER_BASE}/tx/${txHash}`;
}
