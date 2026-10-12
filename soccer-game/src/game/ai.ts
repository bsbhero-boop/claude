import { beginKick, choosePassTarget, skillMove, startSlide, startTackle } from './actions';
import { CY, GOAL_HALF_W, PITCH_L, PITCH_W, RUN_SPEED, SPRINT_SPEED } from './constants';
import type { Player, TeamState } from './entities';
import { distToGoal, inOppBox, inOwnBox, laneRisk, nearestOpp, threat, xg } from './geo';
import { chance, clamp, gauss, len, norm, rand } from './math';
import type { Match } from './match';

export interface Brain {
  phase: 'att' | 'def' | 'loose';
  chaser: Player | null;
  chaserT: number;
  presser1: Player | null;
  presser2: Player | null;
  /** 상대 최종 수비 라인 (이 팀 기준 u) */
  oppLineU: number;
  supporters: Player[];
}

export function newBrain(): Brain {
  return { phase: 'loose', chaser: null, chaserT: 99, presser1: null, presser2: null, oppLineU: 0.8, supporters: [] };
}

/** 선수가 공을 잡을 수 있는 가장 빠른 시간과 지점 */
export function interceptFor(m: Match, p: Player) {
  const pred = m.pred;
  const pace = p.def.pac / 99;
  const sp = SPRINT_SPEED * (0.78 + pace * 0.3) * 0.92;
  const react = 0.12;
  for (let i = 0; i < pred.length; i++) {
    const s = pred[i];
    if (s.z > 1.9) continue;
    const d = len(s.x - p.x, s.y - p.y) - 0.7;
    if (d <= sp * Math.max(0, s.t - react)) return { t: s.t, x: s.x, y: s.y };
  }
  const last = pred[pred.length - 1];
  const d = len(last.x - p.x, last.y - p.y);
  return { t: last.t + d / sp, x: last.x, y: last.y };
}

export function thinkTeam(m: Match, team: TeamState, dt: number) {
  const brain = m.brains[team.side];
  const opp = m.opp(team);
  const b = m.ball;
  const owner = b.owner;
  const passing = b.pass;
  if (owner) brain.phase = owner.team === team ? 'att' : 'def';
  else if (passing && passing.from.team === team) brain.phase = 'att';
  else if (passing) brain.phase = 'def';
  else if (b.shot && b.shot.by.team === team) brain.phase = 'att';
  else brain.phase = 'loose';

  // 상대 수비 라인
  let line = 0;
  for (const o of opp.active) {
    if (o.isGK) continue;
    const u = team.u(o.x);
    if (u > line) line = u;
  }
  brain.oppLineU = Math.max(0.55, line);

  // 루즈볼 추격자
  brain.chaser = null;
  brain.chaserT = 99;
  if (!owner) {
    for (const p of team.active) {
      if (p.state === 'down' || p.state === 'frozen') continue;
      if (p.isGK && !inOwnBox(team, m.pred[Math.min(10, m.pred.length - 1)].x, m.pred[Math.min(10, m.pred.length - 1)].y)) continue;
      const ic = interceptFor(m, p);
      if (ic.t < brain.chaserT) {
        brain.chaserT = ic.t;
        brain.chaser = p;
      }
    }
  }

  // 압박 담당
  brain.presser1 = brain.presser2 = null;
  if (brain.phase === 'def' && owner) {
    const cands = team.active
      .filter((p) => !p.isGK && p.state !== 'down' && p.state !== 'frozen')
      .map((p) => ({ p, d: len(p.x - owner.x, p.y - owner.y) }))
      .sort((a, c) => a.d - c.d);
    const ctl = team.human ? team.controlled : null;
    const list = cands.filter((c) => c.p !== ctl);
    if (ctl && len(ctl.x - owner.x, ctl.y - owner.y) < 7) {
      // 사람이 직접 압박 중이면 AI는 커버만
      brain.presser1 = null;
      brain.presser2 = list[0]?.p ?? null;
    } else {
      brain.presser1 = list[0]?.p ?? null;
      brain.presser2 = list[1]?.p ?? null;
    }
  }

  // 지원 선수 (공격 시 공 근처로 내려와 패스 길을 열어준다)
  brain.supporters = [];
  if (brain.phase === 'att' && owner && owner.team === team) {
    brain.supporters = team.active
      .filter((p) => p !== owner && !p.isGK)
      .map((p) => ({ p, d: len(p.x - owner.x, p.y - owner.y) }))
      .sort((a, c) => a.d - c.d)
      .slice(0, 2)
      .map((x) => x.p);
  }

  for (const p of team.active) {
    if (p.human) continue;
    if (p.isGK) {
      keeperAI(m, p, dt);
      continue;
    }
    playerAI(m, p, brain, dt);
  }
}

