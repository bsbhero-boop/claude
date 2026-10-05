'use strict';
// ── 레벨 실행 상태: 타일 · 함정 · 철창 · 무너지는 바닥 · 파편 ─────────

const BW = 6; // 몸 반폭

class World {
  constructor(def, idx) {
    this.def = def; this.idx = idx; this.theme = def.theme;
    this.h = def.rows.length; this.w = def.rows[0].length;
    this.grid = def.rows.map((r) => r.padEnd(this.w, '#').split(''));
    this.st = new Map();
    this.lights = []; this.lightMap = new Map(); this.gates = {}; this.doors = []; this.debris = []; this.particles = [];
    this.spawns = []; this.start = { c: 1, r: 0 }; this.princess = null;
    this.events = [];
    this.time = 0;
    for (let r = 0; r < this.h; r++) for (let c = 0; c < this.w; c++) this.parse(c, r, this.grid[r][c]);
  }

  parse(c, r, ch) {
    const key = r * 1000 + c, put = (o) => { o.c = c; o.r = r; this.st.set(key, o); return o; };
    const L = tileLight(this.theme, ch, c, r);
    if (L) { this.lights.push(L); this.lightMap.set(key, L); }
    if (ch === '~') put({ kind: 'loose', shake: 0, trig: false, gone: false });
    else if ('abcd'.includes(ch)) put({ kind: 'plate', id: ch.toUpperCase(), down: false, stuck: false });
    else if (ch === 'e') put({ kind: 'plate', id: 'exit', exit: true, down: false, stuck: false });
    else if (ch === '^') put({ kind: 'spikes', out: 0, hold: 0 });
    else if (ch === 'z') put({ kind: 'electric', timer: (c * 0.53) % 2.4, on: false, warn: false });
    else if (ch === 'x') put({ kind: 'chomper', close: 0, timer: (c * 0.37) % 1.6, active: false, blood: false });
    else if ('ABCD'.includes(ch)) {
      const g = put({ kind: 'gate', id: ch, open: 0, target: 0, timer: 0, perm: false });
      (this.gates[ch] = this.gates[ch] || []).push(g);
    } else if (ch === 'E') this.doors.push(put({ kind: 'door', open: this.def.doorOpen ? 1 : 0, target: this.def.doorOpen ? 1 : 0 }));
    else if (ch === 'h' || ch === 'L') put({ kind: 'potion', big: ch === 'L', taken: false });
    else if (ch === 'S') put({ kind: 'sword', taken: false });
    else if (ch === '=') put({ kind: 'floor', rubble: true });
    if (ch === '@') this.start = { c, r };
    if (ch === 'g' || ch === 'k' || ch === 'V') this.spawns.push({ c, r, ch });
    if (ch === 'Q') this.princess = { c, r };
  }

  ch(c, r) {
    if (c < 0 || c >= this.w) return '#';
    if (r < 0 || r >= this.h) return ' ';
    return this.grid[r][c];
  }
  state(c, r) { return this.st.get(r * 1000 + c); }
  lightAt(c, r) { return this.lightMap.get(r * 1000 + c); }
  // 켜져 있는 전선의 불꽃은 순간적인 광원이 된다
  extraLights() {
    const out = [];
    for (const s of this.st.values()) if (s.kind === 'electric' && s.on) out.push({ x: s.c * TW + 18, y: s.r * TH + SLAB - 8, r: 34 + Math.floor(Math.random() * 6), tint: 'cyan', flick: 'steady' });
    return out;
  }
  isWall(c, r) { return this.ch(c, r) === '#'; }
  support(c, r) {
    const ch = this.ch(c, r);
    if (ch === '#') return false;
    if (SUPPORT.has(ch)) return true;
    return r + 1 < this.h && this.isWall(c, r + 1);
  }
  gateAt(c, r) { const s = this.state(c, r); return s && s.kind === 'gate' ? s : null; }
  gateClosed(c, r) { const g = this.gateAt(c, r); return !!g && g.open < 0.62; }

