'use strict';
// ── 도트 그래픽: 테마 팔레트 · 레벨 미리 그리기 · 움직이는 타일 · HUD ──

const PALETTES = {
  subway: {
    bg: '#1b1d1c', tile: ['#929388', '#8b8d82', '#98988c', '#86887e'], grout: '#6c6d64', grime: 'rgba(40,36,26,0.45)',
    hole: '#2a2b26', stripe: '#00a84d', stripeDk: '#00702f', wains: ['#4a4f4a', '#454a45', '#505550'],
    tunnel: ['#2d302e', '#2a2d2b', '#313431'], cable: '#141615',
    shadow: 'rgba(0,0,0,0.5)',
    top: '#8b8d86', topHi: '#abada5', topDk: '#6d6f69', front: '#4b4d49', frontDk: '#2e302c', tactile: '#e3b51f', tactileDk: '#9c7a0c',
    ballast: '#3b3732', sleeper: '#5a3f2a', rail: '#b7bcc2', railDk: '#6c7178',
    wall: ['#5b5e59', '#56595a', '#615f5a', '#4f5251'], wallMortar: '#3a3c3a', wallTop: '#7b7e79', wallEdge: '#333530',
    pillar: '#b9b8aa', pillarHi: '#d6d4c5', pillarDk: '#7c7d72',
    dark: 0.64, flashlight: true,
  },
  bridge: {
    transparent: true, bg: '#120d16',
    shadow: 'rgba(0,0,0,0.35)',
    top: '#4b4b4f', topHi: '#6d6d72', topDk: '#38383c', front: '#78746c', frontDk: '#4a463f', lane: '#d9d4c2',
    girder: '#5b3326', girderHi: '#7e4a35', girderDk: '#3a1e16',
    wall: ['#78746c', '#706c64', '#807c73', '#69655d'], wallMortar: '#4a463f', wallTop: '#9b968b', wallEdge: '#3b382f',
    pillar: '#5e6063', pillarHi: '#8b8e91', pillarDk: '#3a3b3e',
    dark: 0.26,
  },
  tower: {
    bg: '#13171b', panel: ['#252b32', '#293037', '#22282f', '#2c323a'], seam: '#14191e', rivet: '#3f4750',
    shadow: 'rgba(0,0,0,0.45)',
    top: '#47515b', topHi: '#6b7783', topDk: '#36404a', front: '#2b3139', frontDk: '#1a1f24',
    wall: ['#3b4149', '#363c44', '#40464e', '#31373f'], wallMortar: '#22272d', wallTop: '#5b646e', wallEdge: '#1c2126',
    pillar: '#4b535c', pillarHi: '#6d7781', pillarDk: '#2d3339',
    dark: 0.44,
  },
};

const SUPPORT = new Set('_|Twx^zABCDabcdeEhLS@gkVQ='.split(''));
const isWallCh = (ch) => ch === '#';
const STATIC_SLAB = new Set('_|TwxABCDEhLS@gkVQ=^z'.split(''));

function px(ctx, x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); }

// 작은 글씨를 도트처럼 또렷하게: 임시 캔버스에 쓰고 알파값을 이진화
const _pt = document.createElement('canvas'); _pt.width = 120; _pt.height = 24;
function pixelText(ctx, text, x, y, size, color, weight = 700) {
  const t = _pt.getContext('2d');
  t.clearRect(0, 0, 120, 24);
  t.font = `${weight} ${size}px 'IBM Plex Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif`;
  t.textBaseline = 'top'; t.fillStyle = '#fff'; t.fillText(text, 0, 0);
  const w = Math.min(120, Math.ceil(t.measureText(text).width) + 1);
  const d = t.getImageData(0, 0, w, 24).data;
  ctx.fillStyle = color;
  for (let j = 0; j < 24; j++) for (let i = 0; i < w; i++) if (d[(j * 120 + i) * 4 + 3] > 120) ctx.fillRect(x + i, y + j, 1, 1);
  return w;
}

function drawSlab(ctx, P, x0, y0, opts = {}) {
  const top = opts.top || P.top, front = opts.front || P.front;
  px(ctx, x0, y0 + SLAB, TW, 4, top);
  px(ctx, x0, y0 + SLAB, TW, 1, opts.hi || P.topHi);
  px(ctx, x0, y0 + SLAB + 4, TW, 5, front);
  px(ctx, x0, y0 + TH - 1, TW, 1, P.frontDk);
  px(ctx, x0, y0 + SLAB + 4, 1, 5, P.frontDk);
  for (let i = 0; i < 5; i++) {
    const hx = Math.floor(hash2(x0 + i * 7, y0) * 30) + 1, hy = Math.floor(hash2(x0, y0 + i * 3) * 3) + 1;
    px(ctx, x0 + hx, y0 + SLAB + hy, 1 + (i & 1), 1, P.topDk);
  }
}

