import { audio } from './audio';
import { BALL_R, CY, GOAL_H, GOAL_HALF_W, GRAVITY, PITCH_L, PITCH_W } from './constants';
import type { PendingKick, Player } from './entities';
import { distToGoal, inOppBox, nearestOpp } from './geo';
import { angleDiff, chance, clamp, gauss, len, norm, rand } from './math';
import type { Match } from './match';
import type { SpecialType } from './types';

const K_FRIC = 0.42;
const C_FRIC = 1.4 / 0.42;

/** 지면 패스: 거리 D에서 도착 속도 va가 되도록 하는 초기 속도 */
export function groundSpeedFor(D: number, va: number) {
  let lo = va;
  let hi = 45;
  for (let i = 0; i < 30; i++) {
    const v0 = (lo + hi) / 2;
    const t = Math.log((v0 + C_FRIC) / (va + C_FRIC)) / K_FRIC;
    const s = (v0 - va) / K_FRIC - C_FRIC * t;
    if (s < D) lo = v0;
    else hi = v0;
  }
  return (lo + hi) / 2;
}

/** 지면 패스의 대략적 도달 시간 */
export function groundTime(v0: number, D: number) {
  // 수치 적분
  let v = v0;
  let s = 0;
  let t = 0;
  const dt = 0.02;
  while (s < D && t < 6) {
    v = Math.max(0.3, v - (1.4 + 0.42 * v) * dt);
    s += v * dt;
    t += dt;
  }
  return t;
}

export function kickBall(m: Match, p: Player, vx: number, vy: number, vz: number, spin = 0, power = 0.5) {
  const b = m.ball;
  if (b.owner && b.owner !== p) b.owner = null;
  b.owner = null;
  b.heldByKeeper = false;
  b.vx = vx;
  b.vy = vy;
  b.vz = vz;
  b.spin = spin;
  b.dip = 0;
  b.guide = null;
  b.lastTouch = p;
  b.special = null;
  b.shot = null;
  b.pass = null;
  if (b.z < 0.05) b.z = 0.06;
  p.touchCD = 0.28;
  audio.kick(power);
  m.lastKickT = m.clock;
}

function passError(m: Match, p: Player, kind: string, dirX: number, dirY: number) {
  const opps = m.opp(p.team).active;
  const press = nearestOpp(opps, p.x, p.y).d;
  const pressure = press < 1.5 ? 1 : press < 3 ? 0.5 : 0;
  const bodyA = Math.abs(angleDiff(p.facing, Math.atan2(dirY, dirX)));
  let e = 0.01 + (1 - p.def.pas / 99) * 0.055 + pressure * 0.025 + (bodyA > 1.9 ? 0.03 : 0);
  if (kind === 'lob' || kind === 'cross') e += 0.012;
  if (kind === 'through') e += 0.008;
  e /= p.moraleMul;
  if (!p.team.human) e *= m.dp.cpuErr;
  return e;
}

/** 방향 입력에 가장 알맞은 패스 대상 */
export function choosePassTarget(m: Match, p: Player, dirX: number, dirY: number, power: number, kind: string): Player | null {
  const mates = p.team.active.filter((q) => q !== p);
  const opps = m.opp(p.team).active;
  let best: Player | null = null;
  let bestS = -Infinity;
  const manualDist = power > 0.15;
  const pref = kind === 'lob' ? 14 + power * 40 : kind === 'through' ? 10 + power * 30 : 6 + power * 38;
  for (const q of mates) {
    if (q.isGK && (kind === 'through' || kind === 'lob')) continue;
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const d = len(dx, dy);
    if (d < 2.5) continue;
    const cos = (dx * dirX + dy * dirY) / d;
    if (cos < 0.45) continue;
    let s = cos * 3.2;
    s += manualDist ? -Math.abs(d - pref) / 14 : -d / 55;
    const open = nearestOpp(opps, q.x, q.y).d;
    s += Math.min(open, 7) / 14;
    if (kind === 'through') s += (p.team.u(q.x) - p.team.u(p.x)) * 3;
    if (q.isGK) s -= 0.8;
    if (kind === 'cross' && inOppBox(p.team, q.x, q.y)) s += 2;
    if (s > bestS) {
      bestS = s;
      best = q;
    }
  }
  // 살짝 누른 땅볼 패스는 관대하게: 방향 근처에 아무도 없으면 넓은 범위에서 다시 찾는다
  if (!best && kind === 'pass' && !manualDist) {
    for (const q of mates) {
      if (q.isGK) continue;
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const d = len(dx, dy);
      if (d < 2.5 || d > 30) continue;
      const cos = (dx * dirX + dy * dirY) / d;
      if (cos < -0.1) continue;
      const s = cos * 2 - d / 20 + Math.min(nearestOpp(opps, q.x, q.y).d, 6) / 10;
      if (s > bestS) {
        bestS = s;
        best = q;
      }
    }
  }
  return best;
}

