import { beginKick, skillMove, specialTackle, startSlide, startTackle } from './actions';
import { interceptFor, moveTo } from './ai';
import { CY, RUN_SPEED } from './constants';
import type { PendingKick, Player, TeamState } from './entities';
import type { Action } from './input';
import { clamp, len } from './math';
import type { Match } from './match';

export function switchTo(m: Match, team: TeamState, p: Player) {
  if (team.controlled === p) return;
  if (team.controlled) {
    team.controlled.human = false;
    team.controlled.queued = null;
  }
  p.human = true;
  team.controlled = p;
  m.lastSwitchT = m.clock;
  m.charge = null;
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
    if (ax.mag > 0.1) {
      const sp = (sprint ? 12 : RUN_SPEED) * Math.max(0.35, ax.mag);
      p.dvx = ax.x * sp;
      p.dvy = ax.y * sp;
    } else if (b.pass && b.pass.to === p && !b.owner) {
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
    attackControls(m, team, p, ax);
    return;
  }
  const incoming =
    !b.owner &&
    ((b.pass && b.pass.to === p) || (len(b.x - p.x, b.y - p.y) < 4 && b.z < 2.8 && (!b.lastTouch || b.lastTouch.team === team || b.speed < 8)));
  if (incoming) {
    queueControls(m, p);
    return;
  }
  m.charge = null;
  defenseControls(m, team, p);

  // 루즈볼 자동 전환
  if (!b.owner && !(b.pass && b.pass.to && b.pass.to.team === team)) {
    const brain = m.brains[team.side];
    const ch = brain.chaser;
    if (ch && ch !== p && !ch.isGK && m.clock - m.lastSwitchT > 0.9) {
      const mine = interceptFor(m, p).t;
      if (mine - brain.chaserT > (ax.mag > 0.1 ? 1.2 : 0.5)) switchTo(m, team, ch);
    }
  }
}

function aimDir(p: Player, ax: { x: number; y: number; mag: number }) {
  if (ax.mag > 0.2) return { x: ax.x, y: ax.y };
  return { x: Math.cos(p.facing), y: Math.sin(p.facing) };
}

function attackControls(m: Match, team: TeamState, p: Player, ax: { x: number; y: number; mag: number }) {
  const inp = m.input;
  // 타이밍 피니시: 와인드업 중 슛 버튼 다시 누르기
  if (p.kick) {
    if (p.kick.kind === 'shot' && p.kick.timing === 'none' && inp.pressed('shoot')) {
      const t = p.kick.t;
      p.kick.timing = t >= p.kick.windup - 0.1 ? 'perfect' : 'early';
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
    if (inp.held(act)) charging = { kind, t: inp.holdTime(act) };
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
    if (inp.held(act)) charging = { kind, t: inp.holdTime(act) };
    if (inp.released(act)) {
      p.queued = { kind, power: clamp(inp.holdTime(act) / CHARGE_FULL, 0, 1), t: m.clock };
      charging = null;
    }
  }
  m.charge = charging;
}

function defenseControls(m: Match, team: TeamState, p: Player) {
  const inp = m.input;
  if (inp.pressed('pass')) {
    const c = switchCandidate(m, team, p);
    if (c) switchTo(m, team, c);
    return;
  }
  if (inp.pressed('shoot')) startTackle(m, p);
  else if (inp.pressed('through')) startSlide(m, p);
  if (inp.held('lob')) m.teammatePress = true;
  if (inp.pressed('special')) {
    if (team.gauge >= 50) {
      if (!specialTackle(m, p)) m.popup(p, '상대가 너무 멀다!', '#ff9a9a');
    } else m.popup(p, `필살 태클은 게이지 50% 필요`, '#ff9a9a');
  }
}

function setPieceControl(m: Match, team: TeamState, p: Player, ax: { x: number; y: number; mag: number }) {
  const inp = m.input;
  const sp = m.setPiece!;
  p.dvx = p.dvy = 0;
  if (p.kick) {
    if (p.kick.kind === 'shot' && p.kick.timing === 'none' && inp.pressed('shoot')) {
      p.kick.timing = p.kick.t >= p.kick.windup - 0.1 ? 'perfect' : 'early';
    }
    return;
  }
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
    if (inp.held(act)) charging = { kind, t: inp.holdTime(act) };
    if (inp.released(act)) {
      const power = clamp(inp.holdTime(act) / CHARGE_FULL, 0, 1);
      const d = { x: Math.cos(p.facing), y: Math.sin(p.facing) };
      let k = kind;
      if (sp.kind === 'corner' && kind === 'lob') k = 'cross';
      beginKick(m, p, k, k === 'shot' ? Math.max(0.15, power) : power, k === 'shot' ? team.dir : d.x, k === 'shot' ? (ax.mag > 0.2 ? ax.y : 0) : d.y, {
        finesse: inp.held('finesse'),
        chip: inp.held('chip'),
      });
      m.charge = null;
      return;
    }
  }
  m.charge = charging;
}
