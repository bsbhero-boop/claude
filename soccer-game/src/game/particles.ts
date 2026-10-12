import { rand } from './math';

export type PKind = 'spark' | 'flame' | 'smoke' | 'ice' | 'confetti' | 'glow' | 'leaf' | 'star' | 'shard';

export interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  grow: number;
  color: string;
  color2: string;
  kind: PKind;
  gravity: number;
  drag: number;
  rot: number;
  vrot: number;
  additive: boolean;
}

/** 지면에 퍼지는 충격파 링 */
export interface Ring {
  x: number;
  y: number;
  z: number;
  r: number;
  vr: number;
  life: number;
  max: number;
  color: string;
  width: number;
  vertical?: boolean;
}

/** 번개 등 월드 좌표 폴리라인 */
export interface Bolt {
  pts: number[][];
  life: number;
  max: number;
  color: string;
  width: number;
}

const MAX = 2200;

export class Particles {
  list: Particle[] = [];
  rings: Ring[] = [];
  bolts: Bolt[] = [];
  private pool: Particle[] = [];

  spawn(p: Partial<Particle> & { x: number; y: number; z: number }) {
    if (this.list.length >= MAX) return;
    const q = this.pool.pop() ?? ({} as Particle);
    q.x = p.x;
    q.y = p.y;
    q.z = p.z;
    q.vx = p.vx ?? 0;
    q.vy = p.vy ?? 0;
    q.vz = p.vz ?? 0;
    q.max = q.life = p.life ?? 1;
    q.size = p.size ?? 0.2;
    q.grow = p.grow ?? 0;
    q.color = p.color ?? '#fff';
    q.color2 = p.color2 ?? q.color;
    q.kind = p.kind ?? 'spark';
    q.gravity = p.gravity ?? 0;
    q.drag = p.drag ?? 0.5;
    q.rot = p.rot ?? rand(0, Math.PI * 2);
    q.vrot = p.vrot ?? rand(-6, 6);
    q.additive = p.additive ?? true;
    this.list.push(q);
  }

  ring(x: number, y: number, z: number, color: string, opts: Partial<Ring> = {}) {
    this.rings.push({
      x,
      y,
      z,
      r: opts.r ?? 0.3,
      vr: opts.vr ?? 12,
      life: opts.life ?? 0.6,
      max: opts.life ?? 0.6,
      color,
      width: opts.width ?? 4,
      vertical: opts.vertical,
    });
  }

  bolt(pts: number[][], color: string, life = 0.25, width = 3) {
    this.bolts.push({ pts, life, max: life, color, width });
  }

  /** 두 점 사이를 지그재그 번개로 */
  lightning(ax: number, ay: number, az: number, bx: number, by: number, bz: number, color: string, jag = 1.2, life = 0.22) {
    const n = 8;
    const pts: number[][] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const j = i === 0 || i === n ? 0 : jag;
      pts.push([ax + (bx - ax) * t + rand(-j, j), ay + (by - ay) * t + rand(-j, j), Math.max(0, az + (bz - az) * t + rand(-j, j) * 0.6)]);
    }
    this.bolt(pts, color, life, 3);
  }

  burst(x: number, y: number, z: number, n: number, colors: string[], speed = 8, kind: PKind = 'spark', life = 0.8, size = 0.18) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const b = rand(-0.3, 1.2);
      const s = rand(0.3, 1) * speed;
      this.spawn({
        x,
        y,
        z,
        vx: Math.cos(a) * Math.cos(b) * s,
        vy: Math.sin(a) * Math.cos(b) * s,
        vz: Math.sin(b) * s,
        life: rand(0.5, 1) * life,
        size: rand(0.6, 1.2) * size,
        color: colors[i % colors.length],
        kind,
        gravity: kind === 'confetti' ? 3 : kind === 'flame' || kind === 'smoke' ? -2 : 9,
        drag: kind === 'confetti' ? 1.6 : 1.2,
      });
    }
  }

  confetti(x: number, y: number, n: number, colors: string[]) {
    for (let i = 0; i < n; i++) {
      this.spawn({
        x: x + rand(-6, 6),
        y: y + rand(-6, 6),
        z: rand(4, 12),
        vx: rand(-3, 3),
        vy: rand(-3, 3),
        vz: rand(-1, 3),
        life: rand(2, 4),
        size: rand(0.12, 0.22),
        color: colors[i % colors.length],
        kind: 'confetti',
        gravity: 2.2,
        drag: 1.4,
        additive: false,
      });
    }
  }

  update(dt: number) {
    const l = this.list;
    for (let i = l.length - 1; i >= 0; i--) {
      const p = l[i];
      p.life -= dt;
      if (p.life <= 0) {
        l[i] = l[l.length - 1];
        l.pop();
        this.pool.push(p);
        continue;
      }
      const k = Math.exp(-p.drag * dt);
      p.vx *= k;
      p.vy *= k;
      p.vz = p.vz * k - p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.z < 0) {
        p.z = 0;
        p.vz *= -0.3;
        p.vx *= 0.6;
        p.vy *= 0.6;
      }
      p.size += p.grow * dt;
      p.rot += p.vrot * dt;
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      r.r += r.vr * dt;
      if (r.life <= 0) this.rings.splice(i, 1);
    }
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.life -= dt;
      if (b.life <= 0) this.bolts.splice(i, 1);
    }
  }

  clear() {
    for (const p of this.list) this.pool.push(p);
    this.list.length = 0;
    this.rings.length = 0;
    this.bolts.length = 0;
  }
}
