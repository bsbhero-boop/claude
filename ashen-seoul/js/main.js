'use strict';
// ── 게임 루프 · 카메라 · HUD · 화면 전환 ─────────────────────────────

const TOTAL_TIME = 60 * 60;
const SAVE_KEY = 'ashen-seoul-v1';

const Game = {
  mode: 'title', levelIdx: 0, world: null, levelCv: null, player: null, guards: [], princess: null,
  camX: 0, camY: 0, timeLeft: TOTAL_TIME, msg: null, card: 0, hintsShown: new Set(), flags: {},
  carry: { maxHp: 3, hasSword: false }, deadT: 0, fade: 0, endT: 0, scale: 3,

  init() {
    this.view = document.getElementById('screen');
    this.vctx = this.view.getContext('2d');
    this.low = document.createElement('canvas'); this.low.width = VW; this.low.height = VH;
    this.lctx = this.low.getContext('2d');
    Art.init(); Figure.init(); Backdrop.init();
    window.addEventListener('resize', () => this.resize());
    this.resize();
    UI.init(this);
    let last = performance.now(), acc = 0;
    const frame = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      acc += dt;
      while (acc >= 1 / 60) { this.tick(1 / 60); acc -= 1 / 60; }
      this.render();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    this.loadLevel(0, true);
  },

  resize() {
    const host = document.getElementById('view'), cs = getComputedStyle(host);
    const r = host.getBoundingClientRect();
    const box = { width: r.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), height: r.height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) };
    const dpr = window.devicePixelRatio || 1;
    let s = Math.min(box.width / VW, box.height / VH);
    if (s * dpr >= 2) s = Math.floor(s * dpr) / dpr;
    s = Math.max(s, 0.5);
    this.scale = s * dpr;
    this.view.style.width = Math.round(VW * s) + 'px';
    this.view.style.height = Math.round(VH * s) + 'px';
    this.view.width = Math.round(VW * s * dpr); this.view.height = Math.round(VH * s * dpr);
    this.view.parentElement.style.setProperty('--s', s + 'px');
  },

  // ── 레벨 ──
  loadLevel(i, demo = false) {
    this.levelIdx = i;
    const def = LEVELS[i];
    this.world = new World(def, i);
    Backdrop.build(this.world);
    this.levelCv = buildLevelCanvas(this.world);
    const s = this.world.start;
    this.player = new Player(s.c * TW + 16, floorY(s.r), 1);
    this.player.maxHp = this.carry.maxHp; this.player.hp = this.carry.maxHp;
    this.player.hasSword = this.carry.hasSword || i > 0;
    this.guards = this.world.spawns.map((sp, k) => { const cfg = def.guards[k] || def.guards[0]; return cfg.kind === 'zombie' ? new Zombie(sp.c * TW + 16, floorY(sp.r), cfg) : new Guard(sp.c * TW + 16, floorY(sp.r), cfg); });
    this.princess = this.world.princess ? new Princess(this.world.princess.c * TW + 16, floorY(this.world.princess.r)) : null;
    this.hintsShown = new Set(); this.flags = {}; this.wonScene = false; this.msg = null; this.deadT = 0; this.fade = 1; this.endT = 0;
    this.card = demo ? 0 : 2.6;
    this.snapCamera();
    if (!demo) this.save();
  },
  restartLevel() { this.loadLevel(this.levelIdx); this.mode = 'play'; Input.clear(); },
  newGame() {
    this.carry = { maxHp: 3, hasSword: false }; this.timeLeft = TOTAL_TIME;
    this.loadLevel(0); this.mode = 'play'; Sfx.play('start');
  },
  continueGame(sv) {
    this.carry = { maxHp: sv.maxHp, hasSword: sv.level > 0 }; this.timeLeft = sv.timeLeft;
    this.loadLevel(sv.level); this.mode = 'play'; Sfx.play('start');
  },
  levelComplete() {
    Sfx.play('fanfare');
    this.carry = { maxHp: this.player.maxHp, hasSword: this.player.hasSword };
    this.mode = 'levelEnd'; this.endT = 0;
  },
  save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ level: this.levelIdx, maxHp: this.carry.maxHp, timeLeft: Math.round(this.timeLeft) })); } catch (e) { /* 저장 불가 환경 */ }
  },
  loadSave() {
    try { const v = JSON.parse(localStorage.getItem(SAVE_KEY)); if (v && v.level > 0 && v.level < LEVELS.length) return v; } catch (e) { /* 없음 */ }
    return null;
  },
  clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* 무시 */ } },

  once(k) { if (this.flags[k]) return false; this.flags[k] = true; return true; },
  message(text, dur = 4) { this.msg = { text, t: dur }; },
  combatHint() { if (this.once('combatHint') && this.levelIdx === 0) this.message('행동(Shift): 휘두르기   ↑: 막기   ←→: 전진·후퇴   ↓: 무기 내리기', 6); },
  foeFor(p) {
    let best = null, bd = 140;
    for (const g of this.guards) {
      if (!g.alive || g.row !== p.row) continue;
      const d = Math.abs(g.x - p.x);
      if (d < bd && this.world.lineClear(p.row, p.x, g.x)) { best = g; bd = d; }
    }
    return best;
  },
  onKill(g) {
    if (g.isBoss) {
      Sfx.play('fanfare');
      if (this.world.def.bossGate) this.world.openGate(this.world.def.bossGate);
      this.message('독사가 쓰러졌다! 셔터가 올라간다 — 하나에게 가자', 6);
    }
  },

  // ── 갱신 ──
  tick(dt) {
    Input.now += dt;
    if (Input.pressed('pause', 0.05)) { Input.consume('pause'); if (this.mode === 'play') UI.pause(true); else if (this.mode === 'paused') UI.pause(false); }
    if (this.mode === 'paused' || this.mode === 'title' || this.mode === 'over') { this.world.update(dt * (this.mode === 'title' ? 1 : 0), []); return; }
    const w = this.world, p = this.player;
    if (this.mode === 'play' || this.mode === 'levelEnd' || this.mode === 'won') {
      if (this.mode === 'play') {
        this.timeLeft -= dt;
        if (this.timeLeft <= 0) { this.timeLeft = 0; this.mode = 'over'; UI.showEnd('timeup'); return; }
      }
      if (this.mode === 'play' || this.mode === 'won') p.update(dt, w, this);
      for (const g of this.guards) g.update(dt, w, this);
      if (this.princess) this.princess.update(dt, w);
      w.update(dt, [p, ...this.guards.filter((g) => g.alive)]);
      for (const e of w.events) {
        if (e.type === 'gate' && !this.onScreen(e.data.c, e.data.r)) this.message('어디선가 셔터가 말려 올라가는 소리가 들린다', 3);
        if (e.type === 'door') this.message('비상구 전원이 들어왔다! 문 앞에서 ↑', 4);
      }
      w.events.length = 0;
    }
    if (this.card > 0) this.card -= dt;
    if (this.fade > 0) this.fade = Math.max(0, this.fade - dt * 1.5);
    if (this.msg) { this.msg.t -= dt; if (this.msg.t <= 0) this.msg = null; }

    if (this.mode === 'play') {
      // 힌트
      const c = colOf(p.x), r = p.row;
      for (const h of this.world.def.hints || []) {
        const key = h.c + ',' + h.r;
        if (!this.hintsShown.has(key) && c === h.c && r === h.r && p.alive) { this.hintsShown.add(key); this.message(h.text, 5); }
      }
      if (!p.alive) {
        this.deadT += dt;
        if (this.deadT > 1.6 && (Input.pressed('start') || Input.pressed('action', 0.05))) { Input.consume('start'); this.restartLevel(); }
      }
      if (this.princess && p.alive && !this.guards.some((g) => g.isBoss && g.alive) && p.row === this.princess.row && Math.abs(p.x - this.princess.x) < 34) {
        this.mode = 'won'; this.wonScene = true; this.endT = 0; this.princess.set('cheer'); Sfx.play('heli'); p.set('stand'); Sfx.play('victory');
        this.princess.f = sign(p.x - this.princess.x); p.f = -this.princess.f;
      }
    }
    if (this.mode === 'levelEnd') {
      this.endT += dt;
      if (this.endT > 1.4) {
        if (this.levelIdx + 1 < LEVELS.length) { this.loadLevel(this.levelIdx + 1); this.mode = 'play'; Input.clear(); }
      }
    }
    if (this.mode === 'won') {
      this.endT += dt;
      if (this.endT > 3.4 && this.once('wonUI')) { this.clearSave(); this.mode = 'over'; UI.showEnd('won'); }
    }
    this.updateCamera(dt);
  },

  onScreen(c, r) {
    const x = c * TW + 16, y = r * TH + 30;
    return x > this.camX && x < this.camX + VW && y > this.camY && y < this.camY + PH;
  },
  camTarget() {
    const p = this.player, w = this.world;
    const tx = clamp(p.x + p.f * 26 - VW / 2, 0, w.w * TW - VW);
    let fy = p.y;
    if (['hang', 'climbup', 'climbdown'].includes(p.state)) fy = p.hangL + 30;
    else if (['air', 'standjump', 'runjump', 'hop'].includes(p.state)) fy = Math.max(p.groundY, p.y);
    const ty = clamp(fy - 148, 0, Math.max(0, w.h * TH - PH + (w.theme === 'bridge' ? 26 : 0)));
    return [tx, ty];
  },
  snapCamera() { const [x, y] = this.camTarget(); this.camX = x; this.camY = y; },
  updateCamera(dt) {
    const [tx, ty] = this.camTarget();
    this.camX += (tx - this.camX) * Math.min(1, dt * 5);
    this.camY += (ty - this.camY) * Math.min(1, dt * 6);
  },

  // ── 그리기 ──
  render() {
    const c = this.lctx, w = this.world;
    c.imageSmoothingEnabled = false;
    const cx = Math.round(this.camX), cy = Math.round(this.camY);
    c.fillStyle = '#000'; c.fillRect(0, 0, VW, VH);
    Backdrop.draw(c, w, cx, cy, w.time);
    c.drawImage(this.levelCv, cx, cy, VW, PH, 0, 0, VW, PH);
    w.drawTiles(c, cx, cy);
    if (this.princess) this.princess.render(c, cx, cy);
    for (const g of this.guards) if (!g.alive) g.render(c, cx, cy);
    for (const g of this.guards) if (g.alive) g.render(c, cx, cy);
    if (this.mode !== 'title') this.player.render(c, cx, cy);
    w.drawFront(c, cx, cy);
    if (this.wonScene && w.theme === 'tower') Backdrop.heli(c, lerp(VW + 40, VW * 0.4, smooth(clamp(this.endT / 2.2, 0, 1))), 26 + Math.sin(w.time * 2) * 2, w.time);
    Backdrop.ambient(c, w.theme, w.time, cx, cy);
    const extra = w.extraLights(), p = this.player;
    if (PALETTES[w.theme].flashlight && p.alive && this.mode !== 'title') extra.push({ x: p.x + p.f * 12, y: p.y - 30, r: 46, tint: null, flick: 'steady' });
    Art.drawDarkness(c, w, cx, cy, w.time, extra);
    this.drawHud(c);
    if (this.fade > 0 || this.mode === 'levelEnd') {
      const a = this.mode === 'levelEnd' ? clamp(this.endT / 1.2, 0, 1) : this.fade;
      c.fillStyle = `rgba(0,0,0,${a})`; c.fillRect(0, 0, VW, PH);
    }

    const v = this.vctx, S = this.scale;
    v.imageSmoothingEnabled = false;
    v.drawImage(this.low, 0, 0, VW * S, VH * S);
    this.syncText();
  },

  drawHud(c) {
    c.fillStyle = '#000'; c.fillRect(0, PH, VW, VH - PH);
    const p = this.player;
    if (this.mode === 'title') return;
    for (let i = 0; i < p.maxHp; i++) drawHpCell(c, 3 + i * 8, PH + 2, i < p.hp, p.hp <= 1 && Math.floor(this.world.time * 4) % 2 ? '#ff6a4a' : '#e0402a', '#5a1414');
    const foe = this.foeFor(p) || this.guards.find((g) => g.alive && COMBAT.has(g.state));
    if (foe && Math.abs(foe.x - p.x) < 160) {
      const col = foe.isZombie ? '#7ac24a' : foe.isBoss ? '#f2b632' : '#e08a2a';
      for (let i = 0; i < foe.maxHp; i++) drawHpCell(c, VW - 9 - i * 8, PH + 2, i < foe.hp, col, '#2a2a1a');
    } else {
      const m = Math.max(0, Math.ceil(this.timeLeft));
      const str = String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
      drawDigits(c, str, VW - 22, PH + 3, this.timeLeft < 300 ? '#ff6a4a' : '#f2b632');
    }
  },

  // 글자는 HTML로 얹는다 (작은 화면에서도 읽히도록 최소 크기 보장)
  syncText() {
    const show = this.mode !== 'title';
    let msg = '', msgA = 0;
    if (show && this.msg) { msg = this.msg.text; msgA = clamp(this.msg.t * 2, 0, 1); }
    UI.setText(UI.msgEl, msg, msgA);
    let cardA = 0;
    if (show && this.card > 0) cardA = clamp(this.card, 0, 1) * clamp((2.6 - this.card) * 3, 0, 1);
    if (cardA > 0) UI.setCard(this.world.def.name, this.world.def.place + ' · 헬기 출발까지 ' + Math.ceil(this.timeLeft / 60) + '분');
    UI.setText(UI.cardEl, null, cardA);
    const dead = show && this.mode === 'play' && !this.player.alive && this.deadT > 1.6;
    UI.setText(UI.deadEl, null, dead ? 1 : 0);
  },
};

