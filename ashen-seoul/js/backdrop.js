'use strict';
// ── 배경: 다리 위 하늘·스카이라인(시차 스크롤)·강 · 전망창 밖 서울 · 떠도는 재 · 구조 헬기 ──

function grad(ctx, h, stops) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
}
function dither(ctx, x, y, w, h, color, density, seed = 1) {
  ctx.fillStyle = color;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    if (BAYER[((y + j) & 3) * 4 + ((x + i) & 3)] < density && hash2(i + seed, j) > 0.15) ctx.fillRect(x + i, y + j, 1, 1);
  }
}

// 불탄 도시 실루엣 (가로 w, 세로 h). 랜드마크 위치를 돌려준다
function paintSkyline(ctx, w, h, opts) {
  const marks = {};
  let x = 0, k = 0;
  while (x < w) {
    const bw = 8 + Math.floor(hash2(k, 11) * 18), bh = 18 + Math.floor(hash2(k, 23) * (h * 0.55));
    const col = k % 2 ? opts.b1 : opts.b2;
    ctx.fillStyle = col; ctx.fillRect(x, h - bh, bw, bh);
    if (hash2(k, 5) > 0.7) { ctx.fillRect(x + 2, h - bh - 4, Math.max(2, bw - 6), 4); }
    for (let i = 0; i < bw * bh * 0.012; i++) {
      ctx.fillStyle = hash2(i, k) > 0.7 ? '#e0a040' : '#8a4a20';
      ctx.fillRect(x + 1 + Math.floor(hash2(k, i) * (bw - 2)), h - bh + 2 + Math.floor(hash2(i * 3, k) * (bh - 4)), 1, 1);
    }
    if (hash2(k, 77) > 0.82) { // 불타는 꼭대기 + 연기
      ctx.fillStyle = '#ff8a2a'; ctx.fillRect(x + 1, h - bh - 2, bw - 2, 2);
      ctx.fillStyle = '#ffd060'; ctx.fillRect(x + 2, h - bh - 1, Math.max(1, bw - 5), 1);
      dither(ctx, x - 6, Math.max(0, h - bh - 40), bw + 12, 38, 'rgba(10,8,10,0.9)', 0.45, k);
    }
    x += bw + (hash2(k, 31) > 0.7 ? 3 : 0); k++;
  }
  if (opts.landmarks) {
    // 63빌딩 (금빛 유리)
    const sx = Math.floor(w * 0.28), sh = Math.floor(h * 0.86);
    for (let j = 0; j < sh; j++) { const ww = Math.round(lerp(16, 9, j / sh)); ctx.fillStyle = '#3a2e1a'; ctx.fillRect(sx + (16 - ww) / 2 | 0, h - j, ww, 1); }
    for (let i = 2; i < 14; i += 3) { ctx.fillStyle = '#9a7a32'; ctx.fillRect(sx + i, h - sh + 6 + i, 1, sh - 10 - i); }
    marks.b63 = sx;
    // 남산과 N서울타워 — 목적지
    const nx = Math.floor(w * 0.82), hill = Math.floor(h * 0.36);
    ctx.fillStyle = '#121618';
    for (let i = -60; i <= 60; i++) { const hh = Math.round(hill * Math.cos((i / 60) * Math.PI / 2)); ctx.fillRect(nx + i, h - hh, 1, hh); }
    const tb = h - hill, th = Math.floor(h * 0.5);
    ctx.fillStyle = '#20262a'; ctx.fillRect(nx - 1, tb - th, 3, th);
    ctx.fillRect(nx - 4, tb - th * 0.62, 9, 5); ctx.fillStyle = '#d8c070'; ctx.fillRect(nx - 3, tb - th * 0.62 + 1, 7, 1);
    ctx.fillStyle = '#20262a'; ctx.fillRect(nx, tb - th - 10, 1, 10);
    marks.namsan = { x: nx, y: tb - th - 10 };
  }
  return marks;
}

