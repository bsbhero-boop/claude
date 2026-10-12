import { CY, GOAL_HALF_W, PITCH_L, PITCH_W } from './constants';
import type { Player, TeamState } from './entities';
import { clamp, len, segDist } from './math';

/** (x,y)에서 골문 양 포스트 사이의 열린 각도 (rad) */
export function goalAngle(x: number, y: number, gx: number) {
  const a1 = Math.atan2(CY - GOAL_HALF_W - y, gx - x);
  const a2 = Math.atan2(CY + GOAL_HALF_W - y, gx - x);
  let d = Math.abs(a2 - a1);
  if (d > Math.PI) d = Math.PI * 2 - d;
  return d;
}

export function distToGoal(team: TeamState, x: number, y: number) {
  return len(team.oppGoalX - x, CY - y);
}

/** 기대 득점 근사치 */
export function xg(team: TeamState, opps: Player[], x: number, y: number, ignore?: Player) {
  const gx = team.oppGoalX;
  const d = len(gx - x, CY - y);
  const ang = goalAngle(x, y, gx);
  let v = clamp(1.2 * ang * Math.exp(-d / 14), 0, 0.8);
  // 공격 방향이 항상 +x가 되도록 좌표를 뒤집어 각도를 비교한다
  const fx = team.dir > 0 ? x : PITCH_L - x;
  const a1 = Math.atan2(CY - GOAL_HALF_W - y, PITCH_L - fx);
  const a2 = Math.atan2(CY + GOAL_HALF_W - y, PITCH_L - fx);
  const lo = Math.min(a1, a2) - 0.06;
  const hi = Math.max(a1, a2) + 0.06;
  for (const o of opps) {
    if (o === ignore || o.sentOff) continue;
    const ox = team.dir > 0 ? o.x : PITCH_L - o.x;
    if (ox <= fx) continue;
    const od = len(ox - fx, o.y - y);
    if (od > d) continue;
    const a = Math.atan2(o.y - y, ox - fx);
    if (a > lo && a < hi) v *= o.isGK ? 0.75 : od < 2 ? 0.45 : 0.68;
  }
  return v;
}

/** 공을 가졌을 때의 위협도 (대략적인 xThreat) */
export function threat(team: TeamState, x: number, y: number) {
  const u = team.u(x);
  const d = len(team.oppGoalX - x, CY - y);
  const ang = goalAngle(x, y, team.oppGoalX);
  const nearGoal = 0.32 * Math.exp(-d / 10) * clamp(ang / 0.55, 0.2, 1);
  return 0.012 + 0.05 * u * u + nearGoal;
}

export function nearestOpp(opps: Player[], x: number, y: number) {
  let best: Player | null = null;
  let bd = Infinity;
  for (const o of opps) {
    if (o.sentOff) continue;
    const d = len(o.x - x, o.y - y);
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  return { p: best, d: bd };
}

/** 패스 경로의 차단 위험 (0..1) */
export function laneRisk(opps: Player[], fx: number, fy: number, tx: number, ty: number, speed: number, lofted = false) {
  const L = len(tx - fx, ty - fy);
  let risk = 0;
  for (const o of opps) {
    if (o.sentOff) continue;
    const { d, t } = segDist(o, { x: fx, y: fy }, { x: tx, y: ty });
    const along = t * L;
    const tb = along / Math.max(6, speed);
    // 로빙볼은 중간 구간을 넘어간다
    if (lofted && t > 0.15 && t < 0.85) continue;
    const reach = 0.9 + 6.5 * tb * 0.55 + (o.isGK ? 0.8 : 0);
    if (d < reach) risk = Math.max(risk, 1 - d / reach);
  }
  return clamp(risk, 0, 1);
}

export function inBounds(x: number, y: number, m = 1) {
  return x > m && x < PITCH_L - m && y > m && y < PITCH_W - m;
}

/** 해당 팀 기준 자기 페널티 박스 안인지 */
export function inOwnBox(team: TeamState, x: number, y: number) {
  const u = team.u(x);
  return u < 16.5 / PITCH_L && Math.abs(y - CY) < 20.16;
}

export function inOppBox(team: TeamState, x: number, y: number) {
  const u = team.u(x);
  return u > 1 - 16.5 / PITCH_L && Math.abs(y - CY) < 20.16;
}
