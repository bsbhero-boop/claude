import { beginKick, skillMove, specialTackle, startSlide, startTackle } from './actions';
import { interceptFor, moveTo } from './ai';
import { CY, RUN_SPEED } from './constants';
import type { PendingKick, Player, TeamState } from './entities';
import type { Action } from './input';
import { clamp, len } from './math';
import type { Match } from './match';

export function switchTo(m: Match, team: TeamState, p: Player, keepHeld = false) {
  if (team.controlled === p) return;
  if (team.controlled) {
    team.controlled.human = false;
    team.controlled.queued = null;
  }
  p.human = true;
  team.controlled = p;
  m.lastSwitchT = m.clock;
  m.charge = null;
  // 이전 선수로 누르고 있던 버튼을 새 선수가 떼는 순간 엉뚱한 킥이 나가지 않게
  // (패스를 보낸 직후 받는 선수로 넘어갈 때는 예외: 그사이 누른 버튼은 원터치 입력이다)
  if (!keepHeld) m.input.consumeHeld();
}

function switchCandidate(m: Match, team: TeamState, exclude: Player | null) {
  const b = m.ball;
  let best: Player | null = null;
  let bs = Infinity;
  for (const p of team.active) {
    if (p === exclude || p.isGK) continue;
    const d = len(p.x - b.x, p.y - b.y);
    // 공보다 우리 골대 쪽에 있는 선수를 선호
    const goalSide = (team.ownGoalX - p.x) * (team.ownGoalX - b.x) >= 0 && Math.abs(p.x - team.ownGoalX) < Math.abs(b.x - team.ownGoalX);
    const s = d + (goalSide ? 0 : 5) + (p.state === 'down' ? 20 : 0);
    if (s < bs) {
      bs = s;
      best = p;
    }
  }
  return best;
}

const KICK_ACTIONS: [Action, PendingKick['kind']][] = [
  ['pass', 'pass'],
  ['shoot', 'shot'],
  ['through', 'through'],
  ['lob', 'lob'],
];

const CHARGE_FULL = 0.95;

export function humanControl(m: Match, team: TeamState) {
  const inp = m.input;
  let p = team.controlled;
  // 골키퍼는 골킥 같은 세트피스 때만 조종한다
  if (p && p.isGK && m.phase === 'play' && m.ball.owner !== p) {
    const c = switchCandidate(m, team, p);
    if (c) {
      switchTo(m, team, c);
      p = c;
    }
  }
  if (!p || p.sentOff) {
    const c = switchCandidate(m, team, null);
    if (!c) return;
    switchTo(m, team, c);
    p = c;
  }
  const b = m.ball;
  const ax = inp.axis();
  m.teammatePress = false;

  if ((m.phase === 'setpiece' || m.phase === 'kickoff') && m.setPiece) {
    const sp = m.setPiece;
    if (sp.taker === p && sp.side === team.side) {
      setPieceControl(m, team, p, ax);
      return;
    }
    if (m.phase === 'kickoff') {
      p.dvx = p.dvy = 0;
      return;
    }
    p.sprinting = false;
    p.dvx = ax.x * RUN_SPEED;
    p.dvy = ax.y * RUN_SPEED;
    if (inp.pressed('pass')) {
      const c = switchCandidate(m, team, p);
      if (c) switchTo(m, team, c);
    }
    return;
  }
  if (m.phase !== 'play') {
    p.dvx = p.dvy = 0;
    m.charge = null;
    return;
  }

  const hasBall = b.owner === p;
  // 이동
  if (!p.busy || p.state === 'skill') {
    const sprint = inp.held('sprint');
    p.sprinting = sprint && ax.mag > 0.1;
    const lock = m.recvLock;
    const receiving = !!(b.pass && b.pass.to === p && !b.owner);
    // 패스를 보낸 방향으로 방향키를 계속 누르고 있으면, 받는 선수가 공에서 도망치지 않도록 공 쪽으로 보낸다
    const keepIntercept =
      receiving && lock !== null && lock.p === p && m.clock - lock.t < 1.0 && (ax.mag < 0.2 || ax.x * lock.ax + ax.y * lock.ay > 0.5);
    if (keepIntercept) {
      const ic = interceptFor(m, p);
      moveTo(p, ic.x, ic.y, 0.8, b.x, b.y);
    } else if (ax.mag > 0.1) {
      const sp = (sprint ? 12 : RUN_SPEED) * Math.max(0.35, ax.mag);
      p.dvx = ax.x * sp;
      p.dvy = ax.y * sp;
    } else if (receiving) {
      const ic = interceptFor(m, p);
      moveTo(p, ic.x, ic.y, 0.8, b.x, b.y);
    } else {
      p.dvx = 0;
      p.dvy = 0;
      p.lookX = b.x;
      p.lookY = b.y;
    }
  }

  if (hasBall) {
    m.ctlMode = 'attack';
    attackControls(m, team, p, ax);
    return;
  }
  if (isIncoming(m, team, p)) {
    // 수비 중에 누르고 있던 버튼(태클 K 등)이 '받는 공' 원터치 입력으로 바뀌지 않게 (패스 직후는 제외)
    if (m.ctlMode === 'defense') inp.consumeHeld();
    m.ctlMode = 'incoming';
    queueControls(m, p);
    return;
  }
  m.ctlMode = 'defense';
  m.charge = null;
  defenseControls(m, team, p);

  // 루즈볼 자동 전환 (정말 다른 선수가 확실히 빠를 때만)
  if (!b.owner && !(b.pass && b.pass.to && b.pass.to.team === team) && !b.shot) {
    const brain = m.brains[team.side];
    const ch = brain.chaser;
    const steering = ax.mag > 0.1;
    const cooldown = steering ? 1.6 : 0.9;
    if (ch && ch !== p && !ch.isGK && m.clock - m.lastSwitchT > cooldown) {
      const dBall = len(b.x - p.x, b.y - p.y);
      // 공 가까이 있거나 공 쪽으로 달려가는 선수에게서 조종을 빼앗지 않는다
      const toBall = dBall > 0.1 ? ((b.x - p.x) * p.vx + (b.y - p.y) * p.vy) / dBall : 0;
      const chasing = toBall > 3 && dBall < 18;
      // 상대 패스가 날아가는 중이면, 받는 선수보다 먼저 닿을 때만
      let canCut = true;
      if (b.pass && b.pass.to && b.pass.to.team !== team) canCut = brain.chaserT < interceptFor(m, b.pass.to).t - 0.15;
      if (dBall > 6 && !chasing && canCut) {
        const mine = interceptFor(m, p).t;
        if (mine - brain.chaserT > (steering ? 2.0 : 0.6)) switchTo(m, team, ch);
      }
    }
  }
}

