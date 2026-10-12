import { beginKick, executeKick, predictGoalCross, resolveTackles, specialSweep, updateCharge, SPECIAL_COLORS } from './actions';
import { Brain, formationSpot, interceptFor, newBrain, thinkTeam } from './ai';
import { audio } from './audio';
import {
  BALL_R,
  BOX_DEPTH,
  BOX_HALF_W,
  CIRCLE_R,
  CONTROL_R,
  CX,
  CY,
  GOAL_H,
  GOAL_HALF_W,
  GRAVITY,
  PEN_SPOT,
  PITCH_L,
  PITCH_W,
  PLAYER_R,
  SIM_DT,
} from './constants';
import { humanControl, switchTo } from './control';
import { Ball, PendingKick, Player, TeamState } from './entities';
import { inOwnBox, nearestOpp } from './geo';
import { Input } from './input';
import { chance, clamp, len, norm, pick, rand, smooth } from './math';
import { Particles } from './particles';
import { Shootout } from './shootout';
import { FORMATIONS, Slot } from '../data/formations';
import { pickKits } from '../data/teams';
import { COMMENTARY } from '../data/talks';
import type { GoalEvent, MatchConfig, MatchResult, PlayerDef, SpecialType, Tactics, TeamDef } from './types';

export interface DiffParams {
  cpuErr: number;
  cpuTackle: number;
  reaction: number;
  decision: number;
  noise: number;
  tackleRate: number;
  slideRate: number;
  shotBias: number;
  specialUse: number;
  skillUse: number;
  perfect: number;
  gkBonus: number;
  cpuGauge: number;
}

export const DIFFS: DiffParams[] = [
  { cpuErr: 1.7, cpuTackle: -0.14, reaction: 0.5, decision: 0.45, noise: 3, tackleRate: 0.6, slideRate: 0.04, shotBias: 0.8, specialUse: 0.25, skillUse: 0.3, perfect: 0.05, gkBonus: -0.08, cpuGauge: 0.65 },
  { cpuErr: 1.2, cpuTackle: -0.05, reaction: 0.32, decision: 0.34, noise: 2, tackleRate: 1.0, slideRate: 0.09, shotBias: 0.95, specialUse: 0.4, skillUse: 0.6, perfect: 0.15, gkBonus: -0.02, cpuGauge: 0.85 },
  { cpuErr: 0.92, cpuTackle: 0.02, reaction: 0.2, decision: 0.25, noise: 1.2, tackleRate: 1.5, slideRate: 0.15, shotBias: 1.05, specialUse: 0.55, skillUse: 0.9, perfect: 0.3, gkBonus: 0.03, cpuGauge: 1.05 },
  { cpuErr: 0.72, cpuTackle: 0.07, reaction: 0.14, decision: 0.19, noise: 0.7, tackleRate: 2.0, slideRate: 0.2, shotBias: 1.12, specialUse: 0.7, skillUse: 1.1, perfect: 0.45, gkBonus: 0.07, cpuGauge: 1.2 },
];

export type Phase = 'intro' | 'kickoff' | 'play' | 'out' | 'setpiece' | 'goal' | 'replay' | 'cutin' | 'halftime' | 'fulltime' | 'shootout';

export type SetPieceKind = 'kickoff' | 'throw' | 'corner' | 'goalkick' | 'freekick' | 'penalty';

export interface SetPiece {
  kind: SetPieceKind;
  side: 0 | 1;
  taker: Player;
  x: number;
  y: number;
  t: number;
  spots: Map<Player, { x: number; y: number }>;
  /** CPU가 킥하기까지 남은 시간 */
  cpuDelay: number;
}

export interface Popup {
  x: number;
  y: number;
  z: number;
  text: string;
  color: string;
  t: number;
}

interface FrameRec {
  b: number[];
  p: number[][];
  sp: number;
}

const STATE_CODES = ['idle', 'run', 'kick', 'tackle', 'slide', 'down', 'dive', 'celebrate', 'skill', 'frozen', 'stumble', 'header', 'throw', 'charge'] as const;
const SPECIAL_CODES: (SpecialType | null)[] = [null, 'fire', 'thunder', 'tornado', 'meteor', 'ice', 'phantom', 'dragon', 'tiger'];

export interface MatchCallbacks {
  onHalfTime?: () => void;
  onFullTime?: () => void;
  onShootoutEnd?: () => void;
  onPause?: () => void;
}

/** 포메이션 슬롯에 선수를 배정 (역할 적합도 기준 탐욕 배정) */
export function assignLineup(team: TeamDef, formation: Tactics['formation']): { def: PlayerDef; idx: number; slot: Slot }[] {
  const slots = FORMATIONS[formation];
  const remaining = team.players.map((p, i) => ({ p, i }));
  const order = [0, ...slots.map((_, i) => i).filter((i) => slots[i].role === 'FW'), ...slots.map((_, i) => i).filter((i) => slots[i].role === 'DF'), ...slots.map((_, i) => i).filter((i) => slots[i].role === 'MF')];
  const out: { def: PlayerDef; idx: number; slot: Slot }[] = new Array(slots.length);
  const fit = (p: PlayerDef, s: Slot) => {
    if (s.role === 'GK') return p.gk * 2 + (p.role === 'GK' ? 100 : 0);
    if (p.role === 'GK') return -999;
    const roleBonus = p.role === s.role ? 25 : 0;
    if (s.role === 'DF') return p.def + roleBonus;
    if (s.role === 'MF') return (p.pas + p.dri) / 2 + roleBonus;
    return p.sho + roleBonus + (p.ace ? 30 : 0);
  };
  for (const si of order) {
    let best = 0;
    let bs = -Infinity;
    remaining.forEach((r, k) => {
      const f = fit(r.p, slots[si]);
      if (f > bs) {
        bs = f;
        best = k;
      }
    });
    const r = remaining.splice(best, 1)[0];
    out[si] = { def: r.p, idx: r.i, slot: slots[si] };
  }
  return out;
}

export class Match {
  cfg: MatchConfig;
  teams: [TeamState, TeamState];
  ball = new Ball();
  particles = new Particles();
  input: Input;
  brains: [Brain, Brain] = [newBrain(), newBrain()];
  pred: { x: number; y: number; z: number; t: number }[] = [];
  phase: Phase = 'intro';
  phaseT = 0;
  half: 1 | 2 = 1;
  clock = 0;
  halfDur: number;
  kickoffSide: 0 | 1 = 0;
  setPiece: SetPiece | null = null;
  pendingSetPiece: { kind: SetPieceKind; side: 0 | 1; x: number; y: number } | null = null;
  fx = {
    shake: 0,
    flash: 0,
    flashColor: '#ffffff',
    slow: 0,
    slowScale: 1,
    fade: 0,
    letterbox: 0,
    zoom: 1,
    darken: 0,
  };
  cutin: { p: Player; t: number; dur: number; type: SpecialType } | null = null;
  banner: { text: string; sub: string; color: string; t: number; dur: number } | null = null;
  popups: Popup[] = [];
  commentary: { text: string; t: number } = { text: '', t: 0 };
  cb: MatchCallbacks;
  dp: DiffParams;
  teammatePress = false;
  goals: GoalEvent[] = [];
  lastKickT = 0;
  specialData: { pts?: number[][]; fakes?: number[][]; start?: number[] } = {};
  cam = { x: CX, y: CY, zoom: 1, tx: CX, ty: CY, mode: 'broadcast' as 'broadcast' | 'penalty' | 'cinematic' };
  /** 사람이 차지 중인 게이지 (HUD 표시) */
  charge: { kind: string; t: number } | null = null;
  realTime = 0;
  shootout: Shootout | null = null;
  paused = false;
  private frames: FrameRec[] = [];
  private replayFrames: FrameRec[] = [];
  replayIdx = 0;
  private extraT = 0;
  private lastPasser: [Player | null, Player | null] = [null, null];
  private lastPassT: [number, number] = [0, 0];
  private outText = '';
  autoSwitchT = 0;
  lastSwitchT = 0;
  replayEnabled = true;
  /** 경기 후 축포를 터뜨릴 팀 (-1 없음) */
  celebrateTeam: -1 | 0 | 1 = -1;

  constructor(cfg: MatchConfig, input: Input, cb: MatchCallbacks = {}) {
    this.cfg = cfg;
    this.input = input;
    this.cb = cb;
    this.dp = DIFFS[cfg.difficulty];
    this.halfDur = cfg.halfMinutes * 60;
    const [hk, ak] = pickKits(cfg.home, cfg.away);
    const home = new TeamState(0, cfg.home, hk, cfg.homeTactics, cfg.humanSide === 0);
    const away = new TeamState(1, cfg.away, ak, cfg.awayTactics, cfg.humanSide === 1);
    home.dir = 1;
    away.dir = -1;
    this.teams = [home, away];
    for (const t of this.teams) this.buildPlayers(t, t.side === 0 ? cfg.homeMorale : cfg.awayMorale);
    this.kickoffSide = chance(0.5) ? 0 : 1;
    this.setupKickoff(this.kickoffSide, true);
    this.phase = 'intro';
    this.phaseT = 0;
    this.computePred();
  }

  private buildPlayers(team: TeamState, morale: number[]) {
    const lineup = assignLineup(team.def, team.tactics.formation);
    team.players = lineup.map((l, i) => {
      const p = new Player(team, i, l.def, l.slot);
      p.morale = morale[l.idx] ?? 0;
      return p;
    });
    if (team.human) {
      const st = team.players.find((p) => p.role === 'FW') ?? team.players[10];
      st.human = true;
      team.controlled = st;
    }
  }

  /** 하프타임 전술 변경 반영 */
  applyTactics(side: 0 | 1, tactics: Tactics) {
    const team = this.teams[side];
    const formationChanged = tactics.formation !== team.tactics.formation;
    team.tactics = { ...tactics };
    if (formationChanged) {
      const lineup = assignLineup(team.def, tactics.formation);
      const byDef = new Map(team.players.map((p) => [p.def, p]));
      const ordered: Player[] = [];
      lineup.forEach((l, i) => {
        const p = byDef.get(l.def)!;
        p.slot = l.slot;
        p.role = l.slot.role;
        p.idx = i;
        ordered.push(p);
      });
      team.players = ordered;
    }
  }

  setMorale(side: 0 | 1, morale: number[]) {
    const team = this.teams[side];
    for (const p of team.players) {
      const idx = team.def.players.indexOf(p.def);
      if (idx >= 0) p.morale = morale[idx];
    }
  }

  opp(team: TeamState) {
    return this.teams[1 - team.side];
  }

  get humanTeam() {
    return this.cfg.humanSide >= 0 ? this.teams[this.cfg.humanSide as 0 | 1] : null;
  }

  get minute() {
    return Math.min(45, Math.floor((this.clock / this.halfDur) * 45)) + (this.half === 2 ? 45 : 0);
  }

  // ───────────────────────────── 메인 루프 ─────────────────────────────

