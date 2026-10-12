import {
  BALL_R,
  CX,
  CY,
  GOAL_DEPTH,
  GOAL_H,
  GOAL_HALF_W,
  GRAVITY,
  PITCH_L,
  PITCH_W,
  POST_R,
  RUN_SPEED,
  SPRINT_SPEED,
} from './constants';
import { angleDiff, clamp, len, turnToward } from './math';
import type { Kit, PlayerDef, Role, SpecialType, Tactics, TeamDef, TeamStats } from './types';
import type { Slot } from '../data/formations';

export interface Guide {
  path: (t: number) => [number, number, number];
  t: number;
  T: number;
}

export interface ShotInfo {
  by: Player;
  side: 0 | 1;
  t: number;
  special: SpecialType | null;
  /** 골키퍼 반응 판정을 이미 했는지 */
  judged: boolean;
  /** 골문 통과 예측 지점 */
  ty: number;
  tz: number;
  speed: number;
  /** 골키퍼 선방 확률 보정 (필살기 등) */
  saveMul: number;
}

export interface PassInfo {
  from: Player;
  to: Player | null;
  t: number;
  tx: number;
  ty: number;
  lofted: boolean;
  through: boolean;
}

export class Ball {
  x = CX;
  y = CY;
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  spin = 0;
  /** 공의 위쪽 회전(탑스핀): 추가 낙하 가속 */
  dip = 0;
  owner: Player | null = null;
  lastTouch: Player | null = null;
  shot: ShotInfo | null = null;
  pass: PassInfo | null = null;
  guide: Guide | null = null;
  special: SpecialType | null = null;
  specialColor = '#ff7a1a';
  specialT = 0;
  rot = 0;
  /** 골 이후 골망 안에 있음 */
  inNet = false;
  /** 이번 업데이트에서 골대에 맞았는지 */
  hitPost = false;
  hitNet = false;
  heldByKeeper = false;

  get speed() {
    return Math.sqrt(this.vx * this.vx + this.vy * this.vy);
  }

  get onGround() {
    return this.z < 0.05 && Math.abs(this.vz) < 0.8;
  }

  place(x: number, y: number, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.vx = this.vy = this.vz = 0;
    this.spin = 0;
    this.dip = 0;
    this.guide = null;
    this.shot = null;
    this.pass = null;
    this.special = null;
    this.inNet = false;
    this.heldByKeeper = false;
  }

  /** 자유 상태의 공 물리 */
  step(dt: number) {
    this.hitPost = false;
    this.hitNet = false;
    if (this.guide) {
      const g = this.guide;
      g.t += dt;
      const k = Math.min(1, g.t / g.T);
      const [nx, ny, nz] = g.path(k);
      this.vx = (nx - this.x) / dt;
      this.vy = (ny - this.y) / dt;
      this.vz = (nz - this.z) / dt;
      this.x = nx;
      this.y = ny;
      this.z = nz;
      this.rot += (this.speed * dt) / BALL_R;
      if (k >= 1) this.guide = null;
      this.collideFrame();
      return;
    }

    const sp = this.speed;
    const airborne = this.z > 0.02 || this.vz > 0.5;
    if (airborne) {
      this.vz -= (GRAVITY + this.dip) * dt;
      const drag = Math.exp(-0.06 * dt);
      this.vx *= drag;
      this.vy *= drag;
    } else {
      this.z = 0;
      this.vz = 0;
      if (sp > 0) {
        const dec = (1.4 + 0.42 * sp) * dt;
        const ns = Math.max(0, sp - dec);
        this.vx *= ns / sp;
        this.vy *= ns / sp;
      }
    }
    if (this.spin !== 0 && sp > 2) {
      const ax = (-this.vy / sp) * this.spin;
      const ay = (this.vx / sp) * this.spin;
      this.vx += ax * dt;
      this.vy += ay * dt;
      this.spin *= Math.exp(-0.7 * dt);
    }
    this.dip *= Math.exp(-1.2 * dt);
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.z += this.vz * dt;
    if (this.z < 0) {
      this.z = 0;
      if (this.vz < -1.5) {
        this.vz = -this.vz * 0.48;
        this.vx *= 0.86;
        this.vy *= 0.86;
        this.spin *= 0.5;
      } else this.vz = 0;
    }
    this.rot += (sp * dt) / BALL_R;
    this.collideFrame();
  }