/** 공이 이 선수에게 오고 있는가 (원터치 예약 입력을 받는 상황) */
function isIncoming(m: Match, team: TeamState, p: Player) {
  const b = m.ball;
  // 우리 팀이 보낸 패스나 우리 팀이 마지막에 건드린 느린 공만 '받는 공'으로 본다 (상대가 흘린 공 근처에선 태클·전환이 그대로 동작)
  return (
    !b.owner &&
    ((b.pass !== null && b.pass.to === p) ||
      (len(b.x - p.x, b.y - p.y) < 4 && b.z < 2.8 && !!b.lastTouch && (b.lastTouch === p || (b.lastTouch.team === team && b.speed < 9))))
  );
}

/** 지금 버튼이 공격용으로 동작하는지 수비용으로 동작하는지 (터치 버튼 라벨용) */
export function controlMode(m: Match, team: TeamState): 'attack' | 'defense' {
  const p = team.controlled;
  if (!p) return 'defense';
  return m.ball.owner === p || isIncoming(m, team, p) ? 'attack' : 'defense';
}

function aimDir(p: Player, ax: { x: number; y: number; mag: number }) {
  if (ax.mag > 0.2) return { x: ax.x, y: ax.y };
  return { x: Math.cos(p.facing), y: Math.sin(p.facing) };
}

function attackControls(m: Match, team: TeamState, p: Player, ax: { x: number; y: number; mag: number }) {
  const inp = m.input;
  // 타이밍 피니시: 와인드업 중 슛 버튼 다시 누르기
  if (p.kick && (p.state === 'kick' || p.state === 'header')) {
    if (p.kick.kind === 'shot' && p.kick.timing === 'none' && inp.pressed('shoot')) {
      const t = p.kick.t;
      // 첫 입력만 인정 (연타로 PERFECT를 노릴 수 없게). 킥 직후 0.03초 안의 입력은 같은 누름의 떨림으로 보고 무시
      p.kick.timing = t >= p.kick.windup - 0.13 ? 'perfect' : t < 0.03 ? 'none' : 'early';
    }
    // 와인드업 중 조준 미세 조정
    if (ax.mag > 0.2 && p.kick.kind === 'shot') p.kick.dirY = ax.y;
    m.charge = null;
    return;
  }
  if (!p.canAct && p.state !== 'skill') return;

  if (inp.pressed('special')) {
    if (team.gauge >= 100) {
      m.requestSpecial(p);
      return;
    }
    m.popup(p, `필살 게이지 ${Math.floor(team.gauge)}%`, '#ff9a9a');
  }
  if (inp.pressed('skill') && p.state !== 'skill') {
    skillMove(m, p, ax.mag > 0.2 ? ax.x : 0, ax.mag > 0.2 ? ax.y : 0);
    return;
  }
  let charging: { kind: string; t: number } | null = null;
  for (const [act, kind] of KICK_ACTIONS) {
    if (inp.charging(act)) charging = { kind, t: inp.holdTime(act) };
    if (inp.released(act)) {
      const power = clamp(inp.holdTime(act) / CHARGE_FULL, 0, 1);
      const d = aimDir(p, ax);
      let k = kind;
      if (k === 'lob' && team.u(p.x) > 0.68 && Math.abs(p.y - CY) > 11) k = 'cross';
      beginKick(m, p, k, k === 'shot' ? Math.max(0.12, power) : power, k === 'shot' ? team.dir : d.x, d.y, {
        finesse: inp.held('finesse'),
        chip: inp.held('chip'),
      });
      const pk = p.kick as PendingKick | null;
      if (k === 'shot' && pk) {
        // 슛은 골문 방향으로 차되, 방향키 세로 성분으로 좌우 조준
        pk.dirX = team.dir;
        pk.dirY = ax.mag > 0.2 ? ax.y : 0;
      }
      m.charge = null;
      return;
    }
  }
  m.charge = charging;
}