  private acc = 0;

  frame(realDt: number) {
    realDt = Math.min(realDt, 0.1);
    this.realTime += realDt;
    if (this.paused) return;
    let scale = 1;
    if (this.fx.slow > 0) {
      this.fx.slow -= realDt;
      scale = this.fx.slowScale;
    }
    if (this.phase === 'replay') scale = 0.6;
    this.acc += realDt * scale;
    let steps = 0;
    while (this.acc >= SIM_DT && steps < 8) {
      this.acc -= SIM_DT;
      this.step(SIM_DT);
      steps++;
    }
    // 실시간 연출 업데이트
    this.updateFx(realDt);
    audio.update(realDt);
  }

  step(dt: number) {
    this.input.poll(dt);
    this.phaseT += dt;
    if (this.input.pressed('pause') && this.phase !== 'halftime' && this.phase !== 'fulltime') {
      this.cb.onPause?.();
    }
    switch (this.phase) {
      case 'intro':
        this.cameraUpdate(dt);
        this.idlePlayers(dt);
        if (this.phaseT > 2.6 || (this.phaseT > 0.6 && this.input.anyPressed())) this.beginKickoffPhase();
        break;
      case 'cutin':
        this.updateCutin(dt);
        break;
      case 'goal':
        this.updateGoalPhase(dt);
        break;
      case 'replay':
        this.updateReplay(dt);
        break;
      case 'halftime':
      case 'fulltime':
        this.updateAfterWhistle(dt);
        break;
      case 'shootout':
        this.shootout?.update(dt);
        this.particles.update(dt);
        this.updatePopups(dt);
        break;
      default:
        this.simulate(dt);
    }
  }

  /** 일반 플레이 시뮬레이션 (play/out/setpiece/kickoff) */
  simulate(dt: number) {
    if (this.phase === 'play' || this.phase === 'setpiece' || this.phase === 'kickoff' || this.phase === 'out') {
      if (this.phase !== 'kickoff') this.clock += dt;
    }
    this.computePred();
    for (const t of this.teams) if (t.human) humanControl(this, t);
    for (const t of this.teams) thinkTeam(this, t, dt);
    this.updatePlayers(dt);
    this.updateBall(dt);
    if (this.phase === 'play') {
      resolveTackles(this);
      this.keeperShotLogic();
      this.checkPossession();
      this.checkBallOut();
      // 점유율
      const o = this.ball.owner;
      if (o) o.team.stats.possessionTime += dt;
      // 관중 반응
      const nearGoal = Math.min(this.ball.x, PITCH_L - this.ball.x);
      audio.crowd(0.22 + (nearGoal < 25 ? (25 - nearGoal) / 25 : 0) * 0.35);
    }
    if (this.phase === 'out') {
      if (this.phaseT > 1.1 && this.pendingSetPiece) {
        const ps = this.pendingSetPiece;
        this.pendingSetPiece = null;
        this.setupSetPiece(ps.kind, ps.side, ps.x, ps.y);
      }
    }
    if (this.phase === 'setpiece' || this.phase === 'kickoff') this.updateSetPiece(dt);
    this.particles.update(dt);
    this.updatePopups(dt);
    this.cameraUpdate(dt);
    this.record();
    this.checkClock(dt);
    // 게이지 자연 증가
    for (const t of this.teams) this.addGauge(t, dt * 0.32, true);
  }

  /** 휘슬 이후: 선수들은 천천히 멈추고, 우승/승리 시 축포 */
  private updateAfterWhistle(dt: number) {
    for (const t of this.teams)
      for (const p of t.active) {
        p.dvx = p.dvy = 0;
        if (p.state !== 'celebrate' && p.state !== 'down') p.state = p.speed > 0.3 ? 'run' : 'idle';
        if (this.celebrateTeam === t.side && p.z === 0 && Math.random() < 0.01) p.vz = 3;
        if (p.z > 0 || p.vz > 0) {
          p.vz -= GRAVITY * dt;
          p.z = Math.max(0, p.z + p.vz * dt);
          if (p.z === 0) p.vz = 0;
        }
        p.integrate(dt, false);
      }
    if (this.celebrateTeam >= 0) {
      const t = this.teams[this.celebrateTeam as 0 | 1];
      if (Math.random() < dt * 2.2) {
        const x = this.cam.x + rand(-25, 25);
        const y = rand(-20, 10);
        const z = rand(18, 30);
        const cols = [t.kit.shirt, t.kit.accent, '#ffd34d', '#ffffff', '#ff6a2b'];
        this.particles.burst(x, y, z, 70, [pick(cols), pick(cols)], 13, 'spark', 1.6, 0.35);
        audio.boom(0.35);
      }
      if (Math.random() < dt * 3) this.particles.confetti(this.cam.x + rand(-20, 20), CY + rand(-15, 15), 6, [t.kit.shirt, t.kit.accent, '#ffffff']);
    }
    this.particles.update(dt);
    this.updatePopups(dt);
    this.cameraUpdate(dt);
  }

  private idlePlayers(dt: number) {
    for (const t of this.teams)
      for (const p of t.active) {
        p.dvx = p.dvy = 0;
        p.lookX = this.ball.x;
        p.lookY = this.ball.y;
        p.integrate(dt, false);
      }
  }

  // ───────────────────────────── 예측/카메라 ─────────────────────────────

  computePred() {
    const b = this.ball;
    const out = this.pred;
    out.length = 0;
    if (b.owner) {
      const o = b.owner;
      for (let i = 0; i <= 12; i++) {
        const t = i * 0.1;
        out.push({ x: b.x + o.vx * t, y: b.y + o.vy * t, z: 0, t });
      }
      return;
    }
    let x = b.x,
      y = b.y,
      z = b.z,
      vx = b.vx,
      vy = b.vy,
      vz = b.vz;
    const dt = 0.05;
    out.push({ x, y, z, t: 0 });
    if (b.guide) {
      const g = b.guide;
      for (let i = 1; i <= 30; i++) {
        const t = i * 0.05;
        const k = Math.min(1, (g.t + t) / g.T);
        const [px, py, pz] = g.path(k);
        out.push({ x: px, y: py, z: pz, t });
      }
      return;
    }
    for (let i = 1; i <= 70; i++) {
      const sp = Math.sqrt(vx * vx + vy * vy);
      if (z > 0.02 || vz > 0.5) {
        vz -= GRAVITY * dt;
      } else if (sp > 0) {
        const ns = Math.max(0, sp - (1.4 + 0.42 * sp) * dt);
        vx *= ns / sp;
        vy *= ns / sp;
      }
      x += vx * dt;
      y += vy * dt;
      z += vz * dt;
      if (z < 0) {
        z = 0;
        vz = vz < -1.5 ? -vz * 0.48 : 0;
      }
      if (i % 2 === 0) out.push({ x, y, z, t: i * dt });
    }
  }

  cameraUpdate(dt: number) {
    const b = this.ball;
    const c = this.cam;
    let tx = b.x + b.vx * 0.35;
    let ty = b.y + b.vy * 0.2;
    let zoom = 1;
    if (this.phase === 'goal' && this.phaseT > 0.6) {
      const scorer = this.goals[this.goals.length - 1];
      const team = this.teams[scorer.side];
      const sp = team.players.find((p) => p.def.name === scorer.scorer);
      if (sp) {
        tx = sp.x;
        ty = sp.y;
        zoom = 1.3;
      }
    }
    if (this.phase === 'replay') zoom = 1.35;
    if (this.phase === 'cutin' && this.cutin) {
      tx = this.cutin.p.x;
      ty = this.cutin.p.y;
      zoom = 1.6;
    }
    if (this.setPiece && (this.phase === 'setpiece' || this.phase === 'kickoff')) {
      const sp = this.setPiece;
      if (sp.kind === 'corner' || sp.kind === 'penalty' || sp.kind === 'freekick') {
        const team = this.teams[sp.side];
        tx = (sp.x + team.oppGoalX) / 2;
        ty = (sp.y + CY) / 2;
      }
    }
    c.tx = clamp(tx, 14, PITCH_L - 14);
    c.ty = clamp(ty, 8, PITCH_W - 6);
    c.x = smooth(c.x, c.tx, this.phase === 'replay' ? 5 : 3.2, dt);
    c.y = smooth(c.y, c.ty, 2.2, dt);
    c.zoom = smooth(c.zoom, zoom * this.fx.zoom, 3, dt);
  }

  // ───────────────────────────── 선수 업데이트 ─────────────────────────────

  updatePlayers(dt: number) {
    const b = this.ball;
    for (const t of this.teams) {
      for (const p of t.active) {
        p.stateT += dt;
        if (p.touchCD > 0) p.touchCD -= dt;
        if (p.evade > 0) p.evade -= dt;
        if (p.aura > 0) p.aura -= dt;
        if (p.frozen > 0) p.frozen -= dt;
        const withBall = b.owner === p;
        // 상태별 처리
        switch (p.state) {
          case 'kick':
          case 'header':
            if (p.kick) {
              p.kick.t += dt;
              if (p.kick.t >= p.kick.windup) executeKick(this, p);
              p.dvx = p.vx * 0.3;
              p.dvy = p.vy * 0.3;
            } else {
              p.dvx = p.dvy = 0;
            }
            if (p.stateT >= p.stateDur) p.setState('idle');
            break;
          case 'tackle':
            p.dvx = p.vx;
            p.dvy = p.vy;
            if (p.stateT >= p.stateDur) p.setState('idle');
            break;
          case 'slide': {
            const k = Math.exp(-2.6 * dt);
            p.vx *= k;
            p.vy *= k;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            if (p.stateT >= p.stateDur) p.setState('down', 0.35);
            continue;
          }
          case 'charge':
            updateCharge(this, p, dt);
            if (p.stateT >= p.stateDur) p.setState('idle');
            continue;
          case 'down':
          case 'frozen': {
            const k = Math.exp(-4 * dt);
            p.vx *= k;
            p.vy *= k;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            if (p.stateT >= p.stateDur) p.setState('idle');
            continue;
          }
          case 'dive':
            this.updateDive(p, dt);
            continue;
          case 'stumble':
            if (p.stateT >= p.stateDur) p.setState('idle');
            break;
          case 'skill':
            this.updateSkill(p, dt);
            if (p.stateT >= p.stateDur) {
              p.setState('idle');
              p.skill = null;
            }
            break;
          case 'celebrate':
            break;
          default:
            p.state = p.speed > 0.3 ? 'run' : 'idle';
        }
        // 속도 제한
        if (p.state !== 'skill') {
          const max = p.maxSpeed(withBall);
          const dl = len(p.dvx, p.dvy);
          if (dl > max) {
            p.dvx *= max / dl;
            p.dvy *= max / dl;
          }
        }
        p.integrate(dt, withBall);
        // 점프 (헤더/필살기)
        if (p.z > 0 || p.vz > 0) {
          p.vz -= GRAVITY * dt;
          p.z += p.vz * dt;
          if (p.z <= 0) {
            p.z = 0;
            p.vz = 0;
          }
        }
      }
    }
    // 겹침 방지
    const all = this.teams[0].active.concat(this.teams[1].active);
    for (let i = 0; i < all.length; i++) {
      const a = all[i];
      for (let j = i + 1; j < all.length; j++) {
        const c = all[j];
        const dx = c.x - a.x;
        const dy = c.y - a.y;
        const d2 = dx * dx + dy * dy;
        const min = PLAYER_R * 2;
        if (d2 < min * min && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          const push = (min - d) * 0.5;
          const nx = dx / d;
          const ny = dy / d;
          const wa = a.state === 'slide' || a.state === 'dive' ? 0.2 : 1;
          const wc = c.state === 'slide' || c.state === 'dive' ? 0.2 : 1;
          a.x -= nx * push * wa;
          a.y -= ny * push * wa;
          c.x += nx * push * wc;
          c.y += ny * push * wc;
        }
      }
    }
  }