  /** 골대·크로스바·골망 충돌 */
  collideFrame() {
    for (const gx of [0, PITCH_L]) {
      if (Math.abs(this.x - gx) > 3 + GOAL_DEPTH) continue;
      // 골포스트
      for (const py of [CY - GOAL_HALF_W, CY + GOAL_HALF_W]) {
        const dx = this.x - gx;
        const dy = this.y - py;
        const d = len(dx, dy);
        if (d < POST_R + BALL_R && this.z < GOAL_H + BALL_R && d > 1e-4) {
          const nx = dx / d;
          const ny = dy / d;
          const vn = this.vx * nx + this.vy * ny;
          if (vn < 0) {
            this.vx -= 1.65 * vn * nx;
            this.vy -= 1.65 * vn * ny;
            this.hitPost = Math.abs(vn) > 3;
            this.guide = null;
          }
          this.x = gx + nx * (POST_R + BALL_R + 0.01);
          this.y = py + ny * (POST_R + BALL_R + 0.01);
        }
      }
      // 크로스바
      if (Math.abs(this.y - CY) < GOAL_HALF_W) {
        const dx = this.x - gx;
        const dz = this.z - GOAL_H;
        const d = len(dx, dz);
        if (d < POST_R + BALL_R && d > 1e-4) {
          const nx = dx / d;
          const nz = dz / d;
          const vn = this.vx * nx + this.vz * nz;
          if (vn < 0) {
            this.vx -= 1.6 * vn * nx;
            this.vz -= 1.6 * vn * nz;
            this.hitPost = Math.abs(vn) > 3;
            this.guide = null;
          }
          this.x = gx + nx * (POST_R + BALL_R + 0.01);
          this.z = GOAL_H + nz * (POST_R + BALL_R + 0.01);
        }
      }
      // 골망 내부
      const inside = gx === 0 ? this.x < 0 : this.x > PITCH_L;
      if (inside && Math.abs(this.y - CY) < GOAL_HALF_W + 0.3 && this.z < GOAL_H + 0.3) {
        const back = gx === 0 ? -GOAL_DEPTH + BALL_R : PITCH_L + GOAL_DEPTH - BALL_R;
        if ((gx === 0 && this.x < back) || (gx !== 0 && this.x > back)) {
          this.x = back;
          if (Math.abs(this.vx) > 2) this.hitNet = true;
          this.vx *= -0.12;
          this.vy *= 0.5;
          this.vz *= 0.4;
          this.guide = null;
        }
        const side = GOAL_HALF_W - BALL_R;
        if (this.inNet && Math.abs(this.y - CY) > side) {
          this.y = CY + Math.sign(this.y - CY) * side;
          this.vy *= -0.2;
        }
        if (this.inNet && this.z > GOAL_H - BALL_R) {
          this.z = GOAL_H - BALL_R;
          this.vz = -Math.abs(this.vz) * 0.2;
        }
      }
    }
  }
}

export type PState =
  | 'idle'
  | 'run'
  | 'kick'
  | 'tackle'
  | 'slide'
  | 'down'
  | 'dive'
  | 'celebrate'
  | 'skill'
  | 'frozen'
  | 'stumble'
  | 'header'
  | 'throw'
  | 'charge';

export type SkillKind = 'stepover' | 'roulette' | 'dragback' | 'knock' | 'rainbow';

