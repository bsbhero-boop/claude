// 작은 2D/3D 벡터 유틸. 매 프레임 할당을 줄이려고 대부분 숫자 인자로 받는다.

export interface V2 {
  x: number;
  y: number;
}

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const len = (x: number, y: number) => Math.sqrt(x * x + y * y);
export const dist = (a: V2, b: V2) => len(a.x - b.x, a.y - b.y);
export const dist2 = (a: V2, b: V2) => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
};
export const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
export const randInt = (lo: number, hi: number) => Math.floor(rand(lo, hi + 1));
export const chance = (p: number) => Math.random() < p;
export const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];

/** 표준 정규분포 근사 (Box–Muller) */
export const gauss = () => {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

/** 각도 차이를 -PI..PI로 정규화 */
export const angleDiff = (a: number, b: number) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};

/** a에서 b 방향으로 최대 maxStep 만큼 회전 */
export const turnToward = (a: number, b: number, maxStep: number) => {
  const d = angleDiff(a, b);
  if (Math.abs(d) <= maxStep) return b;
  return a + Math.sign(d) * maxStep;
};

export const norm = (x: number, y: number): V2 => {
  const l = Math.sqrt(x * x + y * y);
  return l > 1e-6 ? { x: x / l, y: y / l } : { x: 0, y: 0 };
};

/** 점 p에서 선분 ab까지의 거리와, 선분 위 투영 비율 t(0..1) */
export const segDist = (p: V2, a: V2, b: V2) => {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const l2 = abx * abx + aby * aby;
  let t = l2 > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2 : 0;
  t = clamp(t, 0, 1);
  const cx = a.x + abx * t;
  const cy = a.y + aby * t;
  return { d: len(p.x - cx, p.y - cy), t };
};

export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export const smooth = (current: number, target: number, rate: number, dt: number) =>
  current + (target - current) * (1 - Math.exp(-rate * dt));