  private updateSkill(p: Player, dt: number) {
    const k = p.stateT / p.stateDur;
    switch (p.skill) {
      case 'roulette':
        p.dvx = p.skillDX * 5.6;
        p.dvy = p.skillDY * 5.6;
        p.facing += dt * 13;
        break;
      case 'dragback':
        p.dvx = p.skillDX * 2.8;
        p.dvy = p.skillDY * 2.8;
        if (k > 0.4) p.facing = Math.atan2(p.skillDY, p.skillDX);
        break;
      case 'knock':
        p.sprinting = true;
        p.dvx = p.skillDX * 9.5;
        p.dvy = p.skillDY * 9.5;
        break;
      case 'rainbow':
        p.dvx = p.skillDX * 6.5;
        p.dvy = p.skillDY * 6.5;
        break;
      default: {
        // 헛다리: 순간 가속
        const sp = Math.max(p.speed, 4) + (k < 0.5 ? 0 : 3.5);
        p.dvx = Math.cos(p.facing) * sp;
        p.dvy = Math.sin(p.facing) * sp;
      }
    }
  }

  private updateDive(p: Player, dt: number) {
    const d = p.dive;
    if (!d) {
      p.setState('idle');
      return;
    }
    d.t += dt;
    const k = clamp(d.t / d.dur, 0, 1);
    const e = 1 - (1 - k) * (1 - k);
    p.x = d.sx + (d.tx - d.sx) * e;
    p.y = d.sy + (d.ty - d.sy) * e;
    p.vx = p.vy = 0;
    if (d.t > d.dur + 0.75) {
      p.dive = null;
      p.setState('idle');
    }
  }

  // ───────────────────────────── 공 ─────────────────────────────

  updateBall(dt: number) {
    const b = this.ball;
    if (b.owner) {
      const p = b.owner;
      if (b.heldByKeeper || p.state === 'throw' || (this.setPiece && this.setPiece.kind === 'throw' && this.setPiece.taker === p && this.phase !== 'play')) {
        const f = { x: Math.cos(p.facing), y: Math.sin(p.facing) };
        b.x = p.x + f.x * 0.25;
        // 스로인 시 공은 반드시 라인 안쪽에서 출발
        b.y = clamp(p.y + f.y * 0.25, 0.25, PITCH_W - 0.25);
        b.z = this.setPiece?.kind === 'throw' && this.phase !== 'play' ? 2.1 : 1.0;
        b.vx = p.vx;
        b.vy = p.vy;
        b.vz = 0;
        return;
      }
      const sp = p.speed;
      let dist = 0.42 + sp * 0.05 + (p.sprinting && sp > 6 ? 0.35 : 0);
      if (p.state === 'skill' && p.skill === 'roulette') dist = 0.25;
      if (p.state === 'skill' && p.skill === 'dragback') dist = 0.35;
      if (p.state === 'kick' && p.kick) dist = 0.55;
      const osc = Math.abs(Math.sin(p.anim * Math.PI * 0.5)) * 0.18 * Math.min(1, sp / 6);
      const ang = p.state === 'skill' && p.skill === 'roulette' ? p.facing + Math.PI * 0.5 : p.facing;
      const tx = p.x + Math.cos(ang) * (dist + osc);
      const ty = p.y + Math.sin(ang) * (dist + osc);
      const k = 1 - Math.exp(-22 * dt);
      const nx = b.x + (tx - b.x) * k;
      const ny = b.y + (ty - b.y) * k;
      b.vx = (nx - b.x) / dt;
      b.vy = (ny - b.y) / dt;
      b.x = nx;
      b.y = ny;
      b.z = Math.max(0, b.z - dt * 4);
      b.vz = 0;
      b.rot += (b.speed * dt) / BALL_R;
      // 공이 터치라인 밖으로 나가지 않게 (드리블 중)
      return;
    }
    b.step(dt);
    if (b.hitPost) {
      audio.post();
      this.say(pick(COMMENTARY.post));
      this.fx.shake = Math.max(this.fx.shake, 0.25);
      if (b.shot) b.shot.judged = true;
    }
    if (b.hitNet) audio.net();
    if (b.pass) b.pass.t += dt;
    if (b.shot) {
      b.shot.t += dt;
      if ((b.speed < 5 && b.z < 0.3) || b.shot.t > 3.5) b.shot = null;
    }
    if (b.special) {
      b.specialT += dt;
      this.emitSpecialTrail(dt);
      specialSweep(this);
      if (!b.guide && b.speed < 9) b.special = null;
    }
  }

  emitSpecialTrail(dt: number) {
    const b = this.ball;
    const type = b.special!;
    const [c1, c2, c3] = SPECIAL_COLORS[type];
    const P = this.particles;
    const n = Math.ceil(dt * 260);
    for (let i = 0; i < n; i++) {
      const j = () => rand(-0.25, 0.25);
      switch (type) {
        case 'fire':
        case 'meteor':
          // 절반은 일반 합성으로 그려 주황·빨강 색감을 살린다
          P.spawn({ x: b.x + j(), y: b.y + j(), z: b.z + j(), vx: -b.vx * 0.05 + rand(-1, 1), vy: -b.vy * 0.05 + rand(-1, 1), vz: rand(0.5, 2.5), life: rand(0.25, 0.6), size: rand(0.35, 0.7) * (type === 'meteor' ? 1.4 : 1), grow: -0.6, color: pick([c1, c1, c2, c3]), color2: '#d81e00', kind: 'flame', drag: 2, additive: i % 2 === 0 });
          if (i % 3 === 0) P.spawn({ x: b.x, y: b.y, z: b.z, vx: rand(-4, 4), vy: rand(-4, 4), vz: rand(-1, 4), life: rand(0.3, 0.7), size: 0.08, color: c3, kind: 'spark', gravity: 6 });
          if (i % 5 === 0) P.spawn({ x: b.x, y: b.y, z: b.z, vz: 1, life: 1.2, size: 0.5, grow: 1.2, color: '#3a2a22', kind: 'smoke', additive: false, drag: 1.5 });
          break;
        case 'tiger':
          P.spawn({ x: b.x + j(), y: b.y + j(), z: b.z + j(), vx: rand(-1.5, 1.5), vy: rand(-1.5, 1.5), vz: rand(0, 2), life: rand(0.3, 0.6), size: rand(0.35, 0.65), grow: -0.5, color: pick([c2, c2, c3, '#ffffff']), color2: '#ff6a00', kind: 'flame', drag: 2, additive: i % 2 === 0 });
          if (i % 4 === 0) P.spawn({ x: b.x, y: b.y, z: b.z, vx: rand(-3, 3), vy: rand(-3, 3), vz: rand(0, 3), life: 0.5, size: 0.12, color: '#ffffff', kind: 'star', gravity: 2 });
          break;
        case 'ice':
          P.spawn({ x: b.x + j(), y: b.y + j(), z: b.z + j(), vx: rand(-1.5, 1.5), vy: rand(-1.5, 1.5), vz: rand(-0.5, 1), life: rand(0.5, 1.1), size: rand(0.12, 0.28), color: pick([c1, c2, c3]), kind: 'ice', gravity: 3, drag: 1.5 });
          if (i % 3 === 0) P.spawn({ x: b.x, y: b.y, z: Math.max(0.05, b.z - 0.2), life: 1.4, size: 0.25, grow: 0.4, color: '#dff6ff', kind: 'smoke', additive: true, drag: 3 });
          break;
        case 'thunder':
          P.spawn({ x: b.x + j(), y: b.y + j(), z: b.z + j(), vx: rand(-5, 5), vy: rand(-5, 5), vz: rand(-3, 5), life: rand(0.1, 0.3), size: rand(0.06, 0.12), color: pick([c1, c2, c3]), kind: 'spark', drag: 3 });
          if (i === 0 && Math.random() < 0.6) {
            P.lightning(b.x, b.y, b.z, b.x - b.vx * 0.06 + rand(-1, 1), b.y - b.vy * 0.06 + rand(-1, 1), b.z + rand(-0.5, 0.8), pick([c1, c2]), 0.6, 0.12);
          }
          break;
        case 'tornado': {
          const a = this.realTime * 18 + i;
          const r = 0.9 + Math.sin(a * 0.3) * 0.2;
          P.spawn({ x: b.x + Math.cos(a) * r, y: b.y + Math.sin(a) * r * 0.5, z: b.z + Math.sin(a) * r * 0.8, vx: -b.vx * 0.04, vy: -b.vy * 0.04, life: rand(0.3, 0.6), size: rand(0.12, 0.22), color: pick([c1, c2, c3]), kind: 'leaf', drag: 1 });
          break;
        }
        case 'phantom':
          P.spawn({ x: b.x + j(), y: b.y + j(), z: b.z + j(), life: rand(0.3, 0.5), size: rand(0.25, 0.45), grow: -0.4, color: pick([c1, c2, c3]), kind: 'glow', drag: 3 });
          break;
        case 'dragon':
          P.spawn({ x: b.x + j(), y: b.y + j(), z: b.z + j(), vx: rand(-1, 1), vy: rand(-1, 1), vz: rand(0, 1), life: rand(0.3, 0.6), size: rand(0.2, 0.4), grow: -0.3, color: pick([c1, c2]), kind: 'glow', drag: 2 });
          if (i % 3 === 0) P.spawn({ x: b.x, y: b.y, z: b.z, vx: rand(-3, 3), vy: rand(-3, 3), vz: rand(0, 3), life: 0.6, size: 0.1, color: c2, kind: 'star', gravity: 3 });
          break;
      }
    }
  }

  // ───────────────────────────── 점유 ─────────────────────────────