/** 킥 준비 동작 시작 (와인드업 후 executeKick) */
export function beginKick(
  _m: Match,
  p: Player,
  kind: PendingKick['kind'],
  power: number,
  dirX: number,
  dirY: number,
  opts: { finesse?: boolean; chip?: boolean; target?: Player | null; tx?: number; ty?: number } = {},
) {
  const d = norm(dirX, dirY);
  if (d.x === 0 && d.y === 0) {
    d.x = Math.cos(p.facing);
    d.y = Math.sin(p.facing);
  }
  const bodyA = Math.abs(angleDiff(p.facing, Math.atan2(d.y, d.x)));
  let windup =
    kind === 'shot' ? 0.24 : kind === 'special' ? 0.3 : kind === 'lob' || kind === 'cross' ? 0.15 : kind === 'clear' ? 0.12 : 0.07;
  if (bodyA > 1.6 && kind !== 'header') windup += 0.06;
  if (kind === 'header') windup = 0.03;
  p.kick = {
    kind,
    power: clamp(power, 0, 1),
    dirX: d.x,
    dirY: d.y,
    finesse: !!opts.finesse,
    chip: !!opts.chip,
    t: 0,
    windup,
    timing: 'none',
    target: opts.target ?? null,
    tx: opts.tx,
    ty: opts.ty,
  };
  p.setState(kind === 'header' ? 'header' : 'kick', windup + 0.16);
  if (kind === 'header') p.vz = 3.2;
}

export function executeKick(m: Match, p: Player) {
  const k = p.kick;
  p.kick = null;
  if (!k) return;
  const b = m.ball;
  // 와인드업 사이 공을 빼앗겼거나 멀어진 경우 헛발질
  const reach = k.kind === 'header' ? 1.6 : 1.25;
  const owns = b.owner === p;
  const near = len(b.x - p.x, b.y - p.y) < reach && b.z < (k.kind === 'header' ? 2.9 : 1.2);
  if (!owns && !(near && !b.owner)) {
    return;
  }
  if (k.kind === 'special') {
    launchSpecial(m, p, k);
    return;
  }
  if (k.kind === 'shot' || k.kind === 'header') {
    performShot(m, p, k);
    return;
  }
  performPass(m, p, k);
}