function buildLevelCanvas(world) {
  const P = PALETTES[world.theme], th = world.theme;
  const W = world.w * TW, H = world.h * TH;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H + 12;
  const ctx = cv.getContext('2d');
  if (!P.transparent) px(ctx, 0, 0, cv.width, cv.height, P.bg);
  if (th === 'subway') drawSubwayWalls(ctx, P, world);
  if (th === 'tower') drawTowerWalls(ctx, P, world);

  for (const pr of world.def.props || []) drawProp(ctx, P, world, pr);
  for (let r = 0; r < world.h; r++) for (let c = 0; c < world.w; c++) {
    const ch = world.ch(c, r), x0 = c * TW, y0 = r * TH;
    if ((ch === 'W' || ch === 'w') && th === 'subway') drawAdBox(ctx, x0, y0, c, r);
    if ((ch === 'W' || ch === 'w') && th === 'tower') drawTowerWindow(ctx, P, world, c, r);
    if ((ch === 'T' || ch === 't') && th === 'subway') { px(ctx, x0 + 4, y0 + 1, 24, 2, '#3c3f3d'); px(ctx, x0 + 5, y0 + 3, 22, 3, '#2a2c2b'); }
    if ((ch === 'T' || ch === 't') && th === 'tower') { px(ctx, x0 + 12, y0 + 9, 9, 7, '#2a2f35'); px(ctx, x0 + 13, y0 + 16, 7, 1, '#141719'); }
    if (ch === 'T' && th === 'bridge') drawBarrel(ctx, x0, y0);
  }
  for (const s of world.def.signs || []) drawStationSign(ctx, s);
  if (th === 'bridge') drawRailings(ctx, P, world);
  // 바닥 아래 그림자
  for (let r = 0; r < world.h; r++) for (let c = 0; c < world.w; c++) {
    if (SUPPORT.has(world.ch(c, r)) && r + 1 < world.h && !isWallCh(world.ch(c, r + 1))) {
      ctx.fillStyle = P.shadow; ctx.fillRect(c * TW, r * TH + TH, TW, 5);
    }
  }
  for (let r = 0; r < world.h; r++) for (let c = 0; c < world.w; c++) if (world.ch(c, r) === '|') drawPillar(ctx, P, th, c, r);
  for (let r = 0; r < world.h; r++) for (let c = 0; c < world.w; c++) {
    const ch = world.ch(c, r);
    if (!STATIC_SLAB.has(ch)) continue;
    drawFloor(ctx, P, world, c, r);
  }
  for (let r = 0; r < world.h; r++) for (let c = 0; c < world.w; c++) if (isWallCh(world.ch(c, r))) drawWallBlock(ctx, P, world, c, r);
  if (th === 'bridge') {
    // 맨 아랫줄 교각
    for (let c = 0; c < world.w; c++) if (SUPPORT.has(world.ch(c, world.h - 1))) {
      const x0 = c * TW, y0 = world.h * TH;
      px(ctx, x0 + 2, y0, 28, 12, P.wall[1]); px(ctx, x0 + 2, y0, 28, 1, P.wallTop);
    }
  }
  return cv;
}

function drawFloor(ctx, P, w, c, r) {
  const x0 = c * TW, y0 = r * TH, th = w.theme;
  const L = w.ch(c - 1, r), R = w.ch(c + 1, r);
  const edgeL = !SUPPORT.has(L) && !isWallCh(L), edgeR = !SUPPORT.has(R) && !isWallCh(R);
  if (th === 'subway' && r === w.def.trackRow) {
    px(ctx, x0, y0 + SLAB, TW, 9, P.ballast);
    for (let i = 0; i < 4; i++) px(ctx, x0 + 2 + i * 8, y0 + SLAB + 1, 5, 3, P.sleeper);
    for (let i = 0; i < 6; i++) px(ctx, x0 + Math.floor(hash2(c, i) * 31), y0 + SLAB + 4 + (i % 4), 1, 1, '#57514a');
    px(ctx, x0, y0 + SLAB - 1, TW, 2, P.rail); px(ctx, x0, y0 + SLAB - 1, TW, 1, '#e0e4e8'); px(ctx, x0, y0 + SLAB + 1, TW, 1, P.railDk);
    px(ctx, x0, y0 + TH - 1, TW, 1, '#1c1a17');
    return;
  }
  drawSlab(ctx, P, x0, y0);
  if (th === 'subway') {
    // 승강장·계단 가장자리의 노란 점자블록
    if (edgeL || edgeR) {
      const sx = edgeL ? x0 : x0 + 8, sw = 24;
      px(ctx, sx, y0 + SLAB, sw, 4, P.tactile);
      for (let i = 1; i < sw; i += 3) px(ctx, sx + i, y0 + SLAB + 1 + (i % 2), 1, 1, P.tactileDk);
    }
  } else if (th === 'bridge') {
    if (r <= 2) for (let i = 0; i < 2; i++) px(ctx, x0 + 4 + i * 16, y0 + SLAB + 2, 8, 1, P.lane);
    // 상판 아래 녹슨 철골
    px(ctx, x0, y0 + TH, TW, 2, P.girderHi); px(ctx, x0, y0 + TH + 2, TW, 4, P.girder); px(ctx, x0, y0 + TH + 6, TW, 1, P.girderDk);
    for (let i = 3; i < TW; i += 8) px(ctx, x0 + i, y0 + TH + 3, 1, 1, P.girderHi);
  } else if (th === 'tower') {
    for (let i = 0; i < TW; i += 8) px(ctx, x0 + i, y0 + SLAB + 4, 1, 5, P.frontDk);
  }
  if (edgeL) px(ctx, x0, y0 + SLAB, 1, 9, P.frontDk);
  if (edgeR) { px(ctx, x0 + TW - 1, y0 + SLAB, 1, 9, P.frontDk); px(ctx, x0 + TW - 2, y0 + SLAB + 4, 1, 5, P.frontDk); }
}