  checkPossession() {
    const b = this.ball;
    if (b.owner || b.guide || b.inNet) return;
    let best: Player | null = null;
    let bd = Infinity;
    for (const t of this.teams) {
      for (const p of t.active) {
        if (p.touchCD > 0) continue;
        if (p.state === 'down' || p.state === 'frozen' || p.state === 'dive' || p.state === 'slide' || p.state === 'charge') continue;
        const gkHands = p.isGK && inOwnBox(t, b.x, b.y);
        const reach = gkHands ? 1.25 : p.state === 'header' ? 1.3 : CONTROL_R;
        const zmax = gkHands ? 2.6 : p.state === 'header' ? 2.9 : 1.75;
        if (b.z > zmax) continue;
        const d = len(b.x - p.x, b.y - p.y);
        if (d < reach && d < bd) {
          bd = d;
          best = p;
        }
      }
    }
    if (!best) return;
    const p = best;
    const fast = b.speed > 15;
    // 슛 블로킹
    if (b.shot && fast && !p.isGK) {
      if (p.team !== b.shot.by.team) {
        const n = norm(b.vx, b.vy);
        b.vx = -n.x * rand(3, 8) + rand(-4, 4);
        b.vy = -n.y * rand(3, 8) + rand(-4, 4);
        b.vz = rand(0.5, 4);
        b.spin = 0;
        b.lastTouch = p;
        b.shot = null;
        p.touchCD = 0.4;
        p.st.tackles++;
        audio.tackle();
        this.say(`${p.def.name}, 몸을 던져 막아냅니다!`);
        this.popup(p, '블록!', '#ffffff');
        return;
      }
      return;
    }
    // 헤더/발리
    if (b.z > 1.25 && !p.isGK) {
      const q = p.queued;
      const human = p.human;
      const attacking = p.team.u(p.x) > 0.7;
      if ((human && q && (q.kind === 'shot' || q.kind === 'header')) || (!human && attacking && b.pass && b.pass.lofted && chance(0.75))) {
        p.queued = null;
        this.ball.owner = null;
        const t = p.team;
        beginKick(this, p, 'header', 0.7, t.dir, (Math.random() - 0.5) * 1.6);
        p.kick!.windup = 0;
        executeKick(this, p);
        p.setState('header', 0.5);
        p.vz = 3;
        this.say(`${p.def.name}의 헤더!`);
        return;
      }
      if (!human && p.team.u(p.x) < 0.35 && b.pass && b.pass.from.team !== p.team) {
        // 수비 헤더 클리어
        b.vx = p.team.dir * rand(8, 13) + rand(-3, 3);
        b.vy = rand(-6, 6);
        b.vz = rand(4, 7);
        b.lastTouch = p;
        b.pass = null;
        p.touchCD = 0.4;
        p.setState('header', 0.4);
        p.vz = 2.5;
        audio.kick(0.3);
        this.say(`${p.def.name}, 헤더로 걷어냅니다.`);
        return;
      }
    }
    // 빠른 공은 첫 터치가 튈 수 있다
    if (b.speed > 18 && !p.isGK && chance(0.35 - p.def.dri / 400)) {
      b.vx *= -0.25;
      b.vy *= -0.25;
      b.vx += rand(-3, 3);
      b.vy += rand(-3, 3);
      b.lastTouch = p;
      p.touchCD = 0.3;
      this.popup(p, '트래핑 실수', '#ff9a9a');
      return;
    }
    this.gainPossession(p);
  }

  gainPossession(p: Player) {
    const b = this.ball;
    const pass = b.pass;
    const team = p.team;
    if (pass) {
      if (pass.from.team === team && pass.from !== p) {
        team.stats.passesDone++;
        pass.from.st.passOk++;
        this.addGauge(team, 2.2);
        this.lastPasser[team.side] = pass.from;
        this.lastPassT[team.side] = this.clock;
        if (pass.through) {
          pass.from.st.keyPass++;
          this.addGauge(team, 3);
        }
      } else if (pass.from.team !== team) {
        pass.from.st.passBad++;
        this.addGauge(team, 3);
        if (!p.isGK) this.say(pick(COMMENTARY.intercept).replace('{p}', p.def.name));
      }
    }
    if (b.shot && b.shot.by.team !== team && p.isGK) {
      team.stats.saves++;
      p.st.saves++;
      this.addGauge(team, 5);
      this.say(pick(COMMENTARY.catch).replace('{p}', p.def.name));
      audio.ooh();
    }
    const lastTeam = b.lastTouch?.team;
    b.owner = p;
    b.lastTouch = p;
    b.pass = null;
    b.shot = null;
    b.special = null;
    b.guide = null;
    b.spin = 0;
    b.vz = 0;
    b.heldByKeeper = p.isGK && inOwnBox(team, b.x, b.y) && (lastTeam !== team || b.z > 0.6);
    if (b.heldByKeeper) {
      // 골키퍼가 공을 잡으면 상대는 물러난다
      p.holdT = 0;
    }
    p.holdT = 0;
    p.aiT = 0;
    if (team.human && !p.human && this.phase === 'play') switchTo(this, team, p);
    if (lastTeam && lastTeam !== team) {
      // 공을 잃은 팀이 사람팀이면 가까운 수비수로 전환
      const lost = this.teams[1 - team.side];
      if (lost.human && lost.controlled) {
        const ctl = lost.controlled;
        if (len(ctl.x - p.x, ctl.y - p.y) > 14) {
          const cand = lost.active
            .filter((q) => !q.isGK)
            .sort((a, c) => len(a.x - p.x, a.y - p.y) - len(c.x - p.x, c.y - p.y))[0];
          if (cand) switchTo(this, lost, cand);
        }
      }
    }
    // 원터치 예약 실행
    if (p.human && p.queued && this.clock - p.queued.t < 1.2) {
      const q = p.queued;
      p.queued = null;
      const ax = this.input.axis();
      const dx = ax.mag > 0.2 ? ax.x : Math.cos(p.facing);
      const dy = ax.mag > 0.2 ? ax.y : Math.sin(p.facing);
      beginKick(this, p, q.kind, q.power, dx, dy, {
        finesse: this.input.held('finesse'),
        chip: this.input.held('chip'),
      });
      if (p.kick) p.kick.windup = Math.min(p.kick.windup, 0.08);
      this.popup(p, '원터치!', '#7fe0ff');
    }
  }

  onPassLaunched(from: Player, to: Player) {
    const team = from.team;
    if (team.human && to !== team.controlled) {
      switchTo(this, team, to);
    }
  }

  onShot(p: Player, k: PendingKick, dist: number) {
    if (k.timing === 'perfect') {
      this.popup(p, 'PERFECT!', '#3dff8f');
      audio.perfect();
    } else if (k.timing === 'early' && p.team.human) {
      this.popup(p, '타이밍 빠름', '#ff6b6b');
    }
    const line = dist > 25 ? COMMENTARY.longShot : k.finesse ? COMMENTARY.finesse : k.chip ? COMMENTARY.chip : COMMENTARY.shot;
    this.say(pick(line).replace('{p}', p.def.name));
    audio.crowd(0.6);
  }

  // ───────────────────────────── 필살기 ─────────────────────────────

  requestSpecial(p: Player) {
    const team = p.team;
    if (team.gauge < 100 || this.ball.owner !== p || this.phase !== 'play') return false;
    const d = len(team.oppGoalX - p.x, CY - p.y);
    if (d > 42) {
      if (team.human) this.popup(p, '골문에서 너무 멀다!', '#ff9a9a');
      return false;
    }
    team.gauge = 0;
    this.cutin = { p, t: 0, dur: 1.9, type: team.def.special.type };
    this.phase = 'cutin';
    this.phaseT = 0;
    p.aura = 4;
    p.dvx = p.dvy = 0;
    p.vx *= 0.2;
    p.vy *= 0.2;
    p.facing = Math.atan2(CY - p.y, team.oppGoalX - p.x);
    audio.charge();
    if (team.def.special.type === 'tiger') setTimeout(() => audio.roarTiger(), 600);
    this.say(`${p.def.name}! 필살기 「${team.def.special.name}」!!`);
    return true;
  }

  private updateCutin(dt: number) {
    const c = this.cutin!;
    c.t += dt;
    const p = c.p;
    // 오라 파티클
    const [c1, c2] = SPECIAL_COLORS[c.type];
    for (let i = 0; i < 6; i++) {
      const a = rand(0, Math.PI * 2);
      const r = rand(0.4, 1.4);
      this.particles.spawn({ x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r, z: rand(0, 0.3), vz: rand(2, 5), life: rand(0.4, 0.8), size: rand(0.2, 0.4), grow: -0.3, color: pick([c1, c2]), kind: c.type === 'ice' ? 'ice' : 'flame', drag: 1 });
    }
    this.particles.update(dt);
    this.cameraUpdate(dt);
    if (c.t >= c.dur) {
      this.cutin = null;
      this.phase = 'play';
      this.phaseT = 0;
      const team = p.team;
      const ax = this.input.axis();
      const dirY = team.human ? ax.y : rand(-1, 1);
      beginKick(this, p, 'special', 1, team.dir, dirY);
      p.state = 'kick';
      p.kick!.windup = 0.12;
    }
  }

  onSpecialLaunched(p: Player, type: SpecialType) {
    const [c1, c2, c3] = SPECIAL_COLORS[type];
    this.fx.slow = 0.55;
    this.fx.slowScale = 0.35;
    this.fx.shake = 0.8;
    this.fx.flash = 0.6;
    this.fx.flashColor = c2;
    this.particles.ring(p.x, p.y, 0.05, c1, { vr: 20, life: 0.5, width: 8 });
    this.particles.ring(p.x, p.y, 0.05, c3, { vr: 12, life: 0.7, width: 4 });
    this.particles.burst(p.x, p.y, 0.4, 60, [c1, c2, c3], 12, type === 'ice' ? 'ice' : 'spark', 0.8, 0.22);
    audio.boom(1.2);
    if (type === 'thunder') {
      audio.thunder();
      const pts = this.specialData.pts;
      if (pts) for (let i = 0; i < pts.length - 1; i++) this.particles.lightning(pts[i][0], pts[i][1], pts[i][2], pts[i + 1][0], pts[i + 1][1], pts[i + 1][2], c1, 1.0, 0.9);
    }
    if (type === 'ice') audio.freeze();
    if (type === 'tornado' || type === 'dragon') audio.whoosh();
    if (type === 'tiger') {
      // 발톱 자국
      for (let k = -1; k <= 1; k++) {
        const a = Math.atan2(CY - p.y, p.team.oppGoalX - p.x);
        const px = -Math.sin(a) * k * 0.7;
        const py = Math.cos(a) * k * 0.7;
        this.particles.bolt(
          [
            [p.x + px - Math.cos(a) * 1.5, p.y + py - Math.sin(a) * 1.5, 2.2],
            [p.x + px + Math.cos(a) * 1.5, p.y + py + Math.sin(a) * 1.5, 0.2],
          ],
          '#ffffff',
          0.8,
          7,
        );
      }
    }
    audio.crowd(1);
  }

  // ───────────────────────────── 골키퍼 슛 반응 ─────────────────────────────

