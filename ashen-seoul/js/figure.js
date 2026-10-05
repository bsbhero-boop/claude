'use strict';
// ── 관절 인형 애니메이션 (로토스코핑 느낌의 부드러운 동작을 도트로 그린다) ──
// 자세 배열 (도 단위, 아래 방향 0°, 앞쪽 +):
// [0 몸통 기울기, 1 고개, 2 앞다리 허벅지, 3 앞무릎 굽힘, 4 뒷다리 허벅지, 5 뒷무릎,
//  6 앞팔, 7 앞팔꿈치, 8 뒷팔, 9 뒷팔꿈치, 10 칼 각도(없으면 null)]

const LEN = { thigh: 11, shin: 11, foot: 4, torso: 13, shoulder: 11.5, upper: 8, fore: 7, sword: 15 };

const POSE = {
  stand:    [2, 0, 4, 4, -4, 3, -4, 10, 5, 8, null],
  run1:     [13, 0, 44, 14, -32, 72, -48, 62, 46, 46, null],
  run2:     [11, 0, 8, 18, 26, 98, -2, 62, 2, 62, null],
  run3:     [13, 0, -32, 72, 44, 14, 46, 46, -48, 62, null],
  run4:     [11, 0, 26, 98, 8, 18, 2, 62, -2, 62, null],
  start1:   [15, 0, 22, 36, -12, 30, -26, 44, 26, 30, null],
  skid:     [-9, 0, 40, 4, -12, 46, 36, 26, 56, 16, null],
  turnMid:  [0, 0, 0, 10, 0, 12, 0, 26, 0, 26, null],
  step:     [6, 0, 24, 8, -8, 6, -8, 16, 12, 16, null],
  teeter:   [17, 0, 32, 0, -6, 8, 120, 30, 145, 20, null],
  crouch:   [32, 0, 86, 146, 66, 136, 36, 30, 46, 30, null],
  jprep:    [22, 0, 46, 76, 26, 66, -62, 20, -46, 20, null],
  jair:     [12, 0, 66, 46, -42, 56, 76, 16, 46, 26, null],
  jdesc:    [8, 0, 56, 72, 26, 78, 60, 30, 40, 30, null],
  land:     [26, 0, 62, 106, 42, 100, 30, 30, 40, 30, null],
  hardland: [56, 10, 96, 152, 76, 146, 70, 0, 60, 10, null],
  fall:     [0, -6, 22, 46, -12, 56, 165, 16, 150, 26, null],
  uprep:    [10, 0, 36, 62, 26, 56, 20, 30, 15, 30, null],
  reach:    [0, -12, 0, 0, -5, 6, 176, 0, 170, 0, null],
  hang:     [-2, -10, 8, 16, -6, 22, 172, 0, 168, 0, null],
  pull:     [6, -10, 16, 32, 6, 38, 150, -96, 146, -92, null],
  kneeUp:   [48, 0, 100, 150, 6, 40, 30, 10, 40, 10, null],
  drinkUp:  [-4, -26, 4, 4, -4, 3, 42, 138, 5, 8, null],
  reachDn:  [36, 0, 82, 136, 62, 132, 70, 0, 40, 30, null],
  swordUp:  [0, -6, 4, 4, -4, 3, 165, 0, 5, 8, 182],
  kneel:    [40, 12, 96, 152, 80, 150, 60, 20, 50, 20, null],
  lying:    [92, 0, -88, 4, -84, 10, 100, 10, 110, 20, null],
  impaled:  [42, 24, 70, 130, 58, 120, 82, 20, 70, 30, null],
  engarde:  [4, 0, 28, 30, -22, 22, 55, 25, -36, 42, 124],
  advance:  [6, 0, 42, 24, -10, 32, 55, 25, -36, 42, 124],
  retreat:  [0, 0, 14, 36, -36, 20, 55, 25, -36, 42, 124],
  windup:   [-5, 0, 24, 30, -20, 22, 18, 84, -36, 42, 152],
  lunge:    [22, 0, 56, 16, -36, 10, 88, 0, -52, 20, 92],
  parry:    [-2, 0, 26, 30, -22, 22, 70, 62, -36, 42, 176],
  hurt:     [-18, -12, 10, 30, -30, 30, 30, 40, -60, 30, 140],
  bounce:   [-10, 0, 20, 30, -26, 22, 60, 92, -36, 40, 166],
  drawing:  [4, 0, 10, 10, -10, 8, -20, 64, 5, 8, null],
  cheer:    [-4, -14, 4, 4, -4, 3, 150, 20, 140, 30, null],
  inject:   [2, 12, 4, 4, -4, 3, 30, 115, 25, 95, null],
  // 감염자
  zstand:   [10, 16, 8, 10, -6, 8, 70, 12, 62, 18, null],
  zwalk1:   [12, 18, 22, 14, -12, 28, 78, 6, 58, 22, null],
  zwalk2:   [12, 12, -12, 28, 22, 14, 62, 20, 76, 8, null],
  zwind:    [-8, 6, 16, 22, -16, 16, 150, 25, 135, 30, null],
  zlunge:   [26, 14, 44, 14, -32, 10, 96, 0, 86, 10, null],
  zhurt:    [-16, -14, 8, 26, -28, 26, 40, 30, 20, 40, null],
};