function drawSubwayWalls(ctx, P, w) {
  for (let r = 0; r < w.h; r++) for (let c = 0; c < w.w; c++) {
    const x0 = c * TW, y0 = r * TH;
    const tunnel = w.def.trackRow != null && r >= w.def.trackRow - 1;
    if (tunnel) {
      for (let y = 0; y < TH; y += 9) for (let x = 0; x < TW; x += 16) {
        const off = ((y / 9) & 1) ? 8 : 0;
        px(ctx, x0 + x + off - 8, y0 + y, 15, 8, P.tunnel[Math.floor(hash2(c * 3 + x, r * 9 + y) * 3)]);
      }
      if (r === w.def.trackRow - 1) for (let k = 0; k < 3; k++) px(ctx, x0, y0 + 16 + k * 4, TW, 1, P.cable);
      if (r === w.def.trackRow - 1 && c % 3 === 0) px(ctx, x0 + 4, y0 + 14, 2, 14, '#3a3d3b');
      continue;
    }
    for (let y = 0; y < TH; y += 8) for (let x = 0; x < TW; x += 8) {
      const hs = hash2(c * 4 + x / 8, r * 8 + y / 8);
      const col = hs < 0.015 ? P.hole : P.tile[Math.floor(hs * 97) % 4];
      px(ctx, x0 + x, y0 + y, 7, 7, col);
    }
    px(ctx, x0, y0, TW, TH, 'rgba(0,0,0,0)');
    for (let y = 7; y < TH; y += 8) px(ctx, x0, y0 + y, TW, 1, P.grout);
    for (let x = 7; x < TW; x += 8) px(ctx, x0 + x, y0, 1, TH, P.grout);
    if (SUPPORT.has(w.ch(c, r))) {
      // 2호선 초록 띠 + 아래 벽판
      px(ctx, x0, y0 + 26, TW, 4, P.stripe); px(ctx, x0, y0 + 30, TW, 1, P.stripeDk);
      for (let y = 36; y < SLAB; y += 6) for (let x = 0; x < TW; x += 16) px(ctx, x0 + x, y0 + y, 15, 5, P.wains[Math.floor(hash2(c + x, y) * 3)]);
    }
    // 물 얼룩
    if (hash2(c, r * 7) > 0.7) { ctx.fillStyle = P.grime; ctx.fillRect(x0 + Math.floor(hash2(r, c) * 24), y0, 3 + Math.floor(hash2(c, c) * 4), 20 + Math.floor(hash2(r, r) * 30)); }
  }
}

function drawTowerWalls(ctx, P, w) {
  for (let r = 0; r < w.h; r++) for (let c = 0; c < w.w; c++) {
    const x0 = c * TW, y0 = r * TH;
    for (let k = 0; k < 3; k++) {
      const y = y0 + k * 21;
      px(ctx, x0, y, TW, 20, P.panel[Math.floor(hash2(c, r * 3 + k) * 4)]);
      px(ctx, x0, y + 20, TW, 1, P.seam);
      px(ctx, x0 + 2, y + 2, 1, 1, P.rivet); px(ctx, x0 + TW - 3, y + 2, 1, 1, P.rivet);
    }
    px(ctx, x0 + TW - 1, y0, 1, TH, P.seam);
  }
}

function drawAdBox(ctx, x0, y0, c, r) {
  const bx = x0 + 3, by = y0 + 6, bw = 26, bh = 18;
  px(ctx, bx - 1, by - 1, bw + 2, bh + 2, '#2c2e2c');
  const broken = hash2(c, r) < 0.4;
  if (broken) {
    px(ctx, bx, by, bw, bh, '#1b1c1b');
    for (let i = 0; i < 6; i++) px(ctx, bx + 3 + i * 3, by + 2 + ((i * 5) % 12), 2, 1, '#4a4d4a');
    px(ctx, bx + 12, by + bh, 1, 6, '#141514');
    return;
  }
  const hues = ['#e8d6b8', '#c9dce6', '#e6c6cf', '#d7e2c2'];
  px(ctx, bx, by, bw, bh, hues[Math.floor(hash2(r, c) * 4)]);
  px(ctx, bx + 2, by + 2, 9, 9, ['#c0503a', '#3a6aa8', '#2f8f5a', '#a8742a'][Math.floor(hash2(c, 9) * 4)]);
  px(ctx, bx + 13, by + 3, 10, 2, '#555'); px(ctx, bx + 13, by + 7, 8, 1, '#777'); px(ctx, bx + 13, by + 10, 9, 1, '#777');
  px(ctx, bx + 2, by + 14, 21, 2, '#444');
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(bx, by + 9, bw, 9);
}

// 역 이름판용 손으로 찍은 글자 (9×10)
const GLYPHS = {
  '시': ['.......#.', '...#...#.', '...#...#.', '..#.#..#.', '..#.#..#.', '.#...#.#.', '#.....##.', '.......#.', '.......#.', '.......#.'],
  '청': ['..#....#.', '#####..#.', '..#...##.', '.#.#...#.', '#...#..#.', '.........', '..#####..', '.#.....#.', '.#.....#.', '..#####..'],
};
function drawGlyphs(ctx, text, x, y, color) {
  ctx.fillStyle = color;
  for (const ch of text) {
    const g = GLYPHS[ch];
    if (g) g.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] === '#') ctx.fillRect(x + i, y + j, 1, 1); });
    x += 10;
  }
}

