'use strict';
// ── 도트 그래픽: 팔레트 · 레벨 배경 미리 그리기 · 움직이는 타일 · HUD ──

const PALETTES = {
  dungeon: {
    bg: '#121827', brick: ['#1f2740', '#232c46', '#1b2238', '#262f4a'], mortar: '#0d111c', moss: '#1e3326',
    shadow: 'rgba(4,6,14,0.55)',
    top: '#6d7b99', topHi: '#93a0bc', topDk: '#56627e', front: '#3d4864', frontDk: '#272f45',
    wall: ['#4a5778', '#46536f', '#505d80', '#424e6a'], wallMortar: '#272f45', wallTop: '#7a87a6', wallEdge: '#2a3249',
    pillar: '#5b688c', pillarHi: '#7d89aa', pillarDk: '#3a4460',
    dark: 0.52,
  },
  palace: {
    bg: '#24160f', brick: ['#3f281a', '#47301f', '#3a2417', '#4d3422'], mortar: '#1a0f09', moss: '#3f281a',
    shadow: 'rgba(14,6,2,0.5)',
    top: '#c9a06a', topHi: '#e6c48e', topDk: '#a8824f', front: '#7d5636', frontDk: '#593b23',
    wall: ['#9a7048', '#916844', '#a2784e', '#8a623f'], wallMortar: '#5e4029', wallTop: '#d8b47e', wallEdge: '#5a3c25',
    pillar: '#d2b282', pillarHi: '#f0d8a8', pillarDk: '#9c7c52',
    frieze: ['#1f5d78', '#d8a548', '#2c7d93'],
    dark: 0.3,
  },
};

const SUPPORT = new Set('_|T w~^xABCDabcdeEhLS@gkVQ='.replace(' ', ''));
const isWallCh = (ch) => ch === '#';
const STATIC_SLAB = new Set('_|TwxABCDEhLS@gkVQ=^'.split(''));

function px(ctx, x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); }

function drawSlab(ctx, P, x0, y0, opts = {}) {
  const top = opts.top || P.top, front = opts.front || P.front;
  px(ctx, x0, y0 + SLAB, TW, 4, top);
  px(ctx, x0, y0 + SLAB, TW, 1, opts.hi || P.topHi);
  px(ctx, x0, y0 + SLAB + 4, TW, 5, front);
  px(ctx, x0, y0 + TH - 1, TW, 1, P.frontDk);
  px(ctx, x0, y0 + SLAB + 4, 1, 5, P.frontDk);
  // 윗면 얼룩
  for (let i = 0; i < 5; i++) {
    const hx = Math.floor(hash2(x0 + i * 7, y0) * 30) + 1, hy = Math.floor(hash2(x0, y0 + i * 3) * 3) + 1;
    px(ctx, x0 + hx, y0 + SLAB + hy, 1 + (i & 1), 1, P.topDk);
  }
}