// 애니메이션: [시간, 자세, (선택) 엉덩이 위치 [x, y] — 매달린 모서리 기준]
const ANIM = {
  run: { loop: 0.62, keys: [[0, 'run1'], [0.155, 'run2'], [0.31, 'run3'], [0.465, 'run4'], [0.62, 'run1']] },
  startrun: { keys: [[0, 'stand'], [0.13, 'start1'], [0.3, 'run1']] },
  stoprun: { keys: [[0, 'run2'], [0.12, 'skid'], [0.32, 'stand']] },
  runturn: { keys: [[0, 'run2'], [0.14, 'skid'], [0.26, 'turnMid'], [0.4, 'start1']] },
  turn: { keys: [[0, 'stand'], [0.09, 'turnMid'], [0.2, 'stand']] },
  step: { keys: [[0, 'stand'], [0.18, 'step'], [0.45, 'stand']] },
  teeter: { keys: [[0, 'stand'], [0.2, 'teeter'], [0.32, 'teeter'], [0.55, 'stand']] },
  crouchDown: { keys: [[0, 'stand'], [0.15, 'crouch']] },
  crouchUp: { keys: [[0, 'crouch'], [0.22, 'stand']] },
  jprep: { keys: [[0, 'stand'], [0.22, 'jprep']] },
  rjprep: { keys: [[0, 'run2'], [0.12, 'jprep']] },
  land: { keys: [[0, 'land'], [0.26, 'stand']] },
  hardland: { keys: [[0, 'hardland'], [0.5, 'hardland'], [0.8, 'stand']] },
  uprep: { keys: [[0, 'stand'], [0.18, 'uprep'], [0.28, 'reach']] },
  hop: { keys: [[0, 'reach'], [0.25, 'reach'], [0.4, 'land'], [0.6, 'stand']] },
  climb: { keys: [[0, 'hang', [-5, 28]], [0.24, 'pull', [-4, 14]], [0.5, 'kneeUp', [1, -2]], [0.72, 'crouch', [7, null]], [0.9, 'stand', [10, null]]] },
  drink: { keys: [[0, 'stand'], [0.22, 'reachDn'], [0.45, 'stand'], [0.6, 'drinkUp'], [1.05, 'drinkUp'], [1.3, 'stand']] },
  pickup: { keys: [[0, 'stand'], [0.3, 'reachDn'], [0.6, 'swordUp'], [0.95, 'swordUp'], [1.2, 'stand']] },
  die: { keys: [[0, 'stand'], [0.3, 'kneel'], [0.75, 'lying']] },
  draw: { keys: [[0, 'stand'], [0.18, 'drawing'], [0.42, 'engarde']] },
  sheathe: { keys: [[0, 'engarde'], [0.2, 'drawing'], [0.4, 'stand']] },
  advance: { keys: [[0, 'engarde'], [0.12, 'advance'], [0.28, 'engarde']] },
  retreat: { keys: [[0, 'engarde'], [0.12, 'retreat'], [0.28, 'engarde']] },
  strike: { keys: [[0, 'engarde'], [0.14, 'windup'], [0.22, 'lunge'], [0.3, 'lunge'], [0.5, 'engarde']] },
  gstrike: { keys: [[0, 'engarde'], [0.24, 'windup'], [0.3, 'lunge'], [0.38, 'lunge'], [0.58, 'engarde']] },
  parry: { keys: [[0, 'engarde'], [0.07, 'parry'], [0.34, 'parry'], [0.42, 'engarde']] },
  hurt: { keys: [[0, 'hurt'], [0.38, 'engarde']] },
  bounce: { keys: [[0, 'bounce'], [0.34, 'engarde']] },
  cheer: { keys: [[0, 'stand'], [0.4, 'cheer'], [2, 'cheer']] },
  heal: { keys: [[0, 'stand'], [0.22, 'reachDn'], [0.45, 'stand'], [0.6, 'inject'], [1.05, 'inject'], [1.3, 'stand']] },
  zwalk: { loop: 0.9, keys: [[0, 'zwalk1'], [0.45, 'zwalk2'], [0.9, 'zwalk1']] },
  zclaw: { keys: [[0, 'zstand'], [0.32, 'zwind'], [0.4, 'zlunge'], [0.5, 'zlunge'], [0.8, 'zstand']] },
  zhurt: { keys: [[0, 'zhurt'], [0.4, 'zstand']] },
};