  // 수평 이동 충돌 (석벽 + 닫힌 철창)
  moveX(x, nx, rows) {
    if (nx > x) {
      for (let c = colOf(x + BW); c <= colOf(nx + BW); c++) for (const r of rows) {
        if (this.isWall(c, r)) nx = Math.min(nx, c * TW - BW - 0.01);
        else if (this.gateClosed(c, r)) { const gx = c * TW + 21; if (x + BW <= gx + 0.5 && nx + BW > gx) nx = Math.min(nx, gx - BW); }
      }
    } else if (nx < x) {
      for (let c = colOf(x - BW); c >= colOf(nx - BW); c--) for (const r of rows) {
        if (this.isWall(c, r)) nx = Math.max(nx, (c + 1) * TW + BW + 0.01);
        else if (this.gateClosed(c, r)) { const gr = c * TW + 29; if (x - BW >= gr - 0.5 && nx - BW < gr) nx = Math.max(nx, gr + BW); }
      }
    }
    return nx;
  }
  // 정면 장애물(벽·철창)까지 거리
  wallDist(x, r, f) {
    const probe = this.moveX(x, x + f * 40, [r]);
    return Math.abs(probe - x);
  }
  // 바닥이 끝나는 모서리까지 거리 (없으면 Infinity)
  edgeDist(x, r, f) {
    const c = colOf(x);
    for (let k = 0; k <= 2; k++) {
      const nc = c + f * (k + 1);
      if (this.isWall(nc, r)) return Infinity;
      if (!this.support(nc, r)) {
        const E = f > 0 ? nc * TW : (nc + 1) * TW;
        return Math.abs(E - x);
      }
    }
    return Infinity;
  }
  lineClear(r, x0, x1) {
    const a = Math.min(x0, x1), b = Math.max(x0, x1);
    for (let c = colOf(a); c <= colOf(b); c++) {
      if (this.isWall(c, r)) return false;
      if (this.gateClosed(c, r) && c * TW + 25 > a && c * TW + 25 < b) return false;
    }
    return true;
  }

  emit(type, data) { this.events.push({ type, data }); }

  trigLoose(c, r) {
    const s = this.state(c, r);
    if (s && s.kind === 'loose' && !s.gone && !s.trig) { s.trig = true; Sfx.play('crack'); }
  }

  openGate(id, t) {
    const list = this.gates[id]; if (!list) return;
    const timer = this.def.gates && this.def.gates[id] != null ? this.def.gates[id] : 0;
    for (const g of list) {
      if (g.target === 0 && g.open < 0.99) { Sfx.play('gate'); this.emit('gate', g); }
      g.target = 1; g.perm = timer === 0; g.timer = timer;
    }
  }

  update(dt, actors) {
    this.time += dt;
    for (const s of this.st.values()) {
      switch (s.kind) {
        case 'plate': {
          let down = s.stuck;
          for (const a of actors) if (a.alive && a.grounded && colOf(a.x) === s.c && a.row === s.r) down = true;
          if (down && !s.down) {
            Sfx.play('plate');
            if (s.exit) {
              for (const d of this.doors) if (d.target === 0) { d.target = 1; Sfx.play('door'); this.emit('door', d); }
            } else this.openGate(s.id);
          }
          if (down && !s.exit) for (const g of this.gates[s.id] || []) if (!g.perm) g.timer = this.def.gates[s.id];
          s.down = down;
          break;
        }
        case 'gate': {
          if (s.target === 1) {
            s.open = Math.min(1, s.open + dt / 0.9);
            if (s.open >= 1 && !s.perm) { s.timer -= dt; if (s.timer <= 0) s.target = 0; }
          } else if (s.open > 0) {
            const before = s.open;
            s.open = Math.max(0, s.open - dt / 3.4);
            if (Math.floor(before * 12) !== Math.floor(s.open * 12)) Sfx.play('tick');
            if (s.open === 0) Sfx.play('gateclose');
          }
          break;
        }
        case 'door': if (s.target) s.open = Math.min(1, s.open + dt / 2.4); break;
        case 'loose':
          if (s.trig && !s.gone) {
            s.shake += dt;
            if (s.shake > 0.5) {
              s.gone = true; this.grid[s.r][s.c] = ' ';
              this.debris.push({ x: s.c * TW + 16, y: s.r * TH + SLAB, vy: 0, hit: new Set() });
            }
          }
          break;
        case 'spikes': s.out = 1; break; // 유리 조각은 늘 날카롭다
        case 'electric': {
          const P = 2.4, before = s.timer % P;
          s.timer += dt;
          const p = s.timer % P;
          s.warn = p >= 1.25 && p < 1.55; s.on = p >= 1.55;
          if (before < 1.55 && p >= 1.55) {
            const pl = actors.find((a) => a.isPlayer);
            if (pl && Math.abs(pl.x - s.c * TW) < 240 && Math.abs(pl.row - s.r) <= 1) Sfx.play('zap');
          }
          break;
        }
        case 'chomper': {
          let act = false;
          for (const a of actors) if (a.isPlayer && a.alive && Math.abs(a.row - s.r) <= 0 && Math.abs(a.x - s.c * TW) < 220) act = true;
          const P = 1.6;
          if (act || s.close > 0 || (s.timer % P) > 1.15) {
            const before = s.timer % P;
            s.timer += dt;
            const p = s.timer % P;
            if (before < 1.15 && p >= 1.15) Sfx.play('chomp');
            s.close = p < 1.15 ? 0 : p < 1.24 ? (p - 1.15) / 0.09 : p < 1.4 ? 1 : Math.max(0, 1 - (p - 1.4) / 0.2);
          }
          break;
        }
      }
    }
    // 떨어지는 바닥 조각
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      const py = d.y;
      d.vy = Math.min(d.vy + GRAV * dt, 700); d.y += d.vy * dt;
      for (const a of actors) {
        if (!a.alive || d.hit.has(a)) continue;
        if (Math.abs(a.x - d.x) < 13 && d.y > a.y - a.height() && py < a.y - 8) { d.hit.add(a); a.bonk(); }
      }
      const c = colOf(d.x);
      let landed = false;
      for (let r = 0; r < this.h; r++) {
        const L = ledgeY(r);
        if (py < L && d.y >= L && this.support(c, r)) {
          landed = true;
          let s = this.state(c, r);
          if (s && s.kind === 'plate') s.stuck = true;
          else if (s && s.kind === 'loose' && !s.gone) { s.trig = true; s.shake = 0.5; }
          else { if (!s) { s = { kind: 'floor', c, r }; this.st.set(r * 1000 + c, s); } s.rubble = true; }
          Sfx.play('crash');
          this.dust(d.x, L, 10);
          break;
        }
      }
      if (landed || d.y > this.h * TH + 80) this.debris.splice(i, 1);
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt; p.vy += (p.g ?? 500) * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
  }

