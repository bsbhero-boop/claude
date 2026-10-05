'use strict';
// ── 캐릭터 공통 물리 + 왕자(플레이어) 상태 기계 ───────────────────────

const RUN = 112;
const GROUND = new Set(['stand', 'turn', 'startrun', 'run', 'stoprun', 'runturn', 'step', 'teeter', 'crouch', 'standup',
  'land', 'hardland', 'drink', 'pickup', 'shamble', 'claw', 'draw', 'engarde', 'advance', 'retreat', 'strike', 'parry', 'hurt', 'bounce', 'sheathe', 'bump', 'standjump', 'runjump', 'jumpup', 'hop', 'idle', 'cheer']);
const RUNNING = new Set(['startrun', 'run', 'stoprun', 'runturn', 'runjump', 'bump']);
const COMBAT = new Set(['draw', 'engarde', 'advance', 'retreat', 'strike', 'parry', 'hurt', 'bounce']);

class Actor {
  constructor(x, y, f, look) {
    this.x = x; this.y = y; this.f = f; this.look = look;
    this.vx = 0; this.vy = 0; this.state = 'stand'; this.t = 0; this.anim = 'stand'; this.animT = 0;
    this.hp = 3; this.maxHp = 3; this.alive = true; this.grounded = true; this.hasSword = false;
    this.airStartY = y; this.hangE = 0; this.hangL = 0; this.flipped = false; this.done = {};
    this.flash = 0; this.deathKind = ''; this.isPlayer = false; this.groundY = y; this.renderDy = 0;
  }
  get row() { return rowOf(this.y); }
  height() { return this.state === 'crouch' ? 30 : 44; }
  set(state, anim) {
    this.state = state; this.t = 0; this.anim = anim || null; this.animT = 0; this.flipped = false; this.done = {};
    if (state === 'strike') this.strikeId = (this.strikeId || 0) + 1;
    if (state === 'hang') this.hangStart = Input.now;
  }
  once(key) { if (this.done[key]) return false; this.done[key] = true; return true; }

  moveBy(world, dx) {
    const r = this.row;
    const nx = world.moveX(this.x, this.x + dx, [r]);
    const blocked = Math.abs(nx - (this.x + dx)) > 0.01;
    this.x = nx;
    return blocked;
  }

  startFall(world, vx = 0) {
    this.set('fall'); this.grounded = false; this.vx = vx; this.vy = 0; this.airStartY = this.y;
  }

  // 공중 이동 · 착지 · 모서리 잡기
  air(dt, world, canGrab) {
    const px = this.x, py = this.y;
    this.vy = Math.min(this.vy + GRAV * dt, 650);
    const rows = [...new Set([rowOf(this.y - 40), rowOf(this.y - 22), rowOf(this.y - 2)])];
    let nx = world.moveX(this.x, this.x + this.vx * dt, rows);
    if (Math.abs(nx - (this.x + this.vx * dt)) > 0.01) this.vx = -this.vx * 0.15;
    // 바닥판 옆면: 발이 어떤 층 바닥선보다 조금 아래(키 높이 이내)면 그 바닥 아래로 파고들지 못한다
    for (let r = 0; r < world.h; r++) {
      const dy = this.y - floorY(r);
      if (dy <= 0 || dy >= 44) continue;
      const c0 = colOf(this.x), c1 = colOf(nx);
      if (c1 !== c0 && world.support(c1, r) && !world.support(c0, r)) { nx = c1 > c0 ? c1 * TW - 0.5 : (c1 + 1) * TW + 0.5; this.vx = 0; }
    }
    this.x = nx;
    this.y += this.vy * dt;
    if (this.vy > 0 && canGrab && this.tryGrab(world, py - 56, this.y - 56)) return;
    if (this.vy > 0) {
      for (let r = 0; r < world.h + 2; r++) {
        const FL = floorY(r);
        if (py <= FL && this.y >= FL) {
          // 앞발이 모서리에 걸치면 착지로 인정
          let c = colOf(this.x);
          if (!world.support(c, r)) {
            const cf = colOf(this.x + this.f * 7);
            if (cf !== c && world.support(cf, r)) { this.x = this.f > 0 ? cf * TW + 2 : (cf + 1) * TW - 2; c = cf; }
          }
          if (world.support(c, r)) { this.y = FL; this.land(world, r); return; }
        }
      }
    }
    if (this.y > world.h * TH + 140) this.die(world, 'fall');
  }