  private keeperShotLogic() {
    const b = this.ball;
    const s = b.shot;
    if (!s) return;
    const defTeam = this.teams[1 - s.side];
    const gk = defTeam.gk;
    if (gk.sentOff) return;
    const gx = defTeam.ownGoalX;
    // 공이 골문 방향으로 오는가
    const toward = (gx - b.x) * b.vx > 0;
    if (!s.judged) {
      let react = 0.08 + (1 - gk.def.gk / 99) * 0.22 - (defTeam.human ? 0 : this.dp.gkBonus);
      if (gk.frozen > 0) react += 0.3;
      if (s.special) react += 0.12;
      if (s.t < react) return;
      s.judged = true;
      if (!toward) return;
      this.judgeShot(gk, s);
      return;
    }
    // 세이브 판정 실행
    if (gk.dive && gk.dive.willSave) {
      const hx = gk.x;
      const crossing = Math.abs(b.x - hx) < 0.6 || (gx - b.x) * (gx - hx) < 0;
      const near = len(b.y - gk.dive.ty, b.z - gk.dive.tz) < 1.8;
      if (crossing && near) this.doSave(gk);
    } else if (gk.state !== 'dive' && (gk as Player & { standSave?: boolean }).standSave) {
      if (len(b.x - gk.x, b.y - gk.y) < 1.1 && b.z < 2.3) {
        (gk as Player & { standSave?: boolean }).standSave = false;
        this.doSave(gk);
      }
    }
  }

  private judgeShot(gk: Player, s: NonNullable<Ball['shot']>) {
    const b = this.ball;
    const team = gk.team;
    const gx = team.ownGoalX;
    // 키퍼 평면 통과 지점
    let cross: { t: number; y: number; z: number; hit: boolean } | null = null;
    let kp: { t: number; y: number; z: number } | null = null;
    if (b.guide) {
      const g = b.guide;
      let prev = g.path(Math.min(1, g.t / g.T));
      for (let t = 0.02; t < 3; t += 0.02) {
        const k = Math.min(1, (g.t + t) / g.T);
        const cur = g.path(k);
        if (!kp && (prev[0] - gk.x) * (cur[0] - gk.x) <= 0) kp = { t, y: cur[1], z: cur[2] };
        if ((prev[0] - gx) * (cur[0] - gx) <= 0) {
          cross = { t, y: cur[1], z: cur[2], hit: Math.abs(cur[1] - CY) < GOAL_HALF_W && cur[2] < GOAL_H };
          break;
        }
        prev = cur;
        if (k >= 1) break;
      }
      if (!cross) cross = { t: g.T - g.t, y: s.ty, z: s.tz, hit: true };
    } else {
      cross = predictGoalCross(this, gx);
      const c2 = predictGoalCross(this, gk.x);
      if (c2) kp = { t: c2.t, y: c2.y, z: c2.z };
    }
    if (!cross) return;
    if (!kp) kp = { t: cross.t, y: cross.y, z: cross.z };
    const onTarget = cross.hit;
    const dy = kp.y - gk.y;
    const ady = Math.abs(dy);
    if (!onTarget) {
      // 골대 근처로 빗나가는 슛이면 보여주기용 다이빙
      if (Math.abs(cross.y - CY) < GOAL_HALF_W + 2 && ady > 1.4 && chance(0.6)) {
        this.startDive(gk, kp.y, kp.z, Math.max(0.2, kp.t), false, false);
      }
      gk.touchCD = Math.max(gk.touchCD, 0.1);
      return;
    }
    const diveSpeed = 5 + (gk.def.gk / 99) * 3.2;
    const tAvail = Math.max(0, kp.t - 0.04);
    const reach = diveSpeed * tAvail + 1.05;
    const margin = reach - ady;
    let p: number;
    if (margin < 0) p = 0.04;
    else p = clamp(0.46 + margin * 0.3 + (gk.def.gk - 78) / 55, 0.12, 0.95);
    p *= clamp(1.36 - s.speed / 44, 0.62, 1.05);
    if (kp.z > 1.95 && ady > 1.8) p *= 0.75;
    if (kp.z > GOAL_H - 0.1) p *= 0.85;
    p *= s.saveMul;
    p *= gk.moraleMul;
    if (!team.human) p = clamp(p + this.dp.gkBonus, 0.01, 0.97);
    const willSave = chance(p);
    const catchBall = willSave && !s.special && s.speed < 25 && ady < 1.6 && kp.z < 1.9 && chance(0.35 + gk.def.gk / 250);
    if (ady < 0.75 && kp.z < 1.9 && !s.special) {
      // 정면 슛: 서서 처리
      if (willSave) (gk as Player & { standSave?: boolean }).standSave = true;
      else gk.touchCD = kp.t + 0.4;
      return;
    }
    if (willSave) {
      this.startDive(gk, kp.y, kp.z, Math.max(0.16, tAvail), true, catchBall);
    } else {
      // 막지 못함: 짧거나 늦게 다이빙
      const ty = gk.y + dy * rand(0.45, 0.8);
      this.startDive(gk, ty, kp.z * rand(0.5, 1), Math.max(0.2, tAvail * 1.15), false, false);
      gk.touchCD = kp.t + 0.5;
    }
  }

  private startDive(gk: Player, ty: number, tz: number, dur: number, willSave: boolean, catchBall: boolean) {
    const lateral = clamp(ty - gk.y, -3.6, 3.6);
    gk.dive = {
      tx: gk.x,
      ty: gk.y + lateral,
      tz: clamp(tz, 0.2, 2.5),
      sx: gk.x,
      sy: gk.y,
      t: 0,
      dur: clamp(dur, 0.14, 0.6),
      willSave,
      catchBall,
      side: Math.sign(lateral) || 1,
    };
    gk.setState('dive', 2);
    gk.facing = gk.team.dir > 0 ? 0 : Math.PI;
  }

  private doSave(gk: Player) {
    const b = this.ball;
    const s = b.shot;
    if (!s) return;
    const team = gk.team;
    const special = s.special;
    team.stats.saves++;
    gk.st.saves++;
    this.addGauge(team, special ? 25 : 6);
    if (gk.dive) gk.dive.willSave = false;
    if (gk.dive?.catchBall) {
      b.guide = null;
      this.gainPossession(gk);
      b.heldByKeeper = true;
      this.say(pick(COMMENTARY.catch).replace('{p}', gk.def.name));
      audio.ooh();
      return;
    }
    b.guide = null;
    const out = team.dir;
    if (chance(0.5)) {
      // 골대 옆으로 쳐내기 → 코너킥이 되기 쉽다
      b.vx = -out * rand(0.5, 2.5);
      b.vy = (b.y > CY ? 1 : -1) * rand(7, 12);
      b.vz = rand(1.5, 4);
    } else {
      b.vx = out * rand(3, 8) - b.vx * 0.1;
      b.vy = (b.y > gk.y ? 1 : -1) * rand(4, 10);
      b.vz = rand(2, 6);
    }
    b.spin = 0;
    b.lastTouch = gk;
    b.shot = null;
    b.pass = null;
    gk.touchCD = 0.7;
    audio.ooh();
    audio.tackle();
    if (special) {
      const [c1, c2, c3] = SPECIAL_COLORS[special];
      this.particles.burst(b.x, b.y, b.z, 80, [c1, c2, c3, '#ffffff'], 14, 'spark', 0.9, 0.25);
      this.particles.ring(b.x, b.y, b.z, c1, { vr: 18, life: 0.6, width: 8, vertical: true });
      this.fx.flash = 0.7;
      this.fx.flashColor = '#ffffff';
      this.fx.shake = 1;
      this.fx.slow = 0.7;
      this.fx.slowScale = 0.25;
      audio.boom(1);
      b.special = null;
      this.banner = { text: '슈퍼 세이브!!', sub: `${gk.def.name}이(가) 필살기를 막아냈다!`, color: '#7fe0ff', t: 0, dur: 1.8 };
      this.say(`믿을 수 없습니다! ${gk.def.name}, 필살기를 막아냅니다!!`);
      setTimeout(() => {
        if (gk.state === 'dive') {
          gk.dive = null;
          gk.setState('down', 1.0);
        }
      }, 250);
    } else {
      this.particles.burst(b.x, b.y, b.z, 14, ['#ffffff', '#dfe8ff'], 6, 'spark', 0.4, 0.12);
      this.say(pick(COMMENTARY.save).replace('{p}', gk.def.name));
    }
  }

  // ───────────────────────────── 아웃/골 판정 ─────────────────────────────

  private checkBallOut() {
    const b = this.ball;
    if (b.owner && !b.owner.isGK) {
      // 드리블로 라인 넘기
      if (b.y < -BALL_R || b.y > PITCH_W + BALL_R || b.x < -BALL_R || b.x > PITCH_L + BALL_R) {
        b.owner = null;
      } else return;
    }
    if (b.owner) return;
    // 골
    for (const gx of [0, PITCH_L]) {
      const crossed = gx === 0 ? b.x < -BALL_R : b.x > PITCH_L + BALL_R;
      if (!crossed) continue;
      if (Math.abs(b.y - CY) < GOAL_HALF_W && b.z < GOAL_H) {
        const scoring = this.teams.find((t) => t.oppGoalX === gx)!;
        this.goal(scoring);
        return;
      }
      // 골라인 아웃
      const defending = this.teams.find((t) => t.ownGoalX === gx)!;
      const attacking = this.opp(defending);
      const last = b.lastTouch?.team;
      if (last === defending) {
        const cy = b.y < CY ? 0.6 : PITCH_W - 0.6;
        const cx = gx === 0 ? 0.6 : PITCH_L - 0.6;
        attacking.stats.corners++;
        this.ballOut('corner', attacking.side, cx, cy, '코너킥');
      } else {
        const kx = gx === 0 ? 5.5 : PITCH_L - 5.5;
        const ky = CY + (b.y < CY ? -4 : 4);
        this.ballOut('goalkick', defending.side, kx, ky, '골킥');
      }
      return;
    }
    if (b.y < -BALL_R || b.y > PITCH_W + BALL_R) {
      const last = b.lastTouch?.team ?? this.teams[0];
      const side = (1 - last.side) as 0 | 1;
      this.ballOut('throw', side, clamp(b.x, 1, PITCH_L - 1), b.y < CY ? 0 : PITCH_W, '스로인');
    }
  }

  private ballOut(kind: SetPieceKind, side: 0 | 1, x: number, y: number, text: string) {
    if (this.ball.shot && kind !== 'throw') {
      audio.ooh();
      this.say(pick(COMMENTARY.miss).replace('{p}', this.ball.shot.by.def.name));
    }
    this.ball.shot = null;
    this.ball.pass = null;
    this.ball.special = null;
    this.phase = 'out';
    this.phaseT = 0;
    this.pendingSetPiece = { kind, side, x, y };
    this.outText = text;
    if (kind !== 'throw') audio.whistle(1);
    this.banner = { text, sub: this.teams[side].def.name, color: '#ffffff', t: 0, dur: 1.2 };
    this.charge = null;
  }