function drawStationSign(ctx, s) {
  const x = s.c * TW + 2, y = s.r * TH + 8;
  px(ctx, x - 1, y - 1, 46, 15, '#262826');
  px(ctx, x, y, 44, 13, '#e9ebe6');
  px(ctx, x + 2, y + 2, 9, 9, '#00a84d');
  drawDigits(ctx, '2', x + 5, y + 4, '#ffffff');
  drawGlyphs(ctx, s.text, x + 15, y + 2, '#1d1f1d');
  px(ctx, x, y + 13, 44, 1, '#00a84d');
}

function drawTowerWindow(ctx, P, w, c, r) {
  const x0 = c * TW, y0 = r * TH;
  const up = w.ch(c, r - 1), dn = w.ch(c, r + 1);
  const topOpen = up === 'W' || up === 'w', botOpen = dn === 'W' || dn === 'w';
  const wx = x0 + 3, ww = 26, wy = y0 + (topOpen ? 0 : 6), wh = (botOpen ? TH : SLAB - 4) - (wy - y0);
  ctx.drawImage(Backdrop.city, (x0 * 0.5) % (Backdrop.city.width - 40), Math.max(0, (wy - y0) + r * 24) % 90, ww, wh, wx, wy, ww, wh);
  px(ctx, wx - 2, wy, 2, wh, P.pillarDk); px(ctx, wx + ww, wy, 2, wh, P.pillarDk);
  if (!topOpen) px(ctx, wx - 2, wy - 2, ww + 4, 2, P.pillarDk);
  if (!botOpen) px(ctx, wx - 3, wy + wh, ww + 6, 2, P.pillarHi);
  px(ctx, wx + 12, wy, 1, wh, P.pillarDk);
  if (hash2(c, r) > 0.55) { // 금 간 유리
    const cx = wx + 4 + Math.floor(hash2(r, c) * 16), cy = wy + 8;
    for (let i = 0; i < 6; i++) { px(ctx, cx + i, cy + i, 1, 1, '#c8d6e0'); px(ctx, cx - i / 2, cy + i, 1, 1, '#9fb0bc'); }
  }
}

function drawPillar(ctx, P, th, c, r) {
  const x0 = c * TW, y0 = r * TH;
  if (th === 'subway') {
    const bx = x0 + 8;
    px(ctx, bx, y0, 16, SLAB, P.pillar);
    for (let y = 0; y < SLAB; y += 6) px(ctx, bx, y0 + y, 16, 1, P.pillarDk);
    px(ctx, bx + 8, y0, 1, SLAB, P.pillarDk);
    px(ctx, bx, y0, 2, SLAB, P.pillarHi); px(ctx, bx + 14, y0, 2, SLAB, P.pillarDk);
  } else if (th === 'bridge') {
    // 꺾인 가로등
    const bx = x0 + 14;
    px(ctx, bx, y0 + 10, 3, SLAB - 10, P.pillar); px(ctx, bx, y0 + 10, 1, SLAB - 10, P.pillarHi);
    for (let i = 0; i < 9; i++) px(ctx, bx + 2 + i, y0 + 10 - Math.floor(i / 2) + (i > 5 ? i - 5 : 0), 2, 2, P.pillar);
    px(ctx, bx + 10, y0 + 10, 5, 3, P.pillarDk); px(ctx, bx + 11, y0 + 13, 3, 1, '#2a2a2a');
    px(ctx, bx - 2, y0 + SLAB - 3, 7, 3, P.pillarDk);
  } else {
    const bx = x0 + 9;
    px(ctx, bx, y0, 14, SLAB, P.pillar);
    px(ctx, bx, y0, 14, 1, P.pillarHi); px(ctx, bx + 5, y0, 4, SLAB, P.pillarDk);
    px(ctx, bx, y0, 2, SLAB, P.pillarHi);
    for (let y = 6; y < SLAB; y += 12) { px(ctx, bx + 1, y0 + y, 1, 1, P.rivet || '#888'); px(ctx, bx + 12, y0 + y, 1, 1, P.rivet || '#888'); }
  }
}

function drawBarrel(ctx, x0, y0) {
  const bx = x0 + 9, by = y0 + SLAB - 14;
  px(ctx, bx, by, 14, 14, '#6a3420'); px(ctx, bx, by, 14, 1, '#8a4a2a');
  px(ctx, bx, by + 4, 14, 1, '#4a2214'); px(ctx, bx, by + 9, 14, 1, '#4a2214');
  px(ctx, bx + 2, by + 1, 2, 12, '#7e4426'); px(ctx, bx + 11, by + 1, 2, 12, '#4a2214');
}

function drawRailings(ctx, P, w) {
  for (let r = 0; r < w.h; r++) for (let c = 0; c < w.w; c++) {
    if (!STATIC_SLAB.has(w.ch(c, r)) && w.ch(c, r) !== '~') continue;
    const x0 = c * TW, y0 = r * TH, top = y0 + SLAB - 11;
    px(ctx, x0, top, TW, 2, '#4f5256'); px(ctx, x0, top, TW, 1, '#7a7e83');
    px(ctx, x0, top + 6, TW, 1, '#3c3f43');
    for (let i = 2; i < TW; i += 10) px(ctx, x0 + i, top + 1, 2, 10, '#3c3f43');
  }
}

