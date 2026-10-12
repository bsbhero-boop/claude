// 키보드 + 게임패드 입력. 액션 이름 단위로 눌림/뗌 엣지를 제공한다.

export type Action =
  | 'pass'
  | 'shoot'
  | 'through'
  | 'lob'
  | 'skill'
  | 'special'
  | 'sprint'
  | 'finesse'
  | 'chip'
  | 'pause';

const KEYMAP: Record<string, Action> = {
  KeyJ: 'pass',
  KeyK: 'shoot',
  KeyL: 'through',
  KeyI: 'lob',
  KeyU: 'skill',
  Space: 'special',
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint',
  KeyE: 'finesse',
  KeyQ: 'chip',
  Escape: 'pause',
  KeyP: 'pause',
  // 방향키 사용자를 위한 보조 배치
  KeyZ: 'pass',
  KeyX: 'shoot',
  KeyC: 'through',
  KeyV: 'lob',
};

// 표준 게임패드 매핑 (Xbox 배치 기준)
const PADMAP: [number, Action][] = [
  [0, 'pass'],
  [1, 'shoot'],
  [3, 'through'],
  [2, 'lob'],
  [6, 'skill'],
  [4, 'special'],
  [7, 'sprint'],
  [5, 'finesse'],
  [11, 'chip'],
  [9, 'pause'],
];

export class Input {
  private keys = new Set<string>();
  private down = new Map<Action, boolean>();
  private prev = new Map<Action, boolean>();
  private holdStart = new Map<Action, number>();
  private padAxes = { x: 0, y: 0 };
  private anyPressedFlag = false;
  time = 0;
  /** 메뉴 등 DOM 화면에서는 게임 입력을 막는다 */
  enabled = true;
  /** 터치 컨트롤이 넣는 가상 입력 */
  private virtual = new Set<Action>();
  private vAxis = { x: 0, y: 0 };

  setVirtual(a: Action, on: boolean) {
    if (on) {
      if (!this.virtual.has(a)) this.anyPressedFlag = true;
      this.virtual.add(a);
    } else this.virtual.delete(a);
  }

  setVirtualAxis(x: number, y: number) {
    this.vAxis = { x, y };
  }

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (e.code in KEYMAP || e.code.startsWith('Arrow') || ['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) {
        e.preventDefault();
      }
      if (!e.repeat) this.anyPressedFlag = true;
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => this.keys.clear());
  }

  /** 프레임 시작에 호출: 엣지 계산 */
  poll(dt: number) {
    this.time += dt;
    for (const [a, v] of this.down) this.prev.set(a, v);
    const now = new Map<Action, boolean>();
    for (const code of this.keys) {
      const a = KEYMAP[code];
      if (a) now.set(a, true);
    }
    for (const a of this.virtual) now.set(a, true);
    this.padAxes = { x: 0, y: 0 };
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad) continue;
      for (const [btn, a] of PADMAP) {
        const b = pad.buttons[btn];
        if (b && (b.pressed || b.value > 0.5)) {
          now.set(a, true);
          if (!this.prev.get(a)) this.anyPressedFlag = true;
        }
      }
      const ax = pad.axes[0] ?? 0;
      const ay = pad.axes[1] ?? 0;
      if (Math.hypot(ax, ay) > 0.2) this.padAxes = { x: ax, y: ay };
      // D-pad
      if (pad.buttons[14]?.pressed) this.padAxes.x = -1;
      if (pad.buttons[15]?.pressed) this.padAxes.x = 1;
      if (pad.buttons[12]?.pressed) this.padAxes.y = -1;
      if (pad.buttons[13]?.pressed) this.padAxes.y = 1;
      break;
    }
    const all: Action[] = ['pass', 'shoot', 'through', 'lob', 'skill', 'special', 'sprint', 'finesse', 'chip', 'pause'];
    for (const a of all) {
      const v = !!now.get(a);
      if (v && !this.down.get(a)) this.holdStart.set(a, this.time);
      this.down.set(a, v);
    }
  }

  held(a: Action) {
    return !!this.down.get(a);
  }
  pressed(a: Action) {
    return !!this.down.get(a) && !this.prev.get(a);
  }
  released(a: Action) {
    return !this.down.get(a) && !!this.prev.get(a);
  }
  holdTime(a: Action) {
    const s = this.holdStart.get(a);
    if (s === undefined) return 0;
    return this.time - s;
  }

  /** 화면 기준 방향 입력 (x: 오른쪽+, y: 아래+) */
  axis() {
    let x = 0;
    let y = 0;
    const k = this.keys;
    if (k.has('ArrowLeft') || k.has('KeyA')) x -= 1;
    if (k.has('ArrowRight') || k.has('KeyD')) x += 1;
    if (k.has('ArrowUp') || k.has('KeyW')) y -= 1;
    if (k.has('ArrowDown') || k.has('KeyS')) y += 1;
    if (x === 0 && y === 0) {
      x = this.padAxes.x;
      y = this.padAxes.y;
    }
    if (x === 0 && y === 0) {
      x = this.vAxis.x;
      y = this.vAxis.y;
    }
    const l = Math.hypot(x, y);
    if (l > 1) {
      x /= l;
      y /= l;
    }
    return { x, y, mag: Math.min(1, l) };
  }

  anyPressed() {
    const f = this.anyPressedFlag;
    this.anyPressedFlag = false;
    return f;
  }

  clearEdges() {
    for (const [a, v] of this.down) this.prev.set(a, v);
    this.anyPressedFlag = false;
  }

  reset() {
    this.keys.clear();
    this.virtual.clear();
    this.vAxis = { x: 0, y: 0 };
    this.down.clear();
    this.prev.clear();
    this.anyPressedFlag = false;
  }
}