const Backdrop = {
  city: null, sky: null, far: null, mid: null, marks: null, theme: '',
  init() {
    // 전망창 너머 새벽의 서울
    const cv = document.createElement('canvas'); cv.width = 420; cv.height = 130;
    const c = cv.getContext('2d');
    c.fillStyle = grad(c, 130, [[0, '#0d1630'], [0.45, '#3a2a4a'], [0.72, '#c4603e'], [0.82, '#f0a060'], [1, '#2a1c20']]);
    c.fillRect(0, 0, 420, 130);
    for (let i = 0; i < 40; i++) { c.fillStyle = i % 4 ? '#8a9ac8' : '#fff4d0'; c.fillRect(Math.floor(hash2(i, 1) * 420), Math.floor(hash2(1, i) * 40), 1, 1); }
    dither(c, 0, 20, 420, 30, 'rgba(20,14,24,0.85)', 0.25, 9);
    const sk = document.createElement('canvas'); sk.width = 420; sk.height = 60;
    paintSkyline(sk.getContext('2d'), 420, 60, { b1: '#1a1420', b2: '#221a28' });
    c.drawImage(sk, 0, 66);
    c.fillStyle = '#1a2a3a'; c.fillRect(0, 118, 420, 12);
    for (let i = 0; i < 60; i++) { c.fillStyle = i % 2 ? '#f0a060' : '#e06040'; c.fillRect(Math.floor(hash2(i, 4) * 420), 119 + Math.floor(hash2(4, i) * 10), 2 + (i % 3), 1); }
    this.city = cv;
  },

  build(world) {
    this.theme = world.theme;
    if (world.theme !== 'bridge') return;
    const sky = document.createElement('canvas'); sky.width = VW; sky.height = PH;
    const s = sky.getContext('2d');
    s.fillStyle = grad(s, PH, [[0, '#0d0a14'], [0.5, '#24141e'], [0.74, '#5c2a1c'], [0.8, '#3a1e1a'], [1, '#0e1218']]);
    s.fillRect(0, 0, VW, PH);
    for (let i = 0; i < 50; i++) { s.fillStyle = i % 5 ? '#6a6a8a' : '#e8e0c8'; s.fillRect(Math.floor(hash2(i, 2) * VW), Math.floor(hash2(2, i) * 90), 1, 1); }
    for (let i = 0; i < 9; i++) dither(s, Math.floor(hash2(i, 5) * VW) - 30, 30 + Math.floor(hash2(5, i) * 70), 50 + Math.floor(hash2(i, 6) * 60), 8 + (i % 3) * 4, i % 2 ? 'rgba(8,6,10,0.7)' : 'rgba(60,24,18,0.5)', 0.22, i);
    this.sky = sky;
    const fw = Math.ceil(VW + world.w * TW * 0.12 + 60);
    const far = document.createElement('canvas'); far.width = fw; far.height = 110;
    const f = far.getContext('2d');
    this.marks = paintSkyline(f, fw, 92, { b1: '#18121a', b2: '#1e1622', landmarks: true });
    f.fillStyle = '#101820'; f.fillRect(0, 92, fw, 18);
    for (let i = 0; i < fw / 6; i++) { f.fillStyle = i % 3 ? '#6a3a24' : '#c86a30'; f.fillRect(Math.floor(hash2(i, 8) * fw), 94 + Math.floor(hash2(8, i) * 14), 2 + (i % 4), 1); }
    this.far = far;
    // 한강대교 아치 (중간 거리)
    const mw = Math.ceil(VW + world.w * TW * 0.45 + 200);
    const mid = document.createElement('canvas'); mid.width = mw; mid.height = 70;
    const m = mid.getContext('2d');
    for (let a = 0; a < mw; a += 160) {
      for (let i = 0; i <= 150; i++) {
        const y = Math.round(66 - 52 * Math.sin((i / 150) * Math.PI));
        m.fillStyle = '#3c1e18'; m.fillRect(a + i, y, 1, 4);
        m.fillStyle = '#5a2e22'; m.fillRect(a + i, y, 1, 1);
        if (i % 12 === 0 && i > 0 && i < 150) { m.fillStyle = '#2c1612'; m.fillRect(a + i, y + 4, 1, 66 - y); }
      }
      if (hash2(a, 1) > 0.6) { m.clearRect(a + 60, 0, 30, 70); } // 끊어진 아치
    }
    this.mid = mid;
  },

  draw(ctx, world, camX, camY, t) {
    if (world.theme !== 'bridge') return;
    ctx.drawImage(this.sky, 0, 0);
    const hy = Math.round(118 - camY * 0.18);
    const fx = -Math.round(camX * 0.12);
    ctx.drawImage(this.far, fx, hy - 92);
    if (this.marks && this.marks.namsan && Math.floor(t * 1.5) % 2 === 0) {
      ctx.fillStyle = '#ff3a2a'; ctx.fillRect(fx + this.marks.namsan.x, hy - 92 + this.marks.namsan.y, 1, 1);
    }
    const mx = -Math.round(camX * 0.45);
    ctx.drawImage(this.mid, mx, Math.round(ledgeY(2) + 6 - camY - 66 + camY * 0.3));
    const wy = Math.round(world.h * TH + 4 - camY);
    if (wy < PH) {
      ctx.fillStyle = '#0a121c'; ctx.fillRect(0, wy, VW, PH - wy);
      for (let i = 0; i < 24; i++) {
        const x = Math.floor((hash2(i, 9) * VW + t * (6 + (i % 4) * 3) - camX * 0.6) % VW + VW) % VW;
        ctx.fillStyle = i % 3 ? '#7a3a20' : '#e08a40';
        ctx.fillRect(x, wy + 2 + Math.floor(hash2(9, i) * Math.max(1, PH - wy - 3)), 3 + (i % 5), 1);
      }
    }
  },

  // 떠도는 먼지·재 (화면 좌표, 상태 없이 시간만으로 계산)
  ambient(ctx, theme, t, camX, camY) {
    const n = theme === 'subway' ? 22 : 40;
    for (let i = 0; i < n; i++) {
      let vx, vy, col;
      if (theme === 'subway') { vx = 3; vy = 2; col = 'rgba(220,216,190,0.45)'; }
      else if (theme === 'bridge') { vx = 9; vy = 16; col = i % 7 ? 'rgba(150,140,130,0.7)' : 'rgba(255,150,60,0.9)'; }
      else { vx = 34; vy = 6; col = 'rgba(160,160,170,0.55)'; }
      const sp = 0.6 + hash2(i, 3) * 0.8;
      const x = ((hash2(i, 1) * 400 + t * vx * sp - camX * 0.3) % 400 + 400) % 400 - 40;
      const y = ((hash2(1, i) * 220 + t * vy * sp - camY * 0.3 + Math.sin(t + i) * 3) % 220 + 220) % 220 - 15;
      ctx.fillStyle = col; ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
    }
  },

  heli(ctx, x, y, t) {
    x = Math.round(x); y = Math.round(y);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(255,250,220,0.08)';
    for (let j = 0; j < 120; j++) { const w = 4 + j * 0.45; ctx.fillRect(Math.round(x - 2 - w / 2), y + 8 + j, Math.round(w), 1); }
    ctx.globalCompositeOperation = 'source-over';
    px(ctx, x - 12, y, 22, 8, '#2e3a2d'); px(ctx, x - 12, y, 22, 1, '#4a5a48');
    px(ctx, x + 4, y + 1, 6, 4, '#9fc8d8');
    px(ctx, x - 26, y + 2, 14, 2, '#2e3a2d'); px(ctx, x - 28, y - 2, 2, 7, '#2e3a2d');
    px(ctx, x - 8, y + 10, 18, 1, '#1a1f1a'); px(ctx, x - 6, y + 8, 1, 2, '#1a1f1a'); px(ctx, x + 6, y + 8, 1, 2, '#1a1f1a');
    px(ctx, x - 1, y - 3, 2, 3, '#1a1f1a');
    const blade = Math.floor(t * 30) % 2;
    px(ctx, x - (blade ? 18 : 12), y - 4, blade ? 36 : 24, 1, '#c8ccc0');
    if (Math.floor(t * 3) % 2) px(ctx, x - 28, y - 3, 1, 1, '#ff3a2a');
    px(ctx, x + 9, y + 6, 1, 1, '#fff6c0');
  },
};
