import { audio } from './audio';
import { CY, GOAL_H, GOAL_HALF_W, PEN_SPOT, PITCH_W } from './constants';
import type { Player, TeamState } from './entities';
import { chance, clamp, gauss, len, rand } from './math';
import type { Match } from './match';

type Stage = 'ready' | 'aim' | 'runup' | 'flight' | 'result' | 'done';

/** 승부차기: 항상 왼쪽 골대(x=0)를 사용한다 */
export class Shootout {
  m: Match;
  order: [Player[], Player[]];
  kicks: [boolean[], boolean[]] = [[], []];
  turn: 0 | 1;
  first: 0 | 1;
  stage: Stage = 'ready';
  t = 0;
  aimY = CY;
  aimZ = 1.0;
  power = 0;
  charging = false;
  keeperDir = { y: 0, z: 0, locked: false };
  shooter!: Player;
  keeper!: Player;
  result: 'goal' | 'save' | 'miss' | '' = '';
  winner: 0 | 1 | null = null;
  private endFired = false;
  private shotTarget = { y: CY, z: 1 };
  private willSave = false;
  private flightT = 0;
  private flightDur = 0.5;
  private startPos = { x: PEN_SPOT, y: CY, z: 0 };
  private endPos = { x: -0.8, y: CY, z: 1 };

  constructor(m: Match) {
    this.m = m;
    const pickOrder = (t: TeamState) =>
      t.active
        .filter((p) => !p.isGK)
        .sort((a, c) => c.def.sho + (c.def.ace ? 15 : 0) + c.morale * 4 - (a.def.sho + (a.def.ace ? 15 : 0) + a.morale * 4))
        .concat(t.active.filter((p) => p.isGK));
    this.order = [pickOrder(m.teams[0]), pickOrder(m.teams[1])];
    this.first = chance(0.5) ? 0 : 1;
    this.turn = this.first;
    m.cam.mode = 'penalty';
    m.particles.clear();
    m.ball.owner = null;
    // 나머지 선수들은 센터라인에 일렬로
    for (const t of m.teams) {
      t.pens = 0;
      t.active.forEach((p, i) => {
        p.x = 52.5 + (t.side === 0 ? -1 : 1) * 1.2;
        p.y = CY - 12 + i * 2.2;
        p.facing = Math.PI;
        p.vx = p.vy = 0;
        p.state = 'idle';
        p.dive = null;
      });
    }
    this.setupKick();
  }

  get kickIndex() {
    return this.kicks[this.turn].length;
  }

  private setupKick() {
    const m = this.m;
    const keepTeam = m.teams[1 - this.turn];
    const idx = this.kicks[this.turn].length % this.order[this.turn].length;
    this.shooter = this.order[this.turn][idx];
    this.keeper = keepTeam.gk;
    // 이전 키커/키퍼 원위치
    for (const t of m.teams)
      t.active.forEach((p, i) => {
        if (p === this.shooter || p === this.keeper) return;
        p.x = 52.5 + (t.side === 0 ? -1 : 1) * 1.2;
        p.y = CY - 12 + i * 2.2;
        p.state = 'idle';
        p.dive = null;
        p.z = 0;
      });
    this.shooter.x = PEN_SPOT + 3.2;
    this.shooter.y = CY + 2.2;
    this.shooter.facing = Math.PI;
    this.shooter.state = 'idle';
    this.shooter.z = 0;
    this.keeper.x = 0.3;
    this.keeper.y = CY;
    this.keeper.facing = 0;
    this.keeper.state = 'idle';
    this.keeper.dive = null;
    this.keeper.z = 0;
    m.ball.place(PEN_SPOT, CY);
    m.ball.owner = null;
    this.aimY = CY;
    this.aimZ = 0.9;
    this.power = 0;
    this.charging = false;
    this.keeperDir = { y: 0, z: 0, locked: false };
    this.result = '';
    this.stage = 'ready';
    this.t = 0;
  }

