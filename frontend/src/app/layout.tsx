import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';

import { Navbar } from '@/components/Navbar';
import { ToastProvider } from '@/components/Toast';
import { FreighterProvider } from '@/hooks/useFreighter';
import '@/styles/globals.css';

const geist = Geist({ subsets: ['latin'], variable: '--font-geist-sans' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' });

export const metadata: Metadata = {
  title: 'Giffy — Send Crypto as a Gift Link',
  description:
    'Lock crypto into a shareable gift link on Stellar testnet. No wallet address memorized, no seed-phrase onboarding — just a link, a message, and a claim button.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`}>
      <body className="font-sans antialiased">
        {/* The frosted-glass concept's fractal background, on every page. */}
        <div
          className="fixed inset-0 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: "url('/background.jpg')" }}
        />
        {/* Subtle overlay for better contrast */}
        <div className="fixed inset-0 bg-black/20" />

        <FreighterProvider>
          <ToastProvider>
            <div className="relative z-10 min-h-screen flex flex-col">
              <Navbar />
              <main className="flex-1 flex flex-col px-4 py-10">{children}</main>
              <footer className="relative z-10 mb-6 flex justify-center px-4">
                <div className="backdrop-blur-md bg-white/10 border border-white/20 rounded-2xl px-6 py-3">
                  <p className="text-sm text-white/80 text-center">
                    Giffy runs on the Stellar <span className="text-white/90">Testnet</span> — no
                    real funds are handled. Gifts are locked in native{' '}
                    <span className="text-white/90">Claimable Balances</span>, enforced by the
                    network itself.
                  </p>
                </div>
              </footer>
            </div>
          </ToastProvider>
        </FreighterProvider>
      </body>
    </html>
  );
}
