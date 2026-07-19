import { Clock3, Gift, Link2, Lock, ShieldCheck, Sparkles } from 'lucide-react';
import Link from 'next/link';

import { GlassCard } from '@/components/ui/GlassCard';

/**
 * Landing page (README §11.2): plain-language explanation, testnet expectations,
 * and a primary CTA into /create. The hero is plain (no glass panel) so it reads
 * as page chrome rather than another card among the feature cards below it.
 */

const STEPS = [
  {
    Icon: Gift,
    title: 'Compose a gift',
    body: 'Pick an asset and amount, write a message, choose a theme, and set how long the gift stays claimable.',
  },
  {
    Icon: Link2,
    title: 'Share one link',
    body: 'Your funds are locked on-chain and you get a claim link + QR code. Send it like an e-gift card.',
  },
  {
    Icon: Clock3,
    title: 'Claim or bounce back',
    body: 'The receiver claims into their own wallet before the deadline — or the funds become reclaimable by you. Enforced by Stellar, not by us.',
  },
];

export default function Home() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-10 max-w-5xl mx-auto w-full">
      <div className="w-full text-center space-y-6">
        <span className="inline-flex items-center gap-2 rounded-full bg-white/10 border border-white/20 px-3 py-1 text-xs text-white/80">
          <ShieldCheck className="w-3.5 h-3.5" />
          Non-custodial · Stellar Testnet
        </span>

        <h1 className="text-4xl sm:text-5xl font-semibold text-white text-balance">
          Gift crypto with a link — or seal the amount entirely
        </h1>

        <p className="text-white/70 max-w-2xl mx-auto text-balance">
          No wallet address memorized, no seed-phrase onboarding lecture. Lock XLM or testnet
          USDC into a shareable link — the receiver connects a wallet only when they
          claim, and unclaimed gifts expire back to you automatically.
        </p>

        <div className="flex flex-wrap justify-center gap-3 pt-2">
          <Link
            href="/create"
            className="bg-white/20 hover:bg-white/30 text-white border border-white/30 hover:border-white/40 h-11 px-8 rounded-xl font-medium transition-all duration-200 backdrop-blur-sm inline-flex items-center justify-center gap-2 text-sm"
          >
            <Gift className="w-4 h-4" />
            Send a Gift
          </Link>
          <Link
            href="/dashboard"
            className="text-white/80 hover:text-white h-11 px-6 rounded-xl border border-white/20 hover:border-white/30 hover:bg-white/10 font-medium transition-all duration-200 backdrop-blur-sm inline-flex items-center justify-center text-sm"
          >
            View my gifts
          </Link>
        </div>
      </div>

      <GlassCard className="w-full">
        <div className="p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
          <div className="w-12 h-12 shrink-0 bg-white/20 backdrop-blur-sm border border-white/30 rounded-xl flex items-center justify-center">
            <Lock className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1 space-y-1.5">
            <div className="flex items-center gap-2">
              <h2 className="text-white font-semibold">New: seal the amount with zero-knowledge</h2>
              <span className="inline-flex items-center gap-1 rounded-full bg-white/15 border border-white/25 px-2 py-0.5 text-[10px] uppercase tracking-wider text-white/80">
                <Sparkles className="w-3 h-3" />
                New
              </span>
            </div>
            <p className="text-sm text-white/70 max-w-2xl">
              Don&apos;t want the amount visible on-chain? Toggle &ldquo;Seal the amount&rdquo; when
              composing a gift — it&apos;s locked into a confidential pool as a private note, and
              the receiver claims with a zero-knowledge proof generated right in their browser.
              No one, not even a chain explorer, can see how much you sent.
            </p>
          </div>
        </div>
      </GlassCard>

      <div className="grid sm:grid-cols-3 gap-4 w-full">
        {STEPS.map(({ Icon, title, body }) => (
          <GlassCard key={title}>
            <div className="p-6 space-y-3">
              <div className="w-10 h-10 bg-white/20 backdrop-blur-sm border border-white/30 rounded-xl flex items-center justify-center">
                <Icon className="w-5 h-5 text-white" />
              </div>
              <h3 className="text-white font-semibold">{title}</h3>
              <p className="text-sm text-white/70">{body}</p>
            </div>
          </GlassCard>
        ))}
      </div>
    </div>
  );
}