/** 포메이션 기반 목표 위치 */
export function formationSpot(m: Match, team: TeamState, p: Player, phase: Brain['phase']) {
  const slot = p.slot;
  const b = m.ball;
  const bu = team.u(b.x);
  const bv = team.v(b.y);
  const ment = team.tactics.mentality * 0.03 + (team.shout === 'attack' ? 0.04 : team.shout === 'defend' ? -0.05 : 0);
  let u: number;
  let v: number;
  if (phase === 'att' || (phase === 'loose' && bu > 0.5)) {
    u = slot.u + 0.07 + (bu - 0.35) * 0.62 + ment;
    if (slot.role === 'DF') u = Math.min(u, bu - 0.08 + (slot.wide ? 0.12 + ment : 0));
    v = 0.5 + (slot.v - 0.5) * 1.18 + (bv - 0.5) * 0.18;
    if (slot.wide) v = slot.v < 0.5 ? Math.min(v, 0.08) : Math.max(v, 0.92);
    if (slot.role === 'FW' || (slot.role === 'MF' && slot.u > 0.45)) {
      // 상대 라인에 맞춰 대기 (오프사이드 감각)
      const brain = m.brains[team.side];
      const cap = p.runActive ? 0.93 : brain.oppLineU - 0.01;
      u = Math.min(Math.max(u, bu - 0.05), cap);
    }
  } else {
    u = slot.u * 0.92 + (bu - 0.5) * 0.42 + 0.03 + ment * 0.5 + team.tactics.pressing * 0.02;
    if (team.shout === 'press') u += 0.03;
    v = 0.5 + (slot.v - 0.5) * 0.76 + (bv - 0.5) * 0.34;
    // 수비 라인은 공보다 뒤에
    if (slot.role === 'DF') u = Math.min(u, Math.max(0.06, bu - 0.06));
  }
  if (m.phase === 'kickoff') {
    u = Math.min(u, 0.46);
  }
  u = clamp(u, 0.04, 0.94);
  v = clamp(v, 0.03, 0.97);
  return { x: team.toX(u), y: team.toY(v) };
}

export function moveTo(p: Player, tx: number, ty: number, urgency: number, lookX?: number, lookY?: number) {
  const dx = tx - p.x;
  const dy = ty - p.y;
  const d = len(dx, dy);
  if (d < 0.35) {
    p.dvx = 0;
    p.dvy = 0;
    p.sprinting = false;
  } else {
    const max = urgency > 0.7 && d > 4 ? SPRINT_SPEED * 1.2 : RUN_SPEED * (urgency > 0.35 ? 1 : 0.6);
    const sp = Math.min(max, d * 2.4);
    p.sprinting = urgency > 0.7 && d > 4;
    p.dvx = (dx / d) * sp;
    p.dvy = (dy / d) * sp;
  }
  if (lookX !== undefined && lookY !== undefined) {
    p.lookX = lookX;
    p.lookY = lookY;
  }
}