function buildLevelCanvas(world) {
  const P = PALETTES[world.theme];
  const W = world.w * TW, H = world.h * TH;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H + 10;
  const ctx = cv.getContext('2d');
  px(ctx, 0, 0, cv.width, cv.height, P.bg);

  // 배경 석재 (전역 격자라 칸 경계가 이어진다)
  const BH = 11;
  for (let by = 0; by * BH < H + 10; by++) {
    const off = (by & 1) ? 12 : 0;
    for (let bx = -1; bx * 24 < W + 24; bx++) {
      const x = bx * 24 + off, y = by * BH, hsh = hash2(bx, by);
      px(ctx, x, y, 23, BH - 1, P.brick[Math.floor(hsh * 4)]);
      px(ctx, x, y, 23, 1, P.brick[3]);
      if (hsh > 0.86) px(ctx, x + 4 + Math.floor(hsh * 10), y + 3, 4, 2, P.moss);
      if (hsh < 0.08) { px(ctx, x + 8, y + 2, 1, 4, P.mortar); px(ctx, x + 9, y + 5, 3, 1, P.mortar); }
    }
    px(ctx, 0, by * BH + BH - 1, W, 1, P.mortar);
  }
  if (world.theme === 'palace') {
    for (let r = 0; r < world.h; r++) {
      const y = r * TH + 3;
      for (let x = 0; x < W; x += 8) {
        px(ctx, x, y, 8, 5, P.frieze[0]);
        px(ctx, x + 3, y + 1, 2, 3, P.frieze[1]);
        px(ctx, x, y + 2, 1, 1, P.frieze[2]);
      }
      px(ctx, 0, y - 1, W, 1, P.frieze[1]); px(ctx, 0, y + 5, W, 1, P.frieze[1]);
    }
  }

  for (let r = 0; r < world.h; r++) for (let c = 0; c < world.w; c++) {
    const ch = world.ch(c, r), x0 = c * TW, y0 = r * TH;
    if (ch === 'W' || ch === 'w') drawWindow(ctx, P, x0, y0, c);
    if (ch === 'T' || ch === 't') {
      px(ctx, x0 + 14, y0 + 26, 5, 2, '#5a3a1e'); px(ctx, x0 + 15, y0 + 28, 3, 6, '#3d2612');
      px(ctx, x0 + 13, y0 + 24, 7, 2, '#7a5530');
    }
  }
  // 바닥 아래 그림자
  for (let r = 0; r < world.h; r++) for (let c = 0; c < world.w; c++) {
    if (SUPPORT.has(world.ch(c, r)) && r + 1 < world.h && !isWallCh(world.ch(c, r + 1))) {
      ctx.fillStyle = P.shadow; ctx.fillRect(c * TW, r * TH + TH, TW, 5);
    }
  }
  // 기둥
  for (let r = 0; r < world.h; r++) for (let c = 0; c < world.w; c++) {
    if (world.ch(c, r) !== '|') continue;
    const x0 = c * TW + 9, y0 = r * TH;
    px(ctx, x0 - 2, y0 + 2, 18, 4, P.pillarDk); px(ctx, x0 - 2, y0 + 2, 18, 1, P.pillarHi);
    px(ctx, x0, y0 + 6, 14, SLAB - 6, P.pillar);
    px(ctx, x0, y0 + 6, 3, SLAB - 6, P.pillarHi);
    px(ctx, x0 + 11, y0 + 6, 3, SLAB - 6, P.pillarDk);
    px(ctx, x0 - 2, y0 + SLAB - 4, 18, 4, P.pillarDk); px(ctx, x0 - 2, y0 + SLAB - 4, 18, 1, P.pillarHi);
  }
  // 고정 바닥판
  for (let r = 0; r < world.h; r++) for (let c = 0; c < world.w; c++) {
    const ch = world.ch(c, r);
    if (!STATIC_SLAB.has(ch)) continue;
    drawSlab(ctx, P, c * TW, r * TH);
    const L = world.ch(c - 1, r), R = world.ch(c + 1, r);
    if (!SUPPORT.has(L) && !isWallCh(L)) px(ctx, c * TW, r * TH + SLAB, 1, 9, P.frontDk);
    if (!SUPPORT.has(R) && !isWallCh(R)) { px(ctx, c * TW + TW - 1, r * TH + SLAB, 1, 9, P.frontDk); px(ctx, c * TW + TW - 2, r * TH + SLAB + 4, 1, 5, P.frontDk); }
  }
  // 석벽
  for (let r = 0; r < world.h; r++) for (let c = 0; c < world.w; c++) {
    if (!isWallCh(world.ch(c, r))) continue;
    drawWallBlock(ctx, P, world, c, r);
  }
  return cv;
}

function drawWallBlock(ctx, P, world, c, r) {
  const x0 = c * TW, y0 = r * TH;
  const above = isWallCh(world.ch(c, r - 1));
  const top = above ? y0 : y0 - 9;
  const yEnd = y0 + TH;
  for (let y = top; y < yEnd; y += 8) {
    const brow = Math.floor((y + 9) / 8);
    const off = (brow & 1) ? 8 : 0;
    const h = Math.min(8, yEnd - y);
    for (let bx = -1; bx < 3; bx++) {
      const x = x0 + bx * 16 + off;
      const cx = Math.max(x, x0), cw = Math.min(x + 15, x0 + TW) - cx;
      if (cw <= 0) continue;
      const hs = hash2(c * 4 + bx, brow);
      px(ctx, cx, y, cw, h - 1, P.wall[Math.floor(hs * 4)]);
      px(ctx, cx, y, cw, 1, P.wallTop);
      if (hs > 0.9) px(ctx, cx + 3, y + 3, 3, 1, P.wallMortar);
    }
    px(ctx, x0, y + h - 1, TW, 1, P.wallMortar);
  }
  if (!above) { px(ctx, x0, top, TW, 3, P.wallTop); px(ctx, x0, top + 3, TW, 1, P.wallEdge); }
  if (!isWallCh(world.ch(c - 1, r))) px(ctx, x0, top, 1, yEnd - top, P.wallTop);
  if (!isWallCh(world.ch(c + 1, r))) { px(ctx, x0 + TW - 2, top, 2, yEnd - top, P.wallEdge); }
}