  get humanShooting() {
    return this.m.teams[this.turn].human;
  }
  get humanKeeping() {
    return this.m.teams[1 - this.turn].human;
  }

  update(dt: number) {
    const m = this.m;
    const inp = m.input;
    this.t += dt;
    const ax = inp.axis();
    // 사람 키퍼: 방향 미리 선택 (화면 오른쪽 = 월드 -y)
    if (this.humanKeeping && (this.stage === 'aim' || this.stage === 'runup') && !this.keeperDir.locked) {
      if (ax.mag > 0.3) {
        this.keeperDir.y = clamp(-ax.x, -1, 1);
        this.keeperDir.z = clamp(-ax.y, -1, 1);
      }
      if (inp.pressed('shoot') || inp.pressed('pass')) this.keeperDir.locked = true;
    }
    switch (this.stage) {
      case 'ready':
        if (this.t > 1.1) {
          this.stage = 'aim';
          this.t = 0;
          m.input.clearEdges();
        }
        break;
      case 'aim':
        if (this.humanShooting) {
          this.aimY = clamp(this.aimY - ax.x * dt * 4.2, CY - GOAL_HALF_W - 0.8, CY + GOAL_HALF_W + 0.8);
          this.aimZ = clamp(this.aimZ - ax.y * dt * 2.6, 0.15, GOAL_H + 0.6);
          if (inp.held('shoot')) {
            this.charging = true;
            this.power = clamp(inp.holdTime('shoot') / 1.0, 0, 1);
          }
          if (inp.released('shoot') || this.t > 9) {
            if (!this.charging) this.power = 0.6;
            this.beginRunup();
          }
        } else if (this.t > (this.humanKeeping ? 2.2 : 1.2)) {
          // CPU 키커 조준
          const side = chance(0.5) ? 1 : -1;
          const center = chance(0.12);
          this.aimY = center ? CY + rand(-0.6, 0.6) : CY + side * rand(1.8, 3.3);
          this.aimZ = chance(0.3) ? rand(1.4, 2.2) : rand(0.2, 1.0);
          this.power = clamp(0.62 + gauss() * 0.12, 0.35, 0.95);
          this.beginRunup();
        }
        break;
      case 'runup': {
        const s = this.shooter;
        const k = clamp(this.t / 0.7, 0, 1);
        s.x = PEN_SPOT + 3.2 - k * 2.7;
        s.y = CY + 2.2 - k * 1.8;
        s.anim += dt * 9;
        s.state = 'run';
        if (this.t >= 0.7) this.kick();
        break;
      }
      case 'flight': {
        this.flightT += dt;
        const k = clamp(this.flightT / this.flightDur, 0, 1);
        const b = m.ball;
        b.x = this.startPos.x + (this.endPos.x - this.startPos.x) * k;
        b.y = this.startPos.y + (this.endPos.y - this.startPos.y) * k;
        b.z = this.startPos.z + (this.endPos.z - this.startPos.z) * k + Math.sin(Math.PI * k) * 0.3;
        b.rot += dt * 40;
        if (k >= 1) this.resolve();
        break;
      }
      case 'result': {
        const b = m.ball;
        b.step(dt);
        if (this.t > 1.8) this.next();
        break;
      }
      case 'done':
        if (this.t > 2.6 && !this.endFired) {
          this.endFired = true;
          this.m.cb.onShootoutEnd?.();
        }
        break;
    }
    // 키퍼 다이빙 애니메이션
    const gk = this.keeper;
    if (gk.dive) {
      gk.dive.t += dt;
      const kk = clamp(gk.dive.t / gk.dive.dur, 0, 1);
      const e = 1 - (1 - kk) * (1 - kk);
      gk.y = gk.dive.sy + (gk.dive.ty - gk.dive.sy) * e;
    }
    m.cameraUpdate(dt);
    m.cam.x = 0;
  }

  private beginRunup() {
    this.stage = 'runup';
    this.t = 0;
    this.charging = false;
  }