function playerAI(m: Match, p: Player, brain: Brain, dt: number) {
  const team = p.team;
  const b = m.ball;
  if (p.busy && p.state !== 'skill') {
    p.dvx = p.dvy = 0;
    return;
  }
  if (m.phase === 'setpiece' || m.phase === 'kickoff') {
    if (m.setPiece && m.setPiece.taker === p) {
      p.dvx = p.dvy = 0;
      return;
    }
    const spot = m.setPieceSpot(p) ?? formationSpot(m, team, p, brain.phase);
    moveTo(p, spot.x, spot.y, 0.5, b.x, b.y);
    return;
  }
  if (m.phase !== 'play') {
    p.dvx = p.dvy = 0;
    return;
  }

  if (b.owner === p) {
    carrierAI(m, p, dt);
    return;
  }

  // 패스 받는 선수
  if (b.pass && b.pass.to === p && !b.owner) {
    const ic = interceptFor(m, p);
    moveTo(p, ic.x, ic.y, 0.9, b.x, b.y);
    return;
  }
  // 루즈볼 추격
  if (!b.owner && brain.chaser === p) {
    const ic = interceptFor(m, p);
    moveTo(p, ic.x, ic.y, 1, b.x, b.y);
    return;
  }

  if (brain.phase === 'def' && b.owner) {
    const o = b.owner;
    if (p === brain.presser1) {
      pressAI(m, p, dt, 1);
      return;
    }
    if (p === brain.presser2) {
      const pressing = team.tactics.pressing + (team.shout === 'press' ? 1 : 0);
      if (pressing >= 2 && len(p.x - o.x, p.y - o.y) < 12 && !team.human) {
        pressAI(m, p, dt, 0.5);
        return;
      }
      const g = norm(team.ownGoalX - o.x, CY - o.y);
      moveTo(p, o.x + g.x * 5, o.y + g.y * 5, 0.75, o.x, o.y);
      return;
    }
    // 대인 마크 + 지역 방어
    const spot = formationSpot(m, team, p, 'def');
    let mark: Player | null = null;
    let md = 12;
    for (const a of m.opp(team).active) {
      if (a === o || a.isGK) continue;
      const d = len(a.x - spot.x, a.y - spot.y);
      if (d < md) {
        md = d;
        mark = a;
      }
    }
    if (mark && p.role !== 'FW') {
      const g = norm(team.ownGoalX - mark.x, CY - mark.y);
      const mx = mark.x + g.x * 1.8;
      const my = mark.y + g.y * 1.8;
      const w = p.role === 'DF' ? 0.7 : 0.5;
      moveTo(p, mx * w + spot.x * (1 - w), my * w + spot.y * (1 - w), 0.6, b.x, b.y);
    } else moveTo(p, spot.x, spot.y, 0.5, b.x, b.y);
    return;
  }

  if (brain.phase === 'att' && b.owner && b.owner.team === team) {
    // 침투 패턴
    p.runT -= dt;
    if (p.runT <= 0) {
      p.runActive = false;
      if ((p.role === 'FW' || (p.role === 'MF' && p.slot.u > 0.44)) && chance(0.35 + team.tactics.mentality * 0.08)) {
        p.runActive = true;
        p.runT = rand(1.8, 3);
      } else p.runT = rand(1.5, 3.5);
    }
    if (brain.supporters.includes(p)) {
      p.aiT -= dt;
      if (p.aiT <= 0 || !p.aiTarget) {
        p.aiT = rand(0.5, 0.9);
        p.aiTarget = supportSpot(m, p, b.owner);
      }
      moveTo(p, p.aiTarget.x, p.aiTarget.y, 0.65, b.x, b.y);
      return;
    }
    const spot = formationSpot(m, team, p, 'att');
    moveTo(p, spot.x, spot.y, p.runActive ? 0.95 : 0.55, b.x, b.y);
    return;
  }

  const spot = formationSpot(m, team, p, brain.phase);
  moveTo(p, spot.x, spot.y, 0.5, b.x, b.y);
}

function supportSpot(m: Match, p: Player, owner: Player) {
  const team = p.team;
  const opps = m.opp(team).active;
  const base = formationSpot(m, team, p, 'att');
  let best = base;
  let bestS = -Infinity;
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const r = 11 + (i % 2) * 5;
    const x = clamp(owner.x + Math.cos(a) * r, 2, PITCH_L - 2);
    const y = clamp(owner.y + Math.sin(a) * r, 2, PITCH_W - 2);
    const open = Math.min(8, nearestOpp(opps, x, y).d);
    const fwd = team.u(x) - team.u(owner.x);
    const risk = laneRisk(opps, owner.x, owner.y, x, y, 16);
    const s = open * 0.35 + fwd * 9 - risk * 4 - len(x - base.x, y - base.y) * 0.08 - len(x - p.x, y - p.y) * 0.04;
    if (s > bestS) {
      bestS = s;
      best = { x, y };
    }
  }
  return best;
}