// ── HTML 화면 · 터치 조작 ─────────────────────────────────────────
const UI = {
  touch: false,
  init(game) {
    this.g = game;
    this.title = document.getElementById('title');
    this.pauseEl = document.getElementById('pause');
    this.endEl = document.getElementById('end');
    this.msgEl = document.getElementById('msg');
    this.cardEl = document.getElementById('card');
    this.deadEl = document.getElementById('dead');
    this.deadEl.querySelector('span').textContent = this.touch ? '행동 버튼을 눌러 이 장을 다시 시작' : 'Enter 또는 Shift: 이 장을 다시 시작';
    this.touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    document.body.classList.toggle('touch', this.touch);
    const sv = game.loadSave();
    const cont = document.getElementById('btn-continue');
    if (sv) { cont.hidden = false; cont.textContent = `이어하기 · ${LEVELS[sv.level].name.split(' · ')[0]}`; }
    cont.addEventListener('click', () => { Sfx.init(); this.hide(this.title); game.continueGame(game.loadSave() || sv); });
    document.getElementById('btn-start').addEventListener('click', () => { Sfx.init(); this.hide(this.title); game.newGame(); });
    document.getElementById('btn-resume').addEventListener('click', () => this.pause(false));
    document.getElementById('btn-restart').addEventListener('click', () => { this.pause(false); game.restartLevel(); });
    document.getElementById('btn-again').addEventListener('click', () => { this.hide(this.endEl); game.newGame(); });
    document.getElementById('btn-pause').addEventListener('click', () => { if (game.mode === 'play') this.pause(true); else if (game.mode === 'paused') this.pause(false); });
    const mute = document.getElementById('btn-mute');
    mute.addEventListener('click', () => { Sfx.init(); Sfx.setMuted(!Sfx.muted); mute.setAttribute('aria-pressed', Sfx.muted); mute.textContent = Sfx.muted ? '소리 끔' : '소리 켬'; });
    Input.onAny = () => {
      Sfx.init();
      if (game.mode === 'title' && Input.pressed('start')) { Input.consume('start'); document.getElementById('btn-start').click(); }
    };
    // 터치 버튼
    document.querySelectorAll('[data-k]').forEach((b) => {
      const keys = b.dataset.k.split(' ');
      const on = (e) => { e.preventDefault(); Sfx.init(); b.setPointerCapture?.(e.pointerId); b.classList.add('on'); keys.forEach((k) => Input.set('touch', k, true)); };
      const off = (e) => { e.preventDefault(); b.classList.remove('on'); keys.forEach((k) => Input.set('touch', k, false)); };
      b.addEventListener('pointerdown', on);
      b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('lostpointercapture', off);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    });
  },
  hide(el) { el.hidden = true; },
  setText(el, text, a) {
    if (text != null && el._t !== text) { el._t = text; el.textContent = text; }
    const o = a.toFixed(2);
    if (el._o !== o) { el._o = o; el.style.opacity = o; el.style.visibility = a > 0 ? 'visible' : 'hidden'; }
  },
  setCard(name, sub) {
    if (this.cardEl._n === name + sub) return;
    this.cardEl._n = name + sub;
    this.cardEl.querySelector('strong').textContent = name;
    this.cardEl.querySelector('span').textContent = sub;
  },
  pause(on) {
    const g = this.g;
    if (on) { g.mode = 'paused'; this.pauseEl.hidden = false; Input.clear(); }
    else { g.mode = 'play'; this.pauseEl.hidden = true; Input.clear(); }
  },
  showEnd(kind) {
    const g = this.g, used = TOTAL_TIME - g.timeLeft;
    const mm = Math.floor(used / 60), ss = Math.floor(used % 60);
    document.getElementById('end-title').textContent = kind === 'won' ? '하나를 구했다' : '헬기가 떠났다';
    document.getElementById('end-body').textContent = kind === 'won'
      ? `헬기가 남산을 떠나 잿빛 서울 위로 떠오른다. 창밖으로 한강에 첫 햇살이 번진다. 걸린 시간 ${mm}분 ${String(ss).padStart(2, '0')}초.`
      : '60분이 지나 마지막 구조 헬기가 남산을 떠났다. 처음부터 다시 도전하자.';
    this.endEl.hidden = false;
    if (kind !== 'won') g.clearSave();
  },
};

function boot(data) {
  Game.init();
  if (data && data.mode === 'play' && data.levelIdx != null) {
    Game.carry = { maxHp: data.maxHp || 3, hasSword: !!data.hasSword };
    Game.timeLeft = data.timeLeft || TOTAL_TIME;
    UI.hide(UI.title);
    Game.loadLevel(data.levelIdx); Game.mode = 'play';
  }
}
window.claude?.hot?.snapshot?.(() => ({ mode: Game.mode === 'paused' ? 'play' : Game.mode, levelIdx: Game.levelIdx, timeLeft: Game.timeLeft, maxHp: Game.player ? Game.player.maxHp : 3, hasSword: Game.player ? Game.player.hasSword : false }));
window.addEventListener('load', () => {
  if (window.claude?.hot?.ready) window.claude.hot.ready(boot);
  else boot(window.claude?.hot?.data ?? {});
});
