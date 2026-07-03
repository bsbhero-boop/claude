import type { CompletionPayload } from '../types';

export type SubmitStatus = 'skipped' | 'success' | 'error';

/**
 * Posts the completion record to a Google Apps Script Web App (see apps-script/Code.gs).
 * Uses a text/plain content-type on purpose: it keeps the request a CORS "simple request"
 * so the browser skips the preflight OPTIONS call that Apps Script Web Apps don't handle.
 */
export async function submitCompletion(payload: CompletionPayload): Promise<SubmitStatus> {
  const url = import.meta.env.VITE_APPS_SCRIPT_URL as string | undefined;

  if (!url) {
    console.info('[submitCompletion] VITE_APPS_SCRIPT_URL이 설정되지 않아 서버 기록을 건너뜁니다.', payload);
    return 'skipped';
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error('[submitCompletion] 서버 응답 오류', res.status);
      return 'error';
    }
    return 'success';
  } catch (err) {
    console.error('[submitCompletion] 네트워크 오류', err);
    return 'error';
  }
}
