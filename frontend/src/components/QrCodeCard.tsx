'use client';

import { Check, Copy, Share2 } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useState } from 'react';

import { GlassButton } from '@/components/ui/GlassButton';

/**
 * Claim-link QR + share actions (README §11.3 `QrCodeCard`). The QR is rendered
 * client-side from the URL; the backend only supplies the payload.
 */
export function QrCodeCard({ claimUrl }: { claimUrl: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(claimUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const share = async () => {
    if (navigator.share) {
      await navigator.share({ title: 'You received a gift on Giffy', url: claimUrl }).catch(() => undefined);
    } else {
      await copy();
    }
  };

  return (
    <div className="flex flex-col items-center space-y-4">
      <div className="bg-white/90 p-4 rounded-2xl border border-white/30 shadow-2xl">
        <QRCodeSVG value={claimUrl} size={168} bgColor="transparent" fgColor="#111111" />
      </div>

      <div className="w-full rounded-xl bg-white/10 border border-white/20 px-3 py-2.5">
        <p className="text-xs font-mono text-white/80 break-all text-center">{claimUrl}</p>
      </div>

      <div className="flex gap-3 w-full">
        <GlassButton className="flex-1" onClick={() => void copy()}>
          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          {copied ? 'Copied' : 'Copy link'}
        </GlassButton>
        <GlassButton className="flex-1" onClick={() => void share()}>
          <Share2 className="w-4 h-4" />
          Share
        </GlassButton>
      </div>
    </div>
  );
}