function pressAI(m: Match, p: Player, dt: number, intensity: number) {
  const team = p.team;
  const o = m.ball.owner!;
  const g = norm(team.ownGoalX - o.x, CY - o.y);
  // 공을 가진 선수와 골대 사이로 접근
  const tx = o.x + o.vx * 0.25 + g.x * 0.9;
  const ty = o.y + o.vy * 0.25 + g.y * 0.9;
  moveTo(p, tx, ty, 0.95, o.x, o.y);
  if (m.ball.heldByKeeper) {
    moveTo(p, o.x - team.dir * -8, o.y, 0.4, o.x, o.y);
    return;
  }
  const d = len(o.x - p.x, o.y - p.y);
  let rate = m.dp.tackleRate * intensity * (1 + team.tactics.pressing * 0.25);
  if (team.human) rate *= m.teammatePress ? 1 : 0.35;
  if (d < 1.7 && p.canAct && chance(rate * dt)) {
    startTackle(m, p);
  } else if (!team.human && d > 1.6 && d < 3.2 && o.speed > 4 && p.canAct && chance(m.dp.slideRate * dt)) {
    p.facing = Math.atan2(o.y + o.vy * 0.3 - p.y, o.x + o.vx * 0.3 - p.x);
    startSlide(m, p);
  }
}

// ─────────────────────── 공 가진 선수 (CPU) ───────────────────────

function dribbleDir(m: Match, p: Player) {
  const team = p.team;
  const opps = m.opp(team).active;
  let dx = team.oppGoalX - p.x;
  let dy = (CY - p.y) * (team.u(p.x) > 0.7 ? 1 : 0.35);
  const n = norm(dx, dy);
  dx = n.x;
  dy = n.y;
  let space = 30;
  for (const o of opps) {
    const rx = o.x - p.x;
    const ry = o.y - p.y;
    const d = len(rx, ry);
    if (d > 8 || d < 0.01) continue;
    const ahead = (rx * n.x + ry * n.y) / d;
    if (ahead > -0.2) {
      const push = 3.5 / (d * d + 0.5);
      dx -= (rx / d) * push;
      dy -= (ry / d) * push;
      if (ahead > 0.5) space = Math.min(space, d);
    }
  }
  if (p.y < 5) dy += 0.6;
  if (p.y > PITCH_W - 5) dy -= 0.6;
  const r = norm(dx, dy);
  return { x: r.x, y: r.y, space };
}

interface Option {
  kind: 'dribble' | 'shot' | 'pass' | 'lob' | 'through' | 'cross' | 'clear' | 'special';
  v: number;
  target?: Player;
  tx?: number;
  ty?: number;
}