  foul(offender: Player, victim: Player, behind: boolean) {
    if (this.phase !== 'play') return;
    const team = offender.team;
    team.stats.fouls++;
    audio.whistle(1);
    const vteam = victim.team;
    let card = '';
    if (chance(behind ? 0.45 : 0.12)) {
      offender.yellow++;
      card = 'yellow';
      if (offender.yellow >= 2 && !offender.isGK) {
        card = 'red';
      }
    }
    const inBox = inOwnBox(team, victim.x, victim.y);
    this.ball.owner = null;
    this.ball.shot = null;
    this.ball.pass = null;
    this.phase = 'out';
    this.phaseT = 0;
    if (inBox) {
      const px = team.ownGoalX === 0 ? PEN_SPOT : PITCH_L - PEN_SPOT;
      this.pendingSetPiece = { kind: 'penalty', side: vteam.side, x: px, y: CY };
      this.banner = { text: '페널티킥!', sub: `${offender.def.name}의 파울`, color: '#ff4d6d', t: 0, dur: 1.6 };
      this.say(`휘슬! 페널티킥입니다! ${offender.def.name}의 파울!`);
      audio.roar(0.6);
    } else {
      this.pendingSetPiece = { kind: 'freekick', side: vteam.side, x: clamp(victim.x, 1, PITCH_L - 1), y: clamp(victim.y, 1, PITCH_W - 1) };
      this.banner = { text: '파울', sub: `${offender.def.name} → 프리킥`, color: '#ffd34d', t: 0, dur: 1.2 };
      this.say(`${offender.def.name}의 파울. 프리킥이 선언됩니다.`);
    }
    if (card === 'yellow') {
      this.popup(offender, '옐로카드', '#ffd34d');
      this.say(`${offender.def.name}에게 옐로카드!`);
      audio.cardFlip();
    } else if (card === 'red') {
      this.popup(offender, '레드카드!', '#ff3b3b');
      this.say(`경고 누적! ${offender.def.name} 퇴장입니다!`);
      offender.sentOff = true;
      offender.x = -20;
      if (team.controlled === offender) {
        const next = team.active.find((p) => !p.isGK);
        if (next) switchTo(this, team, next);
      }
    }
  }

  private goal(scoring: TeamState) {
    const b = this.ball;
    const conceding = this.opp(scoring);
    const toucher = b.lastTouch;
    const ownGoal = toucher && toucher.team === conceding && !(b.shot && b.shot.by.team === scoring);
    const scorer = ownGoal ? toucher! : b.shot?.by.team === scoring ? b.shot.by : toucher && toucher.team === scoring ? toucher : scoring.players[10];
    const special = !!(b.shot && b.shot.special);
    scoring.goals++;
    if (!ownGoal) scorer.st.goals++;
    conceding.gk.st.conceded++;
    const lp = this.lastPasser[scoring.side];
    if (!ownGoal && lp && lp !== scorer && this.clock - this.lastPassT[scoring.side] < 10) lp.st.assists++;
    const ev: GoalEvent = {
      side: scoring.side,
      scorer: ownGoal ? `${scorer.def.name} (자책)` : scorer.def.name,
      minute: Math.max(1, this.minute),
      special,
      penalty: this.setPieceKindLast === 'penalty' && this.clock - this.setPieceTakenAt < 3,
    };
    this.goals.push(ev);
    b.inNet = true;
    b.shot = null;
    b.pass = null;
    this.phase = 'goal';
    this.phaseT = 0;
    this.charge = null;
    this.addGauge(conceding, 22, true);
    audio.whistle(1);
    audio.roar(special ? 1.4 : 1.1);
    audio.net();
    audio.crowd(1);
    this.fx.slow = special ? 1.2 : 0.8;
    this.fx.slowScale = 0.3;
    this.fx.shake = special ? 1.2 : 0.5;
    this.fx.flash = special ? 0.9 : 0.4;
    this.fx.flashColor = special ? SPECIAL_COLORS[b.special ?? 'fire'][1] : '#ffffff';
    const colors = [scoring.kit.shirt, scoring.kit.accent, '#ffffff', '#ffd34d'];
    this.particles.burst(b.x, b.y, Math.max(0.5, b.z), special ? 160 : 70, colors, special ? 16 : 10, 'spark', 1.2, 0.22);
    this.particles.confetti(b.x + scoring.dir * -6, b.y, special ? 220 : 120, colors);
    if (special && b.special) {
      const [c1, c2, c3] = SPECIAL_COLORS[b.special];
      this.particles.ring(b.x, b.y, 1.2, c1, { vr: 22, life: 0.8, width: 10, vertical: true });
      this.particles.burst(b.x, b.y, 1.2, 120, [c1, c2, c3], 18, b.special === 'ice' ? 'ice' : 'flame', 1.2, 0.5);
    }
    b.special = null;
    this.banner = {
      text: special ? '필살 골!!!' : 'GOAL!!',
      sub: `${ev.scorer}  ${ev.minute}'`,
      color: special ? SPECIAL_COLORS[scoring.def.special.type][1] : scoring.kit.shirt === '#F5F5F5' ? '#ffffff' : scoring.kit.shirt,
      t: 0,
      dur: 3.2,
    };
    this.say(ownGoal ? pick(COMMENTARY.ownGoal).replace('{p}', scorer.def.name) : pick(special ? COMMENTARY.specialGoal : COMMENTARY.goal).replace('{p}', scorer.def.name));
    // 세리머니
    scorer.setState('celebrate', 99);
    scorer.celebrateKind = Math.floor(rand(0, 3));
    this.replayFrames = this.frames.slice(-Math.round(60 * 4.5));
    this.goalScorer = scorer;
    // 골 이전에 눌린 키가 세리머니를 건너뛰지 않도록
    this.input.clearEdges();
  }

  goalScorer: Player | null = null;
  setPieceKindLast: SetPieceKind | null = null;
  setPieceTakenAt = 0;

  private updateGoalPhase(dt: number) {
    const scorer = this.goalScorer;
    const b = this.ball;
    // 공은 골망에서 계속 움직임
    b.owner = null;
    b.step(dt);
    for (const t of this.teams) {
      for (const p of t.active) {
        if (p === scorer) {
          // 코너 플래그 쪽으로 달려간다
          const cx = p.team.oppGoalX + (p.team.dir > 0 ? -6 : 6);
          const cy = p.y < CY ? 3 : PITCH_W - 3;
          const d = norm(cx - p.x, cy - p.y);
          const far = len(cx - p.x, cy - p.y) > 1.5;
          p.dvx = far ? d.x * 7 : 0;
          p.dvy = far ? d.y * 7 : 0;
          p.sprinting = true;
          p.integrate(dt, false);
          p.state = 'celebrate';
          if (!far && p.z === 0 && Math.random() < 0.03) p.vz = 3.5;
        } else if (t === scorer?.team && scorer) {
          const d = norm(scorer.x - p.x, scorer.y - p.y);
          const dist = len(scorer.x - p.x, scorer.y - p.y);
          p.dvx = dist > 2.5 ? d.x * 6 : 0;
          p.dvy = dist > 2.5 ? d.y * 6 : 0;
          p.lookX = scorer.x;
          p.lookY = scorer.y;
          p.integrate(dt, false);
          if (p.state !== 'celebrate') p.state = 'run';
        } else {
          p.dvx *= 0.9;
          p.dvy *= 0.9;
          p.integrate(dt, false);
          p.state = p.speed > 0.3 ? 'run' : 'idle';
        }
        if (p.z > 0 || p.vz > 0) {
          p.vz -= GRAVITY * dt;
          p.z = Math.max(0, p.z + p.vz * dt);
          if (p.z === 0) p.vz = 0;
        }
      }
    }
    if (Math.random() < 0.25) {
      const sc = this.teams[this.goals[this.goals.length - 1].side];
      this.particles.confetti(this.cam.x + rand(-15, 15), CY + rand(-20, 20), 3, [sc.kit.shirt, sc.kit.accent, '#ffffff']);
    }
    this.particles.update(dt);
    this.updatePopups(dt);
    this.cameraUpdate(dt);
    if (this.phaseT > 4.2 || (this.phaseT > 1.2 && this.input.anyPressed())) {
      if (this.replayEnabled && this.replayFrames.length > 60) {
        this.phase = 'replay';
        this.phaseT = 0;
        this.replayIdx = 0;
        this.particles.clear();
        this.fx.letterbox = 1;
        this.input.clearEdges();
      } else this.afterGoal();
    }
  }

  private afterGoal() {
    this.fx.letterbox = 0;
    for (const t of this.teams) for (const p of t.players) if (p.state === 'celebrate') p.setState('idle');
    const last = this.goals[this.goals.length - 1];
    if (this.clock >= this.halfDur) {
      this.endHalf();
      return;
    }
    this.setupKickoff((1 - last.side) as 0 | 1, true);
    this.beginKickoffPhase();
  }

  // ───────────────────────────── 리플레이 ─────────────────────────────

  private record() {
    const b = this.ball;
    const fr: FrameRec = {
      b: [b.x, b.y, b.z, b.rot, SPECIAL_CODES.indexOf(b.special)],
      p: [],
      sp: 0,
    };
    for (const t of this.teams)
      for (const p of t.players) {
        fr.p.push([p.x, p.y, p.z, p.facing, STATE_CODES.indexOf(p.state as (typeof STATE_CODES)[number]), p.anim, p.stateT, p.dive ? p.dive.side : 0, p.dive ? clamp(p.dive.t / p.dive.dur, 0, 1) : 0, p.dive ? p.dive.tz : 0]);
      }
    this.frames.push(fr);
    if (this.frames.length > 60 * 7) this.frames.shift();
  }

  private updateReplay(dt: number) {
    this.replayIdx += 1;
    const fr = this.replayFrames[Math.min(this.replayFrames.length - 1, Math.floor(this.replayIdx))];
    if (fr) this.applyFrame(fr);
    if (this.ball.special) this.emitSpecialTrail(dt);
    this.particles.update(dt);
    this.cameraUpdate(dt);
    if (this.replayIdx >= this.replayFrames.length - 1 || (this.phaseT > 0.5 && this.input.anyPressed())) {
      this.particles.clear();
      this.afterGoal();
    }
  }

  private applyFrame(fr: FrameRec) {
    const b = this.ball;
    [b.x, b.y, b.z, b.rot] = fr.b;
    b.special = SPECIAL_CODES[fr.b[4]] ?? null;
    let i = 0;
    for (const t of this.teams)
      for (const p of t.players) {
        const r = fr.p[i++];
        if (!r) continue;
        p.x = r[0];
        p.y = r[1];
        p.z = r[2];
        p.facing = r[3];
        p.state = STATE_CODES[r[4]] ?? 'idle';
        p.anim = r[5];
        p.stateT = r[6];
        if (p.state === 'dive') {
          p.dive = { tx: p.x, ty: p.y, tz: r[9], sx: p.x, sy: p.y, t: r[8], dur: 1, willSave: false, catchBall: false, side: r[7] };
        } else p.dive = null;
      }
  }