  dust(x, y, n, col) {
    const P = PALETTES[this.theme];
    for (let i = 0; i < n; i++) this.particles.push({ x: x + rnd(-10, 10), y: y - rnd(0, 4), vx: rnd(-50, 50), vy: rnd(-90, -20), life: rnd(0.3, 0.6), color: col || (i & 1 ? P.topHi : P.front), g: 400 });
  }
  sparks(x, y) {
    for (let i = 0; i < 9; i++) this.particles.push({ x, y, vx: rnd(-110, 110), vy: rnd(-140, 30), life: rnd(0.12, 0.3), color: i & 1 ? '#fff6c0' : '#ffc93a', g: 300 });
  }
  blood(x, y, f) {
    for (let i = 0; i < 7; i++) this.particles.push({ x, y, vx: f * rnd(10, 80), vy: rnd(-80, 10), life: rnd(0.3, 0.6), color: i & 1 ? '#b0141c' : '#7a0a10', g: 600 });
  }

  // 화면에 보이는 칸만 그린다
  drawTiles(ctx, camX, camY) {
    const P = PALETTES[this.theme];
    ctx.save(); ctx.translate(-Math.round(camX), -Math.round(camY));
    const c0 = Math.max(0, colOf(camX) - 1), c1 = Math.min(this.w - 1, colOf(camX + VW) + 1);
    const r0 = Math.max(0, Math.floor(camY / TH) - 1), r1 = Math.min(this.h - 1, Math.floor((camY + PH) / TH) + 1);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) Art.drawTile(ctx, P, this, c, r, this.time, 'back');
    for (const d of this.debris) { drawSlab(ctx, P, Math.round(d.x - 16), Math.round(d.y - SLAB), { top: P.topDk }); }
    ctx.restore();
  }
  drawFront(ctx, camX, camY) {
    // 캐릭터 앞에 와야 하는 것: 칼날 함정, 철창
    const P = PALETTES[this.theme];
    ctx.save(); ctx.translate(-Math.round(camX), -Math.round(camY));
    const c0 = Math.max(0, colOf(camX) - 1), c1 = Math.min(this.w - 1, colOf(camX + VW) + 1);
    for (const s of this.st.values()) {
      if ((s.kind === 'chomper' || s.kind === 'gate') && s.c >= c0 && s.c <= c1) Art.drawTile(ctx, P, this, s.c, s.r, this.time, 'front');
    }
    for (const p of this.particles) { ctx.fillStyle = p.color; ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1); }
    ctx.restore();
  }
}
