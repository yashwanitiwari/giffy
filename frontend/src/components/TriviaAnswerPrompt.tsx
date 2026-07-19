'use client';

import { CheckCircle2 } from 'lucide-react';
import { useState } from 'react';

import { GlassButton } from '@/components/ui/GlassButton';
import { GlassInput, GlassLabel } from '@/components/ui/GlassInput';
import { useCondition } from '@/hooks/useCondition';

/**
 * Receiver-side answer input gating the claim button (README §7.3 step 3).
 *
 * Calls the fast `POST /api/claim/:token/verify-answer` pre-check (§15.3) so the
 * claim button only enables once a plausible answer is entered — the
 * authoritative check still happens inside the contract's `claim` call itself
 * (§16.2), so a false positive here can't be used to bypass anything.
 */
export function TriviaAnswerPrompt({
  token,
  question,
  onVerified,
}: {
  token: string;
  question?: string;
  onVerified: (answer: string) => void;
}) {
  const { checkAnswer, isVerifying } = useCondition(null);
  const [answer, setAnswer] = useState('');
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!answer.trim()) return;
    setError(null);
    try {
      const ok = await checkAnswer(token, answer.trim());
      if (ok) {
        setVerified(true);
        onVerified(answer.trim());
      } else {
        setError("That answer isn't quite right — try again.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not verify that answer.');
    }
  };

  return (
    <div className="space-y-3 rounded-xl bg-white/5 border border-white/10 p-4">
      <GlassLabel htmlFor="trivia-answer-prompt">{question ?? 'Answer the question'}</GlassLabel>
      <div className="flex gap-2">
        <GlassInput
          id="trivia-answer-prompt"
          className="flex-1"
          value={answer}
          disabled={verified}
          onChange={(e) => {
            setAnswer(e.target.value);
            setVerified(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
        />
        <GlassButton
          type="button"
          disabled={isVerifying || verified || !answer.trim()}
          onClick={() => void submit()}
        >
          {verified ? <CheckCircle2 className="w-4 h-4" /> : isVerifying ? '…' : 'Check'}
        </GlassButton>
      </div>
      {error && <p className="text-xs text-red-300">{error}</p>}
      {verified && <p className="text-xs text-green-300">Correct — you can claim below.</p>}
    </div>
  );
}