function queueControls(m: Match, p: Player) {
  const inp = m.input;
  let charging: { kind: string; t: number } | null = null;
  for (const [act, kind] of KICK_ACTIONS) {
    if (inp.charging(act)) charging = { kind, t: inp.holdTime(act) };
    if (inp.released(act)) {
      p.queued = { kind, power: clamp(inp.holdTime(act) / CHARGE_FULL, 0, 1), t: m.clock, finesse: inp.held('finesse'), chip: inp.held('chip') };
      charging = null;
    }
  }
  m.charge = charging;
}

function defenseControls(m: Match, team: TeamState, p: Player) {
  const inp = m.input;
  // 상대 필살 슛 반응 대결 중: 슛·필살 버튼은 키퍼 반응용이라 태클로 쓰지 않는다
  const b = m.ball;
  if (m.saveDuel && b.guide && b.special && b.shot && b.shot.side !== team.side) {
    inp.consume('shoot');
    inp.consume('special');
    return;
  }
  if (inp.pressed('pass')) {
    const c = switchCandidate(m, team, p);
    if (c) switchTo(m, team, c);
    return;
  }
  // 수비 버튼으로 쓴 입력은 소비해서, 공을 뺏은 직후 떼도 슛·패스로 바뀌지 않게
  if (inp.pressed('shoot')) {
    startTackle(m, p);
    inp.consume('shoot');
  } else if (inp.pressed('through')) {
    startSlide(m, p);
    inp.consume('through');
  }
  if (inp.held('lob')) {
    m.teammatePress = true;
    inp.consume('lob');
  }
  if (inp.pressed('special')) {
    inp.consume('special');
    if (team.gauge >= 50) {
      if (!specialTackle(m, p)) m.popup(p, m.ball.owner ? '상대가 너무 멀다!' : '공을 가진 상대가 없다', '#ff9a9a');
    } else m.popup(p, `필살 태클은 게이지 50% 필요`, '#ff9a9a');
  }
}

function setPieceControl(m: Match, team: TeamState, p: Player, ax: { x: number; y: number; mag: number }) {
  const inp = m.input;
  const sp = m.setPiece!;
  p.dvx = p.dvy = 0;
  if (p.kick && p.state === 'kick') {
    if (p.kick.kind === 'shot' && p.kick.timing === 'none' && inp.pressed('shoot')) {
      p.kick.timing = p.kick.t >= p.kick.windup - 0.13 ? 'perfect' : p.kick.t < 0.03 ? 'none' : 'early';
    }
    // 와인드업 중에도 위아래로 코너 조준을 바꿀 수 있다
    if (ax.mag > 0.2 && p.kick.kind === 'shot') p.kick.dirY = ax.y;
    return;
  }
  if (ax.mag > 0.2) sp.idleT = 0;
  if (ax.mag > 0.2) {
    let a = Math.atan2(ax.y, ax.x);
    if (sp.kind === 'throw') {
      // 경기장 안쪽만
      const inward = sp.y <= 0 ? 1 : -1;
      if (Math.sin(a) * inward < 0.1) a = Math.atan2(inward * 0.1, Math.cos(a));
    }
    p.facing = a;
  }
  const allowed: Record<string, PendingKick['kind'][]> = {
    kickoff: ['pass', 'through', 'lob'],
    throw: ['pass', 'lob'],
    corner: ['pass', 'lob'],
    goalkick: ['pass', 'lob', 'through'],
    freekick: ['pass', 'lob', 'through', 'shot'],
    penalty: ['shot'],
  };
  let charging: { kind: string; t: number } | null = null;
  for (const [act, kind] of KICK_ACTIONS) {
    if (!allowed[sp.kind].includes(kind)) continue;
    if (inp.held(act)) sp.idleT = 0;
    if (inp.charging(act)) charging = { kind, t: inp.holdTime(act) };
    if (inp.released(act)) {
      const power = clamp(inp.holdTime(act) / CHARGE_FULL, 0, 1);
      const d = { x: Math.cos(p.facing), y: Math.sin(p.facing) };
      let k = kind;
      if (sp.kind === 'corner' && kind === 'lob') k = 'cross';
      beginKick(m, p, k, k === 'shot' ? Math.max(0.15, power) : power, k === 'shot' ? team.dir : d.x, k === 'shot' ? (ax.mag > 0.2 ? ax.y : 0) : d.y, {
        finesse: inp.held('finesse'),
        chip: inp.held('chip'),
      });
      const pk = p.kick as PendingKick | null;
      if (k === 'shot' && pk) {
        pk.dirX = team.dir;
        pk.dirY = ax.mag > 0.2 ? ax.y : 0;
      }
      m.charge = null;
      return;
    }
  }
  m.charge = charging;
}
