'use client';

import { GlassInput, GlassLabel } from '@/components/ui/GlassInput';

/**
 * Question + answer inputs, shown inline when `ConditionPicker` selects `trivia`
 * (README §13.2). The sender's answer never lingers in review-step UI once
 * submitted (§7.1 step 5).
 */
export function TriviaQuestionForm({
  question,
  answer,
  onQuestionChange,
  onAnswerChange,
}: {
  question: string;
  answer: string;
  onQuestionChange: (v: string) => void;
  onAnswerChange: (v: string) => void;
}) {
  return (
    <div className="space-y-3 rounded-xl bg-white/5 border border-white/10 p-4">
      <div className="space-y-1.5">
        <GlassLabel htmlFor="trivia-question">Question</GlassLabel>
        <GlassInput
          id="trivia-question"
          placeholder="What was the name of our first pet?"
          value={question}
          onChange={(e) => onQuestionChange(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <GlassLabel htmlFor="trivia-answer">Answer</GlassLabel>
        <GlassInput
          id="trivia-answer"
          value={answer}
          onChange={(e) => onAnswerChange(e.target.value)}
        />
        <p className="text-xs text-white/50">Not case-sensitive, ignores extra spaces.</p>
      </div>
    </div>
  );
}
