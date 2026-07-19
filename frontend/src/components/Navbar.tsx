'use client';

import { Gift } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { WalletConnectButton } from '@/components/WalletConnectButton';

/**
 * Glass navbar in the frosted concept's language: `backdrop-blur-md bg-white/10
 * border-white/20 rounded-2xl`, floating over the fractal background on every page.
 */

const LINKS = [
  { href: '/', label: 'Home' },
  { href: '/create', label: 'Send a Gift' },
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/wallet', label: 'Wallet' },
];

export function Navbar() {
  const pathname = usePathname();

  return (
    <header className="sticky top-4 z-40 px-4">
      <nav className="max-w-5xl mx-auto backdrop-blur-md bg-white/10 border border-white/20 rounded-2xl shadow-2xl px-4 sm:px-6 py-3 flex items-center gap-4">
        <Link href="/" className="flex items-center gap-2 text-white font-semibold text-lg">
          <span className="w-9 h-9 bg-white/20 backdrop-blur-sm border border-white/30 rounded-xl flex items-center justify-center">
            <Gift className="w-5 h-5" />
          </span>
          Giffy
        </Link>

        <div className="hidden sm:flex items-center gap-1 ml-2">
          {LINKS.map((link) => {
            const active =
              link.href === '/' ? pathname === '/' : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`px-3 py-1.5 rounded-xl text-sm transition-all duration-200 ${
                  active
                    ? 'bg-white/20 border border-white/30 text-white'
                    : 'text-white/70 hover:text-white hover:bg-white/10 border border-transparent'
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </div>

        <div className="ml-auto flex items-center gap-3">
          <span className="hidden md:inline-flex items-center rounded-full bg-white/10 border border-white/20 px-2.5 py-1 text-xs text-white/70">
            Stellar Testnet
          </span>
          <WalletConnectButton className="!h-10" />
        </div>
      </nav>
    </header>
  );
}