export interface DiveInfo {
  /** 다이빙 목표 (월드) */
  tx: number;
  ty: number;
  tz: number;
  sx: number;
  sy: number;
  t: number;
  dur: number;
  willSave: boolean;
  catchBall: boolean;
  side: number;
}

export interface PendingKick {
  kind: 'pass' | 'through' | 'lob' | 'shot' | 'special' | 'clear' | 'cross' | 'header';
  power: number;
  dirX: number;
  dirY: number;
  finesse: boolean;
  chip: boolean;
  t: number;
  windup: number;
  timing: 'none' | 'perfect' | 'early';
  target: Player | null;
  tx?: number;
  ty?: number;
}

export class Player {
  team: TeamState;
  idx: number;
  def: PlayerDef;
  slot: Slot;
  role: Role;
  x = 0;
  y = 0;
  z = 0;
  vz = 0;
  vx = 0;
  vy = 0;
  facing = 0;
  state: PState = 'idle';
  stateT = 0;
  stateDur = 0;
  /** 이동 의도 (AI/사람이 매 틱 설정) */
  dvx = 0;
  dvy = 0;
  sprinting = false;
  /** 바라볼 방향 (정지 시) */
  lookX = 0;
  lookY = 0;
  stamina = 1;
  morale = 0;
  anim = 0;
  touchCD = 0;
  evade = 0;
  frozen = 0;
  skill: SkillKind | null = null;
  skillDX = 0;
  skillDY = 0;
  dive: DiveInfo | null = null;
  kick: PendingKick | null = null;
  tackleResolved = false;
  aiT = Math.random() * 0.3;
  aiTarget: { x: number; y: number } | null = null;
  runT = 0;
  runActive = false;
  holdT = 0;
  // 경기 기록 (평점용)
  st = { passOk: 0, passBad: 0, shots: 0, goals: 0, assists: 0, tackles: 0, saves: 0, conceded: 0, lost: 0, keyPass: 0, specials: 0 };
  yellow = 0;
  sentOff = false;
  /** 사람이 조작 중 */
  human = false;
  /** 원터치를 위한 예약 입력 */
  queued: { kind: PendingKick['kind']; power: number; t: number } | null = null;
  /** 필살 오라 */
  aura = 0;
  celebrateKind = 0;

  constructor(team: TeamState, idx: number, def: PlayerDef, slot: Slot) {
    this.team = team;
    this.idx = idx;
    this.def = def;
    this.slot = slot;
    this.role = slot.role;
  }

  get speed() {
    return Math.sqrt(this.vx * this.vx + this.vy * this.vy);
  }

  get isGK() {
    return this.role === 'GK';
  }

  get busy() {
    return (
      this.state === 'kick' ||
      this.state === 'tackle' ||
      this.state === 'slide' ||
      this.state === 'down' ||
      this.state === 'dive' ||
      this.state === 'frozen' ||
      this.state === 'header' ||
      this.state === 'throw' ||
      this.state === 'charge' ||
      this.state === 'skill'
    );
  }

  get canAct() {
    return !this.busy || this.state === 'skill';
  }

  setState(s: PState, dur = 0) {
    this.state = s;
    this.stateT = 0;
    this.stateDur = dur;
  }

  /** 사기 반영 (-3..3 → 0.9..1.1) */
  get moraleMul() {
    return 1 + this.morale * 0.035;
  }

  maxSpeed(withBall: boolean) {
    const pace = this.def.pac / 99;
    const base = this.sprinting ? SPRINT_SPEED * (0.78 + pace * 0.3) : RUN_SPEED * (0.86 + pace * 0.18);
    let s = base * this.moraleMul * (0.82 + 0.18 * this.stamina);
    if (withBall) s *= this.sprinting ? 0.9 + (this.def.dri / 99) * 0.06 : 0.94;
    if (this.state === 'stumble') s *= 0.45;
    return s;
  }

