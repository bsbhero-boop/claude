import { useState } from 'react';
import type { OXQuestion } from '../types';
import { OX_QUESTIONS } from '../data/content';
import ProgressHeader from './ProgressHeader';

interface OXQuizScreenProps {
  question: OXQuestion;
  index: number;
  onResult: (questionId: string, correct: boolean) => void;
  onAdvance: () => void;
}

export default function OXQuizScreen({ question, index, onResult, onAdvance }: OXQuizScreenProps) {
  const [selected, setSelected] = useState<'O' | 'X' | null>(null);

  function handleSelect(choice: 'O' | 'X') {
    if (selected) return;
    setSelected(choice);
    onResult(question.id, choice === question.answer);
  }

  const isLast = index === OX_QUESTIONS.length - 1;

  return (
    <div className="flex min-h-screen flex-col bg-brand-50 pb-8">
      <ProgressHeader title="정리 퀴즈 · 이것만은 안 돼요" current={index + 1} total={OX_QUESTIONS.length} unitLabel="문항" />

      <div className="flex flex-1 flex-col gap-4 px-4 py-5">
        <span className="w-fit rounded-full bg-brand-800 px-4 py-1.5 text-base font-semibold text-brand-50">
          {question.category}
        </span>

        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-brand-200">
          <p className="text-xl font-semibold leading-relaxed text-brand-900">
            돌봄제공인력이 다음과 같이 해도 될까요?
          </p>
          <p className="mt-3 rounded-xl bg-brand-100 p-4 text-lg leading-relaxed text-brand-900">
            {question.prompt}
          </p>
        </div>

        <div className="flex gap-4">
          <button
            type="button"
            data-testid="ox-option-o"
            disabled={selected !== null}
            onClick={() => handleSelect('O')}
            className={[
              'min-h-touch flex-1 rounded-2xl border-4 py-6 text-4xl font-extrabold transition-colors',
              selected === 'O'
                ? question.answer === 'O'
                  ? 'border-accent-600 bg-accent-50 text-accent-700'
                  : 'border-brand-300 bg-brand-100 text-brand-400'
                : 'border-brand-300 bg-white text-brand-700 active:border-accent-500',
            ].join(' ')}
          >
            O
          </button>
          <button
            type="button"
            data-testid="ox-option-x"
            disabled={selected !== null}
            onClick={() => handleSelect('X')}
            className={[
              'min-h-touch flex-1 rounded-2xl border-4 py-6 text-4xl font-extrabold transition-colors',
              selected === 'X'
                ? question.answer === 'X'
                  ? 'border-accent-600 bg-accent-50 text-accent-700'
                  : 'border-brand-300 bg-brand-100 text-brand-400'
                : 'border-brand-300 bg-white text-brand-700 active:border-accent-500',
            ].join(' ')}
          >
            X
          </button>
        </div>

        {selected && (
          <div className="rounded-xl bg-brand-800 p-4 text-brand-50">
            <p className="text-lg font-semibold">
              {selected === question.answer ? '✓ 맞습니다' : `✕ 정답은 ${question.answer}예요`}
            </p>
            <p className="mt-2 text-lg leading-relaxed">{question.explanation}</p>
          </div>
        )}

        {selected && (
          <button
            type="button"
            data-testid="ox-advance"
            onClick={onAdvance}
            className="min-h-touch mt-1 w-full rounded-xl bg-accent-600 px-4 py-3 text-lg font-semibold text-white shadow-sm active:bg-accent-700"
          >
            {isLast ? '결과 확인하기 →' : '다음 문항 →'}
          </button>
        )}
      </div>
    </div>
  );
}