  tryGrab(world, h0, h1) {
    for (let r = 0; r < world.h; r++) {
      const L = ledgeY(r);
      if (!(h0 <= L + 4 && h1 >= L - 2)) continue;
      const f = this.f;
      const E = f > 0 ? Math.ceil(this.x / TW) * TW : Math.floor(this.x / TW) * TW;
      const dx = (E - this.x) * f;
      if (dx < -3 || dx > 18) continue;
      const cf = f > 0 ? E / TW : E / TW - 1, cb = f > 0 ? E / TW - 1 : E / TW;
      if (!world.support(cf, r) || world.support(cb, r) || world.isWall(cb, r) || world.isWall(cb, r + 1)) continue;
      if (world.gateClosed(cf, r)) continue;
      this.grabAt(world, E, L);
      return true;
    }
    return false;
  }
  grabAt(world, E, L) {
    this.set('hang'); this.grounded = false; this.vx = 0; this.vy = 0;
    this.hangE = E; this.hangL = L; this.x = E - 5 * this.f; this.y = L + 52;
    Sfx.play('step');
    world.trigLoose(this.f > 0 ? E / TW : E / TW - 1, rowOf(L + 3));
  }

  land(world, r) {
    this.grounded = true; this.vx = 0; this.vy = 0;
    const rows = Math.round((this.y - this.airStartY) / TH);
    const c = colOf(this.x), st = world.state(c, r);
    world.trigLoose(c, r);
    if (st && st.kind === 'spikes') { this.die(world, 'spikes', st); return; }
    if (rows >= 3) { Sfx.play('hardland'); this.die(world, 'splat'); return; }
    if (rows === 2) {
      Sfx.play('hardland'); this.damage(world, 1, 0);
      if (this.alive) this.set('hardland', 'hardland');
      return;
    }
    Sfx.play('land');
    world.dust(this.x, this.y, 4);
    this.set('land', 'land');
  }

  damage(world, n, kf) {
    if (!this.alive) return;
    this.hp -= n; this.flash = 0.25;
    Sfx.play(this.isPlayer ? 'hurt' : 'hit');
    if (this.hp <= 0) { this.hp = 0; this.die(world, 'wound'); }
  }
  bonk() {
    // 떨어진 바닥 조각에 머리를 맞음 (웅크리면 무사)
    if (this.state === 'crouch') return;
    this.pendingBonk = true;
  }

  die(world, kind, st) {
    if (!this.alive) return;
    this.alive = false; this.hp = 0; this.deathKind = kind; this.grounded = true; this.vx = 0;
    if (kind === 'spikes') { this.set('dead', null); if (st) st.blood = true; world.blood(this.x, this.y - 10, this.f); }
    else if (kind === 'sliced') { this.set('dead', 'die'); if (st) st.blood = true; world.blood(this.x, this.y - 26, this.f); }
    else if (kind === 'fall') { this.set('gone'); }
    else if (kind === 'shock') { this.set('dead', 'die'); if (st) st.blood = true; this.flash = 0.8; Sfx.play('zap'); }
    else this.set('dead', 'die');
    if (this.isPlayer) Sfx.play('death');
  }

  // 함정 · 바닥 판정 (지상 상태 공통)
  groundChecks(world) {
    if (!this.alive) return;
    const c = colOf(this.x), r = this.row;
    if (GROUND.has(this.state)) {
      this.grounded = true; this.groundY = this.y;
      if (!world.support(c, r)) {
        const running = RUNNING.has(this.state);
        const v = running ? this.f * RUN * 0.6 : this.f * 20;
        this.startFall(world, this.state === 'retreat' || this.state === 'hurt' ? -this.f * 30 : v);
        this.coyote = running ? 0.1 : 0;
        return;
      }
      world.trigLoose(c, r);
      const st = world.state(c, r);
      if (st && st.kind === 'spikes' && st.out > 0.4 && RUNNING.has(this.state)) this.die(world, 'spikes', st);
      if (st && st.kind === 'electric' && st.on && this.alive) this.die(world, 'shock', st);
    }
    for (const cc of [c]) {
      const st = world.state(cc, r);
      if (st && st.kind === 'chomper' && st.close > 0.55 && Math.abs(this.x - (cc * TW + 16)) < 10 && this.state !== 'hang' && this.state !== 'gone') this.die(world, 'sliced', st);
    }
    if (this.pendingBonk) {
      this.pendingBonk = false;
      if (this.alive) { this.damage(world, 1, 0); if (this.alive && GROUND.has(this.state)) this.set('crouch', 'crouchDown'); }
    }
  }

