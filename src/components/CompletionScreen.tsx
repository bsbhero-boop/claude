import { useEffect, useState } from 'react';
import type { CompletionPayload } from '../types';
import { submitCompletion, type SubmitStatus } from '../lib/submitCompletion';

interface CompletionScreenProps {
  completion: CompletionPayload;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function CompletionScreen({ completion }: CompletionScreenProps) {
  const [status, setStatus] = useState<SubmitStatus | 'submitting'>('submitting');

  useEffect(() => {
    let cancelled = false;
    submitCompletion(completion).then((result) => {
      if (!cancelled) setStatus(result);
    });
    return () => {
      cancelled = true;
    };
  }, [completion]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-brand-50 px-5 py-10 text-center">
      <div className="text-5xl" aria-hidden>
        🎉
      </div>
      <h1 className="mt-3 text-3xl font-bold text-brand-900">실습을 모두 마쳤습니다!</h1>
      <p className="mt-2 text-lg text-brand-600">수고하셨습니다. 아래 완료 정보를 확인해주세요.</p>

      <div className="mt-6 w-full max-w-sm rounded-2xl bg-white p-6 text-left shadow-sm ring-1 ring-brand-200">
        <Row label="이름" value={completion.name} />
        <Row label="소속기관" value={completion.org} />
        <Row label="완료일시" value={formatDate(completion.completedAt)} />
        <Row label="정답률" value={completion.score} />
        <div className="mt-4 rounded-xl bg-brand-800 p-4 text-center">
          <p className="text-sm text-brand-300">완료 코드</p>
          <p data-testid="completion-code" className="mt-1 text-2xl font-extrabold tracking-widest text-white">{completion.completionCode}</p>
        </div>
      </div>

      <p className="mt-4 text-base text-brand-600">이 화면을 캡처해서 제출해주세요.</p>

      <p className="mt-2 min-h-[1.5em] text-sm text-brand-400">
        {status === 'submitting' && '이수 기록을 서버에 저장하는 중...'}
        {status === 'success' && '이수 기록이 자동으로 저장되었습니다.'}
        {status === 'skipped' && '※ 서버 자동 기록이 아직 설정되지 않았습니다. 화면 캡처로 제출해주세요.'}
        {status === 'error' && '※ 서버 자동 저장에 실패했습니다. 화면 캡처로 제출해주세요.'}
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-brand-100 py-2 last:border-0">
      <span className="text-base text-brand-500">{label}</span>
      <span className="text-lg font-semibold text-brand-900">{value}</span>
    </div>
  );
}