function drawWindow(ctx, P, x0, y0, c) {
  const wx = x0 + 6, wy = y0 + 12, ww = 20, wh = 34;
  px(ctx, wx - 2, wy - 2, ww + 4, wh + 4, P.pillarDk);
  for (let i = 0; i < 8; i++) { const w = Math.round(Math.sqrt(64 - (8 - i) * (8 - i)) * 1.25); px(ctx, wx + 10 - w, wy - 8 + i, w * 2, 1, P.pillarDk); }
  px(ctx, wx, wy, ww, wh, '#0b1533');
  for (let i = 0; i < 7; i++) { const w = Math.round(Math.sqrt(49 - (7 - i) * (7 - i)) * 1.4); px(ctx, wx + 10 - w, wy - 7 + i, w * 2, 1, '#0b1533'); }
  for (let i = 0; i < 6; i++) px(ctx, wx + Math.floor(hash2(c, i) * 19), wy - 4 + Math.floor(hash2(i, c) * 30), 1, 1, i % 3 ? '#8aa0d8' : '#fff4c8');
  if (c % 3 === 1) { px(ctx, wx + 11, wy + 4, 5, 5, '#f4e6b0'); px(ctx, wx + 13, wy + 4, 3, 3, '#0b1533'); }
  px(ctx, wx + 9, wy - 6, 2, wh + 6, P.pillar);
  px(ctx, wx - 3, wy + wh, ww + 6, 3, P.pillarHi);
}

