'use strict';
// ── 경비병 AI · 칼싸움 판정 · 공주 ─────────────────────────────────

const Combat = {
  strike(att, def, world, game) {
    const dx = def.x - att.x, dist = Math.abs(dx);
    const facing = att.f === sign(dx);
    if (!def.alive || !facing || dist > (att.reach || 54) || dist < 6 || def.row !== att.row) return;
    const blocking = def.state === 'parry' && def.t < 0.36 && def.f === -att.f;
    const mx = (att.x + def.x) / 2, my = att.y - 30;
    if (blocking) {
      Sfx.play('clang'); world.sparks(mx, my);
      att.set('bounce', 'bounce');
      def.riposte = true;
      if (def.onParried) def.onParried();
      return;
    }
    Sfx.play('hit');
    world.blood(def.x, def.y - 28, att.f);
    def.flash = 0.3;
    def.hp -= 1;
    if (def.hp <= 0) {
      def.hp = 0; def.die(world, 'wound');
      if (game) game.onKill(def);
      return;
    }
    if (def.isPlayer) Sfx.play('hurt');
    if (COMBAT.has(def.state) || def.state === 'idle' || def.state === 'stand') def.set('hurt', 'hurt');
    else if (GROUND.has(def.state)) def.set('hurt', 'hurt');
  },
};

class Guard extends Actor {
  constructor(x, y, cfg) {
    super(x, y, cfg.facing, cfg.look);
    this.hp = this.maxHp = cfg.hp;
    this.skill = SKILLS[cfg.skill];
    this.isBoss = cfg.look === 'boss';
    this.hasSword = true;
    this.cool = 1.0; this.alert = false; this.decided = -1;
    this.set('idle');
  }

  update(dt, world, game) {
    this.t += dt; this.animT += dt;
    if (this.flash > 0) this.flash -= dt;
    if (!this.alive) {
      if (this.state === 'fall' || this.state === 'gone') this.air(dt, world, false);
      return;
    }
    const p = game.player;
    const sees = p.alive && p.row === this.row && Math.abs(p.x - this.x) < 150 && world.lineClear(this.row, this.x, p.x)
      && !['hang', 'climbup', 'climbdown', 'fall', 'air', 'gone'].includes(p.state);
    const dx = p.x - this.x, dist = Math.abs(dx);
    this.cool -= dt;
    if (this.wary > 0) this.wary -= dt;
    switch (this.state) {
      case 'idle':
        if (sees) {
          this.f = sign(dx); this.set('draw', 'draw'); Sfx.play('swish');
          if (this.isBoss && game.once('bossSeen')) Sfx.play('boss');
        }
        break;
      case 'draw': if (this.t >= 0.42) this.set('engarde'); break;
      case 'engarde': {
        if (!sees) { if (this.t > 1.2) this.set('sheathe', 'sheathe'); break; }
        this.f = sign(dx);
        // 왕자가 칼을 휘두르기 시작하면 막을지 결정 (판정 1회)
        if (p.state === 'strike' && p.t < 0.2 && this.decided !== p.strikeId) {
          this.decided = p.strikeId;
          const chance = this.skill.parry + (this.wary > 0 ? 0.35 : 0);
          this.parryPlan = Math.random() < chance && dist < 60 ? this.skill.react : -1;
          this.planT = 0;
        }
        if (this.parryPlan >= 0) {
          this.planT += dt;
          if (this.planT >= this.parryPlan) { this.parryPlan = -1; this.set('parry', 'parry'); break; }
          break;
        }
        if (this.riposte && dist < 52) { this.riposte = false; if (Math.random() < this.skill.riposte + 0.3) { this.set('strike', 'gstrike'); break; } }
        if (dist > 46) { if (this.canStep(world, this.f)) this.set('advance', 'advance'); break; }
        if (dist < 24) { if (this.canStep(world, -this.f)) this.set('retreat', 'retreat'); break; }
        // 왕자가 헛손질 뒤 자세를 추스르는 틈을 노린다
        if ((p.state === 'bounce' || (p.state === 'strike' && p.t > 0.3)) && dist < 50 && this.cool < 0.6) {
          this.cool = rnd(this.skill.cd[0], this.skill.cd[1]); this.set('strike', 'gstrike'); break;
        }
        if (this.cool <= 0 && p.state !== 'hurt') {
          this.cool = rnd(this.skill.cd[0], this.skill.cd[1]);
          this.set('strike', 'gstrike');
        }
        break;
      }
      case 'advance':
        if (dist > 28 && this.canStep(world, this.f)) this.moveBy(world, this.f * 34 * dt);
        if (this.t >= 0.28) this.set('engarde');
        break;
      case 'retreat':
        if (this.canStep(world, -this.f)) this.moveBy(world, -this.f * 34 * dt);
        if (this.t >= 0.28) this.set('engarde');
        break;
      case 'strike': {
        const hitT = 0.3 * (this.skill.wind / 0.25);
        if (this.t >= hitT && this.once('hit')) { Sfx.play('swish'); Combat.strike(this, p, world, game); }
        if (this.t >= 0.58) this.set('engarde');
        break;
      }
      case 'parry':
        if (this.t >= 0.42) this.set('engarde');
        break;
      case 'hurt':
        if (this.t < 0.16) this.moveBy(world, -this.f * 50 * dt);
        if (this.t >= 0.38) { this.set('engarde'); this.cool = Math.min(this.cool, 0.35); this.wary = 1.6; }
        break;
      case 'bounce': if (this.t >= 0.34) this.set('engarde'); break;
      case 'sheathe': if (this.t >= 0.4) this.set('idle'); break;
      case 'fall': case 'air': this.air(dt, world, false); break;
      case 'land': if (this.t >= 0.26) this.set('engarde'); break;
      case 'hardland': if (this.t >= 0.8) this.set('engarde'); break;
    }
    this.groundChecks(world);
  }