  // 렌더링용 자세 계산
  poseNow() {
    const s = this.state, t = this.t;
    let pose, hip = null;
    const A = (name, time = t) => { const r = sampleAnim(name, time); pose = r.pose; if (r.hip) hip = r.hip; };
    switch (s) {
      case 'run': A('run', this.animT); break;
      case 'air': {
        const u = clamp((this.vy + 150) / 400, 0, 1);
        pose = lerpPose(POSE.jair, POSE.jdesc, u, new Array(11)); break;
      }
      case 'fall': case 'gone': pose = lerpPose(POSE.jdesc, POSE.fall, clamp(t / 0.25, 0, 1), new Array(11)); break;
      case 'hang': {
        pose = POSE.hang.slice();
        const sw = Math.sin(this.t * 3) * 3 * Math.exp(-this.t * 0.8);
        pose[2] += sw; pose[4] += sw;
        hip = [-5, 28];
        break;
      }
      case 'climbup': A('climb', t); break;
      case 'climbdown': A('climb', animLen('climb') - t); break;
      case 'crouch': A(this.anim || 'crouchDown'); break;
      case 'dead':
        if (this.deathKind === 'spikes') pose = POSE.impaled.slice();
        else A('die');
        break;
      case 'engarde': pose = POSE.engarde.slice(); break;
      case 'idle': pose = POSE.stand.slice(); pose[0] += Math.sin(this.t * 2) * 1; break;
      default:
        if (this.anim && ANIM[this.anim]) A(this.anim);
        else pose = POSE.stand.slice();
    }
    if (pose[10] == null && COMBAT.has(s) && this.hasSword) pose[10] = 124;
    return { pose, hip };
  }

  render(ctx, camX, camY) {
    if (this.state === 'gone' && this.y > 99999) return;
    const { pose, hip } = this.poseNow();
    let anchor;
    if (hip) anchor = { type: 'hip', x: this.hangE + hip[0] * this.f, y: this.hangL + hip[1] };
    else anchor = { type: 'ground', x: this.x, y: this.y + this.renderDy };
    const swordOut = pose[10] != null;
    if (!this.hasSword && !this.isPrincess && swordOut && !COMBAT.has(this.state) && this.state !== 'pickup') pose[10] = null;
    Figure.draw(ctx, LOOKS[this.look], pose, this.f, anchor, camX, camY, {
      scabbard: this.hasSword && pose[10] == null && !this.look.startsWith('prin') && this.isPlayer,
      flash: this.flash > 0 && Math.floor(this.flash * 30) % 2 === 0,
      alpha: this.alpha,
    });
  }
}

class Player extends Actor {
  constructor(x, y, f) {
    super(x, y, f, 'survivor');
    this.isPlayer = true;
    this.hp = this.maxHp = 3;
  }