function carrierAI(m: Match, p: Player, dt: number) {
  const team = p.team;
  const opps = m.opp(team).active;
  // 골키퍼가 아닌 선수의 드리블
  const dd = dribbleDir(m, p);
  p.aiT -= dt;
  p.holdT += dt;
  const dribbleTo = (sprint: boolean) => {
    const sp = sprint ? SPRINT_SPEED * 1.1 : RUN_SPEED;
    p.sprinting = sprint;
    p.dvx = dd.x * sp;
    p.dvy = dd.y * sp;
  };
  if (p.state === 'skill') {
    dribbleTo(false);
    return;
  }
  if (p.aiT > 0 || p.holdT < m.dp.reaction) {
    dribbleTo(dd.space > 9 && p.stamina > 0.4);
    return;
  }
  p.aiT = m.dp.decision * rand(0.75, 1.3);

  const noise = () => gauss() * 0.006 * m.dp.noise;
  const here = threat(team, p.x, p.y);
  const press = nearestOpp(opps, p.x, p.y).d;
  const lossProb = press < 1.3 ? 0.42 : press < 2.6 ? 0.2 : press < 5 ? 0.07 : 0.03;
  const ahead = { x: p.x + dd.x * 5, y: p.y + dd.y * 5 };
  const opts: Option[] = [];
  opts.push({ kind: 'dribble', v: threat(team, ahead.x, ahead.y) * (1 - lossProb) + noise() + (dd.space > 10 ? 0.01 : 0) });

  const dist = distToGoal(team, p.x, p.y);
  const ment = team.tactics.mentality + (team.shout === 'attack' ? 1 : 0);
  if (dist < 31) {
    const x = xg(team, opps, p.x, p.y);
    opts.push({ kind: 'shot', v: x * (1.25 + ment * 0.08) * m.dp.shotBias + noise() + (dist < 12 ? 0.05 : 0) });
    if (team.gauge >= 100 && dist < 34 && chance(m.dp.specialUse)) {
      opts.push({ kind: 'special', v: 1 });
    }
  }
  const style = team.def.id === 'esp' ? 1.15 : 1;
  for (const q of team.active) {
    if (q === p) continue;
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const d = len(dx, dy);
    if (d < 4 || d > 48) continue;
    const qOpen = nearestOpp(opps, q.x, q.y).d;
    if (q.isGK) {
      if (press < 2 && team.u(p.x) < 0.35 && qOpen > 8) opts.push({ kind: 'pass', v: 0.012 + noise(), target: q });
      continue;
    }
    const tx = q.x + q.vx * 0.5;
    const ty = q.y + q.vy * 0.5;
    const risk = laneRisk(opps, p.x, p.y, tx, ty, 17);
    const val = threat(team, tx, ty) * (qOpen < 1.8 ? 0.7 : qOpen > 5 ? 1.12 : 1);
    if (d < 32) opts.push({ kind: 'pass', v: (1 - risk) * (1 - risk) * val * style - risk * 0.02 + noise(), target: q });
    if (d > 16) {
      const lr = laneRisk(opps, p.x, p.y, tx, ty, 18, true);
      opts.push({ kind: 'lob', v: (1 - lr) * (1 - lr) * val * 0.82 + noise(), target: q });
    }
    // 스루패스: 앞에 있는 공격수에게
    if ((q.role === 'FW' || q.role === 'MF') && team.u(q.x) > team.u(p.x) + 0.04) {
      const lead = 9;
      const fx = clamp(q.x + team.dir * lead, 2, PITCH_L - 2);
      const fy = clamp(q.y + (CY - q.y) * 0.15, 3, PITCH_W - 3);
      const tr = laneRisk(opps, p.x, p.y, fx, fy, 19);
      const open = nearestOpp(opps, fx, fy).d;
      const tv = threat(team, fx, fy) * (open > 4 ? 1.1 : 0.6);
      opts.push({ kind: 'through', v: (1 - tr) * (1 - tr) * tv * 0.95 + noise(), target: q, tx: fx, ty: fy });
    }
    // 크로스
    if (team.u(p.x) > 0.74 && Math.abs(p.y - CY) > 14 && inOppBox(team, q.x, q.y)) {
      const cx = xg(team, opps, q.x, q.y);
      const cr = laneRisk(opps, p.x, p.y, q.x, q.y, 18, true);
      opts.push({ kind: 'cross', v: cx * 0.6 * (1 - cr * 0.6) + noise(), target: q });
    }
  }
  if (team.u(p.x) < 0.22 && press < 2.2) opts.push({ kind: 'clear', v: here * 0.9 + 0.012 + noise() });

  let best = opts[0];
  for (const o of opts) if (o.v > best.v) best = o;
  // 끝없는 드리블 방지
  if (best.kind === 'dribble' && p.holdT > 4 + rand(0, 2)) {
    const passes = opts.filter((o) => o.kind === 'pass' || o.kind === 'lob');
    if (passes.length) best = passes.reduce((a, c) => (c.v > a.v ? c : a));
  }

  switch (best.kind) {
    case 'dribble': {
      if (press < 2.2 && p.def.dri > 68 && chance(0.25 * m.dp.skillUse)) {
        const side = chance(0.5) ? 1 : -1;
        skillMove(m, p, -dd.y * side, dd.x * side);
      }
      dribbleTo(dd.space > 9 && p.stamina > 0.4);
      break;
    }
    case 'special':
      m.requestSpecial(p);
      break;
    case 'shot': {
      const gk = m.opp(team).gk;
      const side = gk.y > CY ? -1 : 1;
      const dirY = side * rand(0.55, 1);
      const power = clamp(0.42 + dist / 45 + gauss() * 0.06, 0.35, 0.86);
      const finesse = dist > 16 && dist < 26 && chance(0.35);
      beginKick(m, p, 'shot', power, team.dir, dirY, { finesse });
      if (p.kick && chance(m.dp.perfect)) p.kick.timing = 'perfect';
      break;
    }
    case 'clear':
      beginKick(m, p, 'clear', rand(0.6, 1), team.dir, rand(-0.5, 0.5));
      break;
    default: {
      const t = best.target!;
      const kind = best.kind === 'pass' ? 'pass' : best.kind;
      const d = norm(t.x - p.x, t.y - p.y);
      beginKick(m, p, kind as 'pass' | 'lob' | 'through' | 'cross', 0, d.x, d.y, { target: t, tx: best.tx, ty: best.ty });
    }
  }
  p.holdT = best.kind === 'dribble' ? p.holdT : 0;
}