const smooth = (t) => t * t * (3 - 2 * t);
function lerpPose(a, b, t, out) {
  for (let i = 0; i < 10; i++) out[i] = a[i] + (b[i] - a[i]) * t;
  const sa = a[10], sb = b[10];
  out[10] = sa == null ? (t > 0.5 ? sb : null) : sb == null ? (t < 0.5 ? sa : null) : sa + (sb - sa) * t;
  return out;
}
function sampleAnim(name, time) {
  const A = ANIM[name];
  let t = time;
  if (A.loop) t = time % A.loop;
  const keys = A.keys;
  if (t <= keys[0][0]) return { pose: POSE[keys[0][1]].slice(), hip: keys[0][2] };
  for (let i = 0; i < keys.length - 1; i++) {
    const k0 = keys[i], k1 = keys[i + 1];
    if (t <= k1[0]) {
      const u = smooth((t - k0[0]) / (k1[0] - k0[0]));
      const pose = lerpPose(POSE[k0[1]], POSE[k1[1]], u, new Array(11));
      let hip;
      if (k0[2] && k1[2]) hip = [lerp(k0[2][0], k1[2][0], u), lerp(k0[2][1], k1[2][1], u)];
      return { pose, hip };
    }
  }
  const last = keys[keys.length - 1];
  return { pose: POSE[last[1]].slice(), hip: last[2] ? last[2].slice() : undefined };
}
const animLen = (name) => { const k = ANIM[name].keys; return k[k.length - 1][0]; };

// 정운동학: 엉덩이(0,0) 기준 관절 위치
const D2R = Math.PI / 180;
function solve(pose, f) {
  const d = (a, l) => [f * Math.sin(a * D2R) * l, Math.cos(a * D2R) * l];
  const add = (p, v) => [p[0] + v[0], p[1] + v[1]];
  const up = (a, l) => [f * Math.sin(a * D2R) * l, -Math.cos(a * D2R) * l];
  const hip = [0, 0];
  const neck = up(pose[0], LEN.torso);
  const sh = up(pose[0], LEN.shoulder);
  const head = add(neck, up(pose[0] + pose[1], 4.5));
  const leg = (th, kn) => {
    const knee = d(th, LEN.thigh), s = th - kn;
    const ankle = add(knee, d(s, LEN.shin));
    const toe = add(ankle, d(clamp(s, -30, 40) + 90, LEN.foot));
    return { knee, ankle, toe };
  };
  const arm = (a, e) => {
    const elbow = add(sh, d(a, LEN.upper));
    const hand = add(elbow, d(a + e, LEN.fore));
    return { elbow, hand };
  };
  const J = { hip, neck, sh, head, A: leg(pose[2], pose[3]), B: leg(pose[4], pose[5]), aA: arm(pose[6], pose[7]), aB: arm(pose[8], pose[9]) };
  if (pose[10] != null) J.tip = add(J.aA.hand, d(pose[10], LEN.sword));
  return J;
}
function lowestY(J) {
  return Math.max(J.A.ankle[1], J.A.toe[1], J.B.ankle[1], J.B.toe[1], J.A.knee[1] + 2, J.B.knee[1] + 2,
    J.hip[1] + 3, J.sh[1] + 3, J.head[1] + 3, J.aA.hand[1] + 1, J.aB.hand[1] + 1);
}
const legHeight = (name) => lowestY(solve(POSE[name], 1));

