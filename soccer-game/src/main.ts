import './style.css';
import { App } from './app';
import type { TournamentState } from './tournament';

interface HotData {
  tour?: TournamentState | null;
}
interface Hot {
  snapshot?: (fn: () => HotData) => void;
  ready?: (fn: (data: HotData) => void) => void;
  data?: HotData;
}

// claude.ai 아티팩트 뷰어에서 새 버전이 배포되면 진행 중인 토너먼트를 이어받는다
const hot = (window as unknown as { claude?: { hot?: Hot } }).claude?.hot;

function start(data: HotData) {
  const root = document.getElementById('app')!;
  const app = new App(root);
  if (data?.tour && !data.tour.champion && !data.tour.eliminated) {
    app.tour = data.tour;
    app.mode = 'tournament';
    app.showBracket();
  } else app.showTitle();
  hot?.snapshot?.(() => ({ tour: app.tour }));
  // 디버그/자동 테스트용
  (window as unknown as { __app: App }).__app = app;
}

if (hot?.ready) hot.ready(start);
else start(hot?.data ?? {});
