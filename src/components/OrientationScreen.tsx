import { useState } from 'react';
import { ORIENTATION } from '../data/content';
import type { Trainee } from '../types';

interface OrientationScreenProps {
  onStart: (trainee: Trainee) => void;
}

export default function OrientationScreen({ onStart }: OrientationScreenProps) {
  const [name, setName] = useState('');
  const [org, setOrg] = useState('');

  const canStart = name.trim().length > 0 && org.trim().length > 0;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canStart) return;
    onStart({ name: name.trim(), org: org.trim() });
  }

  return (
    <div className="flex min-h-screen flex-col justify-center bg-brand-50 px-5 py-10">
      <p className="text-base font-semibold uppercase tracking-wide text-accent-600">병원동행 실습 시뮬레이션</p>
      <h1 className="mt-2 text-3xl font-bold leading-snug text-brand-900">
        노인맞춤돌봄서비스
        <br />
        퇴원환자단기집중서비스
      </h1>

      <div className="mt-6 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-brand-200">
        <p className="text-lg leading-relaxed text-brand-800">{ORIENTATION.intro}</p>
        <p className="mt-3 text-lg font-semibold leading-relaxed text-brand-900">{ORIENTATION.guide}</p>
      </div>

      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
        <label className="flex flex-col gap-2">
          <span className="text-lg font-semibold text-brand-800">이름</span>
          <input
            data-testid="orientation-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="이름을 입력해주세요"
            className="min-h-touch rounded-xl border-2 border-brand-200 bg-white px-4 text-lg text-brand-900 outline-none focus:border-accent-500"
          />
        </label>
        <label className="flex flex-col gap-2">
          <span className="text-lg font-semibold text-brand-800">소속기관</span>
          <input
            data-testid="orientation-org"
            value={org}
            onChange={(e) => setOrg(e.target.value)}
            placeholder="소속기관명을 입력해주세요"
            className="min-h-touch rounded-xl border-2 border-brand-200 bg-white px-4 text-lg text-brand-900 outline-none focus:border-accent-500"
          />
        </label>

        <button
          type="submit"
          data-testid="orientation-submit"
          disabled={!canStart}
          className="min-h-touch mt-2 w-full rounded-xl bg-accent-600 px-4 py-3 text-xl font-bold text-white shadow-sm transition-opacity active:bg-accent-700 disabled:opacity-40"
        >
          실습 시작하기
        </button>
      </form>
    </div>
  );
}