export function performPass(m: Match, p: Player, k: PendingKick) {
  const team = p.team;
  const b = m.ball;
  const kind = k.kind;
  let target = k.target;
  if (!target && k.tx === undefined && kind !== 'clear') {
    target = choosePassTarget(m, p, k.dirX, k.dirY, k.power, kind);
  }
  let tx: number;
  let ty: number;
  let lofted = kind === 'lob' || kind === 'cross' || kind === 'clear';

  if (k.tx !== undefined && k.ty !== undefined) {
    tx = k.tx;
    ty = k.ty;
  } else if (target) {
    const d = len(target.x - p.x, target.y - p.y);
    const lead = kind === 'through' ? 6 + k.power * 9 : lofted ? 1.5 : 0.6;
    const tv = norm(target.vx, target.vy);
    if (kind === 'through') {
      // 상대 골 방향 + 받는 선수의 진행 방향
      const fwdX = team.dir;
      const dx = fwdX * 0.75 + tv.x * 0.6;
      const dy = tv.y * 0.6 + (CY - target.y) * 0.004;
      const n = norm(dx, dy);
      tx = target.x + n.x * lead;
      ty = target.y + n.y * lead;
    } else {
      const tt = lofted ? 0.8 + d / 24 : d / 16;
      tx = target.x + target.vx * tt * 0.65;
      ty = target.y + target.vy * tt * 0.65;
    }
  } else if (kind === 'clear') {
    tx = p.x + team.dir * (30 + k.power * 15);
    ty = p.y + k.dirY * 15 + rand(-8, 8);
  } else {
    const dist = kind === 'lob' ? 18 + k.power * 30 : kind === 'through' ? 14 + k.power * 18 : 8 + k.power * 22;
    tx = p.x + k.dirX * dist;
    ty = p.y + k.dirY * dist;
  }
  tx = clamp(tx, 0.5, PITCH_L - 0.5);
  ty = clamp(ty, 0.8, PITCH_W - 0.8);

  const dx = tx - b.x;
  const dy = ty - b.y;
  const D = Math.max(1, len(dx, dy));
  const err = passError(m, p, kind, dx / D, dy / D) * gauss();
  const ang = Math.atan2(dy, dx) + err;
  let vx: number;
  let vy: number;
  let vz: number;
  let spin = 0;
  if (lofted) {
    const T = clamp(0.7 + D / 23, 0.8, 2.4) * (kind === 'clear' ? 1.1 : 1);
    const zEnd = kind === 'cross' ? 1.1 : 0.2;
    vz = (zEnd - b.z + 0.5 * GRAVITY * T * T) / T;
    const vh = (D / T) * (1 + 0.04 * T) * (1 + gauss() * (1 - p.def.pas / 99) * 0.08);
    vx = Math.cos(ang) * vh;
    vy = Math.sin(ang) * vh;
    if (kind === 'cross') {
      // 크로스는 골문 쪽으로 감아준다
      spin = Math.sign(angleDiff(Math.atan2(vy, vx), Math.atan2(CY - b.y, team.oppGoalX - b.x))) * 2.5;
    }
  } else {
    const arrive = kind === 'through' ? 6.5 : D > 22 ? 6.5 : 5.2;
    let v0 = groundSpeedFor(D, arrive);
    v0 = clamp(v0 * (1 + k.power * 0.18), 7, 27);
    v0 *= 1 + gauss() * (1 - p.def.pas / 99) * 0.06;
    vx = Math.cos(ang) * v0;
    vy = Math.sin(ang) * v0;
    vz = D > 25 ? 1.2 : 0.4;
    if (k.finesse) spin = Math.sign(gauss()) * 2.2;
  }
  kickBall(m, p, vx, vy, vz, spin, lofted ? 0.55 : 0.32);
  b.pass = { from: p, to: target, t: 0, tx, ty, lofted, through: kind === 'through' };
  team.stats.passes++;
  p.anim += 0.3;
  if (target) {
    m.onPassLaunched(p, target);
  }
  // 위험한 패스는 해설
  if (kind === 'cross') m.say(`${p.def.name}, 크로스!`);
  else if (kind === 'through' && target) m.say(`${p.def.name}의 스루패스! ${target.def.name}에게!`);
  else if (kind === 'clear') m.say(`${p.def.name}, 걷어냅니다.`);
}

/** 골문 통과 지점 예측 (단순 물리) */
export function predictGoalCross(m: Match, gx: number) {
  const b = m.ball;
  let x = b.x,
    y = b.y,
    z = b.z,
    vx = b.vx,
    vy = b.vy,
    vz = b.vz,
    spin = b.spin;
  const dt = 1 / 60;
  for (let t = 0; t < 3; t += dt) {
    const sp = Math.sqrt(vx * vx + vy * vy);
    if (z > 0.02 || vz > 0.5) {
      vz -= (GRAVITY + b.dip) * dt;
    } else if (sp > 0) {
      const ns = Math.max(0, sp - (1.4 + 0.42 * sp) * dt);
      vx *= ns / sp;
      vy *= ns / sp;
    }
    if (spin !== 0 && sp > 2) {
      vx += (-vy / sp) * spin * dt;
      vy += (vx / sp) * spin * dt;
      spin *= Math.exp(-0.7 * dt);
    }
    const px = x;
    x += vx * dt;
    y += vy * dt;
    z += vz * dt;
    if (z < 0) {
      z = 0;
      vz = vz < -1.5 ? -vz * 0.48 : 0;
    }
    if ((px - gx) * (x - gx) <= 0) {
      return { t, y, z, hit: Math.abs(y - CY) < GOAL_HALF_W + BALL_R && z < GOAL_H + BALL_R };
    }
    if (sp < 1 && z < 0.05) break;
  }
  return null;
}

