import { useState } from 'react';
import type { EmergencyCard } from '../types';
import QuizCard from './QuizCard';

interface EmergencyOverlayProps {
  card: EmergencyCard;
  onContinue: () => void;
}

export default function EmergencyOverlay({ card, onContinue }: EmergencyOverlayProps) {
  const [solved, setSolved] = useState(false);

  return (
    <div data-testid="emergency-overlay" className="fixed inset-0 z-30 flex items-end justify-center bg-black/50 sm:items-center sm:p-4">
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-brand-50 p-5 shadow-xl sm:rounded-3xl">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-bold text-amber-800 ring-1 ring-amber-300">
            ⚠ 긴급상황 발생
          </span>
        </div>
        <h2 className="mt-3 text-2xl font-bold text-brand-900">{card.title}</h2>

        {card.symptoms && (
          <div className="mt-3 rounded-xl bg-white p-4 ring-1 ring-brand-200">
            <p className="text-base font-semibold text-brand-700">주요 증상</p>
            <p className="mt-1 text-lg text-brand-900">{card.symptoms.join(' · ')}</p>
          </div>
        )}

        <div className="mt-3 rounded-xl bg-brand-800 p-4 text-brand-50">
          <p className="text-base font-semibold">대응 순서</p>
          <ol className="mt-2 flex flex-col gap-2">
            {card.responseSteps.map((step, i) => (
              <li key={i} className="flex gap-2 text-lg leading-snug">
                <span className="text-accent-400">{i + 1}.</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="mt-4">
          <QuizCard key={card.id} quiz={card.quiz} onFirstAttempt={() => {}} onSolved={() => setSolved(true)} />
        </div>

        {solved && (
          <button
            type="button"
            data-testid="emergency-continue"
            onClick={onContinue}
            className="min-h-touch mt-4 w-full rounded-xl bg-accent-600 px-4 py-3 text-lg font-semibold text-white shadow-sm active:bg-accent-700"
          >
            계속 진행하기 →
          </button>
        )}
      </div>
    </div>
  );
}