// ─────────────────────────── 골키퍼 ───────────────────────────

export function keeperAI(m: Match, gk: Player, dt: number) {
  const team = gk.team;
  const b = m.ball;
  if (gk.state === 'dive' || gk.state === 'down' || gk.busy) {
    gk.dvx = gk.dvy = 0;
    return;
  }
  const gx = team.ownGoalX;
  if (m.phase === 'setpiece' || m.phase === 'kickoff') {
    if (m.setPiece && m.setPiece.taker === gk) {
      gk.dvx = gk.dvy = 0;
      return;
    }
    const spot = m.setPieceSpot(gk);
    if (spot) {
      moveTo(gk, spot.x, spot.y, 0.6, b.x, b.y);
      return;
    }
  }
  // 공을 잡고 있으면 배급
  if (b.owner === gk) {
    gk.dvx = gk.dvy = 0;
    gk.holdT += dt;
    if (m.phase === 'play' && gk.holdT > (b.heldByKeeper ? 1.6 : 0.6) + rand(0, 0.3)) {
      distribute(m, gk);
    }
    return;
  }
  // 슛 대응은 match에서 처리, 여기선 위치 선정
  const ballD = len(b.x - gx, b.y - CY);
  let out = ballD > 40 ? 9 : 1.2 + (ballD / 40) * 4;
  // 일대일: 상대가 박스 안에서 공을 가졌다
  const o = b.owner;
  if (o && o.team !== team && inOwnBox(team, o.x, o.y) && ballD < 16) {
    const defenders = team.active.filter((p) => !p.isGK && len(p.x - o.x, p.y - o.y) < 2.5).length;
    if (defenders === 0 && ballD < 13) {
      moveTo(gk, o.x + (gx - o.x) * 0.12, o.y + (CY - o.y) * 0.12, 1, o.x, o.y);
      if (len(o.x - gk.x, o.y - gk.y) < 1.6 && gk.canAct && chance(2.2 * dt)) {
        startSlide(m, gk);
      }
      return;
    }
    out = Math.min(out, 3.2);
  }
  // 루즈볼이 박스 안으로
  const brain = m.brains[team.side];
  if (!b.owner && brain.chaser === gk && !b.shot) {
    const ic = interceptFor(m, gk);
    if (inOwnBox(team, ic.x, ic.y)) {
      moveTo(gk, ic.x, ic.y, 1, b.x, b.y);
      return;
    }
  }
  const dir = norm(b.x - gx, b.y - CY);
  let tx = gx + dir.x * out;
  let ty = CY + dir.y * out;
  ty = clamp(ty, CY - GOAL_HALF_W - 0.6, CY + GOAL_HALF_W + 0.6);
  if (team.dir > 0) tx = Math.max(0.3, tx);
  else tx = Math.min(PITCH_L - 0.3, tx);
  moveTo(gk, tx, ty, b.shot ? 1 : 0.7, b.x, b.y);
}

function distribute(m: Match, gk: Player) {
  const team = gk.team;
  const opps = m.opp(team).active;
  let best: Player | null = null;
  let bestS = -Infinity;
  let long = false;
  for (const q of team.active) {
    if (q === gk) continue;
    const d = len(q.x - gk.x, q.y - gk.y);
    const open = nearestOpp(opps, q.x, q.y).d;
    const risk = laneRisk(opps, gk.x, gk.y, q.x, q.y, 16);
    const s1 = open * 0.4 - risk * 5 - d * 0.03 + rand(0, 0.8);
    if (d < 40 && s1 > bestS) {
      bestS = s1;
      best = q;
      long = false;
    }
    if (q.role !== 'DF' && d > 25) {
      const s2 = open * 0.3 + team.u(q.x) * 3 - 1.2 + rand(0, 1);
      if (s2 > bestS) {
        bestS = s2;
        best = q;
        long = true;
      }
    }
  }
  gk.holdT = 0;
  m.ball.heldByKeeper = false;
  if (!best) {
    beginKick(m, gk, 'clear', 0.8, team.dir, 0);
    return;
  }
  const d = norm(best.x - gk.x, best.y - gk.y);
  beginKick(m, gk, long ? 'lob' : 'pass', long ? 0.7 : 0.2, d.x, d.y, { target: best });
}

/** 사람 팀에서 공을 받은 선수가 없을 때 등, 패스 대상 계산을 위해 공개 */
export { choosePassTarget };