export function performShot(m: Match, p: Player, k: PendingKick) {
  const team = p.team;
  const b = m.ball;
  const gx = team.oppGoalX;
  const opps = m.opp(team).active;
  const D = distToGoal(team, b.x, b.y);
  const isHeader = k.kind === 'header';
  // 조준: 방향키의 세로 성분이 골문 좌우를 결정
  const lateral = Math.abs(k.dirY) > 0.25 ? clamp(k.dirY * 1.15, -1, 1) : 0;
  let aimY: number;
  if (lateral !== 0) aimY = CY + lateral * (GOAL_HALF_W - 0.45);
  else {
    // 기본: 먼 포스트 쪽
    const far = b.y < CY ? 1 : -1;
    aimY = CY + far * rand(1.2, 2.6);
  }
  let power = k.power;
  let aimZ = isHeader ? rand(0.2, 1.4) : 0.2 + power * 1.55;
  // 과한 파워는 뜬다
  if (power > 0.82 && !isHeader) aimZ += (power - 0.82) * rand(4, 10);
  const press = nearestOpp(opps, p.x, p.y).d;
  const pressure = press < 1.3 ? 1 : press < 2.5 ? 0.5 : 0;
  const balance = p.speed > 7.5 ? 0.25 : 0;
  let err = (0.022 + (1 - p.def.sho / 99) * 0.07) * (1 + pressure * 0.6 + balance) * (1 + D / 32);
  if (k.timing === 'perfect') err *= 0.35;
  else if (k.timing === 'early') err *= 1.7;
  if (k.finesse) err *= 0.85;
  if (isHeader) err *= 1.4;
  err /= p.moraleMul;
  if (!team.human) err *= m.dp.cpuErr;

  let speed = (16 + power * 15) * (0.84 + (p.def.sho / 99) * 0.24) * (isHeader ? 0.62 : 1);
  if (k.timing === 'perfect') speed *= 1.06;
  let spin = 0;
  if (k.finesse) {
    speed *= 0.8;
    // 바깥쪽을 겨냥하고 골문 중앙 쪽으로 휘어 들어오게
    const toward = Math.sign(CY - aimY) || 1;
    spin = toward * team.dir * (6 + (p.def.sho / 99) * 4);
  }
  if (k.chip) {
    speed = 11 + power * 6;
    aimZ = 2.0;
  }
  const dx = gx - b.x;
  const dy = aimY - b.y;
  const H = len(dx, dy);
  let T = H / speed;
  if (spin !== 0) {
    // 휘어 들어올 양만큼 반대쪽으로 겨냥 (회전 가속은 속도의 왼쪽 수직 방향)
    const curl = 0.5 * Math.abs(spin) * T * T * 0.62;
    const perpY = dx / H;
    aimY -= perpY * curl * Math.sign(spin);
  }
  const ang = Math.atan2(aimY - b.y, gx - b.x) + gauss() * err;
  const vh = speed;
  T = H / vh;
  let vz = (aimZ - b.z + 0.5 * GRAVITY * T * T) / T;
  if (k.chip) vz = (aimZ - b.z + 0.5 * GRAVITY * T * T) / T + 1.5;
  vz += gauss() * err * 14;
  kickBall(m, p, Math.cos(ang) * vh, Math.sin(ang) * vh, vz, spin, 0.7 + power * 0.3);
  if (!k.finesse && !k.chip && power > 0.6) b.dip = 2 + power * 3;
  const cross = predictGoalCross(m, gx);
  b.shot = {
    by: p,
    side: team.side,
    t: 0,
    special: null,
    judged: false,
    ty: cross ? cross.y : CY,
    tz: cross ? cross.z : 1,
    speed: vh,
    saveMul: k.timing === 'perfect' ? 0.88 : 1,
  };
  team.stats.shots++;
  p.st.shots++;
  if (cross && cross.hit) team.stats.onTarget++;
  m.onShot(p, k, D);
}

