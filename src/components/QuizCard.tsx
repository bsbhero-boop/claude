import { useRef, useState } from 'react';
import type { Quiz } from '../types';

interface QuizCardProps {
  quiz: Quiz;
  /** Fires once, on the very first answer attempt — used for scoring. */
  onFirstAttempt: (correct: boolean) => void;
  /** Fires once, the moment the correct answer is finally selected (first try or a retry). */
  onSolved: () => void;
}

type Status = 'unanswered' | 'correct' | 'incorrect';

export default function QuizCard({ quiz, onFirstAttempt, onSolved }: QuizCardProps) {
  const [status, setStatus] = useState<Status>('unanswered');
  const [wrongIds, setWrongIds] = useState<Set<string>>(new Set());
  const firstAttemptReported = useRef(false);

  function handleSelect(optionId: string, correct: boolean) {
    if (status === 'correct' || wrongIds.has(optionId)) return;

    if (!firstAttemptReported.current) {
      firstAttemptReported.current = true;
      onFirstAttempt(correct);
    }

    if (correct) {
      setStatus('correct');
      onSolved();
    } else {
      setStatus('incorrect');
      setWrongIds((prev) => new Set(prev).add(optionId));
    }
  }

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-brand-200">
      <p className="text-xl font-semibold text-brand-900">{quiz.situation}</p>

      <div className="mt-4 flex flex-col gap-3">
        {quiz.options.map((option) => {
          const isWrongPick = wrongIds.has(option.id);
          const isCorrectPick = status === 'correct' && option.correct;
          return (
            <button
              key={option.id}
              type="button"
              data-testid="quiz-option"
              disabled={isWrongPick || status === 'correct'}
              onClick={() => handleSelect(option.id, option.correct)}
              className={[
                'min-h-touch w-full rounded-xl border-2 px-4 py-3 text-left text-lg leading-snug transition-colors',
                isCorrectPick
                  ? 'border-accent-600 bg-accent-50 text-accent-900'
                  : isWrongPick
                    ? 'border-brand-200 bg-brand-50 text-brand-400 line-through'
                    : 'border-brand-200 bg-white text-brand-900 active:border-accent-500 active:bg-accent-50',
              ].join(' ')}
            >
              {isCorrectPick && <span className="mr-2" aria-hidden>✓</span>}
              {isWrongPick && <span className="mr-2" aria-hidden>✕</span>}
              {option.text}
            </button>
          );
        })}
      </div>

      {status === 'incorrect' && (
        <p data-testid="quiz-feedback-incorrect" className="mt-4 rounded-xl bg-amber-50 p-4 text-base text-amber-900 ring-1 ring-amber-200">
          {quiz.feedback.incorrect}
        </p>
      )}

      {status === 'correct' && (
        <div data-testid="quiz-feedback-correct" className="mt-4 rounded-xl bg-accent-50 p-4 text-base text-accent-900 ring-1 ring-accent-400/40">
          <p>{quiz.feedback.correct}</p>
          <p className="mt-2 text-sm text-brand-500">출처: {quiz.source}</p>
        </div>
      )}
    </div>
  );
}