  // 경비병은 함정·모서리 쪽으로 스스로 걸어가지 않는다
  canStep(world, f) {
    const nx = this.x + f * 12, c = colOf(nx), r = this.row;
    if (!world.support(c, r)) return false;
    const st = world.state(c, r);
    if (st && (st.kind === 'loose' || st.kind === 'spikes' || st.kind === 'chomper' || st.kind === 'electric')) return false;
    return world.moveX(this.x, nx, [r]) === nx;
  }

  poseNow() {
    if (this.state === 'strike') {
      const k = 0.25 / this.skill.wind;
      const r = sampleAnim('gstrike', this.t * k);
      return { pose: r.pose, hip: null };
    }
    return super.poseNow();
  }
}

// 감염자: 막지 못하고 느리지만, 다가와 할퀸다
class Zombie extends Actor {
  constructor(x, y, cfg) {
    super(x, y, cfg.facing, cfg.look);
    this.hp = this.maxHp = cfg.hp; this.isZombie = true; this.reach = 40;
    this.cool = rnd(0.4, 1); this.speed = rnd(18, 26); this.groanT = rnd(1, 4);
    this.set('idle');
  }
  update(dt, world, game) {
    this.t += dt; this.animT += dt;
    if (this.flash > 0) this.flash -= dt;
    if (!this.alive) { if (this.state === 'fall' || this.state === 'gone') this.air(dt, world, false); return; }
    const p = game.player;
    const sees = p.alive && p.row === this.row && Math.abs(p.x - this.x) < 160 && world.lineClear(this.row, this.x, p.x)
      && !['hang', 'climbup', 'climbdown', 'fall', 'air', 'gone'].includes(p.state);
    const dx = p.x - this.x, dist = Math.abs(dx);
    this.cool -= dt; this.groanT -= dt;
    if (this.groanT <= 0) { this.groanT = rnd(3, 6); if (dist < 200 && Math.abs(p.row - this.row) <= 1) Sfx.play('groan'); }
    switch (this.state) {
      case 'idle':
        if (sees) { this.f = sign(dx); this.set('shamble'); Sfx.play('groan'); }
        break;
      case 'shamble':
        if (!sees) { if (this.t > 1.5) this.set('idle'); break; }
        this.f = sign(dx);
        if (dist < 30) { if (this.cool <= 0) { this.cool = rnd(0.9, 1.5); this.set('claw'); } break; }
        if (this.canStep(world, this.f)) this.moveBy(world, this.f * this.speed * dt);
        break;
      case 'claw':
        if (this.t >= 0.4 && this.once('hit')) { Sfx.play('swish'); Combat.strike(this, p, world, game); }
        if (this.t >= 0.8) this.set('shamble');
        break;
      case 'hurt':
        if (this.t < 0.16) this.moveBy(world, -this.f * 40 * dt);
        if (this.t >= 0.4) { this.set('shamble'); this.cool = Math.max(this.cool, 0.5); }
        break;
      case 'bounce': if (this.t >= 0.4) this.set('shamble'); break;
      case 'fall': case 'air': this.air(dt, world, false); break;
      case 'land': if (this.t >= 0.26) this.set('shamble'); break;
      case 'hardland': if (this.t >= 0.8) this.set('shamble'); break;
    }
    this.groundChecks(world);
  }
  poseNow() {
    switch (this.state) {
      case 'shamble': return { pose: sampleAnim('zwalk', this.animT).pose, hip: null };
      case 'claw': return { pose: sampleAnim('zclaw', this.t).pose, hip: null };
      case 'hurt': case 'bounce': return { pose: sampleAnim('zhurt', this.t).pose, hip: null };
      case 'idle': { const q = POSE.zstand.slice(); q[0] += Math.sin(this.t * 1.5) * 3; q[1] += Math.sin(this.t * 1.1) * 4; return { pose: q, hip: null }; }
    }
    return super.poseNow();
  }
}
Zombie.prototype.canStep = Guard.prototype.canStep;

class Princess extends Actor {
  constructor(x, y) {
    super(x, y, 1, 'sister');
    this.isPrincess = true; this.set('idle');
  }
  update(dt, world) {
    this.t += dt;
    this.groundY = this.y;
  }
  poseNow() {
    if (this.state === 'cheer') return { pose: sampleAnim('cheer', this.t).pose, hip: null };
    const pose = POSE.stand.slice();
    pose[1] = Math.sin(this.t * 0.8) * 4 - 6;
    pose[6] = 30; pose[7] = 70; pose[8] = 25; pose[9] = 75;
    return { pose, hip: null };
  }
}