  private kick() {
    const m = this.m;
    const s = this.shooter;
    s.setState('kick', 0.4);
    audio.kick(0.8);
    // 실제 목표: 파워/성격/사기에 따른 오차
    let err = 0.18 + (1 - s.def.sho / 99) * 0.5;
    if (s.def.personality === 'nervous') err += 0.25;
    if (s.def.personality === 'calm' || s.def.personality === 'confident') err -= 0.06;
    err -= s.morale * 0.05;
    if (Math.min(this.kicks[0].length, this.kicks[1].length) >= 5) err += 0.1; // 서든데스 압박
    const over = this.power > 0.82 ? (this.power - 0.82) * 6 : 0;
    const ty = this.aimY + gauss() * err;
    const tz = Math.max(0.1, this.aimZ + gauss() * err * 0.6 + over * rand(0.5, 1.2));
    this.shotTarget = { y: ty, z: tz };
    const speed = 18 + this.power * 14;
    this.flightDur = PEN_SPOT / speed;
    this.flightT = 0;
    this.startPos = { x: PEN_SPOT, y: CY, z: 0.1 };
    this.endPos = { x: -0.6, y: ty, z: tz };
    // 키퍼 반응
    const gk = this.keeper;
    let diveY: number;
    let diveZ: number;
    if (this.humanKeeping) {
      diveY = CY + this.keeperDir.y * 2.6;
      diveZ = 0.6 + Math.max(0, this.keeperDir.z) * 1.3;
    } else {
      const read = 0.22 + m.cfg.difficulty * 0.04 + (gk.def.gk - 75) / 150;
      if (chance(read)) {
        diveY = ty + rand(-0.5, 0.5);
        diveZ = tz;
      } else {
        const r = Math.random();
        diveY = r < 0.4 ? CY - 2.6 : r < 0.8 ? CY + 2.6 : CY;
        diveZ = rand(0.4, 1.6);
      }
    }
    const lateral = clamp(diveY - CY, -3.4, 3.4);
    gk.dive = {
      tx: gk.x,
      ty: CY + lateral,
      tz: clamp(diveZ, 0.3, 2.3),
      sx: gk.x,
      sy: CY,
      t: 0,
      dur: clamp(this.flightDur * 1.05, 0.25, 0.55),
      willSave: false,
      catchBall: false,
      side: Math.sign(lateral) || 1,
    };
    gk.state = Math.abs(lateral) < 0.5 ? 'idle' : 'dive';
    // 세이브 판정
    const onTarget = Math.abs(ty - CY) < GOAL_HALF_W - 0.05 && tz < GOAL_H - 0.05;
    const dist = len(ty - (CY + lateral), tz - diveZ);
    const reach = 1.4 + gk.def.gk / 250;
    let saveP = dist < reach ? clamp(0.85 - dist * 0.35 - (speed - 24) * 0.02, 0.1, 0.9) : 0.02;
    if (Math.abs(lateral) < 0.5 && Math.abs(ty - CY) < 1.1 && tz < 1.9) saveP = 0.8;
    // 구석·높은 코스일수록 막기 어렵다 (코스를 잘 노린 킥이 보상받도록)
    saveP *= clamp((GOAL_HALF_W - 0.3 - Math.abs(ty - CY)) / 1.5, 0.15, 1);
    if (tz > 1.7) saveP *= 0.7;
    this.willSave = onTarget && chance(saveP);
    // 결과에 맞는 도착 지점: 선방은 키퍼 손, 골대는 골대, 골은 골망 안
    const post = !onTarget && Math.abs(ty - CY) < GOAL_HALF_W + 0.25 && tz < GOAL_H + 0.25;
    if (this.willSave) this.endPos = { x: gk.x + 0.25, y: CY + lateral * 0.9 + (ty - (CY + lateral)) * 0.4, z: clamp(diveZ, 0.3, 2.2) * 0.6 + tz * 0.4 };
    else if (post) this.endPos = { x: 0.05, y: CY + Math.sign(ty - CY) * (GOAL_HALF_W + 0.05), z: Math.min(tz, GOAL_H) };
    this.flightDur *= Math.abs(this.endPos.x - PEN_SPOT) / Math.abs(-0.6 - PEN_SPOT);
    this.stage = 'flight';
    this.t = 0;
    m.ball.special = null;
  }