/** 개인기 */
export function skillMove(m: Match, p: Player, dirX: number, dirY: number) {
  if (m.ball.owner !== p) return;
  const f = { x: Math.cos(p.facing), y: Math.sin(p.facing) };
  const inp = norm(dirX, dirY);
  let kind: Player['skill'];
  const sprinting = p.sprinting && p.speed > 6;
  if (inp.x === 0 && inp.y === 0) kind = 'stepover';
  else {
    const dot = inp.x * f.x + inp.y * f.y;
    if (sprinting && dot > 0.5) kind = 'knock';
    else if (dot < -0.5) kind = 'dragback';
    else if (dot > 0.7) kind = 'rainbow';
    else kind = 'roulette';
  }
  p.skill = kind;
  const dur = kind === 'roulette' ? 0.5 : kind === 'dragback' ? 0.35 : kind === 'knock' ? 0.25 : kind === 'rainbow' ? 0.55 : 0.4;
  p.setState('skill', dur);
  p.evade = dur + 0.15;
  if (kind === 'roulette') {
    p.skillDX = inp.x;
    p.skillDY = inp.y;
    m.popup(p, '마르세유 룰렛!', '#9be15d');
  } else if (kind === 'dragback') {
    p.skillDX = -f.x;
    p.skillDY = -f.y;
    m.popup(p, '드래그백', '#9be15d');
  } else if (kind === 'knock') {
    // 공을 길게 치고 달리기
    const k = 9 + (p.def.dri / 99) * 3;
    kickBall(m, p, f.x * k, f.y * k, 0.3, 0, 0.3);
    p.touchCD = 0.18;
    p.skillDX = f.x;
    p.skillDY = f.y;
    m.popup(p, '치고 달리기!', '#9be15d');
  } else if (kind === 'rainbow') {
    p.skillDX = f.x;
    p.skillDY = f.y;
    // 레인보우 플릭: 공이 머리 위로
    kickBall(m, p, f.x * 6.2, f.y * 6.2, 6.4, 0, 0.25);
    p.touchCD = 0.3;
    m.popup(p, '레인보우 플릭!!', '#ffd34d');
  } else {
    p.skillDX = f.x;
    p.skillDY = f.y;
    m.popup(p, '헛다리!', '#9be15d');
  }
  m.addGauge(p.team, 3);
}

export function startTackle(m: Match, p: Player) {
  if (!p.canAct) return;
  p.setState('tackle', 0.38);
  p.tackleResolved = false;
  const b = m.ball;
  const d = norm(b.x - p.x, b.y - p.y);
  p.vx = d.x * 6.5;
  p.vy = d.y * 6.5;
  p.facing = Math.atan2(d.y, d.x);
}

export function startSlide(m: Match, p: Player) {
  if (!p.canAct) return;
  p.setState('slide', 0.95);
  p.tackleResolved = false;
  // 공 방향으로 살짝 보정
  const b = m.ball;
  const toBall = Math.atan2(b.y - p.y, b.x - p.x);
  const diff = angleDiff(p.facing, toBall);
  if (Math.abs(diff) < 0.8) p.facing += diff * 0.7;
  const sp = Math.max(p.speed, 6) + 3;
  p.vx = Math.cos(p.facing) * sp;
  p.vy = Math.sin(p.facing) * sp;
  audio.whoosh();
}

