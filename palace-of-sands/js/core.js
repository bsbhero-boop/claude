'use strict';
// ── 공통 상수 · 유틸 · 입력 · 사운드 ─────────────────────────────

// 타일 격자: 한 칸 32×63px (원작 도스판과 같은 비율), 한 화면 = 3층.
const TW = 32, TH = 63;
const SLAB = 54;   // 칸 안에서 바닥 윗면이 시작되는 y
const FEET = 57;   // 서 있을 때 발바닥 y (윗면 안쪽으로 살짝 들어감)
const VW = 320, VH = 200, PH = 189;   // 가상 해상도, 플레이 영역 높이
const GRAV = 1000;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a, b) => a + Math.random() * (b - a);
const sign = (v) => (v < 0 ? -1 : 1);
function hash2(x, y) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const floorY = (r) => r * TH + FEET;      // r층 바닥에 선 발 y
const ledgeY = (r) => r * TH + SLAB;      // r층 바닥 모서리(매달리는 선) y
const colOf = (x) => Math.floor(x / TW);
const rowOf = (y) => Math.floor((y - 1) / TH);

// ── 입력 ─────────────────────────────────────────────────────────
const Input = {
  held: { left: false, right: false, up: false, down: false, action: false },
  pressT: { left: -9, right: -9, up: -9, down: -9, action: -9, start: -9, pause: -9 },
  now: 0,
  touchHeld: { left: false, right: false, up: false, down: false, action: false },
  keyHeld: { left: false, right: false, up: false, down: false, action: false },
  onAny: null,
  pressed(k, win = 0.16) { return this.now - this.pressT[k] < win; },
  consume(k) { this.pressT[k] = -9; },
  set(src, k, v) {
    const map = src === 'touch' ? this.touchHeld : this.keyHeld;
    if (v && !map[k]) this.pressT[k] = this.now;
    map[k] = v;
    this.held[k] = !!(this.keyHeld[k] || this.touchHeld[k]);
  },
  tap(k) { this.pressT[k] = this.now; },
  clear() {
    for (const k in this.held) { this.held[k] = this.keyHeld[k] = this.touchHeld[k] = false; }
    for (const k in this.pressT) this.pressT[k] = -9;
  },
  dir() { return (this.held.right ? 1 : 0) - (this.held.left ? 1 : 0); },
};

const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  ShiftLeft: 'action', ShiftRight: 'action', KeyZ: 'action', KeyX: 'action', Space: 'action',
};
window.addEventListener('keydown', (e) => {
  if (e.code in KEYMAP) {
    e.preventDefault();
    if (!e.repeat) Input.set('key', KEYMAP[e.code], true);
  } else if (e.code === 'Enter' || e.code === 'NumpadEnter') {
    if (!e.repeat) Input.tap('start');
  } else if (e.code === 'Escape' || e.code === 'KeyP') {
    if (!e.repeat) Input.tap('pause');
  }
  if (Input.onAny) Input.onAny(e);
});
window.addEventListener('keyup', (e) => {
  if (e.code in KEYMAP) { e.preventDefault(); Input.set('key', KEYMAP[e.code], false); }
});
window.addEventListener('blur', () => Input.clear());

// ── 사운드 (WebAudio 합성, 첫 입력 후에만 재생) ──────────────────
const Sfx = {
  ctx: null, master: null, muted: false, noiseBuf: null,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
      const n = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, n, n);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    } catch (err) { this.ctx = null; }
  },
  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  },
  tone(f, dur, type = 'square', vol = 0.15, f2 = null, delay = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  },
  noise(dur, vol = 0.2, freq = 1200, delay = 0, q = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const fl = this.ctx.createBiquadFilter(); fl.type = 'bandpass'; fl.frequency.value = freq; fl.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(fl); fl.connect(g); g.connect(this.master);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  },
  // 히자즈 음계 (D Eb F# G A Bb C#) — 페르시아풍 선율
  HIJAZ: [293.7, 311.1, 370.0, 392.0, 440.0, 466.2, 554.4, 587.3],
  melody(notes, step = 0.16, type = 'triangle', vol = 0.12) {
    notes.forEach((n, i) => { if (n >= 0) this.tone(this.HIJAZ[n % 8] * (n >= 8 ? 2 : 1), step * 1.6, type, vol, null, i * step); });
  },
  play(name) {
    if (!this.ctx || this.muted) return;
    switch (name) {
      case 'step': this.noise(0.04, 0.05, 900); break;
      case 'land': this.noise(0.12, 0.25, 300); this.tone(90, 0.12, 'sine', 0.2, 50); break;
      case 'hardland': this.noise(0.25, 0.4, 250); this.tone(70, 0.25, 'sine', 0.3, 35); break;
      case 'hurt': this.tone(220, 0.18, 'square', 0.12, 110); break;
      case 'swish': this.noise(0.12, 0.12, 3000, 0, 0.7); break;
      case 'clang': this.tone(1400, 0.25, 'square', 0.06, 1300); this.tone(2100, 0.2, 'triangle', 0.08); this.noise(0.06, 0.2, 5000); break;
      case 'hit': this.noise(0.1, 0.3, 600); this.tone(160, 0.1, 'sawtooth', 0.1, 80); break;
      case 'gate': for (let i = 0; i < 6; i++) this.noise(0.03, 0.12, 2200, i * 0.07, 4); break;
      case 'gateclose': this.noise(0.18, 0.3, 500); this.tone(120, 0.15, 'square', 0.08, 60); break;
      case 'crack': this.noise(0.06, 0.15, 1800, 0, 3); this.noise(0.05, 0.1, 1400, 0.08, 3); break;
      case 'crash': this.noise(0.4, 0.4, 700); this.noise(0.25, 0.25, 2500, 0.05); break;
      case 'plate': this.tone(180, 0.06, 'square', 0.08); this.noise(0.05, 0.1, 1200); break;
      case 'chomp': this.noise(0.05, 0.25, 4000, 0, 2); this.tone(900, 0.06, 'square', 0.05, 400); break;
      case 'spikes': this.noise(0.12, 0.2, 6000, 0, 2); break;
      case 'drink': for (let i = 0; i < 5; i++) this.tone(400 + i * 90, 0.07, 'sine', 0.1, 700 + i * 90, i * 0.09); break;
      case 'life': this.melody([0, 2, 4, 7], 0.12, 'triangle', 0.12); break;
      case 'sword': this.tone(1200, 0.4, 'triangle', 0.08, 2400); this.tone(1800, 0.5, 'sine', 0.05, null, 0.05); break;
      case 'door': this.noise(1.6, 0.18, 200, 0, 0.5); this.tone(55, 1.4, 'sawtooth', 0.05, 45); break;
      case 'death': this.melody([4, 3, 2, 1, 0], 0.22, 'square', 0.08); break;
      case 'fanfare': this.melody([0, 2, 3, 4, 5, 4, 3, 2, 3, -1, 0], 0.13, 'square', 0.07); break;
      case 'start': this.melody([0, 1, 2, 3, 4, 3, 2, 1, 2, 0], 0.15, 'triangle', 0.1); break;
      case 'boss': this.melody([0, 0, 1, 0, 6, 5, 6], 0.18, 'sawtooth', 0.05); break;
      case 'victory': this.melody([4, 5, 6, 8, 6, 5, 4, -1, 3, 4, 5, 4, 3, 2, 1, 0], 0.16, 'triangle', 0.12); break;
      case 'tick': this.tone(1000, 0.03, 'square', 0.04); break;
    }
  },
};