  update(dt, world, game) {
    this.t += dt; this.animT += dt;
    if (this.flash > 0) this.flash -= dt;
    const I = Input, dir = I.dir(), f = this.f;
    const r = this.row, c = colOf(this.x);
    const foe = game.foeFor(this);
    switch (this.state) {
      case 'stand': {
        this.vx = 0;
        if (foe && this.hasSword && Math.abs(foe.x - this.x) < (foe.state === 'idle' ? 84 : 124)) { this.f = sign(foe.x - this.x); this.set('draw', 'draw'); break; }
        const door = world.doors.find((d) => d.c === c && d.r === r && d.open > 0.85);
        if (I.held.up) {
          if (door) { this.set('enter'); this.enterX = c * TW + 16; break; }
          if (dir === f) { this.set('standjump', 'jprep'); break; }
          if (dir === -f) { this.set('turn', 'turn'); break; }
          this.set('jumpup', 'uprep'); break;
        }
        if (I.held.down) {
          if (this.tryClimbDown(world)) break;
          this.set('crouch', 'crouchDown'); break;
        }
        if (I.pressed('action') && this.useItem(world)) break;
        if (dir !== 0) {
          if (dir !== f) { this.set('turn', 'turn'); break; }
          if (I.held.action) { this.beginStep(world); break; }
          this.set('startrun', 'startrun');
        }
        break;
      }
      case 'turn':
        if (this.t >= 0.09 && !this.flipped) { this.f = -this.f; this.flipped = true; }
        if (this.t >= 0.2) {
          if (dir === this.f && !I.held.action && !I.held.up) this.set('startrun', 'startrun');
          else this.set('stand');
        }
        break;
      case 'startrun': {
        const blocked = this.moveBy(world, f * RUN * smooth(clamp(this.t / 0.3, 0, 1)) * dt);
        if (blocked) { this.set('stand'); break; }
        if (I.held.up) { if (this.t < 0.12) this.set('standjump', 'jprep'); else this.set('runjump', 'rjprep'); break; }
        if (this.t >= 0.3) {
          if (dir === f) this.set('run'); else this.set('stoprun', 'stoprun');
          this.animT = 0.02;
        }
        break;
      }
      case 'run': {
        const ph0 = (this.animT - dt) % 0.31, ph1 = this.animT % 0.31;
        if (ph1 < ph0) Sfx.play('step');
        if (I.held.up) { this.set('runjump', 'rjprep'); break; }
        if (this.moveBy(world, f * RUN * dt)) { Sfx.play('land'); this.set('bump', 'land'); break; }
        if (dir === -f) { this.set('runturn', 'runturn'); this.f0 = f; break; }
        if (dir !== f) { this.set('stoprun', 'stoprun'); break; }
        if (I.held.down) { this.vx = f * RUN; this.set('crouch', 'crouchDown'); break; }
        break;
      }
      case 'stoprun':
        if (this.moveBy(world, f * RUN * (1 - smooth(clamp(this.t / 0.32, 0, 1))) * dt * 0.9)) { this.set('stand'); break; }
        if (this.t >= 0.32) this.set('stand');
        break;
      case 'runturn': {
        let v;
        if (this.t < 0.22) v = this.f0 * RUN * (1 - this.t / 0.22) * 0.8;
        else { if (!this.flipped) { this.f = -this.f0; this.flipped = true; } v = this.f * RUN * clamp((this.t - 0.26) / 0.14, 0, 1); }
        this.moveBy(world, v * dt);
        if (this.t >= 0.4) { if (dir === this.f) { this.set('run'); this.animT = 0.02; } else this.set('stoprun', 'stoprun'); }
        break;
      }
      case 'step': {
        const u = smooth(clamp(this.t / 0.45, 0, 1));
        this.moveBy(world, this.stepX0 + f * this.stepD * u - this.x);
        if (this.t >= 0.45) this.set('stand');
        break;
      }
      case 'teeter': if (this.t >= 0.55) this.set('stand'); break;
      case 'bump': if (this.t >= 0.22) this.set('stand'); break;
      case 'crouch':
        if (this.vx) { const v = this.vx * Math.max(0, 1 - this.t / 0.35); this.moveBy(world, v * dt); if (this.t > 0.35) this.vx = 0; }
        if (I.pressed('action') && this.t > 0.1 && this.useItem(world)) break;
        if (!I.held.down && this.t > 0.15) this.set('standup', 'crouchUp');
        break;
      case 'standup': if (this.t >= 0.22) this.set('stand'); break;
      case 'standjump':
        if (this.t >= 0.22) { this.set('air'); this.grounded = false; this.vx = f * 128; this.vy = -205; this.airStartY = this.y; Sfx.play('step'); }
        break;
      case 'runjump':
        this.moveBy(world, f * RUN * dt);
        // 도약 준비 중 모서리를 넘으면 그 자리에서 바로 뛴다 (조금 늦은 입력 보정)
        if (this.t >= 0.12 || !world.support(colOf(this.x), r)) { this.set('air'); this.grounded = false; this.vx = f * 225; this.vy = -265; this.airStartY = this.y; Sfx.play('step'); }
        break;
      case 'air': this.air(dt, world, true); break;
      case 'fall':
        // 달리다 모서리를 막 벗어난 직후의 ↑ 는 도움닫기 점프로 인정
        if (this.coyote > 0 && I.held.up && this.y - this.airStartY < 14) {
          this.coyote = 0; this.set('air'); this.vx = f * 225; this.vy = -250; Sfx.play('step'); break;
        }
        if (this.coyote > 0) this.coyote -= dt;
        this.vx *= Math.pow(0.4, dt); this.air(dt, world, I.held.action); break;
      case 'jumpup':
        // ↑ 직후에 방향키가 들어오면 제자리 멀리뛰기로 (동시에 누르기 보정)
        if (this.t < 0.12 && dir === f) { this.set('standjump', 'jprep'); break; }
        if (this.t >= 0.2 && this.once('reach')) {
          const L = this.findLedgeAbove(world);
          if (L) { this.grabAt(world, L.E, L.L); break; }
        }
        if (this.t >= 0.28) this.set('hop', 'hop');
        break;
      case 'hop': {
        this.renderDy = -12 * Math.sin(Math.PI * clamp(this.t / 0.34, 0, 1));
        if (this.t >= 0.17 && this.once('bonk')) { world.trigLoose(c, r - 1); }
        if (this.t >= 0.34 && this.once('down')) { this.renderDy = 0; Sfx.play('land'); }
        if (this.t >= 0.6) { this.renderDy = 0; this.set('stand'); }
        break;
      }
      case 'hang': {
        const cf = f > 0 ? this.hangE / TW : this.hangE / TW - 1, lr = rowOf(this.hangL + 3);
        if (!world.support(cf, lr)) { this.dropFromHang(world); break; }
        if (I.held.up && this.t > 0.12 && !world.gateClosed(cf, lr)) { this.set('climbup'); Sfx.play('step'); break; }
        if (I.pressT.down > this.hangStart && I.held.down && this.t > 0.15) { this.dropFromHang(world); }
        break;
      }
      case 'climbup':
        if (this.t >= animLen('climb')) {
          this.x = this.hangE + 10 * f; this.y = floorY(rowOf(this.hangL + 3)); this.set('stand'); this.grounded = true;
        }
        break;
      case 'climbdown':
        if (this.t >= animLen('climb')) { this.set('hang'); this.x = this.hangE - 5 * f; this.y = this.hangL + 52; this.t = 0.2; }
        break;
      case 'drink':
        if (this.t >= 0.3 && this.once('take')) { this.item.taken = true; }
        if (this.t >= 0.8 && this.once('fx')) {
          if (this.item.big) { this.maxHp = Math.min(10, this.maxHp + 1); this.hp = this.maxHp; Sfx.play('life'); game.message('혈청을 맞았다! 최대 체력이 늘었다'); }
          else { this.hp = Math.min(this.maxHp, this.hp + 1); Sfx.play('drink'); game.message('응급 처치 — 체력 1 회복', 2); }
        }
        if (this.t >= 1.3) this.set('stand');
        break;
      case 'pickup':
        if (this.t >= 0.32 && this.once('take')) { this.item.taken = true; this.hasSword = true; Sfx.play('sword'); }
        if (this.t >= 1.2) { this.set('stand'); game.message('쇠파이프를 얻었다! 이제 맞서 싸울 수 있다'); }
        break;
      case 'land': if (this.t >= 0.26) this.set('stand'); break;
      case 'hardland': if (this.t >= 0.8) this.set('stand'); break;
      case 'enter':
        this.x += clamp(this.enterX - this.x, -40 * dt, 40 * dt);
        this.alpha = clamp(1 - this.t / 0.9, 0, 1);
        if (this.t >= 1.0 && this.once('exit')) game.levelComplete();
        break;
      case 'cheer': break;
      default:
        if (COMBAT.has(this.state) || this.state === 'sheathe') this.fight(dt, world, game, foe);
    }
    if (this.state !== 'hop') this.renderDy = 0;
    this.groundChecks(world);
  }