/** 태클 판정 (매 틱) */
export function resolveTackles(m: Match) {
  const b = m.ball;
  for (const team of m.teams) {
    for (const p of team.active) {
      if (p.tackleResolved) continue;
      if (p.state === 'tackle' && p.stateT > 0.06 && p.stateT < 0.3) {
        const footX = p.x + Math.cos(p.facing) * 0.6;
        const footY = p.y + Math.sin(p.facing) * 0.6;
        const d = len(b.x - footX, b.y - footY);
        if (d < 1.0 && b.z < 0.9) {
          p.tackleResolved = true;
          const o = b.owner;
          if (!o) {
            m.gainPossession(p);
            continue;
          }
          if (o.team === p.team) continue;
          const behind = Math.abs(angleDiff(o.facing, Math.atan2(p.y - o.y, p.x - o.x))) > 2.2;
          let prob = 0.5 + (p.def.def - o.def.dri) / 100 + (p.team.human ? 0.08 : m.dp.cpuTackle);
          if (o.evade > 0) prob *= 0.3;
          if (behind) prob -= 0.15;
          prob = clamp(prob * (p.moraleMul / o.moraleMul), 0.12, 0.88);
          if (o.isGK && b.heldByKeeper) prob = 0;
          if (chance(prob)) {
            p.team.stats.tackles++;
            p.st.tackles++;
            o.st.lost++;
            audio.tackle();
            m.addGauge(p.team, 6);
            if (chance(0.55)) {
              m.gainPossession(p);
            } else {
              const dir = norm(b.x - o.x + rand(-0.5, 0.5), b.y - o.y + rand(-0.5, 0.5));
              b.owner = null;
              b.vx = dir.x * rand(3, 6) + p.vx * 0.3;
              b.vy = dir.y * rand(3, 6) + p.vy * 0.3;
              b.lastTouch = p;
              o.touchCD = 0.5;
            }
            o.setState('stumble', 0.45);
            m.say(`${p.def.name}, 깔끔한 태클로 공을 빼앗습니다!`);
          } else if (behind && chance(0.3)) {
            m.foul(p, o, false);
          } else {
            p.setState('stumble', 0.4);
          }
        }
      } else if (p.state === 'slide' && p.stateT > 0.05 && p.stateT < 0.6) {
        const footX = p.x + Math.cos(p.facing) * 0.9;
        const footY = p.y + Math.sin(p.facing) * 0.9;
        const d = len(b.x - footX, b.y - footY);
        const o = b.owner;
        if (d < 1.15 && b.z < 0.8 && (!o || o.team !== p.team)) {
          p.tackleResolved = true;
          let prob = o ? 0.72 + (p.def.def - o.def.dri) / 160 : 1;
          if (o && o.evade > 0) prob *= 0.5;
          if (o && o.isGK && b.heldByKeeper) prob = 0;
          if (chance(prob)) {
            if (o) {
              o.setState('down', 0.9);
              o.st.lost++;
              o.touchCD = 0.6;
            }
            b.owner = null;
            const sp = Math.max(p.speed, 5);
            b.vx = Math.cos(p.facing) * sp * 0.9 + rand(-1, 1);
            b.vy = Math.sin(p.facing) * sp * 0.9 + rand(-1, 1);
            b.vz = 0.5;
            b.lastTouch = p;
            b.pass = null;
            b.shot = null;
            p.team.stats.tackles++;
            p.st.tackles++;
            audio.tackle();
            m.addGauge(p.team, 7);
            m.say(`${p.def.name}의 슬라이딩 태클! 공을 걷어냅니다!`);
            continue;
          }
        }
        // 공 대신 사람을 걸었는가
        if (!p.tackleResolved) {
          for (const o2 of m.opp(p.team).active) {
            if (o2.state === 'down') continue;
            const dd = len(o2.x - footX, o2.y - footY);
            if (dd < 0.85) {
              p.tackleResolved = true;
              const behind = Math.abs(angleDiff(o2.facing, Math.atan2(p.y - o2.y, p.x - o2.x))) > 2.0;
              const hasBall = b.owner === o2;
              const foulProb = hasBall ? (behind ? 0.85 : 0.5) : 0.75;
              if (chance(foulProb)) {
                o2.setState('down', 1.1);
                m.foul(p, o2, behind);
              }
              break;
            }
          }
        }
      }
    }
  }
}

/** 필살 태클: 공 소유자에게 돌진해 반드시 빼앗는다 */
export function specialTackle(m: Match, p: Player) {
  const o = m.ball.owner;
  if (!o || o.team === p.team) return false;
  if (len(o.x - p.x, o.y - p.y) > 14) return false;
  p.setState('charge', 0.6);
  p.tackleResolved = false;
  p.aura = 1.2;
  m.addGauge(p.team, -50);
  m.popup(p, '필살 태클!!', '#ff4d6d');
  m.say(`${p.def.name}, 필살 태클 발동!`);
  audio.whoosh();
  audio.boom(0.5);
  m.fx.shake = Math.max(m.fx.shake, 0.4);
  return true;
}

export function updateCharge(m: Match, p: Player, dt: number) {
  const b = m.ball;
  const tx = b.x;
  const ty = b.y;
  const d = norm(tx - p.x, ty - p.y);
  p.vx = d.x * 15;
  p.vy = d.y * 15;
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  p.facing = Math.atan2(d.y, d.x);
  const col = p.team.kit.shirt;
  for (let i = 0; i < 4; i++) {
    m.particles.spawn({
      x: p.x + rand(-0.3, 0.3),
      y: p.y + rand(-0.3, 0.3),
      z: rand(0.2, 1.6),
      vx: -p.vx * 0.1,
      vy: -p.vy * 0.1,
      vz: rand(0, 1),
      life: 0.4,
      size: 0.35,
      color: col,
      color2: '#ffffff',
      kind: 'glow',
    });
  }
  if (!p.tackleResolved && len(b.x - p.x, b.y - p.y) < 1.4) {
    p.tackleResolved = true;
    const o = b.owner;
    if (o && o.team !== p.team) {
      o.setState('down', 1.2);
      o.vx = d.x * 6;
      o.vy = d.y * 6;
      o.touchCD = 1;
    }
    m.gainPossession(p);
    p.team.stats.tackles++;
    p.st.tackles++;
    m.particles.burst(p.x, p.y, 0.5, 40, [col, '#ffffff', '#ffd34d'], 9, 'spark', 0.7, 0.25);
    m.particles.ring(p.x, p.y, 0.05, col, { vr: 16, life: 0.5, width: 6 });
    audio.boom(0.8);
    m.fx.shake = 0.6;
    m.fx.flash = 0.35;
    m.fx.flashColor = '#ffffff';
    p.setState('stumble', 0.2);
  }
}