  /** 의도 속도로 가감속 + 방향 전환 관성 */
  integrate(dt: number, withBall: boolean) {
    const cur = this.speed;
    const curA = Math.atan2(this.vy, this.vx);
    const dSp = Math.sqrt(this.dvx * this.dvx + this.dvy * this.dvy);
    const accel = withBall ? 20 : 24;
    const decel = 26;
    let sp = cur;
    let ang = curA;
    if (dSp < 0.15) {
      sp = Math.max(0, cur - decel * dt);
    } else {
      const dA = Math.atan2(this.dvy, this.dvx);
      if (cur < 1.2) {
        ang = dA;
        sp = Math.min(dSp, cur + accel * dt);
      } else {
        const diff = Math.abs(angleDiff(curA, dA));
        const agility = withBall ? 3.4 + (this.def.dri / 99) * 3.4 : 5.5 + (this.def.pac / 99) * 1.5;
        const rate = agility * (cur > 7 ? 0.75 : 1) * (cur < 3.5 ? 2.2 : 1);
        ang = turnToward(curA, dA, rate * dt);
        const target = diff > 1.7 ? dSp * 0.35 : dSp;
        sp = target > cur ? Math.min(target, cur + accel * dt) : Math.max(target, cur - decel * dt);
      }
    }
    this.vx = Math.cos(ang) * sp;
    this.vy = Math.sin(ang) * sp;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    // 방향
    if (sp > 0.6) {
      this.facing = turnToward(this.facing, ang, (withBall ? 9 : 12) * dt);
    } else if (this.lookX !== 0 || this.lookY !== 0) {
      const la = Math.atan2(this.lookY - this.y, this.lookX - this.x);
      this.facing = turnToward(this.facing, la, 6 * dt);
    }
    this.anim += sp * dt * 1.55;
    // 체력
    if (this.sprinting && sp > RUN_SPEED * 0.9) this.stamina = Math.max(0.2, this.stamina - 0.05 * dt);
    else this.stamina = Math.min(1, this.stamina + 0.035 * dt);
    // 경기장 밖으로 너무 나가지 않게
    this.x = clamp(this.x, -3, PITCH_L + 3);
    this.y = clamp(this.y, -2.5, PITCH_W + 2.5);
  }
}

export class TeamState {
  side: 0 | 1;
  def: TeamDef;
  kit: Kit;
  tactics: Tactics;
  players: Player[] = [];
  dir: 1 | -1 = 1;
  human: boolean;
  gauge = 0;
  controlled: Player | null = null;
  goals = 0;
  pens = 0;
  stats: TeamStats = {
    shots: 0,
    onTarget: 0,
    passes: 0,
    passesDone: 0,
    tackles: 0,
    fouls: 0,
    corners: 0,
    possessionTime: 0,
    specials: 0,
    saves: 0,
  };
  /** 터치라인 지시 (0 없음) */
  shout: '' | 'press' | 'calm' | 'attack' | 'defend' = '';

  constructor(side: 0 | 1, def: TeamDef, kit: Kit, tactics: Tactics, human: boolean) {
    this.side = side;
    this.def = def;
    this.kit = kit;
    this.tactics = tactics;
    this.human = human;
  }

  get oppGoalX() {
    return this.dir > 0 ? PITCH_L : 0;
  }
  get ownGoalX() {
    return this.dir > 0 ? 0 : PITCH_L;
  }

  /** 공격 방향 기준 진행도 0..1 */
  u(x: number) {
    return this.dir > 0 ? x / PITCH_L : 1 - x / PITCH_L;
  }
  v(y: number) {
    return this.dir > 0 ? y / PITCH_W : 1 - y / PITCH_W;
  }
  toX(u: number) {
    return this.dir > 0 ? u * PITCH_L : PITCH_L - u * PITCH_L;
  }
  toY(v: number) {
    return this.dir > 0 ? v * PITCH_W : PITCH_W - v * PITCH_W;
  }

  get gk() {
    return this.players[0];
  }

  get active() {
    return this.players.filter((p) => !p.sentOff);
  }
}