  fight(dt, world, game, foe) {
    const I = Input, dir = I.dir();
    if (foe && this.state !== 'hurt') this.f = sign(foe.x - this.x);
    const f = this.f;
    switch (this.state) {
      case 'draw':
        if (this.t >= 0.42) { this.set('engarde'); game.combatHint(); }
        break;
      case 'engarde':
        if (!foe || Math.abs(foe.x - this.x) > 130) { if (this.t > 0.5) this.set('sheathe', 'sheathe'); break; }
        if (I.pressed('up')) { I.consume('up'); this.set('parry', 'parry'); break; }
        if (I.pressed('action')) { I.consume('action'); this.set('strike', 'strike'); Sfx.play('swish'); break; }
        if (I.pressed('down')) { I.consume('down'); this.set('sheathe', 'sheathe'); break; }
        if (dir === f && this.t > 0.05) { this.set('advance', 'advance'); break; }
        if (dir === -f && this.t > 0.05) { this.set('retreat', 'retreat'); break; }
        break;
      case 'advance':
        if (Math.abs(foe ? foe.x - this.x : 99) > 26 && world.edgeDist(this.x, this.row, f) > 10) this.moveBy(world, f * 36 * dt);
        if (I.pressed('action') && this.t > 0.1) { I.consume('action'); this.set('strike', 'strike'); Sfx.play('swish'); break; }
        if (this.t >= 0.28) this.set('engarde');
        break;
      case 'retreat':
        this.moveBy(world, -f * 36 * dt);
        if (I.pressed('up')) { I.consume('up'); this.set('parry', 'parry'); break; }
        if (this.t >= 0.28) this.set('engarde');
        break;
      case 'strike':
        if (this.t >= 0.22 && this.once('hit') && foe) Combat.strike(this, foe, world, game);
        if (this.t >= 0.5) this.set('engarde');
        break;
      case 'parry':
        if (this.riposte && I.pressed('action')) { I.consume('action'); this.riposte = false; this.set('strike', 'strike'); Sfx.play('swish'); break; }
        if (this.t >= 0.42) { this.riposte = false; this.set('engarde'); }
        break;
      case 'hurt':
        if (this.t < 0.16) this.moveBy(world, -f * 50 * dt);
        if (this.t >= 0.38) this.set(this.hasSword ? 'engarde' : 'stand');
        break;
      case 'bounce': if (this.t >= 0.34) this.set('engarde'); break;
      case 'sheathe': if (this.t >= 0.4) this.set('stand'); break;
    }
  }