  // ───────────────────────────── 세트피스 ─────────────────────────────

  setupKickoff(side: 0 | 1, teleport: boolean) {
    const b = this.ball;
    b.place(CX, CY);
    b.owner = null;
    b.lastTouch = null;
    const taker = this.teams[side].players.filter((p) => p.role === 'FW' && !p.sentOff)[0] ?? this.teams[side].players[10];
    this.setPiece = { kind: 'kickoff', side, taker, x: CX, y: CY, t: 0, spots: new Map(), cpuDelay: rand(0.8, 1.4) };
    for (const t of this.teams) {
      for (const p of t.active) {
        p.state = 'idle';
        p.dive = null;
        p.kick = null;
        p.vx = p.vy = 0;
        p.z = 0;
        p.touchCD = 0;
        const sx = t.toX(Math.min(p.slot.u * 0.85, 0.44));
        let sy = t.toY(p.slot.v);
        let sx2 = sx;
        if (t.side !== side) {
          // 센터서클 밖
          const d = len(sx - CX, sy - CY);
          if (d < CIRCLE_R + 0.5) {
            const n = norm(sx - CX || -t.dir, sy - CY);
            sx2 = CX + n.x * (CIRCLE_R + 0.8);
            sy = CY + n.y * (CIRCLE_R + 0.8);
          }
        }
        const spot = { x: sx2, y: sy };
        this.setPiece.spots.set(p, spot);
        if (teleport) {
          p.x = spot.x;
          p.y = spot.y;
          p.facing = t.dir > 0 ? 0 : Math.PI;
        }
      }
    }
    taker.x = CX - this.teams[side].dir * 0.5;
    taker.y = CY;
    taker.facing = this.teams[side].dir > 0 ? Math.PI * 0.8 : Math.PI * 0.2;
    this.setPiece.spots.set(taker, { x: taker.x, y: taker.y });
    b.owner = taker;
    b.x = CX;
    b.y = CY;
    const ht = this.teams[side];
    if (ht.human) switchTo(this, ht, taker);
  }

  private beginKickoffPhase() {
    this.phase = 'kickoff';
    this.phaseT = 0;
    this.banner = { text: '킥오프', sub: `${this.teams[this.setPiece!.side].def.name} 공격`, color: '#ffffff', t: 0, dur: 1.2 };
    audio.whistle(1);
    this.input.clearEdges();
  }

  setupSetPiece(kind: SetPieceKind, side: 0 | 1, x: number, y: number) {
    const team = this.teams[side];
    const opp = this.opp(team);
    const b = this.ball;
    b.place(x, y);
    this.fx.fade = 1;
    let taker: Player;
    const spots = new Map<Player, { x: number; y: number }>();
    const outfield = team.active.filter((p) => !p.isGK);
    const nearest = (list: Player[]) => list.slice().sort((a, c) => len(a.x - x, a.y - y) - len(c.x - x, c.y - y))[0];
    switch (kind) {
      case 'goalkick':
        taker = team.gk;
        break;
      case 'penalty':
      case 'freekick': {
        const d = len(team.oppGoalX - x, CY - y);
        if (kind === 'penalty' || d < 30) {
          taker = outfield.slice().sort((a, c) => c.def.sho + (c.def.ace ? 10 : 0) - (a.def.sho + (a.def.ace ? 10 : 0)))[0];
        } else taker = nearest(outfield);
        break;
      }
      default:
        taker = nearest(outfield);
    }
    const out = y <= 0 ? -0.4 : y >= PITCH_W ? 0.4 : 0;
    taker.x = x - (kind === 'corner' ? (x < CX ? 0.6 : -0.6) * 0.5 : kind === 'throw' ? 0 : Math.cos(Math.atan2(CY - y, team.oppGoalX - x)) * 0.6);
    taker.y = y + out - (kind === 'corner' ? (y < CY ? -0.4 : 0.4) : kind === 'throw' ? 0 : Math.sin(Math.atan2(CY - y, team.oppGoalX - x)) * 0.6);
    if (kind === 'throw') taker.facing = y <= 0 ? Math.PI / 2 : -Math.PI / 2;
    else if (kind === 'goalkick') taker.facing = team.dir > 0 ? 0 : Math.PI;
    else taker.facing = Math.atan2(CY - y, team.oppGoalX - x);
    taker.vx = taker.vy = 0;
    taker.state = 'idle';
    spots.set(taker, { x: taker.x, y: taker.y });

    const gx = team.oppGoalX;
    const toGoal = (u: number) => (team.dir > 0 ? PITCH_L - u : u);
    if (kind === 'corner') {
      const attackers = outfield.filter((p) => p !== taker).sort((a, c) => (c.role === 'FW' ? 2 : c.role === 'DF' ? 1 : 0) - (a.role === 'FW' ? 2 : a.role === 'DF' ? 1 : 0));
      const near = y < CY ? -1 : 1;
      const boxSpots = [
        { x: toGoal(5), y: CY + near * 3 },
        { x: toGoal(PEN_SPOT - 1), y: CY },
        { x: toGoal(6), y: CY - near * 3.5 },
        { x: toGoal(9), y: CY + near * 1 },
        { x: toGoal(14), y: CY - near * 5 },
        { x: toGoal(18), y: CY + near * 3 },
      ];
      attackers.slice(0, 6).forEach((p, i) => spots.set(p, boxSpots[i]));
      // 수비: 공격수 마킹
      const defs = opp.active.filter((p) => !p.isGK);
      const marks = attackers.slice(0, 6);
      defs.forEach((d, i) => {
        if (i < marks.length) {
          const s = spots.get(marks[i])!;
          const gdir = norm(gx - s.x, CY - s.y);
          spots.set(d, { x: s.x + gdir.x * 1.2, y: s.y + gdir.y * 1.2 + rand(-0.4, 0.4) });
        } else if (i === marks.length) spots.set(d, { x: toGoal(1.2), y: CY + near * (GOAL_HALF_W - 0.6) });
      });
      spots.set(opp.gk, { x: toGoal(0.7), y: CY + near * 0.6 });
    } else if (kind === 'penalty') {
      const edge = toGoal(BOX_DEPTH + 2);
      let k = 0;
      for (const t of this.teams) {
        for (const p of t.active) {
          if (p === taker) continue;
          if (p === opp.gk) {
            spots.set(p, { x: toGoal(0.2), y: CY });
            continue;
          }
          if (p.isGK) continue;
          const yy = CY + ((k % 2 === 0 ? 1 : -1) * (4 + Math.floor(k / 2) * 2.4));
          spots.set(p, { x: edge + team.dir * -rand(0, 3), y: clamp(yy, 6, PITCH_W - 6) });
          k++;
        }
      }
      taker.x = toGoal(PEN_SPOT) - team.dir * 0.6;
      taker.y = CY;
      taker.facing = team.dir > 0 ? 0 : Math.PI;
      spots.set(taker, { x: taker.x, y: taker.y });
    } else if (kind === 'freekick') {
      const d = len(gx - x, CY - y);
      if (d < 32) {
        // 수비벽
        const n = norm(gx - x, CY - y);
        const wallC = { x: x + n.x * 9.15, y: y + n.y * 9.15 };
        const perp = { x: -n.y, y: n.x };
        const wallN = d < 22 ? 4 : 3;
        const defs = opp.active
          .filter((p) => !p.isGK)
          .sort((a, c) => len(a.x - wallC.x, a.y - wallC.y) - len(c.x - wallC.x, c.y - wallC.y));
        for (let i = 0; i < wallN && i < defs.length; i++) {
          const off = (i - (wallN - 1) / 2) * 0.7 + (y < CY ? 0.5 : -0.5);
          spots.set(defs[i], { x: wallC.x + perp.x * off, y: wallC.y + perp.y * off });
        }
        // 공격수 박스 안
        const atk = outfield.filter((p) => p !== taker).sort((a, c) => team.u(c.x) - team.u(a.x));
        atk.slice(0, 3).forEach((p, i) => spots.set(p, { x: toGoal(8 + i * 2), y: CY + (i - 1) * 5 }));
      }
    } else if (kind === 'goalkick') {
      // 상대는 박스 밖
      for (const p of opp.active) {
        if (inOwnBox(team, p.x, p.y)) spots.set(p, { x: team.toX(0.22), y: p.y });
      }
    }
    // 프리킥 시 수비는 9.15m 밖
    if (kind === 'freekick' || kind === 'corner' || kind === 'throw') {
      for (const p of opp.active) {
        const s = spots.get(p) ?? { x: p.x, y: p.y };
        const dd = len(s.x - x, s.y - y);
        const minD = kind === 'throw' ? 2.5 : 9.15;
        if (dd < minD) {
          const n = norm(s.x - x || 0.1, s.y - y);
          s.x = x + n.x * minD;
          s.y = y + n.y * minD;
          spots.set(p, s);
        }
      }
    }
    // 텔레포트 (화면 페이드로 가림)
    if (kind !== 'throw') {
      for (const [p, s] of spots) {
        p.x = clamp(s.x, -1, PITCH_L + 1);
        p.y = clamp(s.y, -1, PITCH_W + 1);
        p.vx = p.vy = 0;
      }
    }
    for (const t of this.teams)
      for (const p of t.active) {
        if (p.state !== 'idle' && p.state !== 'run') p.setState('idle');
        p.dive = null;
        p.kick = null;
      }
    b.owner = taker;
    b.lastTouch = taker;
    b.x = x;
    b.y = y;
    b.heldByKeeper = false;
    this.setPiece = { kind, side, taker, x, y, t: 0, spots, cpuDelay: rand(1.0, 1.8) * (kind === 'penalty' ? 1.5 : 1) };
    this.phase = 'setpiece';
    this.phaseT = 0;
    if (team.human) switchTo(this, team, taker);
    else if (opp.human && opp.controlled) {
      // 수비 측 사람: 공에 가까운 선수로
      const cand = opp.active.filter((p) => !p.isGK).sort((a, c) => len(a.x - x, a.y - y) - len(c.x - x, c.y - y))[0];
      if (cand) switchTo(this, opp, cand);
    }
    if (kind === 'penalty') {
      this.banner = { text: '페널티킥', sub: `키커: ${taker.def.name}`, color: '#ff4d6d', t: 0, dur: 1.5 };
    }
    this.input.clearEdges();
  }

  setPieceSpot(p: Player) {
    const sp = this.setPiece;
    if (!sp) return null;
    return sp.spots.get(p) ?? null;
  }

