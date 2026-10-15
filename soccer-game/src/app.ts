import { FORMATION_DESC, FORMATION_IDS } from './data/formations';
import {
  ACE_TALKS,
  HALF_TALKS,
  PERSONALITY_DESC,
  PERSONALITY_LABEL,
  POST_TALKS,
  PRE_TALKS,
  PRESS,
  PressQuestion,
  TONES,
  Tone,
  TalkContext,
  TalkOption,
  moraleLabel,
  reactionText,
  talkEffect,
} from './data/talks';
import { SPECIAL_DESC, SPECIAL_LABEL, TEAMS, overall, teamById } from './data/teams';
import { audio } from './game/audio';
import { Input } from './game/input';
import { Match, assignLineup } from './game/match';
import { clamp, pick, rand } from './game/math';
import { Renderer } from './game/renderer';
import { particleLimit } from './game/particles';
import type { Difficulty, MatchConfig, Tactics, TeamDef, TeamStats } from './game/types';
import {
  ROUND_NAMES,
  TournamentState,
  loadTournament,
  newTournament,
  pairings,
  recordUserMatch,
  saveTournament,
  simulateRest,
  userFixture,
} from './tournament';
import { bar, crest, deltaTag, h, moraleBar, overallOf, seg, starText } from './ui/dom';
import { TouchContext, TouchControls, isTouch } from './ui/touch';
import { controlMode } from './game/control';
import { CY } from './game/constants';

interface Settings {
  difficulty: Difficulty;
  halfMinutes: number;
  wide: boolean;
  sound: boolean;
  replay: boolean;
  /** 터치 버튼: 자동(마지막 입력 기준) / 항상 / 끄기 */
  touch: 'auto' | 'on' | 'off';
  /** 골·필살기 때 휴대폰 진동 */
  vibrate: boolean;
}

interface MatchSetup {
  home: TeamDef;
  away: TeamDef;
  humanSide: 0 | 1 | -1;
  userTactics: Tactics;
  cpuTactics: Tactics;
  userMorale: number[];
  cpuMorale: number[];
  stageName: string;
  stageIdx: number;
  knockout: boolean;
  night: boolean;
  startGauge: number;
}

const DIFF_LABELS = ['아마추어', '프로', '월드클래스', '레전드'];
const MENTALITY = [
  { v: -2, label: '매우 수비적' },
  { v: -1, label: '수비적' },
  { v: 0, label: '균형' },
  { v: 1, label: '공격적' },
  { v: 2, label: '매우 공격적' },
];
const PRESSING = [
  { v: 0, label: '낮음' },
  { v: 1, label: '보통' },
  { v: 2, label: '높음' },
];

const SETTINGS_KEY = 'blaze-eleven-settings';

function loadSettings(): Settings {
  const def: Settings = { difficulty: 1, halfMinutes: 3, wide: false, sound: true, replay: true, touch: 'auto', vibrate: true };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...def, ...JSON.parse(raw) };
  } catch {
    /* 무시 */
  }
  return def;
}

function saveSettings(s: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* 무시 */
  }
}

function cpuTactics(team: TeamDef, opp: TeamDef): Tactics {
  const diff = overall(team) - overall(opp);
  const pressingTeams = ['ger', 'ned', 'kor', 'uru', 'eng'];
  return {
    formation: team.formation,
    mentality: diff > 3 ? 1 : diff < -3 ? -1 : 0,
    pressing: pressingTeams.includes(team.id) ? 2 : 1,
  };
}

export class App {
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  ui: HTMLElement;
  renderer: Renderer;
  input = new Input();
  demoInput = new Input();
  touch: TouchControls;
  settings = loadSettings();
  match: Match | null = null;
  demo: Match | null = null;
  tour: TournamentState | null = null;
  mode: 'tournament' | 'friendly' = 'tournament';
  setup: MatchSetup | null = null;
  private lastT = 0;
  private friendlyHome: TeamDef | null = null;
  private watchOnly = false;
  /** 경기 화면에서 메뉴로 바뀐 직후, 연타한 키·클릭이 메뉴 버튼을 누르지 않게 막는 시각 */
  private guardUntil = 0;
  /** 마지막으로 쓴 입력 장치 (터치 버튼 자동 표시용) */
  private lastInput: 'touch' | 'keys' = isTouch() ? 'touch' : 'keys';