  beginStep(world) {
    const r = this.row, f = this.f;
    const ed = world.edgeDist(this.x, r, f), wd = world.wallDist(this.x, r, f);
    const d = Math.min(11, ed - 3, wd);
    if (d < 1) { this.set('teeter', 'teeter'); return; }
    this.stepX0 = this.x; this.stepD = d;
    this.set('step', 'step');
  }

  useItem(world) {
    const c = colOf(this.x), st = world.state(c, this.row);
    if (!st || st.taken) return false;
    if (st.kind === 'potion') { this.item = st; this.set('drink', 'heal'); return true; }
    if (st.kind === 'sword') { this.item = st; this.set('pickup', 'pickup'); return true; }
    return false;
  }

  findLedgeAbove(world) {
    const r = this.row, f = this.f, c = colOf(this.x);
    if (r <= 0) return null;
    const L = ledgeY(r - 1);
    const tryEdge = (E, ff) => {
      const cf = ff > 0 ? E / TW : E / TW - 1, cb = ff > 0 ? E / TW - 1 : E / TW;
      const dx = (E - this.x) * ff;
      if (dx < -4 || dx > 28) return null;
      if (!world.support(cf, r - 1) || world.support(cb, r - 1) || world.isWall(cb, r - 1)) return null;
      return { E, L };
    };
    return tryEdge(f > 0 ? (c + 1) * TW : c * TW, f) || tryEdge(f > 0 ? c * TW : (c + 1) * TW, f);
  }

  tryClimbDown(world) {
    const r = this.row, f = this.f, c = colOf(this.x);
    // 등 뒤의 모서리
    const E = f > 0 ? c * TW : (c + 1) * TW;
    const cb = f > 0 ? c - 1 : c + 1;
    if (Math.abs(this.x - E) > 18) return false;
    if (world.support(cb, r) || world.isWall(cb, r) || world.isWall(cb, r + 1) || r + 1 >= world.h + 1) return false;
    this.hangE = E; this.hangL = ledgeY(r);
    this.set('climbdown'); this.grounded = false;
    Sfx.play('step');
    return true;
  }

  dropFromHang(world) {
    this.x = this.hangE - 9 * this.f; this.y = this.hangL + 52;
    this.startFall(world, 0); this.airStartY = this.y;
  }
}
