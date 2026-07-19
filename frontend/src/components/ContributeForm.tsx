'use client';

import { HandCoins } from 'lucide-react';
import { useState } from 'react';

import { TrustlinePrompt } from '@/components/TrustlinePrompt';
import { useTransactionErrorToast } from '@/components/TransactionErrorToast';
import { GlassButton } from '@/components/ui/GlassButton';
import { GlassInput, GlassLabel } from '@/components/ui/GlassInput';
import { WalletConnectButton } from '@/components/WalletConnectButton';
import { useContribute } from '@/hooks/useContribute';
import { useFreighter } from '@/hooks/useFreighter';

/**
 * Amount input + wallet connect + trustline check + sign/submit (README §13.4),
 * via `useContribute`. Simulated server-side first, same as gift creation, to
 * get the correct authorization tree for the nested token transfer (§7.2 step 3).
 */
export function ContributeForm({
  giftId,
  assetCode,
}: {
  giftId: string;
  assetCode: string;
}) {
  const { publicKey } = useFreighter();
  const { contribute, isContributing } = useContribute(giftId);
  const showError = useTransactionErrorToast();

  const [amount, setAmount] = useState('');
  const [trustlineOk, setTrustlineOk] = useState(false);
  const [success, setSuccess] = useState(false);

  const amountValid = /^\d+(\.\d{1,7})?$/.test(amount) && Number(amount) > 0;

  const submit = async () => {
    if (!amountValid) return;
    try {
      await contribute(amount);
      setSuccess(true);
      setAmount('');
    } catch (err) {
      showError(err);
    }
  };

  if (!publicKey) {
    return (
      <div className="flex flex-col items-center gap-3 py-4">
        <p className="text-sm text-white/70 text-center">Connect a wallet to contribute.</p>
        <WalletConnectButton />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <TrustlinePrompt assetCode={assetCode} onSatisfied={() => setTrustlineOk(true)} />

      <div className="space-y-1.5">
        <GlassLabel htmlFor="contribute-amount">Contribution amount</GlassLabel>
        <GlassInput
          id="contribute-amount"
          inputMode="decimal"
          placeholder="10"
          value={amount}
          onChange={(e) => setAmount(e.target.value.trim())}
        />
      </div>

      <GlassButton
        className="w-full"
        disabled={!amountValid || !trustlineOk || isContributing}
        onClick={() => void submit()}
      >
        <HandCoins className="w-4 h-4" />
        {isContributing ? 'Waiting for signature…' : `Contribute ${amount || ''} ${assetCode}`.trim()}
      </GlassButton>

      {success && (
        <p className="text-center text-xs text-green-300">
          Thanks for chipping in — the total above just updated.
        </p>
      )}
    </div>
  );
}