function drawProp(ctx, P, w, pr) {
  if (pr.type === 'bus') {
    // 추락한 파란 간선버스: 지붕이 r층 바닥(턱) 역할
    const x = pr.c0 * TW - 4, x1 = (pr.c1 + 1) * TW + 4, top = ledgeY(pr.r) + 4, bot = ledgeY(pr.r + 1) - 2;
    px(ctx, x, top, x1 - x, bot - top, '#2457a6');
    px(ctx, x, top, x1 - x, 2, '#3a74c9');
    px(ctx, x + 4, top + 6, x1 - x - 8, 14, '#10203a');
    for (let i = x + 12; i < x1 - 6; i += 16) px(ctx, i, top + 6, 2, 14, '#2457a6');
    px(ctx, x, top + 24, x1 - x, 3, '#e8e2d0');
    px(ctx, x + 6, top + 8, 14, 5, '#ffb83a');
    for (const wx of [x + 16, x1 - 22]) { px(ctx, wx, bot - 6, 10, 6, '#151515'); px(ctx, wx + 3, bot - 4, 4, 2, '#555'); }
    for (let i = 0; i < 5; i++) px(ctx, x + 30 + i * 9, top + 8 + (i % 3) * 3, 3, 1, '#7a8aa8');
  } else if (pr.type === 'car') {
    const x = pr.c * TW + 2, b = ledgeY(pr.r) - 1;
    px(ctx, x, b - 9, 28, 7, pr.color); px(ctx, x + 6, b - 14, 15, 5, pr.color);
    px(ctx, x + 8, b - 13, 5, 3, '#14181c'); px(ctx, x + 14, b - 13, 5, 3, '#14181c');
    px(ctx, x + 3, b - 3, 6, 3, '#111'); px(ctx, x + 19, b - 3, 6, 3, '#111');
    px(ctx, x, b - 9, 28, 1, 'rgba(255,255,255,0.25)');
  } else if (pr.type === 'locks') {
    // 남산 사랑의 자물쇠 울타리
    const x = pr.c0 * TW, x1 = (pr.c1 + 1) * TW, top = pr.r * TH + 26, bot = pr.r * TH + SLAB;
    for (let y = top; y < bot; y += 4) px(ctx, x, y, x1 - x, 1, '#5d646c');
    for (let i = x; i < x1; i += 4) px(ctx, i, top, 1, bot - top, '#4a5158');
    const cols = ['#e2463c', '#f2b632', '#4fa3e0', '#e46ab0', '#6fcf6a', '#f08a3a'];
    for (let i = 0; i < (x1 - x) * 0.7; i++) {
      const lx = x + Math.floor(hash2(i, 3) * (x1 - x - 3)), ly = top + Math.floor(hash2(7, i) * (bot - top - 4));
      px(ctx, lx, ly, 3, 3, cols[i % cols.length]); px(ctx, lx + 1, ly - 1, 1, 1, '#9aa0a8');
    }
  }
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
      if (world.theme !== 'tower') px(ctx, cx, y, cw, 1, P.wallTop);
      if (hs > 0.9) px(ctx, cx + 3, y + 3, 3, 1, P.wallMortar);
    }
    px(ctx, x0, y + h - 1, TW, 1, P.wallMortar);
  }
  if (!above) { px(ctx, x0, top, TW, 3, P.wallTop); px(ctx, x0, top + 3, TW, 1, P.wallEdge); }
  if (!isWallCh(world.ch(c - 1, r))) px(ctx, x0, top, 1, yEnd - top, P.wallTop);
  if (!isWallCh(world.ch(c + 1, r))) px(ctx, x0 + TW - 2, top, 2, yEnd - top, P.wallEdge);
  if (world.theme === 'bridge' && hash2(c, r) > 0.6) {
    // 부서진 콘크리트 사이로 튀어나온 철근
    const rx = x0 + 6 + Math.floor(hash2(r, c) * 18);
    px(ctx, rx, top - 4, 1, 6, '#8a4a2a'); px(ctx, rx + 3, top - 2, 1, 4, '#8a4a2a');
  }
}