// ───────────────────────── 필살기 ─────────────────────────

export const SPECIAL_COLORS: Record<SpecialType, [string, string, string]> = {
  fire: ['#ff5a1f', '#ffb21f', '#fff2a8'],
  thunder: ['#7fd7ff', '#e6f9ff', '#ffe74d'],
  tornado: ['#8fffd6', '#e9fff6', '#5ad1ff'],
  meteor: ['#ff6b2b', '#ffd36b', '#7a2cff'],
  ice: ['#9be7ff', '#e8fbff', '#5aa9ff'],
  phantom: ['#b86bff', '#f0d9ff', '#5a2cff'],
  dragon: ['#3dff8f', '#ffe066', '#13a35a'],
  tiger: ['#ffffff', '#ff9a1f', '#ffd36b'],
};

export function launchSpecial(m: Match, p: Player, k: PendingKick) {
  const team = p.team;
  const b = m.ball;
  const type = team.def.special.type;
  const gx = team.oppGoalX;
  const inside = team.dir > 0 ? gx + 1.4 : gx - 1.4;
  const lateral = Math.abs(k.dirY) > 0.25 ? Math.sign(k.dirY) : b.y < CY ? 1 : -1;
  const ey = CY + lateral * rand(1.9, 3.0);
  const ez = rand(0.6, 1.9);
  const sx = b.x;
  const sy = b.y;
  const sz = Math.max(0.15, b.z);
  const D = len(gx - sx, ey - sy);
  const ace = p.def.ace;
  const perp = norm(-(ey - sy), gx - sx);
  let path: (t: number) => [number, number, number];
  let T: number;
  const lerp3 = (t: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number): [number, number, number] => [
    ax + (bx - ax) * t,
    ay + (by - ay) * t,
    az + (bz - az) * t,
  ];
  // 골라인 이후로 조금 더 진행 (골망까지)
  switch (type) {
    case 'thunder': {
      const w1 = { x: sx + (gx - sx) * 0.33 + perp.x * 4.5, y: sy + (ey - sy) * 0.33 + perp.y * 4.5, z: 1.4 };
      const w2 = { x: sx + (gx - sx) * 0.66 - perp.x * 4.5, y: sy + (ey - sy) * 0.66 - perp.y * 4.5, z: 2.6 };
      const pts = [
        { x: sx, y: sy, z: sz },
        w1,
        w2,
        { x: inside, y: ey, z: ez },
      ];
      const segs = [0, 0, 0].map((_, i) => len(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y));
      const tot = segs.reduce((a, c) => a + c, 0);
      path = (t) => {
        let dd = t * tot;
        for (let i = 0; i < 3; i++) {
          if (dd <= segs[i] || i === 2) {
            const u = clamp(dd / segs[i], 0, 1);
            return lerp3(u, pts[i].x, pts[i].y, pts[i].z, pts[i + 1].x, pts[i + 1].y, pts[i + 1].z);
          }
          dd -= segs[i];
        }
        return [inside, ey, ez];
      };
      T = tot / 46;
      m.specialData = { pts: pts.map((q) => [q.x, q.y, q.z]) };
      break;
    }
    case 'tornado': {
      const side = Math.random() < 0.5 ? 1 : -1;
      const cx = sx + (gx - sx) * 0.5 + perp.x * 13 * side;
      const cy = sy + (ey - sy) * 0.5 + perp.y * 13 * side;
      const cz = 5;
      path = (t) => {
        const a = (1 - t) * (1 - t);
        const bb = 2 * (1 - t) * t;
        const c = t * t;
        return [a * sx + bb * cx + c * inside, a * sy + bb * cy + c * ey, a * sz + bb * cz + c * ez];
      };
      T = (D * 1.25) / 36;
      break;
    }
    case 'meteor': {
      const cx = sx + (gx - sx) * 0.75;
      const cy = sy + (ey - sy) * 0.75;
      const cz = 36;
      path = (t) => {
        const a = (1 - t) * (1 - t);
        const bb = 2 * (1 - t) * t;
        const c = t * t;
        return [a * sx + bb * cx + c * inside, a * sy + bb * cy + c * ey, a * sz + bb * cz + c * ez];
      };
      T = D / 30 + 0.55;
      p.vz = 5;
      break;
    }
    case 'dragon': {
      path = (t) => {
        const base = lerp3(t, sx, sy, sz, inside, ey, ez);
        const amp = 3.2 * Math.sin(Math.PI * t);
        const w = Math.sin(t * Math.PI * 3);
        return [base[0] + perp.x * amp * w, base[1] + perp.y * amp * w, base[2] + 2.6 * Math.sin(Math.PI * t) + 0.8 * Math.cos(t * Math.PI * 3) * Math.sin(Math.PI * t)];
      };
      T = D / 37;
      break;
    }
    case 'phantom': {
      path = (t) => {
        const base = lerp3(t, sx, sy, sz, inside, ey, ez);
        return [base[0], base[1] + Math.sin(t * Math.PI) * 1.2, base[2] + Math.sin(t * Math.PI) * 0.8];
      };
      T = D / 40;
      // 가짜 공 2개: 반대 코너들
      m.specialData = {
        fakes: [
          [inside, CY - lateral * 2.8, rand(0.3, 2.0)],
          [inside, CY + lateral * 0.3, 2.1],
        ],
        start: [sx, sy, sz],
      };
      break;
    }
    default: {
      // fire, ice, tiger: 위로 솟았다가 떨어지는 드라이브
      path = (t) => {
        const base = lerp3(t, sx, sy, sz, inside, ey, ez);
        return [base[0], base[1], base[2] + Math.sin(Math.PI * t) * 1.6];
      };
      T = D / (type === 'tiger' ? 44 : type === 'ice' ? 39 : 43);
    }
  }
  b.owner = null;
  b.heldByKeeper = false;
  b.lastTouch = p;
  b.pass = null;
  b.guide = { path, t: 0, T };
  b.special = type;
  b.specialT = 0;
  b.specialColor = SPECIAL_COLORS[type][0];
  b.spin = 0;
  p.touchCD = 0.6;
  // 골키퍼가 막을 확률 계수 (매우 낮음)
  const saveMul = (ace ? 0.3 : 0.45) * (type === 'phantom' ? 0.75 : 1);
  b.shot = {
    by: p,
    side: team.side,
    t: 0,
    special: type,
    judged: false,
    ty: ey,
    tz: ez,
    speed: D / T,
    saveMul,
  };
  team.stats.shots++;
  team.stats.onTarget++;
  team.stats.specials++;
  p.st.shots++;
  p.st.specials++;
  m.onSpecialLaunched(p, type);
}