// ── 외형 ──────────────────────────────────────────────────────────
const LOOKS = {
  survivor: { skin: '#d9a27a', skinDk: '#a8734e', hair: '#16110e', shirt: '#56603e', shirtDk: '#3a4129', pants: '#3b5274', pantsDk: '#283a54', sash: '#2a2018', shoe: '#d6d2c4', head: 'hair', pack: '#6e4c2a', packDk: '#4a3218', scarf: '#c0342c', weapon: 'pipe' },
  raider: { skin: '#c8916a', skinDk: '#94643c', shirt: '#2c2826', shirtDk: '#1b1817', pants: '#5c5249', pantsDk: '#3f3832', sash: '#6a5a3a', shoe: '#1a1412', head: 'beanie', hat: '#8a2c22', mask: '#3a3a38', weapon: 'bat' },
  raider2: { skin: '#b88058', skinDk: '#845a34', shirt: '#3b434a', shirtDk: '#262c31', pants: '#2b2b31', pantsDk: '#1d1d22', sash: '#4a4a4a', shoe: '#151515', head: 'beanie', hat: '#2d3d2c', mask: '#d8d4c4', weapon: 'blade' },
  boss: { skin: '#b8805a', skinDk: '#845a34', shirt: '#3c1f1b', shirtDk: '#24120f', vest: '#5b5c59', pants: '#2b2b2b', pantsDk: '#1a1a1a', sash: '#8a6a2a', shoe: '#101010', head: 'gasmask', weapon: 'axe' },
  zombie: { skin: '#8f9c84', skinDk: '#6a7660', hair: '#2a2a24', shirt: '#857e6e', shirtDk: '#5d574b', pants: '#3a3e48', pantsDk: '#282c34', sash: '#3a3e48', shoe: '#2a2420', head: 'zombie', stain: '#6a1a1a' },
  zombie2: { skin: '#9aa08a', skinDk: '#707660', hair: '#3a2a1a', shirt: '#4b6a8a', shirtDk: '#344a62', pants: '#2c2c34', pantsDk: '#1e1e24', sash: '#2c2c34', shoe: '#3a3028', head: 'zombie', stain: '#5a1414' },
  sister: { skin: '#efbf98', skinDk: '#c08e68', hair: '#1e120c', shirt: '#28324e', shirtDk: '#1c2438', pants: '#2a2a32', pantsDk: '#1e1e24', sash: '#c0342c', shoe: '#1a1a1a', head: 'long', skirt: '#4e4460' },
};

// ── 도트 붓 ─────────────────────────────────────────────────────────
let SC = null, SX = null, OC = null, OX = null;
const SPR = 112, OXO = 56, OYO = 76;
function disc(ctx, x, y, r) {
  const cx = Math.round(x), cy = Math.round(y), R = Math.ceil(r);
  for (let dy = -R; dy <= R; dy++) {
    const w = Math.floor(Math.sqrt(Math.max(0, r * r - dy * dy)) + 0.35);
    if (r * r - dy * dy < 0) continue;
    ctx.fillRect(cx - w, cy + dy, w * 2 + 1, 1);
  }
}
function seg(ctx, a, b, r0, r1, col) {
  ctx.fillStyle = col;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(1, Math.ceil(len * 1.2));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    disc(ctx, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, r0 + (r1 - r0) * t);
  }
}
function line1(ctx, a, b, col) {
  ctx.fillStyle = col;
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]))));
  for (let i = 0; i <= n; i++) ctx.fillRect(Math.round(a[0] + (b[0] - a[0]) * i / n), Math.round(a[1] + (b[1] - a[1]) * i / n), 1, 1);
}