// ── 조명 ──────────────────────────────────────────────────────────
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
function makeLightSprite(R) {
  const cv = document.createElement('canvas'); cv.width = cv.height = R * 2;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(R * 2, R * 2);
  for (let y = 0; y < R * 2; y++) for (let x = 0; x < R * 2; x++) {
    const d = Math.hypot(x - R + 0.5, y - R + 0.5) / R;
    const v = clamp(1 - d * d, 0, 1);
    const q = Math.floor(v * 3 + BAYER[(y & 3) * 4 + (x & 3)]) / 3;
    const i = (y * R * 2 + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = Math.round(clamp(q, 0, 1) * 255);
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}
function makeGlow(rgb, R) {
  const cv = document.createElement('canvas'); cv.width = cv.height = R * 2;
  const g = cv.getContext('2d'), gr = g.createRadialGradient(R, R, 0, R, R, R);
  gr.addColorStop(0, `rgba(${rgb},0.55)`); gr.addColorStop(0.5, `rgba(${rgb},0.18)`); gr.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = gr; g.fillRect(0, 0, R * 2, R * 2);
  return cv;
}
const TINTS = { fire: '255,140,40', red: '255,40,30', green: '40,230,120', cyan: '120,220,255', cool: '200,230,255' };

// 타일별 광원 (월드 좌표)
function tileLight(theme, ch, c, r) {
  const x = c * TW + 16;
  if (ch === 'T' || ch === 't') {
    if (theme === 'subway') return { x, y: r * TH + 6, r: 60, tint: 'cool', flick: hash2(c, r) < 0.35 ? 'broken' : 'steady' };
    if (theme === 'bridge') return { x, y: r * TH + 36, r: 72, tint: 'fire', flick: 'fire' };
    if (theme === 'tower') return { x, y: r * TH + 13, r: 54, tint: 'red', flick: 'blink' };
  }
  if ((ch === 'W' || ch === 'w') && theme === 'tower') return { x, y: r * TH + 28, r: 38, tint: null, flick: 'steady' };
  if (ch === 'E') return { x, y: r * TH + 8, r: 30, tint: 'green', flick: 'steady' };
  return null;
}
function lightOn(L, t) {
  if (L.flick === 'broken') return (Math.sin(t * 17 + L.x) + Math.sin(t * 5.3 + L.x * 0.37) * 1.2) > -0.9;
  if (L.flick === 'blink') return (t + L.x * 0.01) % 1.4 < 0.9;
  return true;
}

const Art = {
  light: null, darkCv: null, glows: {},
  init() {
    this.light = makeLightSprite(64);
    this.darkCv = document.createElement('canvas'); this.darkCv.width = VW; this.darkCv.height = PH;
    for (const k in TINTS) this.glows[k] = makeGlow(TINTS[k], 48);
  },

  flame(ctx, x, y, t, k, big) {
    const f = Math.floor(t * 12 + k * 3) % 4;
    const s = big ? 1.6 : 1;
    const hgt = Math.round([9, 11, 10, 12][f] * s), sway = [0, 1, 0, -1][f];
    const w = big ? 9 : 5;
    px(ctx, x - (w >> 1), y - 3, w, 3, '#c43a10');
    px(ctx, x - (w >> 1) + sway, y - hgt + 2, w, hgt - 4, '#f07a18');
    px(ctx, x - (w >> 1) + 1 + sway, y - hgt + 4, w - 2, hgt - 6, '#ffc93a');
    px(ctx, x + sway, y - hgt, 1, 3, '#f07a18');
    px(ctx, x + sway, y - 5, 1, 2, '#fff6c0');
    if (f === 2) px(ctx, x + 2, y - hgt - 2, 1, 1, '#ffb030');
  },

  drawTile(ctx, P, w, c, r, t, pass) {
    const ch = w.ch(c, r), st = w.state(c, r), x0 = c * TW, y0 = r * TH, th = w.theme;
    if (pass === 'back') {
      if ((ch === 'T' || ch === 't') && th === 'bridge') this.flame(ctx, x0 + 16, y0 + SLAB - 14, t, c + r, true);
      if ((ch === 'T' || ch === 't') && th === 'subway') {
        const L = w.lightAt(c, r), on = L ? lightOn(L, t) : true;
        px(ctx, x0 + 6, y0 + 4, 20, 2, on ? '#f4fbff' : '#5d6668');
        if (on) px(ctx, x0 + 6, y0 + 6, 20, 1, '#b8d8e8');
      }
      if ((ch === 'T' || ch === 't') && th === 'tower') {
        const L = w.lightAt(c, r), on = L ? lightOn(L, t) : true;
        px(ctx, x0 + 13, y0 + 10, 7, 5, on ? '#ff3a2a' : '#6a1a14');
        if (on) px(ctx, x0 + 14, y0 + 11, 2, 2, '#ffc0b0');
      }
    }
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
        px(ctx, x0 + 9 + j, y0 + SLAB + dy, 1, 4, P.frontDk); px(ctx, x0 + 10 + j, y0 + SLAB + 3 + dy, 6, 1, P.frontDk);
        px(ctx, x0 + 22 + j, y0 + SLAB + 1 + dy, 1, 3, P.frontDk);
        break;
      }
      case 'plate': {
        drawFloor(ctx, P, w, c, r);
        const down = st.down ? 1 : 0;
        for (let i = 0; i < 20; i++) px(ctx, x0 + 6 + i, y0 + SLAB - 1 + down, 1, 2, ((i >> 1) & 1) ? '#16140e' : '#e3b51f');
        px(ctx, x0 + 6, y0 + SLAB + 1 + down, 20, 1, '#3a3220');
        const lamp = st.exit ? (st.down || w.doors.some((d) => d.target) ? '#34e07a' : '#1a5a32') : (st.down ? '#34e07a' : '#7a1a14');
        px(ctx, x0 + 15, y0 + SLAB - 3 + down, 2, 2, lamp);
        break;
      }
      case 'spikes': {
        // 깨진 유리 조각과 철근
        for (let i = 0; i < 4; i++) {
          const sx = x0 + 4 + i * 7, hgt = 5 + Math.floor(hash2(c, i) * 6);
          for (let k = 0; k < hgt; k++) px(ctx, sx + Math.floor(k / 3) * (i & 1 ? 1 : -1) + 1, y0 + SLAB - k, k < hgt - 2 ? 2 : 1, 1, k % 2 ? '#bfe0ea' : '#e8f6fa');
        }
        px(ctx, x0 + 8, y0 + SLAB - 10, 1, 10, '#8a4a2a'); px(ctx, x0 + 22, y0 + SLAB - 8, 1, 8, '#8a4a2a');
        px(ctx, x0 + 22, y0 + SLAB - 9, 3, 1, '#8a4a2a');
        if (st.blood) { px(ctx, x0 + 10, y0 + SLAB - 4, 6, 2, '#a3141c'); px(ctx, x0 + 18, y0 + SLAB - 2, 4, 2, '#7a0a10'); }
        break;
      }
      case 'electric': {
        // 바닥의 물웅덩이 + 천장에서 늘어진 전선
        const on = st.on, warn = st.warn;
        px(ctx, x0 + 3, y0 + SLAB, 26, 2, on ? '#9ff0ff' : '#2a5a6e');
        px(ctx, x0 + 6, y0 + SLAB, 8, 1, on ? '#ffffff' : '#4a8aa0');
        const cx = x0 + 18 + Math.round(Math.sin(t * 2 + c) * 1);
        ctx.fillStyle = '#121212';
        for (let y = y0; y < y0 + SLAB - 12; y++) ctx.fillRect(cx + Math.round(Math.sin((y - y0) * 0.12) * 2), y, 1, 1);
        const ex = cx + Math.round(Math.sin((SLAB - 12) * 0.12) * 2), ey = y0 + SLAB - 12;
        px(ctx, ex - 1, ey, 3, 2, '#d0782a');
        if (on || (warn && Math.floor(t * 20) % 3 === 0)) {
          const n = on ? 3 : 1;
          for (let k = 0; k < n; k++) {
            let ax = ex, ay = ey + 2;
            ctx.fillStyle = k === 0 ? '#ffffff' : '#7fe8ff';
            while (ay < y0 + SLAB) { ax += Math.round((hash2(Math.floor(t * 30) + k, ay) - 0.5) * 4); ay += 1; ctx.fillRect(ax, ay, 1, 1); }
          }
          if (on) for (let k = 0; k < 4; k++) px(ctx, x0 + 4 + Math.floor(hash2(Math.floor(t * 25), k) * 24), y0 + SLAB - 1 - Math.floor(hash2(k, Math.floor(t * 25)) * 4), 1, 1, '#d8fbff');
        }
        if (st.blood) px(ctx, x0 + 8, y0 + SLAB - 1, 8, 1, '#1a1a1a');
        break;
      }
      case 'chomper': {
        // 고장난 방화셔터: 순식간에 내리꽂혔다가 올라간다
        const cl = st.close, sx = x0 + 7, sw = 18;
        px(ctx, sx - 2, y0, sw + 4, 6, '#33373c'); px(ctx, sx - 2, y0 + 5, sw + 4, 1, '#1e2125');
        const bottom = Math.round(lerp(y0 + 8, y0 + SLAB, cl));
        for (let y = y0 + 6; y < bottom; y++) px(ctx, sx, y, sw, 1, (y - y0) % 3 === 0 ? '#5d6268' : '#8a9097');
        for (let i = 0; i < sw; i++) px(ctx, sx + i, bottom - 3, 1, 3, ((i >> 1) & 1) ? '#16140e' : '#e3b51f');
        px(ctx, sx - 2, y0 + 6, 2, SLAB - 6, '#2a2d31'); px(ctx, sx + sw, y0 + 6, 2, SLAB - 6, '#2a2d31');
        const phase = st.timer % 1.6;
        px(ctx, sx + sw / 2 - 1, y0 + 1, 3, 3, phase > 0.85 && phase < 1.4 && Math.floor(t * 12) % 2 ? '#ff3a2a' : '#5a1a14');
        if (st.blood) { px(ctx, sx + 2, bottom - 6, 12, 3, '#a3141c'); }
        break;
      }
      case 'gate': {
        // 셔터 문: 말려 올라간다. 충돌 기준 x는 칸의 21~29px
        const o = st.open, gx = x0 + 19, gw = 11;
        px(ctx, gx - 1, y0, gw + 2, 5, '#33373c');
        const bottom = Math.round(y0 + 5 + (SLAB - 5) * (1 - o * 0.9));
        for (let y = y0 + 5; y < bottom; y++) px(ctx, gx, y, gw, 1, (y - y0) % 3 === 0 ? '#5f646a' : '#878d94');
        px(ctx, gx, bottom - 2, gw, 2, '#3c4046');
        px(ctx, gx + 4, bottom - 4, 3, 1, '#2a2d31');
        break;
      }
      case 'door': {
        // 비상구: 초록 표지 + 철문
        const dx = x0 + 6, dw = 20, dh = 40, dy = y0 + SLAB - dh;
        px(ctx, dx - 2, dy - 2, dw + 4, dh + 2, '#2a2e2c');
        px(ctx, dx, dy, dw, dh, '#0c0d0c');
        for (let i = 0; i < 5; i++) px(ctx, dx + 2 + i * 2, dy + dh - 6 - i * 7, dw - 4 - i * 2, 2, '#3c4440');
        if (st.open > 0.05) { ctx.fillStyle = 'rgba(160,255,190,0.12)'; ctx.fillRect(dx, dy, dw, dh); }
        const pw = Math.round(dw * (1 - st.open));
        if (pw > 0) {
          px(ctx, dx, dy, pw, dh, '#5f6f68'); px(ctx, dx, dy, pw, 1, '#83958c');
          if (pw > 4) { px(ctx, dx + pw - 5, dy + 20, 3, 2, '#c8d0cc'); px(ctx, dx + 2, dy + 18, Math.max(1, pw - 6), 1, '#4a5751'); }
        }
        const sx = x0 + 7, sy = dy - 12;
        px(ctx, sx, sy, 18, 9, '#18b85e'); px(ctx, sx, sy, 18, 1, '#5ff09a');
        const man = ['0011000', '0011000', '0111100', '1011010', '0011000', '0100100', '1000010'];
        for (let j = 0; j < 7; j++) for (let i = 0; i < 7; i++) if (man[j][i] === '1') px(ctx, sx + 2 + i, sy + 1 + j, 1, 1, '#ffffff');
        px(ctx, sx + 11, sy + 4, 5, 1, '#ffffff'); px(ctx, sx + 14, sy + 3, 1, 3, '#ffffff');
        break;
      }
      case 'potion': {
        if (st.taken) break;
        const bx = x0 + 12, by = y0 + SLAB - 1;
        if (st.big) {
          // 혈청 앰플 케이스
          const pulse = Math.floor(t * 3) % 2;
          px(ctx, bx - 2, by - 6, 11, 6, '#2c3a40'); px(ctx, bx - 2, by - 6, 11, 1, '#4a5a62');
          px(ctx, bx, by - 11, 3, 6, pulse ? '#7ff6ff' : '#3ad6e8'); px(ctx, bx + 4, by - 10, 3, 5, pulse ? '#3ad6e8' : '#7ff6ff');
          px(ctx, bx, by - 12, 3, 1, '#d8e0e4'); px(ctx, bx + 4, by - 11, 3, 1, '#d8e0e4');
        } else {
          // 구급상자
          px(ctx, bx - 2, by - 7, 11, 7, '#f0eee6'); px(ctx, bx - 2, by - 7, 11, 1, '#ffffff'); px(ctx, bx - 2, by - 1, 11, 1, '#b8b4a8');
          px(ctx, bx + 2, by - 6, 3, 5, '#d8262a'); px(ctx, bx + 1, by - 5, 5, 3, '#d8262a');
          px(ctx, bx + 1, by - 9, 5, 2, '#8a8a84');
        }
        break;
      }
      case 'sword': {
        if (st.taken) break;
        const sx = x0 + 5, sy = y0 + SLAB - 1;
        px(ctx, sx, sy, 21, 2, '#8f969e'); px(ctx, sx, sy, 21, 1, '#c8ced4'); px(ctx, sx + 16, sy - 1, 5, 4, '#6e757c');
        px(ctx, sx + 2, sy, 4, 2, '#a0302c');
        if (Math.floor(t * 2) % 3 === 0) { const gx = sx + Math.floor((t * 20) % 18); px(ctx, gx, sy - 1, 1, 3, '#ffffff'); }
        break;
      }
    }
  },

  drawDarkness(ctx, w, camX, camY, t, extra) {
    const P = PALETTES[w.theme];
    const d = this.darkCv.getContext('2d');
    d.globalCompositeOperation = 'source-over';
    d.clearRect(0, 0, VW, PH);
    d.fillStyle = `rgba(2,3,8,${P.dark})`;
    d.fillRect(0, 0, VW, PH);
    d.globalCompositeOperation = 'destination-out';
    const lights = extra ? w.lights.concat(extra) : w.lights;
    const visible = [];
    for (const L of lights) {
      const sx = Math.round(L.x - camX), sy = Math.round(L.y - camY);
      if (sx < -90 || sx > VW + 90 || sy < -90 || sy > PH + 90) continue;
      if (!lightOn(L, t)) continue;
      const flick = L.flick === 'fire' ? Math.sin(t * 11 + L.x) * 4 + Math.sin(t * 29 + L.y) * 2 : Math.sin(t * 9 + L.x) * 1.2;
      const R = Math.round(L.r + flick);
      d.drawImage(this.light, sx - R, sy - R, R * 2, R * 2);
      visible.push([L, sx, sy, R]);
    }
    d.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.darkCv, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    for (const [L, sx, sy, R] of visible) {
      if (!L.tint) continue;
      const g = this.glows[L.tint], gr = Math.round(R * 0.8);
      ctx.globalAlpha = L.tint === 'cool' ? 0.35 : 0.7;
      ctx.drawImage(g, sx - gr, sy - gr, gr * 2, gr * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
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

// 체력 칸
function drawHpCell(ctx, x, y, full, color, dim) {
  ctx.fillStyle = full ? color : dim;
  ctx.fillRect(x, y, 6, 7);
  if (full) { ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fillRect(x, y, 6, 1); ctx.fillRect(x, y, 1, 7); }
  else { ctx.fillStyle = '#000'; ctx.fillRect(x + 1, y + 1, 4, 5); }
}