  private updateSetPiece(dt: number) {
    const sp = this.setPiece;
    if (!sp) return;
    sp.t += dt;
    const taker = sp.taker;
    const b = this.ball;
    // 공 고정
    if (b.owner === taker) {
      if (sp.kind !== 'throw') {
        b.x = sp.x;
        b.y = sp.y;
        b.z = 0;
      }
      b.vx = b.vy = 0;
    }
    taker.x = sp.spots.get(taker)!.x;
    taker.y = sp.spots.get(taker)!.y;
    taker.vx = taker.vy = 0;
    // 키커의 조준 방향을 '공 바라보기'가 덮어쓰지 않도록
    taker.lookX = taker.lookY = 0;
    if (taker.kick) return; // 킥 진행 중
    if (b.owner !== taker) {
      // 킥 완료 → 플레이 재개
      this.phase = 'play';
      this.phaseT = 0;
      this.setPieceKindLast = sp.kind;
      this.setPieceTakenAt = this.clock;
      if (sp.kind === 'throw') {
        // 스로인은 손으로: 높이 보정, 라인 안쪽에서 시작
        b.y = clamp(b.y, 0.3, PITCH_W - 0.3);
        b.z = Math.max(b.z, 1.6);
        b.vz = Math.max(b.vz, 1.5);
        const s = b.speed;
        if (s > 15) {
          b.vx *= 15 / s;
          b.vy *= 15 / s;
        }
      }
      this.setPiece = null;
      return;
    }
    const team = this.teams[sp.side];
    if (team.human && taker.human) return; // 사람 입력 대기 (control.ts)
    sp.cpuDelay -= dt;
    if (sp.cpuDelay > 0 || sp.t < 0.6) return;
    this.cpuSetPiece(sp);
  }

  private cpuSetPiece(sp: SetPiece) {
    const team = this.teams[sp.side];
    const taker = sp.taker;
    const opps = this.opp(team).active;
    const mates = team.active.filter((p) => p !== taker && !p.isGK);
    const openest = (maxD: number, minU = -1) => {
      let best: Player | null = null;
      let bs = -Infinity;
      for (const q of mates) {
        const d = len(q.x - taker.x, q.y - taker.y);
        if (d > maxD || d < 3 || team.u(q.x) < minU) continue;
        const s = nearestOpp(opps, q.x, q.y).d - d * 0.05 + rand(0, 1.5);
        if (s > bs) {
          bs = s;
          best = q;
        }
      }
      return best;
    };
    const go = (kind: PendingKick['kind'], target: Player | null, power = 0.3) => {
      const t = target;
      const dx = t ? t.x - taker.x : team.dir;
      const dy = t ? t.y - taker.y : 0;
      const n = norm(dx, dy);
      beginKick(this, taker, kind, power, n.x, n.y, { target: t });
    };
    switch (sp.kind) {
      case 'kickoff': {
        const back = mates.filter((q) => team.u(q.x) < team.u(taker.x)).sort((a, c) => len(a.x - taker.x, a.y - taker.y) - len(c.x - taker.x, c.y - taker.y))[0];
        go('pass', back ?? mates[0]);
        break;
      }
      case 'throw':
        go('pass', openest(22));
        break;
      case 'corner': {
        const inBox = mates.filter((q) => len(q.x - team.oppGoalX, q.y - CY) < 16);
        const tgt = inBox.length && chance(0.85) ? inBox[Math.floor(Math.random() * inBox.length)] : openest(18);
        go(inBox.includes(tgt as Player) ? 'cross' : 'pass', tgt);
        break;
      }
      case 'goalkick': {
        const long = chance(0.45);
        const tgt = long ? openest(60, 0.4) : openest(30);
        go(long ? 'lob' : 'pass', tgt, long ? 0.8 : 0.2);
        break;
      }
      case 'penalty': {
        const dirY = chance(0.5) ? rand(0.6, 1) : -rand(0.6, 1);
        beginKick(this, taker, 'shot', rand(0.5, 0.78), team.dir, chance(0.12) ? 0 : dirY);
        if (taker.kick && chance(this.dp.perfect + 0.2)) taker.kick.timing = 'perfect';
        break;
      }
      case 'freekick': {
        const d = len(team.oppGoalX - sp.x, CY - sp.y);
        if (d < 28 && Math.abs(sp.y - CY) < 22 && chance(0.7)) {
          const dirY = chance(0.5) ? rand(0.5, 1) : -rand(0.5, 1);
          beginKick(this, taker, 'shot', rand(0.55, 0.75), team.dir, dirY, { finesse: chance(0.7) });
        } else {
          const fwd = openest(40, team.u(taker.x));
          go(fwd && len(fwd.x - taker.x, fwd.y - taker.y) > 20 ? 'lob' : 'pass', fwd ?? openest(30));
        }
        break;
      }
    }
  }

  // ───────────────────────────── 시간 ─────────────────────────────

  private checkClock(dt: number) {
    if (this.clock < this.halfDur) return;
    const b = this.ball;
    if (this.phase === 'out' || this.phase === 'setpiece') {
      if (this.setPiece?.kind !== 'penalty' && this.pendingSetPiece?.kind !== 'penalty') {
        this.endHalf();
        return;
      }
    }
    if (this.phase !== 'play') return;
    this.extraT += dt;
    const danger = b.shot || Math.min(b.x, PITCH_L - b.x) < 22;
    if (!danger || this.extraT > 8) this.endHalf();
  }

  private endHalf() {
    this.extraT = 0;
    this.charge = null;
    this.ball.owner = null;
    this.ball.shot = null;
    this.setPiece = null;
    this.pendingSetPiece = null;
    audio.whistle(3, true);
    audio.crowd(0.35);
    if (this.half === 1) {
      this.phase = 'halftime';
      this.banner = { text: '전반 종료', sub: `${this.teams[0].def.short} ${this.teams[0].goals} - ${this.teams[1].goals} ${this.teams[1].def.short}`, color: '#ffffff', t: 0, dur: 2.5 };
      setTimeout(() => this.cb.onHalfTime?.(), 1600);
    } else {
      this.phase = 'fulltime';
      this.banner = { text: '경기 종료', sub: `${this.teams[0].def.short} ${this.teams[0].goals} - ${this.teams[1].goals} ${this.teams[1].def.short}`, color: '#ffffff', t: 0, dur: 2.5 };
      setTimeout(() => this.cb.onFullTime?.(), 1800);
    }
  }

  startSecondHalf() {
    this.half = 2;
    this.clock = 0;
    for (const t of this.teams) {
      t.dir = t.dir > 0 ? -1 : 1;
      for (const p of t.players) p.stamina = Math.min(1, p.stamina + 0.35);
    }
    this.particles.clear();
    this.setupKickoff((1 - this.kickoffSide) as 0 | 1, true);
    this.phase = 'intro';
    this.phaseT = 1.4;
    this.banner = { text: '후반전', sub: '', color: '#ffffff', t: 0, dur: 1.2 };
    this.cam.x = CX;
  }

  startShootout() {
    this.shootout = new Shootout(this);
    this.phase = 'shootout';
    this.phaseT = 0;
  }

  // ───────────────────────────── 연출/텍스트 ─────────────────────────────

  say(text: string) {
    this.commentary = { text, t: 0 };
  }

  popup(p: Player, text: string, color: string) {
    this.popups.push({ x: p.x, y: p.y, z: 2.4, text, color, t: 0 });
  }

  private updatePopups(dt: number) {
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const q = this.popups[i];
      q.t += dt;
      q.z += dt * 0.8;
      if (q.t > 1.3) this.popups.splice(i, 1);
    }
  }

  addGauge(team: TeamState, amount: number, passive = false) {
    let mul = 1;
    if (!passive) {
      const avg = team.players.reduce((a, p) => a + p.morale, 0) / team.players.length;
      mul = 1 + avg * 0.1;
    }
    if (!team.human) mul *= this.dp.cpuGauge;
    const before = team.gauge;
    team.gauge = clamp(team.gauge + amount * mul, 0, 100);
    if (before < 100 && team.gauge >= 100 && team.human) {
      audio.select();
      this.banner = { text: '필살기 준비 완료!', sub: `[Space] ${team.def.special.name}`, color: SPECIAL_COLORS[team.def.special.type][1], t: 0, dur: 1.4 };
    }
  }

  private updateFx(dt: number) {
    const f = this.fx;
    f.shake = Math.max(0, f.shake - dt * 2.2);
    f.flash = Math.max(0, f.flash - dt * 2.5);
    f.fade = Math.max(0, f.fade - dt * 2.5);
    this.commentary.t += dt;
    if (this.banner) {
      this.banner.t += dt;
      if (this.banner.t > this.banner.dur) this.banner = null;
    }
    const targetLB = this.phase === 'cutin' || this.phase === 'replay' ? 1 : 0;
    f.letterbox += (targetLB - f.letterbox) * Math.min(1, dt * 6);
    f.darken += ((this.phase === 'cutin' ? 0.55 : 0) - f.darken) * Math.min(1, dt * 8);
  }

  // ───────────────────────────── 결과 ─────────────────────────────

  ratings(): [number[], number[]] {
    return this.teams.map((t) => {
      const won = t.goals > this.opp(t).goals;
      const lost = t.goals < this.opp(t).goals;
      const arr: number[] = new Array(t.def.players.length).fill(6.0);
      for (const p of t.players) {
        const s = p.st;
        let r = 6.3 + (won ? 0.4 : lost ? -0.3 : 0);
        r += s.goals * 1.1 + s.assists * 0.6 + s.keyPass * 0.15;
        r += Math.min(1, s.passOk * 0.04) - s.passBad * 0.06;
        r += s.tackles * 0.18 - s.lost * 0.05;
        r += s.saves * 0.35 - s.conceded * 0.35;
        r += Math.min(0.4, s.shots * 0.05);
        r += p.morale * 0.08;
        if (p.yellow) r -= 0.3;
        if (p.sentOff) r -= 1.2;
        const idx = t.def.players.indexOf(p.def);
        arr[idx] = clamp(Math.round(r * 10) / 10, 3, 10);
      }
      return arr;
    }) as [number[], number[]];
  }

  result(): MatchResult {
    const ratings = this.ratings();
    let mom = { side: 0 as 0 | 1, index: 0, rating: 0 };
    ratings.forEach((arr, side) =>
      arr.forEach((r, i) => {
        if (r > mom.rating) mom = { side: side as 0 | 1, index: i, rating: r };
      }),
    );
    return {
      homeGoals: this.teams[0].goals,
      awayGoals: this.teams[1].goals,
      homePens: this.shootout ? this.teams[0].pens : undefined,
      awayPens: this.shootout ? this.teams[1].pens : undefined,
      stats: [this.teams[0].stats, this.teams[1].stats],
      goals: this.goals,
      ratings,
      mom,
    };
  }

  get outLabel() {
    return this.outText;
  }

  /** 디버그/테스트: 사람 입력 없이 interceptFor 노출 */
  intercept(p: Player) {
    return interceptFor(this, p);
  }

  formationSpot(team: TeamState, p: Player) {
    return formationSpot(this, team, p, this.brains[team.side].phase);
  }

  /** 박스 규격 (렌더러용) */
  static readonly BOX = { depth: BOX_DEPTH, halfW: BOX_HALF_W };
}