  private resolve() {
    const m = this.m;
    const b = m.ball;
    const { y: ty, z: tz } = this.shotTarget;
    const onTarget = Math.abs(ty - CY) < GOAL_HALF_W - 0.05 && tz < GOAL_H - 0.05;
    const team = m.teams[this.turn];
    if (this.willSave) {
      this.result = 'save';
      b.vx = rand(4, 8);
      b.vy = (ty > CY ? 1 : -1) * rand(3, 7);
      b.vz = rand(2, 5);
      audio.ooh();
      audio.tackle();
      m.particles.burst(b.x, b.y, b.z, 20, ['#ffffff', '#cfe3ff'], 6, 'spark', 0.5, 0.12);
      m.banner = { text: '선방!!', sub: this.keeper.def.name, color: '#7fe0ff', t: 0, dur: 1.6 };
    } else if (!onTarget) {
      this.result = 'miss';
      b.vx = -12;
      b.vy = 0;
      b.vz = tz > GOAL_H ? 2 : 0;
      if (Math.abs(ty - CY) < GOAL_HALF_W + 0.25 && tz < GOAL_H + 0.25) {
        audio.post();
        b.vx = 6;
      }
      audio.ooh();
      m.banner = { text: '실축!', sub: this.shooter.def.name, color: '#ff6b6b', t: 0, dur: 1.6 };
    } else {
      this.result = 'goal';
      b.vx = -10;
      b.vy = 0;
      b.vz = 0;
      b.inNet = true;
      team.pens++;
      audio.net();
      audio.roar(0.8);
      m.particles.burst(b.x, b.y, b.z, 50, [team.kit.shirt, team.kit.accent, '#ffffff'], 9, 'spark', 0.9, 0.18);
      m.fx.shake = 0.35;
      m.banner = { text: '골!', sub: this.shooter.def.name, color: '#ffd34d', t: 0, dur: 1.6 };
    }
    this.kicks[this.turn].push(this.result === 'goal');
    this.stage = 'result';
    this.t = 0;
  }

  private decided(): 0 | 1 | null {
    const [a, b] = this.kicks;
    const ga = a.filter(Boolean).length;
    const gb = b.filter(Boolean).length;
    const na = a.length;
    const nb = b.length;
    if (na <= 5 && nb <= 5 && (na < 5 || nb < 5)) {
      const remA = 5 - na;
      const remB = 5 - nb;
      if (ga > gb + remB) return 0;
      if (gb > ga + remA) return 1;
      return null;
    }
    if (na === nb && na >= 5) {
      if (ga > gb) return 0;
      if (gb > ga) return 1;
    }
    return null;
  }

  private next() {
    const w = this.decided();
    if (w !== null) {
      this.winner = w;
      this.stage = 'done';
      const t = this.m.teams[w];
      this.m.banner = { text: `${t.def.name} 승리!`, sub: `승부차기 ${this.m.teams[0].pens} : ${this.m.teams[1].pens}`, color: '#ffd34d', t: 0, dur: 3 };
      audio.roar(1.2);
      audio.whistle(3, true);
      this.m.particles.confetti(0, CY, 200, [t.kit.shirt, t.kit.accent, '#ffffff', '#ffd34d']);
      this.t = 0;
      return;
    }
    this.turn = (1 - this.turn) as 0 | 1;
    this.setupKick();
  }

  /** HUD용 조준점 */
  get reticle() {
    return { x: 0, y: this.aimY, z: this.aimZ };
  }

  get crowdY() {
    return PITCH_W;
  }
}
