import type { Action, Input } from '../game/input';
import { h } from './dom';

/** 터치 화면에 보여줄 상황 */
export type TouchMode = 'attack' | 'defense' | 'setpiece' | 'kickoff' | 'shootout-shoot' | 'shootout-keep' | 'duel' | 'hidden';

export interface TouchContext {
  mode: TouchMode;
  /** 세트피스 종류 (corner, throw …) */
  setpiece?: string;
  specialReady: boolean;
  tackleReady: boolean;
  /** 측면 공격 지역: 로빙 → 크로스 */
  crossZone?: boolean;
  /** 필살 타이밍 대결 중 슛 버튼 이름 */
  duelLabel?: string;
}

interface BtnDef {
  key: string;
  action: Action;
  size: number;
  right: number;
  bottom: number;
  cls?: string;
}

// 오른손 엄지가 닿는 부채꼴 배치 (오른쪽 아래 기준 px)
const BTNS: BtnDef[] = [
  { key: 'shoot', action: 'shoot', size: 64, right: 16, bottom: 22, cls: 'primary' },
  { key: 'pass', action: 'pass', size: 52, right: 92, bottom: 14 },
  { key: 'through', action: 'through', size: 46, right: 24, bottom: 98 },
  { key: 'lob', action: 'lob', size: 44, right: 84, bottom: 78 },
  { key: 'sprint', action: 'sprint', size: 44, right: 156, bottom: 16 },
  { key: 'skill', action: 'skill', size: 40, right: 146, bottom: 70 },
  { key: 'special', action: 'special', size: 44, right: 28, bottom: 158, cls: 'sp' },
];

const LABELS: Record<string, Record<string, string>> = {
  attack: { shoot: '슛', pass: '패스', through: '스루', lob: '로빙', sprint: '질주', skill: '개인기', special: '필살' },
  defense: { shoot: '태클', pass: '전환', through: '슬라이딩', lob: '압박', sprint: '질주', special: '필살태클' },
  kickoff: { pass: '킥오프', through: '스루', lob: '로빙' },
  'shootout-shoot': { shoot: '슛' },
  'shootout-keep': { shoot: '확정' },
};

const SETPIECE_LABELS: Record<string, Record<string, string>> = {
  throw: { pass: '스로인', lob: '멀리' },
  corner: { pass: '짧게', lob: '크로스' },
  goalkick: { pass: '짧게', lob: '롱킥', through: '스루' },
  freekick: { shoot: '슛', pass: '패스', lob: '로빙', through: '스루' },
  penalty: { shoot: '슛' },
  kickoff: { pass: '킥오프', through: '스루', lob: '로빙' },
};

/** 터치 기기용: 손가락을 댄 곳에 생기는 조이스틱 + 작은 반투명 버튼 */
export class TouchControls {
  root: HTMLElement;
  private input: Input;
  private stickId: number | null = null;
  private zone: HTMLElement;
  private base: HTMLElement;
  private knob: HTMLElement;
  private hint: HTMLElement;
  private origin = { x: 0, y: 0 };
  private buttons = new Map<string, HTMLButtonElement>();
  private ctxKey = '';
  private shootStart: { x: number; y: number } | null = null;

