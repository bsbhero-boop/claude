import { V3 } from './math';

export interface Proj {
  x: number;
  y: number;
  /** 깊이(m) */
  d: number;
  /** 1m 당 픽셀 */
  s: number;
}

/** 원근 투영 카메라. 좌표계: x,y 지면, z 위쪽. */
export class Camera {
  px = 52.5;
  py = 100;
  pz = 25;
  // forward / right / up 기저
  fx = 0;
  fy = -1;
  fz = 0;
  rx = 1;
  ry = 0;
  rz = 0;
  ux = 0;
  uy = 0;
  uz = 1;
  focal = 1000;
  cx = 640;
  cy = 360;
  near = 0.5;

  setViewport(w: number, h: number) {
    this.cx = w / 2;
    this.cy = h / 2;
  }

  lookAt(px: number, py: number, pz: number, tx: number, ty: number, tz: number) {
    this.px = px;
    this.py = py;
    this.pz = pz;
    let fx = tx - px;
    let fy = ty - py;
    let fz = tz - pz;
    const fl = Math.hypot(fx, fy, fz);
    fx /= fl;
    fy /= fl;
    fz /= fl;
    // right = Z × f
    let rx = -fy;
    let ry = fx;
    const rl = Math.hypot(rx, ry) || 1;
    rx /= rl;
    ry /= rl;
    // up = f × right
    const ux = fy * 0 - fz * ry;
    const uy = fz * rx - fx * 0;
    const uz = fx * ry - fy * rx;
    this.fx = fx;
    this.fy = fy;
    this.fz = fz;
    this.rx = rx;
    this.ry = ry;
    this.rz = 0;
    this.ux = ux;
    this.uy = uy;
    this.uz = uz;
  }

  /** 카메라 공간 (오른쪽, 위, 깊이) */
  toCam(x: number, y: number, z: number): V3 {
    const dx = x - this.px;
    const dy = y - this.py;
    const dz = z - this.pz;
    return {
      x: dx * this.rx + dy * this.ry + dz * this.rz,
      y: dx * this.ux + dy * this.uy + dz * this.uz,
      z: dx * this.fx + dy * this.fy + dz * this.fz,
    };
  }

  project(x: number, y: number, z: number, out: Proj): boolean {
    const dx = x - this.px;
    const dy = y - this.py;
    const dz = z - this.pz;
    const d = dx * this.fx + dy * this.fy + dz * this.fz;
    if (d < this.near) {
      out.d = d;
      return false;
    }
    const sx = dx * this.rx + dy * this.ry + dz * this.rz;
    const sy = dx * this.ux + dy * this.uy + dz * this.uz;
    const s = this.focal / d;
    out.x = this.cx + sx * s;
    out.y = this.cy - sy * s;
    out.d = d;
    out.s = s;
    return true;
  }

  /** 근평면 클리핑 후 화면 좌표 다각형 반환 */
  projectPoly(pts: number[][]): [number, number][] | null {
    const cam = pts.map((p) => this.toCam(p[0], p[1], p[2]));
    const clipped: V3[] = [];
    const n = cam.length;
    for (let i = 0; i < n; i++) {
      const a = cam[i];
      const b = cam[(i + 1) % n];
      const ain = a.z >= this.near;
      const bin = b.z >= this.near;
      if (ain) clipped.push(a);
      if (ain !== bin) {
        const t = (this.near - a.z) / (b.z - a.z);
        clipped.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: this.near });
      }
    }
    if (clipped.length < 3) return null;
    return clipped.map((c) => [this.cx + (c.x * this.focal) / c.z, this.cy - (c.y * this.focal) / c.z]);
  }

  /** 선분 (클리핑 포함) */
  projectLine(a: number[], b: number[]): [number, number, number, number] | null {
    let ca = this.toCam(a[0], a[1], a[2]);
    let cb = this.toCam(b[0], b[1], b[2]);
    if (ca.z < this.near && cb.z < this.near) return null;
    if (ca.z < this.near) {
      const t = (this.near - ca.z) / (cb.z - ca.z);
      ca = { x: ca.x + (cb.x - ca.x) * t, y: ca.y + (cb.y - ca.y) * t, z: this.near };
    } else if (cb.z < this.near) {
      const t = (this.near - cb.z) / (ca.z - cb.z);
      cb = { x: cb.x + (ca.x - cb.x) * t, y: cb.y + (ca.y - cb.y) * t, z: this.near };
    }
    return [
      this.cx + (ca.x * this.focal) / ca.z,
      this.cy - (ca.y * this.focal) / ca.z,
      this.cx + (cb.x * this.focal) / cb.z,
      this.cy - (cb.y * this.focal) / cb.z,
    ];
  }

  /** 화면 → 지면(z=0) 역투영 */
  unproject(sx: number, sy: number): { x: number; y: number } | null {
    const vx = (sx - this.cx) / this.focal;
    const vy = -(sy - this.cy) / this.focal;
    const dx = this.fx + this.rx * vx + this.ux * vy;
    const dy = this.fy + this.ry * vx + this.uy * vy;
    const dz = this.fz + this.rz * vx + this.uz * vy;
    if (dz >= -1e-6) return null;
    const t = -this.pz / dz;
    return { x: this.px + dx * t, y: this.py + dy * t };
  }
}