// ── 조명: 횃불 주변 디더링 빛 ─────────────────────────────────────
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
function makeLightSprite(R) {
  const cv = document.createElement('canvas'); cv.width = cv.height = R * 2;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(R * 2, R * 2);
  for (let y = 0; y < R * 2; y++) for (let x = 0; x < R * 2; x++) {
    const d = Math.hypot(x - R + 0.5, y - R + 0.5) / R;
    let v = clamp(1 - d * d, 0, 1);
    const q = Math.floor(v * 3 + BAYER[(y & 3) * 4 + (x & 3)]) / 3;
    const i = (y * R * 2 + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = Math.round(clamp(q, 0, 1) * 255);
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

// ── 움직이는 타일 ──────────────────────────────────────────────────
const Art = {
  light: null, darkCv: null,
  init() {
    this.light = makeLightSprite(64);
    this.darkCv = document.createElement('canvas'); this.darkCv.width = VW; this.darkCv.height = PH;
  },

  flame(ctx, x, y, t, k) {
    const f = Math.floor(t * 12 + k * 3) % 4;
    const hgt = [9, 11, 10, 12][f], sway = [0, 1, 0, -1][f];
    px(ctx, x - 2, y - 3, 5, 3, '#c43a10');
    px(ctx, x - 2 + sway, y - hgt + 2, 5, hgt - 4, '#f07a18');
    px(ctx, x - 1 + sway, y - hgt + 4, 3, hgt - 6, '#ffc93a');
    px(ctx, x + sway, y - hgt, 1, 3, '#f07a18');
    px(ctx, x + sway, y - 5, 1, 2, '#fff6c0');
    if (f === 2) px(ctx, x + 2, y - hgt - 2, 1, 1, '#ffb030');
  },

  drawTile(ctx, P, w, c, r, t, pass) {
    const ch = w.ch(c, r), st = w.state(c, r), x0 = c * TW, y0 = r * TH;
    if (pass === 'back' && (ch === 'T' || ch === 't')) this.flame(ctx, x0 + 16, y0 + 24, t, c + r);
    if (!st) return;
    const front = st.kind === 'gate' || st.kind === 'chomper';
    if ((pass === 'back') === front) return;
    if (st.rubble) {
      for (let i = 0; i < 7; i++) px(ctx, x0 + 3 + Math.floor(hash2(c, i) * 26), y0 + SLAB - 1 - (i % 2), 2 + (i % 3), 2, i & 1 ? P.topDk : P.front);
    }
    switch (st.kind) {
      case 'loose': {
        if (st.gone) break;
        const j = st.shake > 0 ? (Math.floor(t * 40) % 2 ? 1 : -1) : 0;
        const dy = st.shake > 0 ? (Math.floor(t * 30) % 3 === 0 ? -1 : 0) : 0;
        drawSlab(ctx, P, x0 + j, y0 + dy, { top: P.topDk });
        px(ctx, x0 + 9 + j, y0 + SLAB + dy, 1, 4, P.frontDk); px(ctx, x0 + 22 + j, y0 + SLAB + 1 + dy, 1, 3, P.frontDk);
        break;
      }
      case 'plate': {
        drawSlab(ctx, P, x0, y0);
        const down = st.down ? 1 : 0, exit = st.exit;
        px(ctx, x0 + 5, y0 + SLAB - 1 + down, 22, 2, exit ? '#d9a43a' : P.topHi);
        px(ctx, x0 + 5, y0 + SLAB + 1 + down, 22, 1, exit ? '#8a5e1a' : P.frontDk);
        break;
      }
      case 'spikes': {
        const s = st.out;
        for (let i = 0; i < 5; i++) {
          const sx = x0 + 3 + i * 6, hgt = Math.round(s * (8 + (i % 2) * 3));
          px(ctx, sx + 1, y0 + SLAB + 1, 2, 1, '#10121a');
          if (hgt <= 0) continue;
          for (let k = 0; k < hgt; k++) {
            const wdt = k < hgt - 2 ? 3 : 1, ox = wdt === 3 ? 0 : 1;
            px(ctx, sx + ox, y0 + SLAB + 1 - k, wdt, 1, k % 3 === 0 ? '#9aa4b8' : '#cfd6e2');
          }
          if (st.blood) px(ctx, sx + 1, y0 + SLAB - hgt + 2, 1, 3, '#a3141c');
        }
        break;
      }
      case 'chomper': {
        const cl = st.close; // 0 열림 → 1 닫힘
        const cx = x0 + 14;
        px(ctx, cx - 3, y0 + 2, 10, 3, '#3a3f4c');
        const upEnd = Math.round(lerp(12, 29, cl)), loEnd = Math.round(lerp(46, 29, cl));
        px(ctx, cx, y0 + 4, 4, upEnd - 4, '#59606f');
        px(ctx, cx + 1, y0 + 4, 1, upEnd - 4, '#9aa4b8');
        px(ctx, cx - 1, upEnd - 3 + y0, 6, 3, '#d8dee9');
        px(ctx, cx, loEnd + y0, 4, SLAB - loEnd, '#59606f');
        px(ctx, cx + 1, loEnd + y0, 1, SLAB - loEnd, '#9aa4b8');
        px(ctx, cx - 1, loEnd + y0, 6, 3, '#d8dee9');
        if (st.blood) { px(ctx, cx - 1, upEnd + y0 - 2, 6, 2, '#a3141c'); px(ctx, cx, loEnd + y0, 4, 2, '#a3141c'); }
        break;
      }
      case 'gate': {
        const o = st.open, gx = x0 + 21, top = y0 + 1, full = SLAB - 2;
        const bottom = Math.round(top + full * (1 - o * 0.86));
        px(ctx, gx - 1, y0, 9, 2, '#2a2d36');
        for (let i = 0; i < 3; i++) px(ctx, gx + i * 3, top, 2, bottom - top, i === 1 ? '#8a90a0' : '#5d6372');
        for (let y = bottom - 2; y > top + 2; y -= 9) px(ctx, gx - 1, y, 9, 1, '#3c414e');
        px(ctx, gx - 1, bottom - 2, 9, 2, '#2a2d36');
        for (let i = 0; i < 3; i++) px(ctx, gx + i * 3, bottom, 2, 1, '#cfd6e2');
        break;
      }
      case 'door': {
        const dx = x0 + 3, dw = 26, dh = 46, dy = y0 + SLAB - dh;
        px(ctx, dx - 3, dy - 5, dw + 6, dh + 5, P.wallEdge);
        px(ctx, dx - 2, dy - 4, dw + 4, 3, P.wallTop);
        px(ctx, dx, dy, dw, dh, '#0d0906');
        for (let i = 0; i < 5; i++) px(ctx, dx + 2, dy + dh - 6 - i * 8, dw - 4 - i * 2, 2, i % 2 ? '#3a2a1c' : '#5a4430');
        if (st.open > 0.05) { ctx.fillStyle = 'rgba(255,214,140,0.18)'; ctx.fillRect(dx, dy, dw, dh); }
        const ph = Math.round(dh * (1 - st.open));
        if (ph > 0) {
          px(ctx, dx, dy, dw, ph, '#6a4a2a');
          for (let i = 2; i < dw; i += 6) px(ctx, dx + i, dy, 2, ph, '#4e351c');
          px(ctx, dx, dy + ph - 2, dw, 2, '#2e1e10');
          px(ctx, dx, dy + 3, dw, 1, '#8a6a3a');
        }
        break;
      }
      case 'potion': {
        if (st.taken) break;
        const big = st.big, bx = x0 + 14, by = y0 + SLAB - 1;
        const glass = big ? '#4ecf9a' : '#e0384a', hi = big ? '#bff5dc' : '#ffb0b8';
        const bh = big ? 9 : 7;
        px(ctx, bx - 2, by - bh, 6, bh, glass);
        px(ctx, bx - 1, by - bh - 3, 4, 3, '#c9d2e0'); px(ctx, bx - 1, by - bh - 4, 4, 1, '#7a5530');
        px(ctx, bx - 1, by - bh + 1, 1, 3, hi);
        if (big) { px(ctx, bx - 3, by - bh + 2, 8, 4, glass); }
        const bub = (t * 1.6 + c * 0.3) % 1;
        px(ctx, bx + 1, by - bh - 4 - Math.floor(bub * 8), 1, 1, hi);
        break;
      }
      case 'sword': {
        if (st.taken) break;
        const sx = x0 + 6, sy = y0 + SLAB;
        px(ctx, sx, sy, 17, 1, '#d8dee9'); px(ctx, sx, sy + 1, 17, 1, '#8a92a4');
        px(ctx, sx + 17, sy - 1, 2, 4, '#d9a43a'); px(ctx, sx + 19, sy, 5, 2, '#6a3a1a');
        if (Math.floor(t * 2) % 3 === 0) { const gx = sx + Math.floor((t * 20) % 16); px(ctx, gx, sy - 1, 1, 3, '#ffffff'); }
        break;
      }
    }
  },

  drawDarkness(ctx, w, camX, camY, t) {
    const P = PALETTES[w.theme];
    const d = this.darkCv.getContext('2d');
    d.globalCompositeOperation = 'source-over';
    d.clearRect(0, 0, VW, PH);
    d.fillStyle = `rgba(2,3,10,${P.dark})`;
    d.fillRect(0, 0, VW, PH);
    d.globalCompositeOperation = 'destination-out';
    for (const L of w.lights) {
      const sx = Math.round(L.x - camX), sy = Math.round(L.y - camY);
      if (sx < -80 || sx > VW + 80 || sy < -80 || sy > PH + 80) continue;
      const flick = Math.sin(t * 9 + L.x) * 2 + Math.sin(t * 23 + L.y);
      const R = Math.round(L.r + flick);
      d.drawImage(this.light, sx - R, sy - R, R * 2, R * 2);
    }
    d.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.darkCv, 0, 0);
  },
};

// ── 3×5 도트 숫자 글꼴 ──────────────────────────────────────────────
const DIGITS = {
  '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111',
  '4': '101101111001001', '5': '111100111001111', '6': '111100111101111', '7': '111001010010010',
  '8': '111101111101111', '9': '111101111001111', ':': '000010000010000',
};
function drawDigits(ctx, str, x, y, color) {
  ctx.fillStyle = color;
  for (const chr of str) {
    const g = DIGITS[chr];
    if (g) for (let i = 0; i < 15; i++) if (g[i] === '1') ctx.fillRect(x + (i % 3), y + Math.floor(i / 3), 1, 1);
    x += chr === ':' ? 3 : 4;
  }
}

function drawHpFlask(ctx, x, y, full, color, dim) {
  // 원작의 삼각형 체력 표시
  for (let i = 0; i < 6; i++) {
    const wdt = 7 - i;
    const off = Math.floor(i / 2);
    ctx.fillStyle = full ? (i === 0 ? '#ffffff' : color) : dim;
    if (full || i === 0 || i === 5) ctx.fillRect(x + off, y + 6 - i, Math.max(1, wdt - off), 1);
    else { ctx.fillRect(x + off, y + 6 - i, 1, 1); ctx.fillRect(x + off + Math.max(1, wdt - off) - 1, y + 6 - i, 1, 1); }
  }
}