  constructor(parent: HTMLElement, input: Input, onPause: () => void) {
    this.input = input;
    this.knob = h('div', { class: 'knob' });
    this.base = h('div', { class: 'stick-base' }, this.knob);
    this.hint = h('div', { class: 'stick-hint', 'aria-hidden': 'true' }, '이동');
    this.zone = h('div', { class: 'stick-zone', 'aria-label': '이동: 왼쪽 화면을 누른 채 끌기' }, this.base, this.hint);
    const pad = h('div', { class: 'pad' });
    for (const d of BTNS) {
      const b = h('button', { type: 'button', class: `tbtn ${d.cls ?? ''}`, style: `width:${d.size}px;height:${d.size}px;right:${d.right}px;bottom:${d.bottom}px` }) as HTMLButtonElement;
      this.bind(b, d);
      this.buttons.set(d.key, b);
      pad.appendChild(b);
    }
    const pause = h('button', { type: 'button', class: 'pause-btn', 'aria-label': '일시정지', onclick: onPause }, 'II');
    this.root = h('div', { id: 'touch' }, this.zone, pad, pause);
    parent.appendChild(this.root);

    this.zone.addEventListener('pointerdown', (e) => {
      if (this.stickId !== null) return;
      this.stickId = e.pointerId;
      this.zone.setPointerCapture(e.pointerId);
      const r = this.zone.getBoundingClientRect();
      this.origin = { x: e.clientX, y: e.clientY };
      this.base.style.left = `${e.clientX - r.left}px`;
      this.base.style.top = `${e.clientY - r.top}px`;
      this.base.classList.add('on');
      this.hint.classList.add('off');
      this.move(e);
    });
    this.zone.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stickId) this.move(e);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.base.classList.remove('on');
      this.knob.style.transform = '';
      input.setVirtualAxis(0, 0);
    };
    this.zone.addEventListener('pointerup', end);
    this.zone.addEventListener('pointercancel', end);
  }

  private bind(b: HTMLButtonElement, d: BtnDef) {
    const input = this.input;
    const on = (e: PointerEvent) => {
      e.preventDefault();
      b.setPointerCapture(e.pointerId);
      b.classList.add('on');
      if (d.key === 'shoot') this.shootStart = { x: e.clientX, y: e.clientY };
      input.setVirtual(d.action, true);
    };
    const off = (e: PointerEvent) => {
      e.preventDefault();
      if (!b.classList.contains('on')) {
        // 버튼이 숨겨지는 사이에 손을 뗀 경우에도 입력은 반드시 풀어 준다
        input.setVirtual(d.action, false);
        return;
      }
      b.classList.remove('on');
      // 슛 버튼에서 위로 밀어 떼면 칩슛, 옆으로 밀어 떼면 감아차기
      if (d.key === 'shoot' && this.shootStart) {
        const dx = e.clientX - this.shootStart.x;
        const dy = e.clientY - this.shootStart.y;
        const mod: Action | null = dy < -28 && Math.abs(dy) > Math.abs(dx) ? 'chip' : Math.abs(dx) > 28 ? 'finesse' : null;
        if (mod) {
          input.setVirtual(mod, true);
          setTimeout(() => input.setVirtual(mod, false), 120);
        }
        this.shootStart = null;
      }
      input.setVirtual(d.action, false);
    };
    b.addEventListener('pointerdown', on);
    b.addEventListener('pointerup', off);
    b.addEventListener('pointercancel', off);
  }

  private move(e: PointerEvent) {
    const R = 46;
    let dx = (e.clientX - this.origin.x) / R;
    let dy = (e.clientY - this.origin.y) / R;
    const l = Math.hypot(dx, dy);
    if (l > 1) {
      dx /= l;
      dy /= l;
    }
    this.knob.style.transform = `translate(${dx * 30}px, ${dy * 30}px)`;
    const dead = 0.18;
    this.input.setVirtualAxis(l < dead ? 0 : dx, l < dead ? 0 : dy);
  }

  /** 매 프레임 호출: 상황이 바뀔 때만 라벨·표시를 갱신 */
  update(c: TouchContext) {
    const key = `${c.mode}|${c.setpiece ?? ''}|${c.specialReady}|${c.tackleReady}|${c.crossZone ?? false}|${c.duelLabel ?? ''}`;
    if (key === this.ctxKey) return;
    this.ctxKey = key;
    this.root.dataset.mode = c.mode;
    let labels = c.mode === 'setpiece' ? SETPIECE_LABELS[c.setpiece ?? ''] ?? {} : LABELS[c.mode] ?? {};
    if (c.mode === 'attack' && c.crossZone) labels = { ...labels, lob: '크로스' };
    if (c.mode === 'duel') labels = { shoot: c.duelLabel ?? '타이밍!' };
    for (const [k, b] of this.buttons) {
      const label = labels[k];
      b.hidden = !label;
      if (!label) continue;
      b.textContent = label;
      b.classList.toggle('ready', k === 'special' && (c.mode === 'defense' ? c.tackleReady : c.specialReady));
      b.classList.toggle('dim', k === 'special' && !(c.mode === 'defense' ? c.tackleReady : c.specialReady));
      b.setAttribute('aria-label', label);
    }
    this.zone.hidden = c.mode === 'shootout-shoot' || c.mode === 'shootout-keep' ? false : c.mode === 'hidden' || c.mode === 'duel';
  }

  show(on: boolean) {
    this.root.classList.toggle('on', on);
    if (!on) {
      this.input.setVirtualAxis(0, 0);
      this.stickId = null;
      this.base.classList.remove('on');
      for (const d of BTNS) {
        const b = this.buttons.get(d.key)!;
        if (b.classList.contains('on')) this.input.setVirtual(d.action, false);
        b.classList.remove('on');
      }
    }
  }
}

export const isTouch = () => {
  try {
    return window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  } catch {
    return false;
  }
};