  constructor(root: HTMLElement) {
    this.root = root;
    this.canvas = h('canvas', { id: 'game', 'aria-label': '경기 화면' }) as HTMLCanvasElement;
    this.ui = h('div', { id: 'ui' });
    root.append(this.canvas, this.ui);
    this.renderer = new Renderer(this.canvas);
    this.renderer.wide = this.settings.wide;
    this.demoInput.enabled = false;
    this.touch = new TouchControls(root, this.input, () => this.pauseMatch());
    audio.setMuted(!this.settings.sound);
    window.addEventListener('resize', () => {
      this.renderer.resize();
      this.pausedDrawn = false;
    });
    // 휴대폰은 파티클 수를 줄인다 (골 세리머니 프레임 저하 방지)
    if (isTouch()) particleLimit.max = 900;
    // 첫 입력 시 오디오 시작
    const unlock = () => {
      audio.init();
      audio.setMuted(!this.settings.sound);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    // 일시정지 화면에서 Esc/P로 재개 (한 번만 등록, 한글 자판에서도 동작하도록 e.code)
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if ((e.code === 'Escape' || e.code === 'KeyP') && this.match?.paused && this.ui.querySelector('.screen.pause')) {
        e.preventDefault();
        this.resumeMatch();
      }
    });
    // 경기 중 연타하던 Space/Enter·클릭이 막 열린 메뉴의 버튼을 누르지 않도록
    const guardKey = (e: KeyboardEvent) => {
      if (performance.now() < this.guardUntil && (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter')) e.preventDefault();
    };
    window.addEventListener('keydown', guardKey, true);
    window.addEventListener('keyup', guardKey, true);
    this.ui.addEventListener(
      'click',
      (e) => {
        if (performance.now() < this.guardUntil) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
      true,
    );
    // 입력 장치 전환: 터치하면 터치 버튼, 키보드·패드를 쓰면 숨김 (설정이 '자동'일 때)
    window.addEventListener(
      'pointerdown',
      (e) => {
        if (e.pointerType === 'touch' || e.pointerType === 'pen') this.setLastInput('touch');
      },
      true,
    );
    window.addEventListener('keydown', () => this.setLastInput('keys'), true);
    // 화면을 탭하면 인트로·골 장면·리플레이 넘기기
    this.canvas.addEventListener('pointerdown', () => {
      const m = this.match;
      if (m && !m.paused && (m.phase === 'intro' || m.phase === 'goal' || m.phase === 'replay')) this.input.tap();
    });
    // 앱이 백그라운드로 가면 자동 일시정지, 소리도 멈춤
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.match && !this.match.paused && !this.ui.childElementCount) this.pauseMatch();
        audio.suspend();
      } else audio.resume();
    });
    this.startDemo();
    requestAnimationFrame(this.loop);
  }

  private loop = (t: number) => {
    // 90/120Hz 화면에서도 60fps로만 그린다 (시뮬레이션은 60Hz 고정이라 더 그려도 같은 장면)
    if (this.lastT && t - this.lastT < 10) {
      requestAnimationFrame(this.loop);
      return;
    }
    const dt = this.lastT ? (t - this.lastT) / 1000 : 0.016;
    this.lastT = t;
    this.adaptResolution(dt);
    this.pollMenuPad();
    const m = this.match ?? this.demo;
    // 불투명한 메뉴 뒤에서는 경기를 돌리지 않는다 (배터리, 끝난 경기 폭죽 소리)
    const top = this.ui.firstElementChild;
    const covered = !!top && !top.classList.contains('see-through');
    // 일시정지 중에는 화면이 바뀌지 않으므로 한 번만 그린다
    const frozen = !!m && m.paused && this.pausedDrawn;
    if (covered) this.pausedDrawn = false;
    if (m && !covered && !frozen) {
      // 타이틀 배경 데모의 효과음만 끈다 (메뉴 클릭·팡파르 같은 UI 소리는 그대로)
      audio.sfxOff = m === this.demo;
      m.frame(dt);
      audio.sfxOff = false;
      this.pausedDrawn = m.paused;
      this.renderer.render(m, dt);
      if (this.match && this.renderer.touchMode) this.touch.update(this.touchContext(this.match));
    }
    requestAnimationFrame(this.loop);
  };

  private pausedDrawn = false;
  private slowT = 0;
  private fastT = 0;
  private dts: number[] = [];

  /** 경기 중 프레임이 계속 느리면 해상도를 낮추고, 여유가 생기면 되돌린다 */
  private adaptResolution(dt: number) {
    const r = this.renderer;
    // 컷인·필살 추격 장면은 그리는 양이 많으므로 그동안만 해상도 상한을 1.5로
    const m = this.match;
    const cine = !!m && (m.phase === 'cutin' || m.cine.w > 0.3);
    const wantCap = cine ? 1.5 : 9;
    if (r.cineCap !== wantCap) {
      r.cineCap = wantCap;
      r.resize();
    }
    if (!this.match || this.match.paused || this.ui.childElementCount || dt > 0.25) {
      this.slowT = this.fastT = 0;
      return;
    }
    // 느림 판단은 이 기기의 평소 프레임 간격 기준 (저전력 모드처럼 30Hz로 고정된 화면을 느리다고 오해하지 않게)
    this.dts.push(dt);
    if (this.dts.length > 90) this.dts.shift();
    if (this.dts.length < 30) return;
    const base = this.dts.slice().sort((a, b) => a - b)[Math.floor(this.dts.length * 0.2)];
    if (dt > Math.max(0.02, base * 1.4)) {
      this.slowT += dt;
      this.fastT = 0;
    } else {
      this.fastT += dt;
      this.slowT = Math.max(0, this.slowT - dt * 0.5);
    }
    const native = Math.min(window.devicePixelRatio || 1, 2);
    if (this.slowT > 1.5 && r.dprCap > 1) {
      r.dprCap = Math.max(1, Math.min(r.dprCap, native) - 0.25);
      r.resize();
      this.slowT = 0;
    } else if (this.fastT > 20 && r.dprCap < native) {
      r.dprCap = Math.min(native, r.dprCap + 0.25);
      r.resize();
      this.fastT = 0;
    }
  }

  private padPrev: boolean[] = [];
  private padDir = '';

  /** 게임패드로 메뉴 조작: 십자키·스틱으로 이동, A 선택, B 뒤로, Start 경기 재개 */
  private pollMenuPad() {
    const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
    const pad = pads.find((p) => !!p);
    if (!pad) return;
    if (pad.buttons.some((b) => b.pressed) || pad.axes.some((a) => Math.abs(a) > 0.5)) this.setLastInput('keys');
    const pressed = (i: number) => !!pad.buttons[i]?.pressed;
    const edge = (i: number) => pressed(i) && !this.padPrev[i];
    const ax = pad.axes[0] ?? 0;
    const ay = pad.axes[1] ?? 0;
    const dir = pressed(12) || ay < -0.6 ? 'u' : pressed(13) || ay > 0.6 ? 'd' : pressed(14) || ax < -0.6 ? 'l' : pressed(15) || ax > 0.6 ? 'r' : '';
    if (this.ui.childElementCount) {
      if (dir && dir !== this.padDir) this.moveFocus(dir === 'u' || dir === 'l' ? -1 : 1);
      if (edge(0)) (document.activeElement as HTMLElement | null)?.click();
      if (edge(1)) {
        const back = Array.from(this.ui.querySelectorAll<HTMLButtonElement>('button')).find((b) => /뒤로|돌아가기|계속하기/.test(b.textContent ?? ''));
        back?.click();
      }
      if (edge(9) && this.match?.paused) this.resumeMatch();
    }
    this.padDir = dir;
    this.padPrev = pad.buttons.map((b) => b.pressed);
  }

  private moveFocus(delta: number) {
    const els = Array.from(this.ui.querySelectorAll<HTMLElement>('button:not([disabled])')).filter((e) => e.offsetParent !== null);
    if (!els.length) return;
    const i = els.indexOf(document.activeElement as HTMLElement);
    const next = els[(i + delta + els.length) % els.length];
    next.focus();
    next.scrollIntoView({ block: 'nearest' });
  }

  /** 터치 버튼 라벨을 상황에 맞게 */
  private touchContext(m: Match): TouchContext {
    const user = m.humanTeam;
    const base = { specialReady: !!user && user.gauge >= 100, tackleReady: !!user && user.gauge >= 50 };
    if (!user || m.paused) return { mode: 'hidden', ...base };
    // 필살 타이밍 대결: 내 컷인 중이거나, 상대 필살 슛이 날아오는 중
    if (m.phase === 'cutin' && m.cutin?.p.team === user && m.cutin.duel === 'none') return { mode: 'duel', duelLabel: '타이밍!', ...base };
    const sd = m.saveDuel;
    const b = m.ball;
    if (sd && sd.res === 'none' && b.guide && b.special && b.shot && !b.shot.judged && b.shot.side !== user.side) return { mode: 'duel', duelLabel: '막기!', ...base };
    // 필살 추격·리플레이 같은 시네마틱 장면에서는 버튼을 숨겨 화면을 비운다
    if (m.cine.w > 0.3) return { mode: 'hidden', ...base };
    if (m.phase === 'intro' || m.phase === 'goal' || m.phase === 'replay' || m.phase === 'cutin' || m.phase === 'halftime' || m.phase === 'fulltime') return { mode: 'hidden', ...base };
    if (m.phase === 'shootout') {
      const so = m.shootout;
      return { mode: so?.humanShooting ? 'shootout-shoot' : so?.humanKeeping ? 'shootout-keep' : 'hidden', ...base };
    }
    const sp = m.setPiece;
    if ((m.phase === 'setpiece' || m.phase === 'kickoff') && sp && sp.side === user.side && sp.taker === user.controlled) {
      return { mode: 'setpiece', setpiece: sp.kind, ...base };
    }
    if (m.phase === 'kickoff') return { mode: 'hidden', ...base };
    const mode = controlMode(m, user);
    const p = user.controlled;
    const crossZone = !!p && user.u(p.x) > 0.68 && Math.abs(p.y - CY) > 11;
    return { mode, crossZone, ...base };
  }

  // ───────────────────────────── 데모 (타이틀 배경) ─────────────────────────────

  startDemo() {
    const pool = TEAMS.slice();
    const a = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
    const b = pick(pool);
    const cfg: MatchConfig = {
      home: a,
      away: b,
      humanSide: -1,
      halfMinutes: 1.5,
      difficulty: 2,
      homeTactics: cpuTactics(a, b),
      awayTactics: cpuTactics(b, a),
      homeMorale: a.players.map(() => rand(0, 1.5)),
      awayMorale: b.players.map(() => rand(0, 1.5)),
      knockout: false,
      stageName: '친선 경기',
      night: Math.random() < 0.5,
    };
    const d: Match = new Match(cfg, this.demoInput, {
      onHalfTime: () => setTimeout(() => this.demo === d && d.startSecondHalf(), 1200),
      onFullTime: () => setTimeout(() => this.demo === d && !this.match && this.startDemo(), 1500),
    });
    d.isDemo = true;
    this.demo = d;
    // 데모는 필살기가 자주 나오게
    this.demo.teams.forEach((t) => (t.gauge = rand(40, 80)));
  }

  // ───────────────────────────── 화면 전환 ─────────────────────────────

  show(el: HTMLElement) {
    // 경기 화면에서 바로 넘어온 메뉴는 잠깐 입력을 막는다 (슛·필살기 연타가 '넘어가기'를 누르는 사고 방지)
    if (this.input.enabled && this.match) this.guardUntil = performance.now() + 650;
    this.ui.innerHTML = '';
    this.ui.appendChild(el);
    this.ui.scrollTop = 0;
    this.input.enabled = false;
    this.input.reset();
    this.touch.show(false);
    // 건너뛰기·뒤로 같은 버튼에는 자동 포커스를 주지 않는다
    const first = el.querySelector<HTMLElement>('[data-autofocus]') ?? el.querySelector<HTMLElement>('.btn.primary, .btn.hot');
    if (first) first.focus({ preventScroll: true });
    else (document.activeElement as HTMLElement | null)?.blur?.();
  }

  private touchOn() {
    const t = this.settings.touch;
    return t === 'on' || (t === 'auto' && this.lastInput === 'touch');
  }

  private setLastInput(k: 'touch' | 'keys') {
    if (this.lastInput === k) return;
    this.lastInput = k;
    if (this.match && !this.ui.childElementCount) this.applyTouch();
  }

  private applyTouch() {
    const touch = this.touchOn() && !!this.match;
    this.touch.show(touch);
    this.renderer.touchMode = touch;
    if (this.match) this.match.touchUI = touch;
  }

  hideUi() {
    this.ui.innerHTML = '';
    this.input.enabled = true;
    this.input.reset();
    // 메뉴를 닫은 게임패드 A/B가 경기에서 패스·슛으로 이어지지 않게
    this.input.swallowHeld();
    this.applyTouch();
  }

  private click() {
    audio.init();
    audio.click();
  }

  // ───────────────────────────── 타이틀 ─────────────────────────────

  showTitle(confirmNew = false) {
    this.match = null;
    if (!this.demo) this.startDemo();
    const saved = loadTournament();
    const startNew = () => {
      this.click();
      this.mode = 'tournament';
      this.showTeamSelect('tournament');
    };
    const menu = h(
      'div',
      { class: 'menu' },
      h(
        'button',
        { class: 'btn primary', type: 'button', onclick: () => (saved && !confirmNew ? (this.click(), this.showTitle(true)) : startNew()) },
        saved ? '새 토너먼트' : '토너먼트 시작',
        h('small', null, '8강 → 4강 → 결승'),
      ),
      confirmNew && saved
        ? h(
            'div',
            { class: 'confirm' },
            h('span', null, `진행 중인 토너먼트(${teamById(saved.userTeam).name} · ${ROUND_NAMES[saved.round]})는 새 팀을 고르면 지워집니다.`),
            h('button', { class: 'btn', type: 'button', 'data-autofocus': true, onclick: startNew }, '새로 시작'),
            h('button', { class: 'btn ghost', type: 'button', onclick: () => (this.click(), this.showTitle()) }, '취소'),
          )
        : null,
      saved &&
        h(
          'button',
          {
            class: 'btn',
            type: 'button',
            onclick: () => {
              this.click();
              this.mode = 'tournament';
              this.tour = saved;
              this.showBracket();
            },
          },
          '이어하기',
          h('small', null, `${teamById(saved.userTeam).name} · ${ROUND_NAMES[saved.round]}`),
        ),
      h(
        'button',
        { class: 'btn', type: 'button', onclick: () => (this.click(), (this.mode = 'friendly'), (this.watchOnly = false), this.showTeamSelect('friendly-home')) },
        '친선 경기',
        h('small', null, '원하는 두 팀으로 한 판'),
      ),
      h(
        'button',
        { class: 'btn', type: 'button', onclick: () => (this.click(), (this.mode = 'friendly'), (this.watchOnly = true), this.showTeamSelect('friendly-home')) },
        '관전 모드',
        h('small', null, 'CPU 대 CPU'),
      ),
      h('button', { class: 'btn', type: 'button', onclick: () => (this.click(), this.showControls(() => this.showTitle())) }, '조작법'),
      h('button', { class: 'btn', type: 'button', onclick: () => (this.click(), this.showSettings()) }, '설정', h('small', null, `${DIFF_LABELS[this.settings.difficulty]} · 전후반 ${this.settings.halfMinutes}분`)),
    );
    this.show(
      h(
        'div',
        { class: 'screen title-screen see-through' },
        h(
          'div',
          { class: 'logo' },
          h('div', { class: 'mark' }, 'BLAZE', h('span', { class: 'eleven' }, 'ELEVEN')),
          h('div', { class: 'ko' }, '블레이즈 일레븐 · 필살 토너먼트'),
        ),
        menu,
        h('div', { class: 'title-foot' }, '키보드 · 게임패드 · 터치 지원  |  선수와 감독은 모두 가상의 인물입니다'),
      ),
    );
  }

  showSettings() {
    const s = this.settings;
    const running = loadTournament();
    const save = () => {
      saveSettings(s);
      audio.setMuted(!s.sound);
      this.renderer.wide = s.wide;
      // 진행 중인 토너먼트에도 난이도·경기 시간을 반영
      const t = loadTournament();
      if (t && (t.difficulty !== s.difficulty || t.halfMinutes !== s.halfMinutes)) {
        t.difficulty = s.difficulty;
        t.halfMinutes = s.halfMinutes;
        saveTournament(t);
      }
    };
    this.show(
      h(
        'div',
        { class: 'screen' },
        h(
          'div',
          { class: 'wrap', style: 'max-width:620px' },
          h('div', { class: 'eyebrow' }, 'Settings'),
          h('h2', null, '설정'),
          h(
            'div',
            { class: 'panel', style: 'display:flex;flex-direction:column;gap:16px' },
            h(
              'div',
              null,
              h('div', { class: 'field-label' }, '난이도 — CPU의 판단 속도, 패스 정확도, 태클 적극성, 골키퍼 능력' + (running ? ' (진행 중인 토너먼트에도 적용)' : '')),
              seg(
                DIFF_LABELS.map((l, i) => ({ v: i as Difficulty, label: l })),
                s.difficulty,
                (v) => ((s.difficulty = v), save()),
                'set-diff',
              ),
            ),
            h(
              'div',
              null,
              h('div', { class: 'field-label' }, '경기 시간 (전·후반 각각, 실제 시간)'),
              seg(
                [2, 3, 4, 5].map((v) => ({ v, label: `${v}분` })),
                s.halfMinutes,
                (v) => ((s.halfMinutes = v), save()),
                'set-time',
              ),
            ),
            h(
              'div',
              null,
              h('div', { class: 'field-label' }, '카메라'),
              seg(
                [
                  { v: 'n', label: '기본 (방송)' },
                  { v: 'w', label: '와이드' },
                ],
                s.wide ? 'w' : 'n',
                (v) => ((s.wide = v === 'w'), save()),
                'set-cam',
              ),
            ),
            h(
              'div',
              null,
              h('div', { class: 'field-label' }, '터치 버튼 (휴대폰·태블릿)'),
              seg(
                [
                  { v: 'auto', label: '자동' },
                  { v: 'on', label: '항상 표시' },
                  { v: 'off', label: '끄기' },
                ],
                s.touch,
                (v) => ((s.touch = v as Settings['touch']), save()),
                'set-touch',
              ),
            ),
            h(
              'div',
              null,
              h('div', { class: 'field-label' }, '진동 (지원하는 휴대폰에서 골·필살기 때)'),
              seg(
                [
                  { v: 'on', label: '켜기' },
                  { v: 'off', label: '끄기' },
                ],
                s.vibrate ? 'on' : 'off',
                (v) => ((s.vibrate = v === 'on'), save()),
                'set-vibrate',
              ),
            ),
            h(
              'div',
              null,
              h('div', { class: 'field-label' }, '골 리플레이'),
              seg(
                [
                  { v: 'on', label: '켜기' },
                  { v: 'off', label: '끄기' },
                ],
                s.replay ? 'on' : 'off',
                (v) => ((s.replay = v === 'on'), save()),
                'set-replay',
              ),
            ),
            h(
              'div',
              null,
              h('div', { class: 'field-label' }, '사운드'),
              seg(
                [
                  { v: 'on', label: '켜기' },
                  { v: 'off', label: '끄기' },
                ],
                s.sound ? 'on' : 'off',
                (v) => ((s.sound = v === 'on'), save()),
                'set-sound',
              ),
            ),
          ),
          h('div', { class: 'row end' }, h('button', { class: 'btn primary', type: 'button', onclick: () => (this.click(), this.showTitle()) }, '돌아가기')),
        ),
      ),
    );
  }

  showControls(back: () => void) {
    const row = (keys: string[], desc: string) => h('tr', null, h('td', null, ...keys.map((k) => h('kbd', null, k))), h('td', null, desc));
    const touchPanel = h(
      'div',
      { class: 'panel' },
      h('h3', { style: 'margin-bottom:8px' }, '터치 (휴대폰·태블릿)'),
      h(
        'table',
        null,
        h(
          'tbody',
          null,
          row(['왼쪽 화면'], '아무 곳이나 누른 채 끌면 이동 — 조이스틱이 손가락 자리에 생긴다'),
          row(['슛'], '길게 눌러 파워 · 킥 직전 다시 누르면 타이밍 피니시'),
          row(['슛', '↑'], '위로 밀며 떼면 칩슛'),
          row(['슛', '↔'], '옆으로 밀며 떼면 감아차기'),
          row(['패스', '스루', '로빙'], '길게 누를수록 멀리 · 측면에서는 로빙이 크로스'),
          row(['필살'], '게이지 100%가 되면 버튼이 빛난다 · 컷인 중 막대가 초록일 때 슛 버튼'),
          row(['막기!'], '상대 필살 슛이 올 때 키퍼 고리가 초록이면 누르기'),
          row(['수비'], '버튼이 태클 · 전환 · 슬라이딩 · 압박 · 필살태클로 바뀐다'),
          row(['화면 탭'], '골 장면 · 리플레이 넘기기'),
          row(['II'], '일시정지 · 터치라인 지시'),
        ),
      ),
    );
    const touchFirst = this.touchOn() || isTouch();
    this.show(
      h(
        'div',
        { class: 'screen' },
        h(
          'div',
          { class: 'wrap' },
          h('div', { class: 'eyebrow' }, 'Controls'),
          h('h2', null, '조작법'),
          h(
            'div',
            { class: 'keys' },
            touchFirst ? touchPanel : null,
            h(
              'div',
              { class: 'panel' },
              h('h3', { style: 'margin-bottom:8px' }, '공격'),
              h(
                'table',
                null,
                h(
                  'tbody',
                  null,
                  row(['W', 'A', 'S', 'D'], '이동 (방향키도 가능)'),
                  row(['Shift'], '질주 — 공이 발에서 멀어진다'),
                  row(['J'], '패스 — 길게 누를수록 먼 동료에게'),
                  row(['K'], '슛 — 길게 눌러 파워, 빨간 구간은 뜬다'),
                  row(['K', 'K'], '타이밍 피니시 — 킥 직전 다시 눌러 PERFECT'),
                  row(['L'], '스루패스 — 수비 뒷공간으로'),
                  row(['I'], '로빙 패스 / 측면에서는 크로스'),
                  row(['E', '+', 'K'], '감아차기 — 느리지만 휘어 들어간다'),
                  row(['Q', '+', 'K'], '칩슛 — 키퍼 키를 넘긴다'),
                  row(['U'], '개인기 (방향에 따라 다름)'),
                  row(['Space'], '필살기 — 게이지 100%, 골문 42m 이내'),
                  row(['K'], '필살 컷인 중 막대가 초록일 때 — PERFECT 필살 슛'),
                ),
              ),
            ),
            h(
              'div',
              { class: 'panel' },
              h('h3', { style: 'margin-bottom:8px' }, '수비'),
              h(
                'table',
                null,
                h(
                  'tbody',
                  null,
                  row(['J'], '선수 전환 (공에 가까운 수비수)'),
                  row(['K'], '스탠딩 태클'),
                  row(['L'], '슬라이딩 태클 — 뒤에서 하면 파울·카드'),
                  row(['I'], '누르고 있는 동안 동료가 압박'),
                  row(['Space'], '필살 태클 — 게이지 50%, 반드시 빼앗는다'),
                  row(['K'], '상대 필살 슛 — 키퍼 고리가 초록일 때 눌러 선방'),
                  row(['Esc', 'P'], '일시정지 · 터치라인 지시'),
                ),
              ),
              h('h3', { style: 'margin:14px 0 8px' }, '개인기 (U + 방향)'),
              h(
                'table',
                null,
                h(
                  'tbody',
                  null,
                  row(['U'], '제자리: 헛다리 — 순간 가속'),
                  row(['U', '+', '옆'], '마르세유 룰렛 — 옆으로 돌아 나간다'),
                  row(['U', '+', '뒤'], '드래그백 — 공을 끌고 방향 전환'),
                  row(['U', '+', '앞'], '레인보우 플릭 / 질주 중이면 치고 달리기'),
                ),
              ),
            ),
            touchFirst ? null : touchPanel,
          ),
          h(
            'div',
            { class: 'grid two' },
            h('p', { class: 'tip' }, '방향키로 이동하는 사람은 Z(패스) · X(슛) · C(스루) · V(로빙)도 쓸 수 있습니다. 게임패드는 A 패스, B 슛, Y 스루, X 로빙, RT 질주, RB 감아차기, 왼쪽 스틱 누르기 칩슛, LT 개인기, LB 필살기, Start 일시정지입니다. 메뉴는 십자키로 고르고 A로 선택합니다.'),
            h('p', { class: 'tip' }, '필살 게이지는 패스 성공, 태클, 개인기, 선방, 그리고 실점했을 때 크게 찹니다. 선수들의 사기가 높을수록 빨리 차고, 공을 받으며 버튼을 미리 눌러 두면 원터치로 처리합니다.'),
          ),
          h('div', { class: 'row end' }, h('button', { class: 'btn primary', type: 'button', onclick: () => (this.click(), back()) }, '돌아가기')),
        ),
      ),
    );
  }

  // ───────────────────────────── 팀 선택 ─────────────────────────────

  showTeamSelect(purpose: 'tournament' | 'friendly-home' | 'friendly-away') {
    let selected: TeamDef | null = purpose === 'friendly-away' ? TEAMS.find((t) => t.id !== this.friendlyHome?.id) ?? null : null;
    const detail = h('div', { class: 'panel', style: 'display:flex;flex-direction:column;gap:10px' });
    const confirmBtn = h('button', { class: 'btn primary', type: 'button', disabled: true }, '이 팀으로 결정') as HTMLButtonElement;
    const renderDetail = () => {
      detail.innerHTML = '';
      if (!selected) {
        detail.appendChild(h('p', { class: 'muted' }, '팀을 고르면 필살기와 에이스 정보를 볼 수 있습니다.'));
        confirmBtn.disabled = true;
        return;
      }
      const t = selected;
      const ace = t.players.find((p) => p.ace)!;
      detail.append(
        h(
          'div',
          { class: 'row' },
          crest(t, 'lg'),
          h('div', null, h('div', { class: 'eyebrow' }, t.nick), h('h2', null, t.name), h('div', { class: 'stars' }, starText(t))),
        ),
        h('p', { class: 'muted' }, `감독 ${t.manager} · 기본 포메이션 ${t.formation} · ${t.style}`),
        h('div', { class: 'special-tag' }, `필살기 「${t.special.name}」 · ${SPECIAL_LABEL[t.special.type]}`),
        h('p', { style: 'font-size:14px' }, SPECIAL_DESC[t.special.type]),
        h('p', { style: 'font-size:14px' }, h('span', { class: 'chip ace' }, '에이스'), ' ', `No.${ace.num} ${ace.name} — ${PERSONALITY_LABEL[ace.personality]} 성격. 에이스가 쓰는 필살기는 더 강력하다.`),
      );
      confirmBtn.disabled = purpose === 'friendly-away' && t.id === this.friendlyHome?.id;
    };
    const cards = TEAMS.map((t) => {
      const card = h(
        'button',
        {
          type: 'button',
          class: 'team-card' + (selected?.id === t.id ? ' selected' : ''),
          style: `--kit:${t.home.shirt}`,
          'aria-pressed': selected?.id === t.id ? 'true' : 'false',
          disabled: purpose === 'friendly-away' && t.id === this.friendlyHome?.id,
          onclick: () => {
            audio.init();
            audio.select();
            selected = t;
            grid.querySelectorAll('.team-card').forEach((c) => c.classList.remove('selected'));
            card.classList.add('selected');
            renderDetail();
            confirmBtn.disabled = false;
            if (window.innerWidth < 760) detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          },
          ondblclick: () => confirmBtn.click(),
        },
        crest(t),
        h('div', null, h('div', { class: 'name' }, t.name), h('div', { class: 'nick' }, `${t.nick} · `, h('span', { class: 'stars' }, starText(t)))),
        h(
          'div',
          { class: 'info' },
          bar('공격', t.att),
          bar('중원', t.mid),
          bar('수비', t.def),
          bar('GK', t.gkr),
          h('div', { class: 'special-tag' }, t.special.name),
        ),
      );
      return card;
    });
    const grid = h('div', { class: 'grid teams' }, cards);
    confirmBtn.addEventListener('click', () => {
      if (!selected) return;
      this.click();
      if (purpose === 'tournament') {
        this.tour = newTournament(selected.id, this.settings.difficulty, this.settings.halfMinutes);
        saveTournament(this.tour);
        this.showBracket();
      } else if (purpose === 'friendly-home') {
        this.friendlyHome = selected;
        this.showTeamSelect('friendly-away');
      } else {
        const home = this.friendlyHome!;
        this.prepareMatch(home, selected, this.watchOnly ? -1 : 0, '친선 경기', 0, false);
      }
    });
    renderDetail();
    const title =
      purpose === 'tournament' ? '토너먼트에 나갈 팀을 고르세요' : purpose === 'friendly-home' ? (this.watchOnly ? '홈 팀을 고르세요' : '내가 조종할 팀을 고르세요') : '상대 팀을 고르세요';
    this.show(
      h(
        'div',
        { class: 'screen' },
        h(
          'div',
          { class: 'wrap' },
          h('div', { class: 'eyebrow' }, purpose === 'tournament' ? 'Legend Cup · Team Select' : 'Friendly · Team Select'),
          h('h2', null, title),
          h('div', { class: 'grid two', style: 'align-items:start' }, grid, detail),
          h(
            'div',
            { class: 'row end' },
            h('button', { class: 'btn ghost', type: 'button', onclick: () => (this.click(), purpose === 'friendly-away' ? this.showTeamSelect('friendly-home') : this.showTitle()) }, '뒤로'),
            confirmBtn,
          ),
        ),
      ),
    );
    // 팀 그리드가 넓게 보이도록 레이아웃 조정
    (grid.parentElement as HTMLElement).style.gridTemplateColumns = 'minmax(0, 2fr) minmax(min(100%, 300px), 1fr)';
    if (window.innerWidth < 760) (grid.parentElement as HTMLElement).style.gridTemplateColumns = '1fr';
  }

  // ───────────────────────────── 대진표 ─────────────────────────────

  showBracket() {
    const s = this.tour!;
    const cols = [0, 1, 2].map((r) => {
      const pairs = r <= s.round || s.eliminated || s.champion ? pairings(s, r) : pairings(s, r).map(() => ['?', '?'] as [string, string]);
      return h(
        'div',
        { class: 'col', 'data-round': ROUND_NAMES[r] },
        pairs.map(([a, b]) => {
          const res = s.results.find((x) => x.round === r && ((x.home === a && x.away === b) || (x.home === b && x.away === a)));
          const isUser = a === s.userTeam || b === s.userTeam;
          const line = (id: string) => {
            if (id === '?') return h('div', { class: 't' }, h('div', { class: 'crest sm', style: '--c1:#333;--c2:#555' }, '?'), h('span', { class: 'nm muted' }, '미정'), h('span', { class: 'sc' }, ''));
            const t = teamById(id);
            let score = '';
            if (res) {
              const g = res.home === id ? res.hg : res.ag;
              const p = res.home === id ? res.hp : res.ap;
              score = p !== undefined ? `${g} (${p})` : String(g);
            }
            return h('div', { class: 't' + (res && res.winner !== id ? ' lost' : '') }, crest(t, 'sm'), h('span', { class: 'nm' }, t.name, id === s.userTeam ? ' ★' : ''), h('span', { class: 'sc' }, score));
          };
          return h('div', { class: 'fixture' + (isUser && !res ? ' user' : '') }, line(a), line(b));
        }),
      );
    });
    const fx = userFixture(s);
    let next: HTMLElement;
    if (fx) {
      const oppId = fx[0] === s.userTeam ? fx[1] : fx[0];
      const opp = teamById(oppId);
      next = h(
        'div',
        { class: 'panel row', style: 'justify-content:space-between' },
        h(
          'div',
          { class: 'row' },
          crest(teamById(s.userTeam)),
          h('div', null, h('div', { class: 'eyebrow' }, `다음 경기 · ${ROUND_NAMES[s.round]}`), h('h3', null, `${teamById(s.userTeam).name} vs ${opp.name}`), h('div', { class: 'muted', style: 'font-size:13px' }, `상대 필살기 「${opp.special.name}」 · ${opp.style}`)),
          crest(opp),
        ),
        h(
          'div',
          { class: 'row' },
          h('button', { class: 'btn ghost', type: 'button', onclick: () => (this.click(), this.showTitle()) }, '타이틀로 (자동 저장)'),
          h('button', { class: 'btn primary', type: 'button', 'data-autofocus': true, onclick: () => (this.click(), this.prepareMatch(teamById(s.userTeam), opp, 0, ROUND_NAMES[s.round], s.round, true)) }, '경기 준비'),
        ),
      );
    } else {
      next = h('div', { class: 'row end' }, h('button', { class: 'btn primary', type: 'button', onclick: () => this.showTitle() }, '타이틀로'));
    }
    this.show(
      h(
        'div',
        { class: 'screen' },
        h(
          'div',
          { class: 'wrap' },
          h('div', { class: 'eyebrow' }, 'Legend Cup 2026'),
          h('h2', null, '대진표'),
          h('div', { class: 'bracket' }, ROUND_NAMES.map((n) => h('div', { class: 'head' }, n)), cols),
          next,
        ),
      ),
    );
  }

  // ───────────────────────────── 경기 준비 (FM 스타일) ─────────────────────────────

  prepareMatch(user: TeamDef, opp: TeamDef, humanSide: 0 | -1, stageName: string, stageIdx: number, knockout: boolean) {
    if (this.match) this.leaveMatch();
    const baseMorale = this.mode === 'tournament' && this.tour ? this.tour.morale.slice() : user.players.map(() => 0.3);
    this.setup = {
      home: user,
      away: opp,
      humanSide,
      userTactics: { formation: user.formation, mentality: 0, pressing: 1 },
      cpuTactics: cpuTactics(opp, user),
      userMorale: baseMorale,
      cpuMorale: opp.players.map(() => clamp(0.3 + rand(-0.6, 0.8), -3, 3)),
      stageName,
      stageIdx,
      knockout,
      night: stageIdx >= 2 || (stageIdx === 1 ? Math.random() < 0.6 : Math.random() < 0.3),
      startGauge: 0,
    };
    if (humanSide === -1) {
      this.setup.userTactics = cpuTactics(user, opp);
      this.startMatch();
      return;
    }
    this.showPreMatch(0);
  }

  private stepsBar(cur: number, labels: string[]) {
    return h(
      'div',
      { class: 'steps' },
      labels.map((l, i) => h('span', { class: i === cur ? 'on' : i < cur ? 'done' : '' }, `${i + 1}. ${l}`)),
    );
  }

  private squadList(team: TeamDef, tactics: Tactics, morale: number[]) {
    const lineup = assignLineup(team, tactics.formation);
    return h(
      'div',
      { class: 'squad' },
      lineup.map((l) =>
        h(
          'div',
          { class: 'pl' },
          h('span', { class: 'pos' }, l.slot.label),
          h('span', { class: 'num' }, l.def.num),
          h('span', { class: 'nm', title: PERSONALITY_DESC[l.def.personality] }, l.def.name, ' ', l.def.ace ? h('span', { class: 'chip ace' }, '에이스') : null, ' ', h('span', { class: 'chip' }, PERSONALITY_LABEL[l.def.personality])),
          h('b', { style: 'font-family:var(--font-num);font-size:12px' }, overallOf({ ...l.def, role: l.slot.role })),
          moraleBar(morale[l.idx]),
        ),
      ),
    );
  }

  showPreMatch(step: number) {
    const st = this.setup!;
    const user = st.home;
    const opp = st.away;
    const labels = ['전술', '기자회견', '라커룸 토크', '에이스 면담'];
    const ctx: TalkContext = { favorite: overall(user) - overall(opp), scoreDiff: 0, stage: st.stageIdx };
    const header = h(
      'div',
      { class: 'row', style: 'justify-content:space-between' },
      h('div', null, h('div', { class: 'eyebrow' }, `${st.stageName} · 경기 전`), h('h2', null, `${user.name} vs ${opp.name}`)),
      this.stepsBar(step, labels),
    );
    let body: HTMLElement;
    if (step === 0) {
      const squadBox = h('div', null, this.squadList(user, st.userTactics, st.userMorale));
      const refresh = () => {
        squadBox.innerHTML = '';
        squadBox.appendChild(this.squadList(user, st.userTactics, st.userMorale));
        desc.textContent = FORMATION_DESC[st.userTactics.formation];
      };
      const desc = h('p', { class: 'muted', style: 'font-size:13px;margin-top:6px' }, FORMATION_DESC[st.userTactics.formation]);
      const oppAce = opp.players.find((p) => p.ace)!;
      body = h(
        'div',
        { class: 'grid two', style: 'align-items:start' },
        h(
          'div',
          { class: 'panel', style: 'display:flex;flex-direction:column;gap:14px' },
          h('h3', null, '우리 팀 전술'),
          h('div', null, h('div', { class: 'field-label' }, '포메이션'), seg(FORMATION_IDS.map((f) => ({ v: f, label: f })), st.userTactics.formation, (v) => ((st.userTactics.formation = v), refresh()), 'pm-form'), desc),
          h('div', null, h('div', { class: 'field-label' }, '공수 성향'), seg(MENTALITY, st.userTactics.mentality, (v) => (st.userTactics.mentality = v), 'pm-ment')),
          h('div', null, h('div', { class: 'field-label' }, '압박 강도'), seg(PRESSING, st.userTactics.pressing, (v) => (st.userTactics.pressing = v), 'pm-press')),
          h('div', null, h('div', { class: 'field-label' }, '선발 명단 · 사기'), squadBox),
        ),
        h(
          'div',
          { class: 'panel', style: 'display:flex;flex-direction:column;gap:10px' },
          h('h3', null, '상대 분석'),
          h('div', { class: 'row' }, crest(opp, 'lg'), h('div', null, h('div', { class: 'eyebrow' }, opp.nick), h('h3', null, opp.name), h('div', { class: 'stars' }, starText(opp)))),
          bar('공격', opp.att),
          bar('중원', opp.mid),
          bar('수비', opp.def),
          bar('GK', opp.gkr),
          h('p', { style: 'font-size:14px' }, `감독 ${opp.manager}. ${opp.style}. 예상 포메이션 ${st.cpuTactics.formation}.`),
          h('div', { class: 'special-tag' }, `경계 대상: No.${oppAce.num} ${oppAce.name}`),
          h('p', { class: 'muted', style: 'font-size:13px' }, `필살기 「${opp.special.name}」 — ${SPECIAL_DESC[opp.special.type]}`),
          h(
            'p',
            { class: 'tip' },
            ctx.favorite > 2 ? '전력상 우리가 앞선다. 방심만 하지 않으면 된다.' : ctx.favorite < -2 ? '객관적 전력은 상대가 위다. 선수들의 사기가 승부를 가를 것이다.' : '팽팽한 승부가 예상된다.',
          ),
        ),
      );
    } else if (step === 1) {
      const qd: PressQuestion = pick(PRESS);
      const oppAce = opp.players.find((p) => p.ace)!;
      const q = qd.q.replace('{ace}', oppAce.name).replace('{stage}', st.stageName);
      const result = h('div', null);
      const answers = h(
        'div',
        { class: 'answers' },
        qd.answers.map((a) =>
          h(
            'button',
            {
              type: 'button',
              class: 'answer',
              onclick: (e: Event) => {
                if (answers.dataset.done) return;
                answers.dataset.done = '1';
                (e.currentTarget as HTMLElement).classList.add('on');
                this.click();
                let sum = 0;
                user.players.forEach((p, i) => {
                  const d = (a.us[p.personality] ?? 0) + (a.us.all ?? 0);
                  st.userMorale[i] = clamp(st.userMorale[i] + d, -3, 3);
                  sum += d;
                });
                st.cpuMorale = st.cpuMorale.map((m) => clamp(m + a.them, -3, 3));
                const avg = sum / user.players.length;
                result.appendChild(
                  h(
                    'div',
                    { class: 'panel tight', style: 'display:flex;flex-direction:column;gap:6px' },
                    h('p', null, avg > 0.12 ? '선수단 분위기가 한층 고조됐다.' : avg < -0.05 ? '몇몇 선수들이 부담을 느끼는 눈치다.' : '선수단은 담담하게 기사를 읽었다.'),
                    h('p', { class: 'muted' }, a.them > 0.2 ? `${opp.name} 선수들이 발언에 자극받은 듯하다.` : a.them < -0.05 ? `${opp.name} 쪽은 조용히 경계하는 분위기다.` : `${opp.name}의 반응은 미지근하다.`),
                  ),
                );
                next.removeAttribute('disabled');
                next.focus();
              },
            },
            `“${a.text}”`,
          ),
        ),
      );
      const next = h('button', { class: 'btn primary', type: 'button', disabled: true, onclick: () => (this.click(), this.showPreMatch(2)) }, '라커룸으로') as HTMLButtonElement;
      body = h(
        'div',
        { class: 'panel', style: 'display:flex;flex-direction:column;gap:14px;max-width:760px' },
        h('div', { class: 'eyebrow' }, '경기 전 기자회견'),
        h('div', { class: 'quote' }, `기자: “${q}”`),
        answers,
        result,
        h('div', { class: 'row end' }, h('button', { class: 'btn ghost', type: 'button', onclick: () => (this.click(), this.showPreMatch(2)) }, '답변 거부'), next),
      );
    } else if (step === 2) {
      body = this.talkPanel(PRE_TALKS, ctx, user, st.userMorale, '경기 전 팀 토크', () => this.showPreMatch(3));
    } else {
      const ace = user.players.find((p) => p.ace)!;
      const aceIdx = user.players.indexOf(ace);
      body = this.acePanel(ace.name, aceIdx, ace.personality, ctx, st.userMorale, (gaugeBonus) => {
        st.startGauge = gaugeBonus;
        this.startMatch();
      });
    }
    const nav =
      step === 0
        ? h(
            'div',
            { class: 'row end' },
            h('button', { class: 'btn ghost', type: 'button', onclick: () => (this.click(), this.mode === 'tournament' ? this.showBracket() : this.showTitle()) }, '뒤로'),
            h('button', { class: 'btn ghost', type: 'button', onclick: () => (this.click(), this.startMatch()) }, '바로 킥오프'),
            h('button', { class: 'btn primary', type: 'button', onclick: () => (this.click(), this.showPreMatch(1)) }, '기자회견으로'),
          )
        : null;
    this.show(h('div', { class: 'screen' }, h('div', { class: 'wrap' }, header, body, nav)));
  }

  /** 팀 토크 패널 (경기 전/하프타임/경기 후 공용) */
  private talkPanel(options: TalkOption[], ctx: TalkContext, team: TeamDef, morale: number[], title: string, onDone: () => void, extra?: HTMLElement) {
    let tone: Tone = 'calm';
    let chosen: TalkOption | null = null;
    const reactBox = h('div', null);
    const toneSeg = seg(
      TONES.map((t) => ({ v: t.id, label: t.label })),
      tone,
      (v) => {
        tone = v;
        toneDesc.textContent = TONES.find((t) => t.id === v)!.desc;
      },
      'talk-tone',
    );
    const toneDesc = h('p', { class: 'muted', style: 'font-size:13px;margin-top:6px' }, TONES[0].desc);
    const deliver = h('button', { class: 'btn hot', type: 'button', disabled: true }, '말하기') as HTMLButtonElement;
    const cont = h('button', { class: 'btn primary', type: 'button', style: 'display:none', onclick: () => (this.click(), onDone()) }, '계속') as HTMLButtonElement;
    const opts = h(
      'div',
      { class: 'answers' },
      options.map((o) => {
        const b = h(
          'button',
          {
            type: 'button',
            class: 'answer',
            onclick: () => {
              if (deliver.dataset.done) return;
              chosen = o;
              opts.querySelectorAll('.answer').forEach((x) => x.classList.remove('on'));
              b.classList.add('on');
              deliver.disabled = false;
              this.click();
            },
          },
          `“${o.text}”`,
          o.act ? h('small', null, `(${o.act})`) : null,
        );
        return b;
      }),
    );
    deliver.addEventListener('click', () => {
      if (!chosen || deliver.dataset.done) return;
      deliver.dataset.done = '1';
      deliver.disabled = true;
      audio.init();
      audio.select();
      const rows: HTMLElement[] = [];
      const lineup = team.players.map((p, i) => ({ p, i }));
      let sum = 0;
      lineup.forEach(({ p, i }, k) => {
        const d = talkEffect(chosen!, tone, p.personality, ctx) * 0.9;
        morale[i] = clamp(morale[i] + d, -3, 3);
        sum += d;
        rows.push(
          h(
            'div',
            { class: 'reaction', style: `animation-delay:${k * 0.05}s` },
            h('span', { class: 'who' }, `${p.num} ${p.name}`, ' ', h('span', { class: 'chip' }, PERSONALITY_LABEL[p.personality])),
            deltaTag(d),
            h('span', { class: 'say' }, `${reactionText(d, p.personality)} · 사기 ${moraleLabel(morale[i])}`),
          ),
        );
      });
      const avg = sum / lineup.length;
      reactBox.append(
        h('p', { style: 'margin-bottom:8px' }, avg > 0.45 ? '라커룸이 함성으로 가득 찼다!' : avg > 0.1 ? '선수들이 고개를 끄덕이며 일어선다.' : avg > -0.2 ? '반응이 엇갈린다.' : '라커룸에 무거운 침묵이 흐른다…'),
        h('div', { class: 'reactions' }, rows),
      );
      cont.style.display = '';
      cont.focus();
    });
    return h(
      'div',
      { class: 'grid two', style: 'align-items:start' },
      h(
        'div',
        { class: 'panel', style: 'display:flex;flex-direction:column;gap:12px' },
        h('div', { class: 'eyebrow' }, title),
        h('div', null, h('div', { class: 'field-label' }, '어조'), toneSeg, toneDesc),
        h('div', null, h('div', { class: 'field-label' }, '무슨 말을 할까?'), opts),
        h('div', { class: 'row end' }, h('button', { class: 'btn ghost', type: 'button', onclick: () => (this.click(), onDone()) }, '말없이 넘어가기'), deliver, cont),
      ),
      h('div', { class: 'panel', style: 'display:flex;flex-direction:column;gap:10px' }, extra ?? null, h('h3', null, '선수 반응'), reactBox.childElementCount ? reactBox : reactBox, h('p', { class: 'muted', style: 'font-size:12px' }, '성격에 따라 같은 말도 다르게 받아들입니다. 예민한 선수는 압박에 약하고, 승부욕 있는 선수는 강한 요구에 불이 붙습니다.')),
    );
  }

  private acePanel(name: string, idx: number, pers: TeamDef['players'][number]['personality'], ctx: TalkContext, morale: number[], onDone: (gauge: number) => void) {
    let gauge = 0;
    const res = h('div', null);
    const go = h('button', { class: 'btn primary', type: 'button', onclick: () => (this.click(), onDone(gauge)) }, '킥오프!');
    const answers = h(
      'div',
      { class: 'answers' },
      ACE_TALKS.map((o) =>
        h(
          'button',
          {
            type: 'button',
            class: 'answer',
            onclick: (e: Event) => {
              if (answers.dataset.done) return;
              answers.dataset.done = '1';
              (e.currentTarget as HTMLElement).classList.add('on');
              this.click();
              const d = talkEffect(o, 'calm', pers, ctx);
              morale[idx] = clamp(morale[idx] + d, -3, 3);
              if (o.id === 'hero' && d > 0.3) gauge = 25;
              res.append(
                h(
                  'div',
                  { class: 'reaction' },
                  h('span', { class: 'who' }, name),
                  deltaTag(d),
                  h('span', { class: 'say' }, `${reactionText(d, pers)}${gauge ? ' — 필살 게이지 25%로 시작!' : ''}`),
                ),
              );
              go.focus();
            },
          },
          `“${o.text}”`,
        ),
      ),
    );
    return h(
      'div',
      { class: 'panel', style: 'display:flex;flex-direction:column;gap:12px;max-width:760px' },
      h('div', { class: 'eyebrow' }, '에이스와 1:1 면담'),
      h('h3', null, `${name} (${PERSONALITY_LABEL[pers]})`),
      h('p', { class: 'muted', style: 'font-size:13px' }, PERSONALITY_DESC[pers]),
      answers,
      res,
      h('div', { class: 'row end' }, go),
    );
  }

  // ───────────────────────────── 경기 ─────────────────────────────

  startMatch() {
    const st = this.setup!;
    this.demo = null;
    const cfg: MatchConfig = {
      home: st.home,
      away: st.away,
      humanSide: st.humanSide,
      halfMinutes: this.mode === 'tournament' && this.tour ? this.tour.halfMinutes : this.settings.halfMinutes,
      difficulty: this.mode === 'tournament' && this.tour ? this.tour.difficulty : this.settings.difficulty,
      homeTactics: { ...st.userTactics },
      awayTactics: { ...st.cpuTactics },
      homeMorale: st.userMorale.slice(),
      awayMorale: st.cpuMorale.slice(),
      knockout: st.knockout,
      stageName: st.stageName,
      night: st.night,
    };
    // 콜백은 지연 실행되므로, 그 사이 경기를 나갔다면 무시한다
    const m: Match = new Match(cfg, this.input, {
      onHalfTime: () => this.match === m && this.showHalfTime(),
      onFullTime: () => this.match === m && this.showFullTime(),
      onShootoutEnd: () => this.match === m && this.showFullTime(),
      onPause: () => this.pauseMatch(),
    });
    m.replayEnabled = this.settings.replay;
    m.haptics = this.settings.vibrate;
    if (st.humanSide === 0) m.teams[0].gauge = st.startGauge;
    this.match = m;
    this.hideUi();
    audio.init();
    audio.crowd(0.4);
    audio.roar(0.6);
  }

  pauseMatch() {
    const m = this.match;
    if (!m || m.paused || m.phase === 'halftime' || m.phase === 'fulltime' || m.shootout?.stage === 'done') return;
    m.paused = true;
    const user = m.humanTeam;
    let confirmExit = false;
    const shoutDefs: { id: '' | 'press' | 'calm' | 'attack' | 'defend'; label: string; desc: string }[] = [
      { id: 'press', label: '더 압박해!', desc: '전방 압박과 태클 빈도 증가' },
      { id: 'attack', label: '앞으로 나가!', desc: '라인을 올리고 침투를 늘린다' },
      { id: 'defend', label: '수비 집중!', desc: '라인을 내리고 공간을 지운다' },
      { id: 'calm', label: '침착하게!', desc: '지시 해제, 평소대로' },
    ];
    const render = () => {
      const shouts = user
        ? h(
            'div',
            { class: 'shouts' },
            shoutDefs.map((s) =>
              h(
                'button',
                {
                  type: 'button',
                  class: 'shout' + ((user.shout || 'calm') === s.id ? ' on' : ''),
                  onclick: () => {
                    this.click();
                    user.shout = s.id === 'calm' ? '' : s.id;
                    m.say(`${user.def.manager} 감독: "${s.label}"`);
                    render();
                  },
                },
                s.label,
                h('small', null, s.desc),
              ),
            ),
          )
        : null;
      const mentality = user ? h('div', null, h('div', { class: 'field-label' }, '공수 성향'), seg(MENTALITY, user.tactics.mentality, (v) => (user.tactics.mentality = v), 'pause-ment')) : null;
      const exitBox = confirmExit
        ? h(
            'div',
            { class: 'confirm' },
            h('span', null, this.mode === 'tournament' ? '이 경기는 기록되지 않습니다. 이어하기로 같은 경기를 처음부터 다시 치를 수 있어요.' : '경기를 끝내고 타이틀로 갈까요?'),
            h('button', { class: 'btn', type: 'button', onclick: () => this.abandonMatch() }, '나가기'),
            h('button', { class: 'btn ghost', type: 'button', onclick: () => ((confirmExit = false), render()) }, '취소'),
          )
        : null;
      this.show(
        h(
          'div',
          { class: 'screen pause see-through' },
          h(
            'div',
            { class: 'panel' },
            h('div', { class: 'eyebrow' }, `일시정지 · ${m.minute}'`),
            h('h2', null, `${m.teams[0].def.short} ${m.teams[0].goals} - ${m.teams[1].goals} ${m.teams[1].def.short}`),
            user ? h('h3', null, '터치라인 지시') : null,
            shouts,
            mentality,
            exitBox,
            h(
              'div',
              { class: 'row end' },
              h('button', { class: 'btn ghost', type: 'button', onclick: () => ((confirmExit = true), render()) }, '경기 나가기'),
              h('button', { class: 'btn ghost', type: 'button', onclick: () => this.showControls(() => render()) }, '조작법'),
              h('button', { class: 'btn primary', type: 'button', 'data-autofocus': true, onclick: () => this.resumeMatch() }, '계속하기'),
            ),
          ),
        ),
      );
    };
    render();
  }

  resumeMatch() {
    const m = this.match;
    if (!m || !m.paused) return;
    this.hideUi();
    m.paused = false;
    m.resumedAt = m.realTime;
  }

  abandonMatch() {
    const m = this.match;
    if (!m) return;
    // 토너먼트는 경기 전 상태로 저장돼 있으므로 기록 없이 나간다 (새로고침과 같은 결과)
    this.match = null;
    this.startDemo();
    this.showTitle();
  }

  // ───────────────────────────── 하프타임 ─────────────────────────────

  private statsPanel(m: Match) {
    const [a, b] = m.teams;
    const total = a.stats.possessionTime + b.stats.possessionTime || 1;
    const poss = [Math.round((a.stats.possessionTime / total) * 100), 0];
    poss[1] = 100 - poss[0];
    const pct = (s: TeamStats) => (s.passes ? Math.round((s.passesDone / s.passes) * 100) : 0);
    const row = (label: string, va: number, vb: number, suffix = '') => {
      const t = va + vb || 1;
      return h(
        'div',
        { class: 'stat' },
        h('span', { class: 'lbl' }, label),
        h('span', { class: 'v' }, `${va}${suffix}`),
        h('div', { class: 'split' }, h('i', { style: `width:${(va / t) * 100}%;background:${a.kit.shirt}` }), h('i', { style: `width:${(vb / t) * 100}%;background:${b.kit.shirt}` })),
        h('span', { class: 'v r' }, `${vb}${suffix}`),
      );
    };
    return h(
      'div',
      { class: 'stats' },
      row('점유율', poss[0], poss[1], '%'),
      row('슈팅', a.stats.shots, b.stats.shots),
      row('유효 슈팅', a.stats.onTarget, b.stats.onTarget),
      row('패스 성공률', pct(a.stats), pct(b.stats), '%'),
      row('태클 성공', a.stats.tackles, b.stats.tackles),
      row('코너킥', a.stats.corners, b.stats.corners),
      row('선방', a.stats.saves, b.stats.saves),
      row('필살기', a.stats.specials, b.stats.specials),
    );
  }

  private scoreline(m: Match, showPens = false) {
    const [a, b] = m.teams;
    const scorers = (side: 0 | 1) => m.goals.filter((g) => g.side === side).map((g) => h('span', null, `${g.scorer} ${g.minute}'${g.special ? ' (필살기)' : ''}${g.penalty ? ' (PK)' : ''}`));
    return h(
      'div',
      { class: 'scoreline' },
      h('div', { class: 'side' }, crest(a.def, 'lg'), h('div', { class: 'nm' }, a.def.name), h('div', { class: 'scorers' }, scorers(0))),
      h('div', null, h('div', { class: 'big' }, `${a.goals} : ${b.goals}`), showPens && m.shootout ? h('div', { class: 'pens' }, `승부차기 ${a.pens} : ${b.pens}`) : null),
      h('div', { class: 'side' }, crest(b.def, 'lg'), h('div', { class: 'nm' }, b.def.name), h('div', { class: 'scorers' }, scorers(1))),
    );
  }

  private ratingsPanel(m: Match, side: 0 | 1) {
    const t = m.teams[side];
    const r = m.ratings()[side];
    const list = t.players
      .map((p) => ({ p, r: r[t.def.players.indexOf(p.def)] }))
      .sort((x, y) => y.r - x.r);
    return h(
      'div',
      { class: 'ratings' },
      list.map(({ p, r: rr }) =>
        h(
          'div',
          { class: 'r' },
          h('span', { class: 'pos', style: 'font-family:var(--font-num);font-size:11px;color:var(--cyan)' }, p.slot.label),
          h('span', { class: 'nm' }, p.def.name, p.st.goals ? ` ⚽${p.st.goals > 1 ? '×' + p.st.goals : ''}` : ''),
          h('b', { style: `color:${rr >= 7.5 ? 'var(--good)' : rr < 6 ? 'var(--bad)' : 'var(--text)'}` }, rr.toFixed(1)),
        ),
      ),
    );
  }

  showHalfTime() {
    const m = this.match!;
    m.paused = false;
    const user = m.humanTeam;
    // CPU 하프타임 조정
    for (const t of m.teams) {
      if (t.human) continue;
      const diff = t.goals - m.opp(t).goals;
      if (diff < 0) t.tactics.mentality = Math.min(2, t.tactics.mentality + 1);
      if (diff > 1) t.tactics.mentality = Math.max(-1, t.tactics.mentality - 1);
      for (const p of t.players) p.morale = clamp(p.morale + rand(-0.3, 0.4) + (diff < 0 ? 0.15 : 0), -3, 3);
    }
    if (!user) {
      setTimeout(() => this.match === m && m.startSecondHalf(), 300);
      return;
    }
    const st = this.setup!;
    const tactics: Tactics = { ...user.tactics };
    const morale = user.def.players.map((d) => user.players.find((p) => p.def === d)?.morale ?? 0);
    const ctx: TalkContext = { favorite: overall(user.def) - overall(m.opp(user).def), scoreDiff: user.goals - m.opp(user).goals, stage: st.stageIdx };
    let aceGauge = 0;
    const tacticsBox = h(
      'div',
      { class: 'panel', style: 'display:flex;flex-direction:column;gap:12px' },
      h('h3', null, '후반 전술'),
      h('div', null, h('div', { class: 'field-label' }, '포메이션'), seg(FORMATION_IDS.map((f) => ({ v: f, label: f })), tactics.formation, (v) => (tactics.formation = v), 'ht-form')),
      h('div', null, h('div', { class: 'field-label' }, '공수 성향'), seg(MENTALITY, tactics.mentality, (v) => (tactics.mentality = v), 'ht-ment')),
      h('div', null, h('div', { class: 'field-label' }, '압박 강도'), seg(PRESSING, tactics.pressing, (v) => (tactics.pressing = v), 'ht-press')),
    );
    const startSecond = () => {
      m.applyTactics(user.side, tactics);
      m.setMorale(user.side, morale);
      user.gauge = clamp(user.gauge + aceGauge, 0, 100);
      this.hideUi();
      m.startSecondHalf();
    };
    const aceDef = user.def.players.find((p) => p.ace)!;
    const aceIdx = user.def.players.indexOf(aceDef);
    const render = (stage: 'talk' | 'ace') => {
      const body =
        stage === 'talk'
          ? this.talkPanel(HALF_TALKS, ctx, user.def, morale, '하프타임 팀 토크', () => render('ace'))
          : this.acePanel(aceDef.name, aceIdx, aceDef.personality, ctx, morale, (g) => {
              aceGauge = g;
              startSecond();
            });
      this.show(
        h(
          'div',
          { class: 'screen' },
          h(
            'div',
            { class: 'wrap' },
            h('div', { class: 'eyebrow' }, `${st.stageName} · 하프타임`),
            this.scoreline(m),
            body,
            stage === 'ace' ? h('div', { class: 'row end' }, h('button', { class: 'btn ghost', type: 'button', onclick: () => (this.click(), startSecond()) }, '면담 없이 후반 시작')) : null,
            h('div', { class: 'grid three', style: 'align-items:start' }, tacticsBox, h('div', { class: 'panel' }, h('h3', { style: 'margin-bottom:12px' }, '전반 기록'), this.statsPanel(m)), h('div', { class: 'panel' }, h('h3', { style: 'margin-bottom:12px' }, '전반 평점'), this.ratingsPanel(m, user.side))),
          ),
        ),
      );
    };
    render('talk');
  }

  // ───────────────────────────── 경기 종료 ─────────────────────────────

  showFullTime() {
    const m = this.match!;
    m.paused = false;
    const res = m.result();
    const user = m.humanTeam;
    const draw = res.homeGoals === res.awayGoals;
    const needPens = m.cfg.knockout && draw && !m.shootout;
    if (needPens) {
      this.show(
        h(
          'div',
          { class: 'screen see-through', style: 'justify-content:center' },
          h(
            'div',
            { class: 'wrap', style: 'max-width:720px;align-items:center;text-align:center' },
            h('div', { class: 'eyebrow' }, '정규 시간 종료'),
            this.scoreline(m),
            h('h2', null, '승부차기로 승자를 가립니다'),
            h(
              'p',
              { class: 'muted' },
              !user
                ? 'CPU끼리의 승부차기입니다.'
                : this.touchOn()
                  ? '키커일 때: 스틱으로 조준하고 슛 버튼을 길게 눌렀다 떼세요. 키퍼일 때: 스틱으로 다이빙 방향을 고르고 확정 버튼을 누르세요.'
                  : '키커일 때: 방향키로 조준하고 K를 길게 눌렀다 떼세요. 키퍼일 때: 방향키로 다이빙 방향을 고르고 K로 확정하세요.',
            ),
            h(
              'div',
              { class: 'row center' },
              h(
                'button',
                {
                  class: 'btn hot',
                  type: 'button',
                  'data-autofocus': true,
                  onclick: () => {
                    this.click();
                    this.hideUi();
                    m.startShootout();
                  },
                },
                '승부차기 시작',
              ),
            ),
          ),
        ),
      );
      return;
    }
    const momTeam = m.teams[res.mom.side];
    const momDef = momTeam.def.players[res.mom.index];
    const userWon = user ? (res.homeGoals !== res.awayGoals ? (user.side === 0 ? res.homeGoals > res.awayGoals : res.awayGoals > res.homeGoals) : (user.side === 0 ? (res.homePens ?? 0) > (res.awayPens ?? 0) : (res.awayPens ?? 0) > (res.homePens ?? 0))) : false;
    let actions: HTMLElement;
    let headline = '경기 종료';
    if (this.mode === 'tournament' && this.tour && user) {
      const tour = this.tour;
      const isFinal = tour.round === 2;
      const played = tour.round;
      recordUserMatch(tour, m.cfg.home.id, m.cfg.away.id, res);
      // 사기 반영
      const morale = user.def.players.map((d) => user.players.find((p) => p.def === d)?.morale ?? 0);
      tour.morale = morale.map((x) => clamp(x * 0.55 + (userWon ? 0.45 : -0.2), -3, 3));
      if (tour.eliminated) {
        simulateRest(tour);
        saveTournament(null);
        headline = isFinal ? '준우승' : `${ROUND_NAMES[played]} 탈락`;
        actions = h(
          'div',
          { class: 'row end' },
          h('button', { class: 'btn', type: 'button', onclick: () => (this.click(), this.showBracket()) }, '최종 대진표 보기'),
          h('button', { class: 'btn primary', type: 'button', onclick: () => (this.click(), this.leaveMatch(), this.showTitle()) }, '타이틀로'),
        );
      } else if (isFinal) {
        saveTournament(null);
        headline = '우승!!';
        actions = h('div', { class: 'row end' }, h('button', { class: 'btn hot', type: 'button', 'data-autofocus': true, onclick: () => (this.click(), this.showChampion()) }, '시상식으로'));
        m.celebrateTeam = user.side;
      } else {
        saveTournament(tour);
        headline = `${ROUND_NAMES[played]} 승리! ${ROUND_NAMES[played + 1]} 진출`;
        actions = h('div', { class: 'row end' }, h('button', { class: 'btn primary', type: 'button', 'data-autofocus': true, onclick: () => (this.click(), this.showPostTalk()) }, '경기 후 라커룸'));
        m.celebrateTeam = user.side;
      }
    } else {
      if (user && userWon) m.celebrateTeam = user.side;
      headline = user ? (userWon ? '승리!' : draw ? '무승부' : '패배') : '경기 종료';
      actions = h(
        'div',
        { class: 'row end' },
        h('button', { class: 'btn', type: 'button', onclick: () => (this.click(), this.leaveMatch(), this.showTitle()) }, '타이틀로'),
        h(
          'button',
          {
            class: 'btn primary',
            type: 'button',
            onclick: () => {
              this.click();
              const st = this.setup!;
              this.prepareMatch(st.home, st.away, st.humanSide === -1 ? -1 : 0, st.stageName, 0, false);
            },
          },
          '한 판 더',
        ),
      );
    }
    this.show(
      h(
        'div',
        { class: 'screen' },
        h(
          'div',
          { class: 'wrap' },
          h('div', { class: 'eyebrow' }, `${m.cfg.stageName} · 경기 종료`),
          h('h2', { style: 'text-align:center' }, headline),
          this.scoreline(m, true),
          h('div', { class: 'mom' }, h('span', { class: 'chip ace' }, 'MOM'), h('b', null, momDef.name), h('span', { class: 'muted' }, `${momTeam.def.name} · 평점 ${res.mom.rating.toFixed(1)}`)),
          h(
            'div',
            { class: 'grid three', style: 'align-items:start' },
            h('div', { class: 'panel' }, h('h3', { style: 'margin-bottom:12px' }, '경기 기록'), this.statsPanel(m)),
            h('div', { class: 'panel' }, h('h3', { style: 'margin-bottom:12px' }, `${m.teams[0].def.name} 평점`), this.ratingsPanel(m, 0)),
            h('div', { class: 'panel' }, h('h3', { style: 'margin-bottom:12px' }, `${m.teams[1].def.name} 평점`), this.ratingsPanel(m, 1)),
          ),
          actions,
        ),
      ),
    );
  }

  private leaveMatch() {
    this.match = null;
    this.startDemo();
  }

  showPostTalk() {
    const m = this.match!;
    const user = m.humanTeam!;
    const tour = this.tour!;
    const ctx: TalkContext = { favorite: 0, scoreDiff: 1, stage: tour.round };
    const morale = tour.morale;
    this.show(
      h(
        'div',
        { class: 'screen' },
        h(
          'div',
          { class: 'wrap' },
          h('div', { class: 'eyebrow' }, '경기 후 라커룸'),
          h('h2', null, `${ROUND_NAMES[tour.round]}을 앞두고 한마디`),
          this.talkPanel(POST_TALKS, ctx, user.def, morale, '경기 후 팀 토크', () => {
            saveTournament(tour);
            this.leaveMatch();
            this.showBracket();
          }),
        ),
      ),
    );
  }

  showChampion() {
    const m = this.match;
    const tour = this.tour!;
    const t = teamById(tour.userTeam);
    if (m) {
      m.celebrateTeam = m.humanTeam?.side ?? 0;
    }
    const path = tour.results.filter((r) => r.user);
    const trophy = h('div', { class: 'trophy', role: 'img', 'aria-label': '우승 트로피' });
    trophy.innerHTML = `<svg viewBox="0 0 120 160" width="100%" height="100%"><defs><linearGradient id="tg" x1="0" x2="1"><stop offset="0" stop-color="#b8860b"/><stop offset=".45" stop-color="#ffe9a3"/><stop offset=".6" stop-color="#ffd34d"/><stop offset="1" stop-color="#a8720a"/></linearGradient></defs><path d="M30 14h60v26c0 22-12 38-30 42-18-4-30-20-30-42z" fill="url(#tg)"/><path d="M30 22H14c0 18 8 28 20 30M90 22h16c0 18-8 28-20 30" fill="none" stroke="url(#tg)" stroke-width="7"/><rect x="54" y="80" width="12" height="30" fill="url(#tg)"/><path d="M36 110h48l6 16H30z" fill="url(#tg)"/><rect x="26" y="126" width="68" height="22" rx="3" fill="#2a1d0a"/><text x="60" y="141" text-anchor="middle" font-size="9" fill="#ffd34d" font-family="sans-serif">LEGEND CUP</text><circle cx="60" cy="42" r="12" fill="none" stroke="#fff6c9" stroke-width="2" opacity=".8"/><path d="M60 33l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z" fill="#fff6c9"/></svg>`;
    this.show(
      h(
        'div',
        { class: 'screen see-through' },
        h(
          'div',
          { class: 'wrap trophy-wrap', style: 'max-width:760px' },
          h('div', { class: 'eyebrow' }, 'Legend Cup 2026 Champion'),
          trophy,
          h('div', { class: 'champion-title' }, `${t.name} 우승!`),
          h('p', { class: 'muted' }, `${t.manager} 감독과 ${t.nick}가 정상에 올랐습니다.`),
          h(
            'div',
            { class: 'panel', style: 'width:100%;display:flex;flex-direction:column;gap:6px;text-align:left' },
            path.map((r) => {
              const oppId = r.home === tour.userTeam ? r.away : r.home;
              const us = r.home === tour.userTeam ? r.hg : r.ag;
              const them = r.home === tour.userTeam ? r.ag : r.hg;
              const pens = r.hp !== undefined ? ` (승부차기 ${r.home === tour.userTeam ? r.hp : r.ap}:${r.home === tour.userTeam ? r.ap : r.hp})` : '';
              return h('div', { class: 'row', style: 'justify-content:space-between' }, h('span', null, `${ROUND_NAMES[r.round]} vs ${teamById(oppId).name}`), h('b', { style: 'font-family:var(--font-num)' }, `${us} : ${them}${pens}`));
            }),
          ),
          h('div', { class: 'row center' }, h('button', { class: 'btn primary', type: 'button', onclick: () => (this.click(), this.leaveMatch(), this.showTitle()) }, '타이틀로')),
        ),
      ),
    );
    audio.fanfare();
  }
}