/** 필살 슛이 날아가는 동안 진로에 있는 선수 날려버리기 */
export function specialSweep(m: Match) {
  const b = m.ball;
  if (!b.special || !b.guide || !b.shot) return;
  const shooterTeam = b.shot.by.team;
  for (const o of m.opp(shooterTeam).active) {
    if (o.isGK || o.state === 'down') continue;
    const d = len(o.x - b.x, o.y - b.y);
    if (d < 1.3 && b.z < 2.4) {
      const dir = norm(o.x - b.x + 0.01, o.y - b.y);
      o.setState(b.special === 'ice' ? 'frozen' : 'down', b.special === 'ice' ? 1.6 : 1.2);
      if (b.special === 'ice') o.frozen = 1.6;
      o.vx = dir.x * 7 + b.vx * 0.15;
      o.vy = dir.y * 7 + b.vy * 0.15;
      o.touchCD = 1.2;
      const col = SPECIAL_COLORS[b.special];
      m.particles.burst(o.x, o.y, 1.0, 26, [col[0], col[1], col[2]], 8, b.special === 'ice' ? 'ice' : 'spark', 0.7, 0.22);
      m.popup(o, b.special === 'ice' ? '빙결!' : '튕겨나감!', col[0]);
      audio.tackle();
    }
  }
}

export function isOnTarget(y: number, z: number) {
  return Math.abs(y - CY) < GOAL_HALF_W + 0.05 && z < GOAL_H + 0.05;
}