const Figure = {
  standLeg: 0, crouchLeg: 0,
  init() {
    SC = document.createElement('canvas'); SC.width = SC.height = SPR; SX = SC.getContext('2d');
    OC = document.createElement('canvas'); OC.width = OC.height = SPR; OX = OC.getContext('2d');
    this.standLeg = legHeight('stand');
    this.crouchLeg = legHeight('crouch');
    // 매달리기 애니메이션의 'null' 높이 = 그 자세로 위층 바닥(모서리+3)에 발을 디딘 높이
    for (const k in ANIM) for (const key of ANIM[k].keys) {
      if (key[2] && key[2][1] == null) key[2][1] = 3 - legHeight(key[1]);
    }
  },

  // 캐릭터의 현재 자세와 기준점(월드 좌표)을 받아 그린다
  draw(ctx, look, pose, f, anchor, camX, camY, opt = {}) {
    const J = solve(pose, f);
    let ox, oy;
    if (anchor.type === 'hip') { ox = anchor.x; oy = anchor.y; }
    else { ox = anchor.x; oy = anchor.y - lowestY(J); }
    const bx = Math.round(anchor.x) - OXO, by = Math.round(anchor.y) - OYO;
    const T = (p) => [p[0] + ox - bx, p[1] + oy - by];
    SX.clearRect(0, 0, SPR, SPR);
    this.paint(SX, look, J, f, T, opt);
    // 외곽선
    OX.globalCompositeOperation = 'source-over';
    OX.clearRect(0, 0, SPR, SPR);
    OX.drawImage(SC, -1, 0); OX.drawImage(SC, 1, 0); OX.drawImage(SC, 0, -1); OX.drawImage(SC, 0, 1);
    OX.globalCompositeOperation = 'source-in';
    OX.fillStyle = opt.flash ? '#ffffff' : 'rgba(8,6,10,0.9)';
    OX.fillRect(0, 0, SPR, SPR);
    OX.globalCompositeOperation = 'source-over';
    const sx = bx - Math.round(camX), sy = by - Math.round(camY);
    if (opt.alpha != null) ctx.globalAlpha = opt.alpha;
    ctx.drawImage(OC, sx, sy);
    ctx.drawImage(SC, sx, sy);
    ctx.globalAlpha = 1;
    return { J, ox, oy };
  },

  paint(c, L, J, f, T, opt) {
    const hip = T(J.hip), sh = T(J.sh), neck = T(J.neck), head = T(J.head);
    const lg = (Lg) => ({ knee: T(Lg.knee), ankle: T(Lg.ankle), toe: T(Lg.toe) });
    const A = lg(J.A), B = lg(J.B);
    const aA = { elbow: T(J.aA.elbow), hand: T(J.aA.hand) }, aB = { elbow: T(J.aB.elbow), hand: T(J.aB.hand) };
    const robe = !!L.robe;

    // 뒷팔
    seg(c, sh, aB.elbow, 1.6, 1.5, L.shirtDk); seg(c, aB.elbow, aB.hand, 1.5, 1.3, L.shirtDk);
    c.fillStyle = L.skinDk; disc(c, aB.hand[0], aB.hand[1], 1.2);
    // 뒷다리
    seg(c, hip, B.knee, 2.7, 2.4, L.pantsDk); seg(c, B.knee, B.ankle, 2.4, 1.5, L.pantsDk);
    seg(c, B.ankle, B.toe, 1.2, 1, L.shoe);
    if (L.pack) { // 배낭
      seg(c, [lerp(hip[0], neck[0], 0.3) - f * 3.2, lerp(hip[1], neck[1], 0.3)], [lerp(hip[0], neck[0], 0.9) - f * 3.2, lerp(hip[1], neck[1], 0.9)], 2.7, 2.9, L.pack);
      c.fillStyle = L.packDk; c.fillRect(Math.round(lerp(hip[0], neck[0], 0.5) - f * 4.5), Math.round(lerp(hip[1], neck[1], 0.5)), 2, 2);
    }
    // 몸통
    seg(c, hip, neck, 3.1, 3.3, L.shirt);
    if (L.stain) { c.fillStyle = L.stain; const m = [lerp(hip[0], neck[0], 0.55), lerp(hip[1], neck[1], 0.55)]; c.fillRect(Math.round(m[0] + f), Math.round(m[1]), 2, 3); c.fillRect(Math.round(m[0] - 1), Math.round(m[1] + 3), 1, 2); }
    if (L.vest) seg(c, [lerp(hip[0], neck[0], 0.15), lerp(hip[1], neck[1], 0.15)], [lerp(hip[0], neck[0], 0.85), lerp(hip[1], neck[1], 0.85)], 2.2, 2.6, L.vest);
    // 앞다리
    seg(c, hip, A.knee, 2.7, 2.4, L.pants); seg(c, A.knee, A.ankle, 2.4, 1.5, L.pants);
    seg(c, A.ankle, A.toe, 1.2, 1, L.shoe);
    if (L.skirt) {
      const kneeM = [(A.knee[0] + B.knee[0]) / 2, (A.knee[1] + B.knee[1]) / 2];
      seg(c, hip, [lerp(hip[0], kneeM[0], 0.7), lerp(hip[1], kneeM[1], 0.7)], 3.3, 4.4, L.skirt);
    }
    if (robe) {
      // 긴 옷자락: 엉덩이에서 두 발목 사이로 퍼지는 천
      const mid = [(A.ankle[0] + B.ankle[0]) / 2, Math.max(A.ankle[1], B.ankle[1]) - 1];
      const kneeM = [(A.knee[0] + B.knee[0]) / 2, (A.knee[1] + B.knee[1]) / 2];
      seg(c, hip, kneeM, 3.4, 4.2, L.robe);
      seg(c, kneeM, mid, 4.2, 5.4, L.robe);
      seg(c, B.knee, B.ankle, 3, 3.6, L.robeDk);
      seg(c, A.knee, A.ankle, 3, 3.8, L.robe);
      c.fillStyle = L.trim; c.fillRect(Math.round(mid[0]) - 5, Math.round(mid[1]) + 3, 11, 1);
      seg(c, A.ankle, A.toe, 1.2, 1, L.shoe);
      seg(c, hip, neck, 3.1, 3.4, L.robe);
      line1(c, [hip[0], hip[1]], [neck[0], neck[1] + 1], L.trim);
    }
    // 허리띠
    {
      const ux = neck[0] - hip[0], uy = neck[1] - hip[1], ul = Math.hypot(ux, uy) || 1;
      const nx = -uy / ul * 3.3, ny = ux / ul * 3.3;
      for (const k of [0.6, 1.5, 2.4]) {
        const q = [hip[0] + ux / ul * k, hip[1] + uy / ul * k];
        line1(c, [q[0] - nx, q[1] - ny], [q[0] + nx, q[1] + ny], L.sash);
      }
    }
    if (opt.scabbard) { // 쇠파이프를 배낭 옆에 꽂고 다닌다
      line1(c, [lerp(hip[0], neck[0], -0.1) - f * 6, lerp(hip[1], neck[1], -0.1)], [lerp(hip[0], neck[0], 1.15) - f * 1, lerp(hip[1], neck[1], 1.15)], '#a3aab2');
      line1(c, [lerp(hip[0], neck[0], -0.1) - f * 7, lerp(hip[1], neck[1], -0.1)], [lerp(hip[0], neck[0], 1.15) - f * 2, lerp(hip[1], neck[1], 1.15)], '#5c636b');
    }
    // 머리
    this.head(c, L, head, neck, f);
    if (L.scarf) { seg(c, [neck[0], neck[1] + 1], [neck[0] - f * 5, neck[1] + 4 + Math.sin(Input.now * 6) * 1], 1.6, 0.8, L.scarf); c.fillStyle = L.scarf; disc(c, neck[0] + f * 0.5, neck[1] + 1, 2.1); }
    // 앞팔 + 칼
    seg(c, sh, aA.elbow, 1.7, 1.5, L.shirt); seg(c, aA.elbow, aA.hand, 1.5, 1.3, L.shirt);
    if (J.tip) this.weapon(c, L.weapon || 'pipe', aA.hand, T(J.tip));
    c.fillStyle = L.skin; disc(c, aA.hand[0], aA.hand[1], 1.3);
  },

  weapon(c, kind, h, tip) {
    const dx = (tip[0] - h[0]) / LEN.sword, dy = (tip[1] - h[1]) / LEN.sword;
    const back = [h[0] - dx * 3, h[1] - dy * 3];
    if (kind === 'pipe') {
      line1(c, back, tip, '#a3aab2');
      line1(c, [back[0] - dy, back[1] + dx], [tip[0] - dy, tip[1] + dx], '#5c636b');
      line1(c, [h[0] - dx, h[1] - dy], [h[0] + dx, h[1] + dy], '#a0302c');
    } else if (kind === 'bat') {
      seg(c, back, tip, 0.6, 1.5, '#a87a48');
      line1(c, [h[0] + dx * 4, h[1] + dy * 4], tip, '#caa06a');
    } else if (kind === 'blade') {
      line1(c, [h[0] + dx, h[1] + dy], tip, '#e4e9ef');
      line1(c, [h[0] + dx - dy, h[1] + dy + dx], [tip[0] - dx * 2 - dy, tip[1] - dy * 2 + dx], '#8a929c');
      line1(c, back, h, '#151515');
    } else if (kind === 'axe') {
      line1(c, back, tip, '#6a4a2a');
      line1(c, [back[0] - dy * 0.6, back[1] + dx * 0.6], [tip[0] - dy * 0.6, tip[1] + dx * 0.6], '#4a3218');
      const hx = tip[0] - dx * 2, hy = tip[1] - dy * 2;
      seg(c, [hx + dy * 1, hy - dx * 1], [hx - dy * 4, hy + dx * 4], 1.5, 2.2, '#c0302c');
      line1(c, [hx - dy * 5 - dx, hy + dx * 5 - dy], [hx - dy * 5 + dx * 2, hy + dx * 5 + dy * 2], '#e4e9ef');
    }
  },

  head(c, L, hc, neck, f) {
    const x = hc[0], y = hc[1];
    c.fillStyle = L.skinDk; disc(c, neck[0], neck[1], 1.5);
    if (L.head === 'long') {
      c.fillStyle = L.hair; disc(c, x - f * 1.2, y - 0.5, 3.4);
      seg(c, [x - f * 2, y], [x - f * 3.5, y + 9], 2.2, 1.6, L.hair);
    } else if (L.head === 'hair') {
      c.fillStyle = L.hair; disc(c, x - f * 1, y - 0.8, 3.3);
    }
    c.fillStyle = L.skin; disc(c, x + f * 0.8, y + 0.4, 2.6);
    c.fillRect(Math.round(x + f * 3.2), Math.round(y + 0.5), 1, 1);
    if (L.head === 'hair' || L.head === 'long') {
      c.fillStyle = L.hair;
      c.fillRect(Math.round(x - 2), Math.round(y - 3.5), 5, 2);
      c.fillRect(Math.round(x - f * 2.5), Math.round(y - 1), 2, 3);
    }
    if (L.head === 'beanie') {
      c.fillStyle = L.hat; disc(c, x - f * 0.4, y - 2.2, 3.4);
      c.fillRect(Math.round(x - 3), Math.round(y - 1.2), 7, 1);
      c.fillStyle = L.mask; c.fillRect(Math.round(x + f * 0.5) - 2, Math.round(y + 1.2), 5, 3);
    }
    if (L.head === 'gasmask') {
      c.fillStyle = '#2c2c2a'; disc(c, x - f * 0.6, y - 1.2, 3.3);
      c.fillStyle = '#3c403c'; disc(c, x + f * 1.2, y + 0.6, 2.6);
      c.fillStyle = '#9fd0b0'; c.fillRect(Math.round(x + f * 2), Math.round(y - 1), 1, 1); c.fillRect(Math.round(x + f * 0.5), Math.round(y - 1), 1, 1);
      c.fillStyle = '#5c605a'; disc(c, x + f * 3, y + 2.4, 1.4);
      c.fillStyle = '#1a1a1a'; c.fillRect(Math.round(x - f * 2.8), Math.round(y - 0.5), 1, 2);
      return;
    }
    if (L.head === 'zombie') {
      c.fillStyle = L.hair; c.fillRect(Math.round(x - 2), Math.round(y - 3.6), 4, 2); c.fillRect(Math.round(x - f * 2.6), Math.round(y - 2), 2, 3);
      c.fillRect(Math.round(x + f * 1), Math.round(y - 4), 1, 1);
      c.fillStyle = '#ff3a2a'; c.fillRect(Math.round(x + f * 2), Math.round(y - 0.6), 1, 1);
      c.fillStyle = '#3a0e0e'; c.fillRect(Math.round(x + f * 2.2), Math.round(y + 2), 2, 1);
      return;
    }
    if (L.head === 'turban') {
      c.fillStyle = L.turban; disc(c, x - f * 0.2, y - 2.6, 3.4);
      if (L.tall) { disc(c, x - f * 0.2, y - 5.2, 3.0); disc(c, x, y - 7.6, 2.0); }
      c.fillStyle = L.band; c.fillRect(Math.round(x - 3), Math.round(y - 1.6), 7, 1);
      if (L.tall) { c.fillStyle = L.band; c.fillRect(Math.round(x + f * 1.5), Math.round(y - 5), 2, 2); }
      c.fillStyle = L.stache; c.fillRect(Math.round(x + f * 1.5) - (f < 0 ? 2 : 0), Math.round(y + 1.6), 3, 1);
      if (L.beard) { c.fillStyle = L.beard; disc(c, x + f * 1.4, y + 3.4, 1.6); c.fillRect(Math.round(x + f * 1.4), Math.round(y + 5), 1, 2); }
    }
    c.fillStyle = '#140c08'; c.fillRect(Math.round(x + f * 2), Math.round(y - 0.6), 1, 1);
  },
};
