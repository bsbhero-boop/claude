import { SPECIAL_COLORS } from './actions';
import { Camera, Proj } from './camera';
import {
  BALL_R,
  BOX_DEPTH,
  BOX_HALF_W,
  CIRCLE_R,
  CX,
  CY,
  GOAL_DEPTH,
  GOAL_H,
  GOAL_HALF_W,
  PEN_SPOT,
  PITCH_L,
  PITCH_W,
  SIX_DEPTH,
  SIX_HALF_W,
} from './constants';
import type { Player, TeamState } from './entities';
import { clamp, rand } from './math';
import type { Match } from './match';
import type { Particle } from './particles';
import { SPECIAL_LABEL } from '../data/teams';

export const FONT_DISPLAY = '"Black Han Sans", "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
export const FONT_NUM = '"Russo One", "Black Han Sans", "Noto Sans KR", sans-serif';
export const FONT_BODY = '"Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';

const BODY_SCALE = 1.3;

interface Drawable {
  d: number;
  draw: () => void;
}

export class Renderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  w = 0;
  h = 0;
  dpr = 1;
  cam = new Camera();
  wide = false;
  /** 터치 조작 화면: HUD를 위쪽으로 모으고 키 안내를 숨긴다 */
  touchMode = false;
  private crowdPattern: CanvasPattern | null = null;
  private crowdKey = '';
  private sprites = new Map<string, HTMLCanvasElement>();
  private dragonTrail: { x: number; y: number; z: number }[] = [];
  private time = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.resize();
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = this.canvas.getBoundingClientRect();
    this.w = Math.max(320, r.width);
    this.h = Math.max(240, r.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
  }

  private proj(x: number, y: number, z: number): Proj | null {
    const p: Proj = { x: 0, y: 0, d: 0, s: 0 };
    return this.cam.project(x, y, z, p) ? p : null;
  }

  private setupCamera(m: Match) {
    const c = this.cam;
    c.setViewport(this.w, this.h);
    if (m.cam.mode === 'penalty') {
      c.lookAt(PEN_SPOT + 15, CY + 3.2, 4.3, 0, CY, 0.9);
      c.focal = Math.min(this.h * 2.3, this.w * 1.6);
      return;
    }
    const z = m.cam.zoom;
    const tx = m.cam.x;
    const ty = m.cam.y;
    const camY = PITCH_W + 33;
    const camZ = 33;
    const lookY = clamp(ty, 8, 60) * 0.88 + CY * 0.12;
    c.lookAt(tx, camY, camZ, tx, lookY, 0);
    const portrait = this.h > this.w;
    c.focal = (portrait ? this.w * 2.0 : Math.min(this.h * 2.45, this.w * 1.5)) * z * (this.wide ? 0.78 : 1);
    // 세로 화면/터치 화면에서는 시점을 위로 올려 아래쪽 컨트롤에 공이 가리지 않게
    if (portrait) c.cy = this.h * 0.38;
    else if (this.touchMode) c.cy = this.h * 0.46;
  }

  // ─────────────────────────────── 메인 ───────────────────────────────

  render(m: Match, dt: number) {
    this.time += dt;
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.setupCamera(m);
    this.ensureCrowd(m);
    ctx.save();
    if (m.fx.shake > 0) {
      const a = m.fx.shake * 9;
      ctx.translate(rand(-a, a), rand(-a, a));
    }
    this.drawSky(m);
    this.drawStands(m);
    this.drawGround(m);
    this.drawPitch();
    this.drawBoards(m);
    this.drawGoalBack(0);
    this.drawGoalBack(PITCH_L);
    this.drawShadows(m);
    this.drawRings(m, true);
    this.drawSelection(m);
    this.drawEntities(m);
    this.drawParticles(m);
    this.drawRings(m, false);
    this.drawBolts(m);
    this.drawSpecialExtras(m);
    this.drawPopups(m);
    ctx.restore();
    this.drawOverlays(m);
    if (m.phase === 'shootout') this.drawShootoutHud(m);
    else this.drawHud(m);
    if (m.cutin) this.drawCutin(m);
    this.drawBanner(m);
  }

  // ─────────────────────────────── 배경 ───────────────────────────────

  private drawSky(m: Match) {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, 0, 0, this.h * 0.5);
    if (m.cfg.night) {
      g.addColorStop(0, '#05060d');
      g.addColorStop(1, '#141a33');
    } else {
      g.addColorStop(0, '#5d8fd6');
      g.addColorStop(1, '#bcd4f0');
    }
    ctx.fillStyle = g;
    ctx.fillRect(-20, -20, this.w + 40, this.h + 40);
  }

  private ensureCrowd(m: Match) {
    const key = m.teams[0].kit.shirt + m.teams[1].kit.shirt + (m.cfg.night ? 'n' : 'd');
    if (this.crowdKey === key) return;
    this.crowdKey = key;
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = m.cfg.night ? '#11131c' : '#2a2d38';
    g.fillRect(0, 0, 256, 128);
    const cols = [m.teams[0].kit.shirt, m.teams[0].kit.shirt, m.teams[1].kit.shirt, '#d8d8d8', '#3a3f55', '#7a3030', '#2f4f7a', '#c9b37a'];
    for (let row = 0; row < 16; row++) {
      for (let i = 0; i < 44; i++) {
        const x = i * 5.8 + (row % 2) * 2.9 + rand(-0.8, 0.8);
        const y = row * 8 + 3;
        g.fillStyle = cols[Math.floor(Math.random() * cols.length)];
        g.fillRect(x - 2, y + 1, 4.2, 4);
        g.fillStyle = Math.random() < 0.5 ? '#e7c09a' : '#a77852';
        g.beginPath();
        g.arc(x, y, 1.7, 0, Math.PI * 2);
        g.fill();
      }
    }
    // 깃발/현수막
    for (let i = 0; i < 6; i++) {
      g.fillStyle = cols[i % 3];
      g.globalAlpha = 0.8;
      g.fillRect(rand(0, 220), rand(0, 110), rand(14, 34), rand(5, 9));
    }
    g.globalAlpha = 1;
    this.crowdPattern = this.ctx.createPattern(c, 'repeat');
  }

  private fillPoly(pts: number[][], style: string | CanvasPattern | CanvasGradient) {
    const sp = this.cam.projectPoly(pts);
    if (!sp) return null;
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(sp[0][0], sp[0][1]);
    for (let i = 1; i < sp.length; i++) ctx.lineTo(sp[i][0], sp[i][1]);
    ctx.closePath();
    ctx.fillStyle = style;
    ctx.fill();
    return sp;
  }

  private drawStands(m: Match) {
    const ctx = this.ctx;
    const pat = this.crowdPattern;
    const night = m.cfg.night;
    const bounce = m.phase === 'goal' ? Math.abs(Math.sin(this.time * 9)) * 4 : Math.sin(this.time * 2) * 0.6;
    const standFill = (pts: number[][], depthHint: Proj | null) => {
      if (!pat) return;
      const s = depthHint ? clamp(depthHint.s / 14, 0.25, 4) : 1;
      pat.setTransform(new DOMMatrix().translateSelf(0, bounce).scaleSelf(s, s));
      const sp = this.fillPoly(pts, pat);
      if (sp) {
        // 위쪽은 어둡게
        const ys = sp.map((q) => q[1]);
        const top = Math.min(...ys);
        const bot = Math.max(...ys);
        const g = ctx.createLinearGradient(0, top, 0, bot);
        g.addColorStop(0, night ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.35)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fill();
      }
    };
    const pen = m.cam.mode === 'penalty';
    // 먼 쪽 관중석 (y < 0)
    standFill(
      [
        [-40, -6, 1.2],
        [PITCH_L + 40, -6, 1.2],
        [PITCH_L + 40, -36, 22],
        [-40, -36, 22],
      ],
      this.proj(this.cam.px, -20, 10),
    );
    // 지붕
    this.fillPoly(
      [
        [-40, -36, 22],
        [PITCH_L + 40, -36, 22],
        [PITCH_L + 40, -40, 30],
        [-40, -40, 30],
      ],
      night ? '#0a0b12' : '#3b3f4a',
    );
    // 양쪽 끝 관중석
    for (const side of [0, 1]) {
      const x0 = side === 0 ? -7 : PITCH_L + 7;
      const x1 = side === 0 ? -34 : PITCH_L + 34;
      standFill(
        [
          [x0, -6, 1.2],
          [x0, PITCH_W + 6, 1.2],
          [x1, PITCH_W + 6, 22],
          [x1, -6, 22],
        ],
        this.proj(x0 + (x1 - x0) * 0.5, CY, 10),
      );
    }
    if (pen) {
      // 카메라 쪽 관중석 (승부차기 시점에서만 보임)
      standFill(
        [
          [-40, PITCH_W + 6, 1.2],
          [-40, PITCH_W + 36, 22],
          [60, PITCH_W + 36, 22],
          [60, PITCH_W + 6, 1.2],
        ],
        this.proj(0, PITCH_W + 20, 10),
      );
    }
    // 조명탑 빛
    if (night) {
      for (const lx of [-10, PITCH_L + 10]) {
        for (const ly of [-38, PITCH_W + 38]) {
          const p = this.proj(lx, ly, 42);
          if (!p) continue;
          const r = Math.max(40, p.s * 26);
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
          g.addColorStop(0, 'rgba(255,255,240,0.9)');
          g.addColorStop(0.15, 'rgba(255,250,220,0.35)');
          g.addColorStop(1, 'rgba(255,250,220,0)');
          ctx.fillStyle = g;
          ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
        }
      }
    }
  }

  private drawGround(m: Match) {
    this.fillPoly(
      [
        [-40, -6, 0],
        [PITCH_L + 40, -6, 0],
        [PITCH_L + 40, PITCH_W + 40, 0],
        [-40, PITCH_W + 40, 0],
      ],
      m.cfg.night ? '#23562a' : '#2f6e33',
    );
  }

  private drawPitch() {
    const night = this.crowdKey.endsWith('n');
    const c1 = night ? '#2f8136' : '#3c9440';
    const c2 = night ? '#378f3e' : '#45a249';
    const n = 18;
    const sw = PITCH_L / n;
    for (let i = 0; i < n; i++) {
      this.fillPoly(
        [
          [i * sw, 0, 0],
          [(i + 1) * sw, 0, 0],
          [(i + 1) * sw, PITCH_W, 0],
          [i * sw, PITCH_W, 0],
        ],
        i % 2 ? c1 : c2,
      );
    }
    // 은은한 조명 그라데이션
    const ctx = this.ctx;
    const ctr = this.proj(this.cam.px, CY, 0);
    if (ctr) {
      const g = ctx.createRadialGradient(ctr.x, ctr.y, 0, ctr.x, ctr.y, this.w * 0.8);
      g.addColorStop(0, 'rgba(255,255,230,0.07)');
      g.addColorStop(1, 'rgba(0,0,0,0.12)');
      this.fillPoly(
        [
          [-2, -2, 0],
          [PITCH_L + 2, -2, 0],
          [PITCH_L + 2, PITCH_W + 2, 0],
          [-2, PITCH_W + 2, 0],
        ],
        g,
      );
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.88)';
    ctx.lineCap = 'round';
    const line = (pts: number[][]) => {
      for (let i = 0; i < pts.length - 1; i++) {
        const l = this.cam.projectLine(pts[i], pts[i + 1]);
        if (!l) continue;
        const mid = this.proj((pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2, 0);
        ctx.lineWidth = mid ? clamp(0.13 * mid.s, 0.8, 6) : 1;
        ctx.beginPath();
        ctx.moveTo(l[0], l[1]);
        ctx.lineTo(l[2], l[3]);
        ctx.stroke();
      }
    };
    const rect = (x0: number, y0: number, x1: number, y1: number) =>
      line([
        [x0, y0, 0],
        [x1, y0, 0],
        [x1, y1, 0],
        [x0, y1, 0],
        [x0, y0, 0],
      ]);
    const arc = (cx: number, cy: number, r: number, a0: number, a1: number, segs = 40) => {
      const pts: number[][] = [];
      for (let i = 0; i <= segs; i++) {
        const a = a0 + ((a1 - a0) * i) / segs;
        pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, 0]);
      }
      line(pts);
    };
    rect(0, 0, PITCH_L, PITCH_W);
    line([
      [CX, 0, 0],
      [CX, PITCH_W, 0],
    ]);
    arc(CX, CY, CIRCLE_R, 0, Math.PI * 2, 56);
    for (const side of [0, 1]) {
      const gx = side === 0 ? 0 : PITCH_L;
      const dir = side === 0 ? 1 : -1;
      rect(gx, CY - BOX_HALF_W, gx + dir * BOX_DEPTH, CY + BOX_HALF_W);
      rect(gx, CY - SIX_HALF_W, gx + dir * SIX_DEPTH, CY + SIX_HALF_W);
      const px = gx + dir * PEN_SPOT;
      // 페널티 아크
      const ang = Math.acos((BOX_DEPTH - PEN_SPOT) / CIRCLE_R);
      if (side === 0) arc(px, CY, CIRCLE_R, -ang, ang, 20);
      else arc(px, CY, CIRCLE_R, Math.PI - ang, Math.PI + ang, 20);
      this.dot(px, CY, 0.2);
      // 코너 아크
      for (const cy of [0, PITCH_W]) {
        const a0 = side === 0 ? (cy === 0 ? 0 : -Math.PI / 2) : cy === 0 ? Math.PI / 2 : Math.PI;
        arc(gx, cy, 1, a0, a0 + Math.PI / 2, 8);
      }
    }
    this.dot(CX, CY, 0.25);
  }

  private dot(x: number, y: number, r: number) {
    const p = this.proj(x, y, 0);
    if (!p) return;
    this.ctx.fillStyle = 'rgba(255,255,255,0.9)';
    this.ctx.beginPath();
    this.ctx.ellipse(p.x, p.y, Math.max(1, r * p.s), Math.max(0.6, r * p.s * 0.45), 0, 0, Math.PI * 2);
    this.ctx.fill();
  }

  private drawBoards(m: Match) {
    const ctx = this.ctx;
    const texts = ['BLAZE ELEVEN', '필살 축구', `${m.teams[0].def.name} vs ${m.teams[1].def.name}`, 'LEGEND CUP 2026', '열정의 한판', 'FAIR PLAY'];
    const seg = 12;
    const y = -3.4;
    for (let i = 0; i < Math.ceil((PITCH_L + 20) / seg); i++) {
      const x0 = -10 + i * seg;
      const x1 = x0 + seg - 0.2;
      const night = m.cfg.night;
      const hue = (i * 47 + Math.floor(this.time * 0.25) * 90) % 360;
      const sp = this.fillPoly(
        [
          [x0, y, 0],
          [x1, y, 0],
          [x1, y, 1.0],
          [x0, y, 1.0],
        ],
        `hsl(${hue}, 70%, ${night ? 40 : 34}%)`,
      );
      if (!sp) continue;
      const c = this.proj((x0 + x1) / 2, y, 0.5);
      if (!c) continue;
      const fs = clamp(c.s * 0.62, 6, 40);
      ctx.font = `${fs}px ${FONT_DISPLAY}`;
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(texts[i % texts.length], c.x, c.y);
    }
    // 골대 뒤 광고판
    for (const gx of [-4.5, PITCH_L + 4.5]) {
      this.fillPoly(
        [
          [gx, CY - 18, 0],
          [gx, CY + 18, 0],
          [gx, CY + 18, 1],
          [gx, CY - 18, 1],
        ],
        m.cfg.night ? '#1d3a8a' : '#18306f',
      );
    }
  }

  // ─────────────────────────────── 골대 ───────────────────────────────

  private drawGoalBack(gx: number) {
    const ctx = this.ctx;
    const dir = gx === 0 ? -1 : 1;
    const bx = gx + dir * GOAL_DEPTH;
    const y0 = CY - GOAL_HALF_W;
    const y1 = CY + GOAL_HALF_W;
    ctx.strokeStyle = 'rgba(240,240,255,0.32)';
    ctx.lineWidth = 1;
    const net = (a: number[], b: number[], c: number[], d: number[], nu: number, nv: number) => {
      // a-b-c-d 사각형 그물
      ctx.beginPath();
      for (let i = 0; i <= nu; i++) {
        const t = i / nu;
        const p0 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
        const p1 = [d[0] + (c[0] - d[0]) * t, d[1] + (c[1] - d[1]) * t, d[2] + (c[2] - d[2]) * t];
        const l = this.cam.projectLine(p0, p1);
        if (l) {
          ctx.moveTo(l[0], l[1]);
          ctx.lineTo(l[2], l[3]);
        }
      }
      for (let j = 0; j <= nv; j++) {
        const t = j / nv;
        const p0 = [a[0] + (d[0] - a[0]) * t, a[1] + (d[1] - a[1]) * t, a[2] + (d[2] - a[2]) * t];
        const p1 = [b[0] + (c[0] - b[0]) * t, b[1] + (c[1] - b[1]) * t, b[2] + (c[2] - b[2]) * t];
        const l = this.cam.projectLine(p0, p1);
        if (l) {
          ctx.moveTo(l[0], l[1]);
          ctx.lineTo(l[2], l[3]);
        }
      }
      ctx.stroke();
    };
    // 뒷그물
    this.fillPoly(
      [
        [bx, y0, 0],
        [bx, y1, 0],
        [bx, y1, GOAL_H * 0.8],
        [bx, y0, GOAL_H * 0.8],
      ],
      'rgba(255,255,255,0.06)',
    );
    net([bx, y0, 0], [bx, y1, 0], [bx, y1, GOAL_H * 0.8], [bx, y0, GOAL_H * 0.8], 18, 7);
    // 지붕
    net([gx, y0, GOAL_H], [gx, y1, GOAL_H], [bx, y1, GOAL_H * 0.8], [bx, y0, GOAL_H * 0.8], 18, 4);
    // 옆그물
    net([gx, y0, 0], [bx, y0, 0], [bx, y0, GOAL_H * 0.8], [gx, y0, GOAL_H], 5, 7);
    net([gx, y1, 0], [bx, y1, 0], [bx, y1, GOAL_H * 0.8], [gx, y1, GOAL_H], 5, 7);
  }

  private drawGoalFrame(gx: number, which: 'far' | 'near' | 'bar') {
    const ctx = this.ctx;
    const y0 = CY - GOAL_HALF_W;
    const y1 = CY + GOAL_HALF_W;
    ctx.strokeStyle = '#f4f6fa';
    ctx.lineCap = 'round';
    const seg = (a: number[], b: number[]) => {
      const l = this.cam.projectLine(a, b);
      const mid = this.proj((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
      if (!l || !mid) return;
      ctx.lineWidth = Math.max(1.5, 0.13 * mid.s);
      ctx.beginPath();
      ctx.moveTo(l[0], l[1]);
      ctx.lineTo(l[2], l[3]);
      ctx.stroke();
    };
    if (which === 'far') seg([gx, y0, 0], [gx, y0, GOAL_H]);
    else if (which === 'near') seg([gx, y1, 0], [gx, y1, GOAL_H]);
    else seg([gx, y0, GOAL_H], [gx, y1, GOAL_H]);
  }

  // ─────────────────────────────── 그림자/선택 ───────────────────────────────

  private drawShadows(m: Match) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    for (const t of m.teams)
      for (const p of t.active) {
        const q = this.proj(p.x + 0.25, p.y - 0.2, 0);
        if (!q) continue;
        const lying = p.state === 'down' || p.state === 'slide' || p.state === 'dive';
        ctx.beginPath();
        ctx.ellipse(q.x, q.y, (lying ? 1.0 : 0.45) * q.s, 0.18 * q.s, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    const b = m.ball;
    const q = this.proj(b.x + b.z * 0.25, b.y - b.z * 0.15, 0);
    if (q) {
      const k = clamp(1 - b.z / 12, 0.25, 1);
      ctx.fillStyle = `rgba(0,0,0,${0.35 * k})`;
      ctx.beginPath();
      ctx.ellipse(q.x, q.y, BALL_R * 2.1 * q.s * (1 + b.z * 0.05), BALL_R * 0.9 * q.s, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawSelection(m: Match) {
    const ctx = this.ctx;
    if (m.phase === 'shootout' || m.phase === 'replay') return;
    for (const t of m.teams) {
      if (!t.human || !t.controlled) continue;
      const p = t.controlled;
      const q = this.proj(p.x, p.y, 0.02);
      if (!q) continue;
      const pulse = 1 + Math.sin(this.time * 8) * 0.06;
      ctx.lineWidth = Math.max(2, 0.09 * q.s);
      ctx.strokeStyle = '#ffe14d';
      ctx.beginPath();
      ctx.ellipse(q.x, q.y, 0.75 * q.s * pulse, 0.3 * q.s * pulse, 0, 0, Math.PI * 2);
      ctx.stroke();
      // 진행 방향 화살표
      const a = this.proj(p.x + Math.cos(p.facing) * 1.25, p.y + Math.sin(p.facing) * 1.25, 0.02);
      if (a) {
        ctx.fillStyle = '#ffe14d';
        const ang = Math.atan2(a.y - q.y, a.x - q.x);
        ctx.beginPath();
        ctx.moveTo(a.x + Math.cos(ang) * 6, a.y + Math.sin(ang) * 6);
        ctx.lineTo(a.x + Math.cos(ang + 2.4) * 7, a.y + Math.sin(ang + 2.4) * 7);
        ctx.lineTo(a.x + Math.cos(ang - 2.4) * 7, a.y + Math.sin(ang - 2.4) * 7);
        ctx.fill();
      }
    }
  }

  // ─────────────────────────────── 엔티티 ───────────────────────────────

  private drawEntities(m: Match) {
    const list: Drawable[] = [];
    for (const t of m.teams)
      for (const p of t.active) {
        const q = this.proj(p.x, p.y, 0);
        if (!q) continue;
        list.push({ d: q.d, draw: () => this.drawPlayer(m, p, q) });
      }
    const b = m.ball;
    const bq = this.proj(b.x, b.y, b.z + BALL_R);
    if (bq) list.push({ d: bq.d - 0.05, draw: () => this.drawBall(m, bq) });
    for (const gx of [0, PITCH_L]) {
      const far = this.proj(gx, CY - GOAL_HALF_W, 1);
      const near = this.proj(gx, CY + GOAL_HALF_W, 1);
      if (far) list.push({ d: far.d, draw: () => this.drawGoalFrame(gx, 'far') });
      if (near) list.push({ d: near.d, draw: () => this.drawGoalFrame(gx, 'near') });
      const bar = this.proj(gx, CY, GOAL_H);
      if (bar) list.push({ d: Math.min(far?.d ?? 1e9, near?.d ?? 1e9) - 0.01, draw: () => this.drawGoalFrame(gx, 'bar') });
    }
    list.sort((a, c) => c.d - a.d);
    for (const it of list) it.draw();
  }

  private kitOf(p: Player) {
    const t = p.team;
    if (p.isGK) return { shirt: t.def.gkShirt, shorts: '#1b1b22', socks: t.def.gkShirt, accent: '#ffffff', stripes: false };
    return t.kit;
  }

  drawPlayer(m: Match, p: Player, q: Proj, ctxOverride?: CanvasRenderingContext2D, forceScale?: number) {
    const ctx = ctxOverride ?? this.ctx;
    const s = (forceScale ?? q.s) * BODY_SCALE;
    if (s < 1.5) return;
    const kit = this.kitOf(p);
    // 화면상 방향
    let side = 1;
    let toward = 0;
    if (!forceScale) {
      const f = this.proj(p.x + Math.cos(p.facing), p.y + Math.sin(p.facing), 0);
      if (f) {
        side = f.x >= q.x ? 1 : -1;
        toward = clamp((f.y - q.y) / (q.s * 0.6), -1, 1);
      }
    }
    const lift = p.z * s;
    ctx.save();
    ctx.translate(q.x, q.y - lift);
    let rot = 0;
    let lyingY = 0;
    if (p.state === 'down') {
      rot = side * 1.45;
      lyingY = 0;
    } else if (p.state === 'slide') {
      rot = -side * 1.15;
    } else if (p.state === 'dive' && p.dive) {
      const k = clamp(p.dive.t / p.dive.dur, 0, 1);
      const sideScreen = this.screenSideOfLateral(p, p.dive.side);
      rot = sideScreen * 1.35 * Math.min(1, k * 1.6);
      lyingY = -p.dive.tz * Math.sin(Math.PI * Math.min(1, k)) * s * 0.6;
      ctx.translate(sideScreen * k * 0.3 * s, lyingY);
    } else if (p.state === 'frozen') {
      rot = 0;
    }
    if (rot) ctx.rotate(rot);
    ctx.scale(side, 1);

    const moving = Math.min(1, p.speed / 6);
    const ph = p.anim * Math.PI;
    let legA = Math.sin(ph) * 0.7 * moving;
    let legB = -legA;
    let armA = -legA * 0.8;
    let armB = -armA;
    let kickLeg = 0;
    if (p.state === 'kick' || p.state === 'header') {
      const k = p.kick ? clamp(p.kick.t / Math.max(0.05, p.kick.windup), 0, 1) : 1;
      kickLeg = p.kick ? -0.6 * k : 1.3 * Math.max(0, 1 - (p.stateT - 0.1) * 4);
      if (p.kick) kickLeg = 0.9 * k; // 뒤로 젖힘
      else kickLeg = -1.3 * clamp(1 - p.stateT * 3, 0, 1);
      legA = kickLeg;
      legB = 0.1;
      armA = -0.9;
      armB = 0.7;
    } else if (p.state === 'slide') {
      legA = -1.4;
      legB = -0.4;
      armA = 1.2;
      armB = 1.6;
    } else if (p.state === 'tackle') {
      legA = -1.0;
      legB = 0.3;
    } else if (p.state === 'skill') {
      legA = Math.sin(p.stateT * 30) * 0.9;
      legB = -legA;
    } else if (p.state === 'celebrate') {
      armA = -2.8 + Math.sin(this.time * 10) * 0.2;
      armB = -2.8 - Math.sin(this.time * 10) * 0.2;
    } else if (p.state === 'dive') {
      armA = -2.6;
      armB = -2.9;
      legA = 0.3;
      legB = -0.2;
    }
    const throwing = m.setPiece && m.setPiece.kind === 'throw' && m.setPiece.taker === p && m.phase !== 'play';
    if (throwing || (m.ball.owner === p && m.ball.heldByKeeper)) {
      armA = -2.7;
      armB = -2.9;
    }

    const U = s; // 1m
    const hipY = -0.95 * U;
    const legLen = 0.92 * U;
    const legW = Math.max(1.8, 0.18 * U);
    const drawLeg = (ang: number, back: boolean) => {
      ctx.save();
      ctx.translate(back ? -0.04 * U : 0.04 * U, hipY);
      ctx.rotate(-ang);
      ctx.lineCap = 'round';
      // 허벅지 (반바지)
      ctx.strokeStyle = back ? shade(kit.shorts, -25) : kit.shorts;
      ctx.lineWidth = legW * 1.25;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, legLen * 0.35);
      ctx.stroke();
      // 다리 피부
      ctx.strokeStyle = back ? shade(p.def.skin, -25) : p.def.skin;
      ctx.lineWidth = legW;
      ctx.beginPath();
      ctx.moveTo(0, legLen * 0.33);
      ctx.lineTo(0, legLen * 0.55);
      ctx.stroke();
      // 양말
      ctx.strokeStyle = back ? shade(kit.socks, -25) : kit.socks;
      ctx.beginPath();
      ctx.moveTo(0, legLen * 0.55);
      ctx.lineTo(0, legLen * 0.93);
      ctx.stroke();
      // 축구화
      ctx.fillStyle = back ? '#111' : '#1d1d1d';
      ctx.beginPath();
      ctx.ellipse(0.07 * U, legLen, 0.13 * U, 0.06 * U, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };
    const shoulderY = -1.42 * U;
    const drawArm = (ang: number, back: boolean) => {
      ctx.save();
      ctx.translate(0, shoulderY);
      ctx.rotate(-ang);
      ctx.lineCap = 'round';
      ctx.strokeStyle = back ? shade(kit.shirt, -30) : kit.shirt;
      ctx.lineWidth = Math.max(1.4, 0.15 * U);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, 0.22 * U);
      ctx.stroke();
      ctx.strokeStyle = p.isGK ? (back ? '#bbb' : '#f2f2f2') : back ? shade(p.def.skin, -25) : p.def.skin;
      ctx.lineWidth = Math.max(1.1, 0.115 * U);
      ctx.beginPath();
      ctx.moveTo(0, 0.2 * U);
      ctx.lineTo(0, 0.55 * U);
      ctx.stroke();
      if (p.isGK) {
        ctx.fillStyle = back ? '#ccc' : '#fff';
        ctx.beginPath();
        ctx.arc(0, 0.58 * U, 0.08 * U, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    };

    drawArm(armB, true);
    drawLeg(legB, true);
    drawLeg(legA, false);
    // 몸통
    const torsoTop = -1.52 * U;
    const torsoH = 0.6 * U;
    const tw = 0.5 * U;
    ctx.fillStyle = kit.shirt;
    roundRect(ctx, -tw / 2, torsoTop, tw, torsoH, 0.1 * U);
    ctx.fill();
    if (kit.stripes) {
      ctx.save();
      roundRect(ctx, -tw / 2, torsoTop, tw, torsoH, 0.1 * U);
      ctx.clip();
      ctx.fillStyle = '#ffffff';
      for (let i = -2; i <= 2; i += 2) ctx.fillRect(i * tw * 0.12 - tw * 0.06, torsoTop, tw * 0.12, torsoH);
      ctx.restore();
    }
    // 음영
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(-tw / 2, torsoTop + torsoH * 0.55, tw, torsoH * 0.45);
    // 등번호 (등을 보일 때)
    if (toward < -0.15 && U > 14) {
      ctx.save();
      ctx.scale(side, 1);
      ctx.fillStyle = kit.accent;
      ctx.font = `${Math.round(0.28 * U)}px ${FONT_NUM}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(p.def.num), 0, torsoTop + torsoH * 0.45);
      ctx.restore();
    } else if (U > 14) {
      ctx.fillStyle = kit.accent;
      ctx.fillRect(0.04 * U, torsoTop + 0.1 * U, 0.06 * U, 0.06 * U);
    }
    // 머리
    const headY = -1.7 * U;
    const hr = 0.15 * U;
    ctx.fillStyle = p.def.skin;
    ctx.beginPath();
    ctx.arc(0, headY, hr, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p.def.hair;
    ctx.beginPath();
    if (toward < -0.3) ctx.arc(0, headY, hr * 1.02, 0, Math.PI * 2);
    else ctx.arc(-0.02 * U, headY - 0.02 * U, hr * 1.02, Math.PI * 0.95, Math.PI * 2.15);
    ctx.fill();
    if (toward > -0.3 && U > 12) {
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(0.06 * U, headY - 0.01 * U, 0.025 * U, 0.03 * U);
    }
    drawArm(armA, false);

    // 빙결
    if (p.state === 'frozen' || p.frozen > 0) {
      ctx.fillStyle = 'rgba(170,230,255,0.45)';
      ctx.strokeStyle = 'rgba(230,250,255,0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-0.4 * U, 0);
      ctx.lineTo(-0.45 * U, -1.6 * U);
      ctx.lineTo(-0.1 * U, -2.0 * U);
      ctx.lineTo(0.4 * U, -1.8 * U);
      ctx.lineTo(0.45 * U, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();

    // 오라
    if (p.aura > 0) {
      const col = SPECIAL_COLORS[p.team.def.special.type];
      const a = clamp(p.aura, 0, 1);
      const sprite = this.glowSprite(col[0]);
      const r = 1.6 * s * (1 + Math.sin(this.time * 14) * 0.08);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.65 * a;
      ctx.drawImage(sprite, q.x - r, q.y - lift - 1.0 * s - r, r * 2, r * 2);
      ctx.restore();
    }
    // 레드/옐로 카드 표시 없음, 조작 선수 이름표
    if (p.human && !forceScale && m.phase !== 'replay' && m.phase !== 'shootout') {
      const ny = q.y - lift - 2.25 * s;
      ctx.fillStyle = '#ffe14d';
      ctx.beginPath();
      ctx.moveTo(q.x - 6, ny - 9);
      ctx.lineTo(q.x + 6, ny - 9);
      ctx.lineTo(q.x, ny - 1);
      ctx.fill();
      ctx.font = `13px ${FONT_DISPLAY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      const label = `${p.def.num} ${p.def.name}`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.strokeText(label, q.x, ny - 11);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, q.x, ny - 11);
      // 스태미나
      const bw = 34;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(q.x - bw / 2, ny - 31, bw, 4);
      ctx.fillStyle = p.stamina > 0.5 ? '#5dff8f' : p.stamina > 0.3 ? '#ffd34d' : '#ff6b6b';
      ctx.fillRect(q.x - bw / 2, ny - 31, bw * p.stamina, 4);
      // 파워 게이지
      if (m.charge && p.team.controlled === p) {
        const k = clamp(m.charge.t / 0.95, 0, 1);
        const gw = 46;
        const gy = ny - 42;
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(q.x - gw / 2 - 2, gy - 2, gw + 4, 9);
        const gg = ctx.createLinearGradient(q.x - gw / 2, 0, q.x + gw / 2, 0);
        gg.addColorStop(0, '#5dff8f');
        gg.addColorStop(0.7, '#ffd34d');
        gg.addColorStop(1, '#ff4d4d');
        ctx.fillStyle = gg;
        ctx.fillRect(q.x - gw / 2, gy, gw * k, 5);
        if (m.charge.kind === 'shot') {
          ctx.fillStyle = 'rgba(255,255,255,0.8)';
          ctx.fillRect(q.x - gw / 2 + gw * 0.82, gy - 2, 1.5, 9);
        }
      }
    }
  }

  /** 다이빙 방향(월드 y 기준 ±)이 화면에서 왼쪽인지 오른쪽인지 */
  private screenSideOfLateral(p: Player, lateral: number) {
    const a = this.proj(p.x, p.y, 0);
    const b = this.proj(p.x, p.y + lateral, 0);
    if (!a || !b) return lateral;
    const dx = b.x - a.x;
    return Math.abs(dx) < 0.5 ? (lateral > 0 ? 1 : -1) : Math.sign(dx);
  }

  private drawBall(m: Match, q: Proj) {
    const ctx = this.ctx;
    const b = m.ball;
    const r = Math.max(2.2, BALL_R * 1.9 * q.s);
    if (b.special) {
      const col = SPECIAL_COLORS[b.special];
      const sprite = this.glowSprite(col[0]);
      const gr = r * (b.special === 'meteor' ? 9 : 6) * (1 + Math.sin(this.time * 30) * 0.1);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(sprite, q.x - gr, q.y - gr, gr * 2, gr * 2);
      const s2 = this.glowSprite(col[1]);
      ctx.drawImage(s2, q.x - gr * 0.5, q.y - gr * 0.5, gr, gr);
      ctx.restore();
    }
    const g = ctx.createRadialGradient(q.x - r * 0.35, q.y - r * 0.35, r * 0.1, q.x, q.y, r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, '#c9ccd6');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
    ctx.fill();
    // 회전하는 패턴
    ctx.fillStyle = '#20232c';
    for (let i = 0; i < 3; i++) {
      const a = b.rot * 0.5 + (i * Math.PI * 2) / 3;
      const px = Math.cos(a) * r * 0.55;
      const py = Math.sin(a * 0.7) * r * 0.4;
      if (Math.cos(a) > -0.3) {
        ctx.beginPath();
        ctx.arc(q.x + px, q.y + py, r * 0.26, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // ─────────────────────────────── 이펙트 ───────────────────────────────

  glowSprite(color: string) {
    let c = this.sprites.get(color);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, '#ffffff');
    gr.addColorStop(0.18, color);
    gr.addColorStop(0.5, hexA(color, 0.35));
    gr.addColorStop(1, hexA(color, 0));
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    this.sprites.set(color, c);
    return c;
  }

  /** 흰 코어 없이 색이 살아 있는 불꽃 스프라이트 */
  private flameSprite(color: string) {
    const key = 'flame' + color;
    let c = this.sprites.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, hexA(color, 0.95));
    gr.addColorStop(0.35, hexA(color, 0.6));
    gr.addColorStop(1, hexA(color, 0));
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    this.sprites.set(key, c);
    return c;
  }

  private softSprite(color: string) {
    const key = 'soft' + color;
    let c = this.sprites.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, hexA(color, 0.7));
    gr.addColorStop(1, hexA(color, 0));
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    this.sprites.set(key, c);
    return c;
  }

  private drawParticles(m: Match) {
    const ctx = this.ctx;
    const list = m.particles.list;
    // 일반 합성 먼저 (연기, 꽃가루)
    ctx.save();
    for (const p of list) {
      if (p.additive) continue;
      const q = this.proj(p.x, p.y, p.z);
      if (!q) continue;
      this.drawParticle(p, q);
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const p of list) {
      if (!p.additive) continue;
      const q = this.proj(p.x, p.y, p.z);
      if (!q) continue;
      this.drawParticle(p, q);
    }
    ctx.restore();
  }

  private drawParticle(p: Particle, q: Proj) {
    const ctx = this.ctx;
    const k = p.life / p.max;
    const sz = Math.max(0.6, p.size * q.s);
    switch (p.kind) {
      case 'flame': {
        const sp = this.flameSprite(k > 0.45 ? p.color : p.color2);
        ctx.globalAlpha = Math.min(0.8, k * 1.2);
        ctx.drawImage(sp, q.x - sz, q.y - sz, sz * 2, sz * 2);
        break;
      }
      case 'glow': {
        const sp = this.glowSprite(k > 0.5 ? p.color : p.color2);
        ctx.globalAlpha = Math.min(1, k * 1.4);
        ctx.drawImage(sp, q.x - sz, q.y - sz, sz * 2, sz * 2);
        break;
      }
      case 'smoke': {
        const sp = this.softSprite(p.color);
        ctx.globalAlpha = k * 0.6;
        ctx.drawImage(sp, q.x - sz, q.y - sz, sz * 2, sz * 2);
        break;
      }
      case 'ice':
      case 'shard': {
        ctx.globalAlpha = Math.min(1, k * 1.5);
        ctx.fillStyle = p.color;
        ctx.save();
        ctx.translate(q.x, q.y);
        ctx.rotate(p.rot);
        ctx.beginPath();
        ctx.moveTo(0, -sz);
        ctx.lineTo(sz * 0.45, 0);
        ctx.lineTo(0, sz);
        ctx.lineTo(-sz * 0.45, 0);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        break;
      }
      case 'confetti': {
        ctx.globalAlpha = Math.min(1, k * 2);
        ctx.fillStyle = p.color;
        ctx.save();
        ctx.translate(q.x, q.y);
        ctx.rotate(p.rot);
        ctx.fillRect(-sz, -sz * 0.5 * Math.abs(Math.sin(p.rot * 2)), sz * 2, sz * Math.abs(Math.sin(p.rot * 2)) + 0.5);
        ctx.restore();
        break;
      }
      case 'star': {
        ctx.globalAlpha = Math.min(1, k * 1.5);
        ctx.fillStyle = p.color;
        ctx.save();
        ctx.translate(q.x, q.y);
        ctx.rotate(p.rot);
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const r = i % 2 ? sz * 0.35 : sz * 1.2;
          const a = (i / 8) * Math.PI * 2;
          ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        break;
      }
      case 'leaf': {
        ctx.globalAlpha = Math.min(1, k * 1.5);
        ctx.strokeStyle = p.color;
        ctx.lineWidth = Math.max(1, sz * 0.4);
        ctx.beginPath();
        ctx.arc(q.x, q.y, sz * 1.5, p.rot, p.rot + 1.6);
        ctx.stroke();
        break;
      }
      default: {
        ctx.globalAlpha = Math.min(1, k * 1.5);
        ctx.fillStyle = p.color;
        ctx.fillRect(q.x - sz * 0.5, q.y - sz * 0.5, sz, sz);
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawRings(m: Match, ground: boolean) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const r of m.particles.rings) {
      if (!!r.vertical === ground) continue;
      const k = r.life / r.max;
      ctx.strokeStyle = hexA(r.color, k);
      if (r.vertical) {
        const q = this.proj(r.x, r.y, r.z);
        if (!q) continue;
        ctx.lineWidth = Math.max(1, r.width * k);
        ctx.beginPath();
        ctx.arc(q.x, q.y, r.r * q.s, 0, Math.PI * 2);
        ctx.stroke();
        continue;
      }
      ctx.beginPath();
      let first = true;
      let lw = 2;
      for (let i = 0; i <= 32; i++) {
        const a = (i / 32) * Math.PI * 2;
        const q = this.proj(r.x + Math.cos(a) * r.r, r.y + Math.sin(a) * r.r, r.z);
        if (!q) {
          first = true;
          continue;
        }
        lw = q.s;
        if (first) ctx.moveTo(q.x, q.y);
        else ctx.lineTo(q.x, q.y);
        first = false;
      }
      ctx.lineWidth = Math.max(1, r.width * 0.05 * lw * k);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawBolts(m: Match) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const b of m.particles.bolts) {
      const k = b.life / b.max;
      const pts = b.pts.map((p) => this.proj(p[0], p[1], p[2]));
      if (pts.some((p) => !p)) continue;
      for (const pass of [0, 1]) {
        ctx.strokeStyle = pass === 0 ? hexA(b.color, 0.35 * k) : `rgba(255,255,255,${0.9 * k})`;
        ctx.lineWidth = pass === 0 ? b.width * 3.5 : b.width * 0.8;
        ctx.beginPath();
        pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p!.x, p!.y) : ctx.lineTo(p!.x, p!.y)));
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private drawSpecialExtras(m: Match) {
    const b = m.ball;
    const ctx = this.ctx;
    if (b.special === 'dragon') {
      this.dragonTrail.unshift({ x: b.x, y: b.y, z: b.z });
      if (this.dragonTrail.length > 46) this.dragonTrail.pop();
    } else if (this.dragonTrail.length) this.dragonTrail.length = 0;
    if (b.special === 'dragon' && this.dragonTrail.length > 3) {
      ctx.save();
      const tr = this.dragonTrail;
      for (let i = tr.length - 1; i >= 0; i -= 1) {
        const q = this.proj(tr[i].x, tr[i].y, tr[i].z);
        if (!q) continue;
        const k = 1 - i / tr.length;
        const r = Math.max(2, (0.18 + k * 0.45) * q.s);
        ctx.fillStyle = i % 4 < 2 ? '#1fa85a' : '#2fd170';
        ctx.beginPath();
        ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
        ctx.fill();
        if (i % 3 === 0) {
          ctx.fillStyle = '#ffe066';
          ctx.beginPath();
          ctx.moveTo(q.x - r * 0.4, q.y - r * 0.9);
          ctx.lineTo(q.x, q.y - r * 1.7);
          ctx.lineTo(q.x + r * 0.4, q.y - r * 0.9);
          ctx.fill();
        }
      }
      // 용머리
      const h = this.proj(b.x, b.y, b.z);
      const n = this.proj(tr[2].x, tr[2].y, tr[2].z);
      if (h && n) {
        const ang = Math.atan2(h.y - n.y, h.x - n.x);
        const r = 0.75 * h.s;
        ctx.translate(h.x, h.y);
        ctx.rotate(ang);
        ctx.fillStyle = '#2fd170';
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 1.3, r * 0.8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffe066';
        ctx.beginPath();
        ctx.moveTo(-r * 0.5, -r * 0.6);
        ctx.lineTo(-r * 1.5, -r * 1.5);
        ctx.lineTo(-r * 0.1, -r * 0.7);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(-r * 0.5, r * 0.6);
        ctx.lineTo(-r * 1.5, r * 1.5);
        ctx.lineTo(-r * 0.1, r * 0.7);
        ctx.fill();
        ctx.fillStyle = '#ff3030';
        ctx.beginPath();
        ctx.arc(r * 0.45, -r * 0.3, r * 0.15, 0, Math.PI * 2);
        ctx.arc(r * 0.45, r * 0.3, r * 0.15, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#0b5a2c';
        ctx.fillRect(r * 0.9, -r * 0.12, r * 0.5, r * 0.24);
      }
      ctx.restore();
    }
    if (b.special === 'tornado') {
      const q = this.proj(b.x, b.y, b.z);
      if (q) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 4; i++) {
          const a = this.time * 14 + i * 1.6;
          ctx.strokeStyle = `rgba(160,255,220,${0.55 - i * 0.1})`;
          ctx.lineWidth = Math.max(1.5, q.s * 0.08);
          ctx.beginPath();
          ctx.ellipse(q.x, q.y, (0.8 + i * 0.35) * q.s, (0.35 + i * 0.12) * q.s, a * 0.2, a, a + 4);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
    if (b.special === 'phantom' && m.specialData.fakes && b.guide) {
      const k = clamp(b.guide.t / b.guide.T, 0, 1);
      const st = m.specialData.start!;
      ctx.save();
      for (const f of m.specialData.fakes) {
        const x = st[0] + (f[0] - st[0]) * k;
        const y = st[1] + (f[1] - st[1]) * k;
        const z = st[2] + (f[2] - st[2]) * k + Math.sin(Math.PI * k) * 0.8;
        for (let j = 0; j < 4; j++) {
          const kk = Math.max(0, k - j * 0.025);
          const q = this.proj(st[0] + (f[0] - st[0]) * kk, st[1] + (f[1] - st[1]) * kk, st[2] + (f[2] - st[2]) * kk + Math.sin(Math.PI * kk) * 0.8);
          if (!q) continue;
          ctx.globalAlpha = 0.5 - j * 0.11;
          ctx.fillStyle = '#d8b4ff';
          ctx.beginPath();
          ctx.arc(q.x, q.y, BALL_R * 1.9 * q.s, 0, Math.PI * 2);
          ctx.fill();
        }
        const q = this.proj(x, y, z);
        if (q) {
          ctx.globalAlpha = 0.8;
          ctx.globalCompositeOperation = 'lighter';
          const sp = this.glowSprite('#b86bff');
          const gr = BALL_R * 10 * q.s;
          ctx.drawImage(sp, q.x - gr, q.y - gr, gr * 2, gr * 2);
          ctx.globalCompositeOperation = 'source-over';
        }
      }
      ctx.restore();
    }
  }

  private drawPopups(m: Match) {
    const ctx = this.ctx;
    for (const pp of m.popups) {
      const q = this.proj(pp.x, pp.y, pp.z);
      if (!q) continue;
      const a = clamp(1.3 - pp.t, 0, 1);
      const sc = pp.t < 0.12 ? 0.6 + pp.t * 3.3 : 1;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(q.x, q.y - 26);
      ctx.scale(sc, sc);
      ctx.font = `17px ${FONT_DISPLAY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.strokeText(pp.text, 0, 0);
      ctx.fillStyle = pp.color;
      ctx.fillText(pp.text, 0, 0);
      ctx.restore();
    }
  }

  // ─────────────────────────────── 오버레이 ───────────────────────────────

  private drawOverlays(m: Match) {
    const ctx = this.ctx;
    const { w, h } = this;
    // 비네트
    const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.45, w / 2, h / 2, Math.max(w, h) * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, `rgba(0,0,0,${m.cfg.night ? 0.45 : 0.3})`);
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, w, h);
    if (m.fx.darken > 0.01) {
      ctx.fillStyle = `rgba(5,5,20,${m.fx.darken})`;
      ctx.fillRect(0, 0, w, h);
    }
    if (m.fx.flash > 0.01) {
      ctx.fillStyle = hexA(m.fx.flashColor, Math.min(0.85, m.fx.flash));
      ctx.fillRect(0, 0, w, h);
    }
    if (m.fx.fade > 0.01) {
      ctx.fillStyle = `rgba(0,0,0,${m.fx.fade})`;
      ctx.fillRect(0, 0, w, h);
    }
    if (m.fx.letterbox > 0.01) {
      const lb = h * 0.09 * m.fx.letterbox;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, lb);
      ctx.fillRect(0, h - lb, w, lb);
    }
    if (m.phase === 'replay') {
      ctx.font = `22px ${FONT_NUM}`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#fff';
      ctx.fillText('REPLAY', w - 24, h * 0.09 + 14);
      if (Math.sin(this.time * 6) > 0) {
        ctx.fillStyle = '#ff3b3b';
        ctx.beginPath();
        ctx.arc(w - 140, h * 0.09 + 26, 7, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.font = `13px ${FONT_BODY}`;
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText('아무 키나 눌러 건너뛰기', w - 24, h * 0.09 + 44);
    }
  }

  // ─────────────────────────────── HUD ───────────────────────────────

  private drawHud(m: Match) {
    const ctx = this.ctx;
    const { w, h } = this;
    const compact = w < 700 || h < 500 || this.touchMode;
    // 스코어보드
    const [a, b] = m.teams;
    const sx = 18;
    const sy = 16;
    ctx.save();
    ctx.font = `${compact ? 15 : 19}px ${FONT_NUM}`;
    ctx.textBaseline = 'middle';
    const codeW = compact ? 44 : 54;
    const scoreW = compact ? 56 : 68;
    const timeW = compact ? 52 : 62;
    const H = compact ? 30 : 36;
    ctx.fillStyle = 'rgba(8,10,20,0.82)';
    roundRect(ctx, sx, sy, codeW * 2 + scoreW + timeW + 14, H, 6);
    ctx.fill();
    const chip = (x: number, t: TeamState) => {
      ctx.fillStyle = t.kit.shirt;
      ctx.fillRect(x, sy + 5, 5, H - 10);
    };
    chip(sx + 6, a);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.fillText(a.def.short, sx + 8 + codeW / 2, sy + H / 2 + 1);
    ctx.fillStyle = '#ffe14d';
    ctx.fillRect(sx + 10 + codeW, sy, scoreW, H);
    ctx.fillStyle = '#111';
    ctx.fillText(`${a.goals} - ${b.goals}`, sx + 10 + codeW + scoreW / 2, sy + H / 2 + 1);
    ctx.fillStyle = '#fff';
    ctx.fillText(b.def.short, sx + 12 + codeW + scoreW + codeW / 2 - 2, sy + H / 2 + 1);
    chip(sx + 10 + codeW * 2 + scoreW - 3, b);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(sx + 12 + codeW * 2 + scoreW + 2, sy + 6, 1, H - 12);
    ctx.fillStyle = '#9fe7ff';
    ctx.fillText(`${String(m.minute).padStart(2, '0')}'`, sx + 14 + codeW * 2 + scoreW + timeW / 2, sy + H / 2 + 1);
    ctx.font = `11px ${FONT_BODY}`;
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.textAlign = 'left';
    ctx.fillText(`${m.cfg.stageName} · ${m.half === 1 ? '전반' : '후반'}`, sx + 2, sy + H + 12);
    ctx.restore();

    // 필살 게이지
    const human = m.humanTeam;
    const gw = compact ? 150 : 230;
    const drawGauge = (t: TeamState, x: number, y: number, align: 'left' | 'right', big: boolean) => {
      const ww = big ? gw : gw * 0.65;
      const hh = big ? 14 : 9;
      const col = SPECIAL_COLORS[t.def.special.type];
      const full = t.gauge >= 100;
      ctx.save();
      ctx.fillStyle = 'rgba(8,10,20,0.75)';
      roundRect(ctx, x - 6, y - (big ? 26 : 20), ww + 12, hh + (big ? 34 : 26), 6);
      ctx.fill();
      ctx.font = `${big ? 13 : 11}px ${FONT_DISPLAY}`;
      ctx.textBaseline = 'bottom';
      ctx.textAlign = align;
      ctx.fillStyle = full ? col[1] : 'rgba(255,255,255,0.85)';
      const label = `${t.def.short} 필살기 · ${t.def.special.name}`;
      ctx.fillText(label, align === 'left' ? x : x + ww, y - 4);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(x, y, ww, hh);
      const g = ctx.createLinearGradient(x, 0, x + ww, 0);
      g.addColorStop(0, col[0]);
      g.addColorStop(1, col[1]);
      ctx.fillStyle = g;
      const fw = (ww * t.gauge) / 100;
      if (align === 'left') ctx.fillRect(x, y, fw, hh);
      else ctx.fillRect(x + ww - fw, y, fw, hh);
      // 50% 표시 (필살 태클)
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillRect(x + ww / 2, y - 2, 1.5, hh + 4);
      if (full) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.4 + Math.sin(this.time * 8) * 0.3;
        ctx.fillStyle = col[1];
        ctx.fillRect(x - 2, y - 2, ww + 4, hh + 4);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        if (big && t.human) {
          ctx.font = `12px ${FONT_NUM}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillStyle = '#fff';
          ctx.fillText('SPACE!', x + ww / 2, y + hh + 2);
        }
      }
      ctx.restore();
    };
    if (human && this.touchMode) {
      // 터치 화면: 스틱·버튼과 겹치지 않게 위쪽에 배치
      drawGauge(human, 22, 104, 'left', true);
      if (h > w) {
        drawGauge(m.opp(human), 22, 150, 'left', false);
        if (Math.floor(this.time) % 8 < 4) {
          ctx.save();
          ctx.font = `13px ${FONT_BODY}`;
          ctx.textAlign = 'center';
          ctx.fillStyle = 'rgba(255,255,255,0.75)';
          ctx.fillText('가로로 돌리면 더 넓게 보여요', w / 2, 196);
          ctx.restore();
        }
      } else drawGauge(m.opp(human), w - 90 - gw * 0.65, 44, 'right', false);
    } else if (human) {
      drawGauge(human, 22, h - 34, 'left', true);
      drawGauge(m.opp(human), w - 22 - gw * 0.65, h - 30, 'right', false);
    } else {
      drawGauge(a, 22, h - 34, 'left', true);
      drawGauge(b, w - 22 - gw, h - 34, 'right', true);
    }

    // 레이더 (공이 레이더 뒤에 가려지면 반투명하게)
    if (!compact) {
      const rx = w / 2 - 100;
      const ry = h - 142;
      const bq = this.proj(m.ball.x, m.ball.y, m.ball.z);
      const hidden = bq && bq.x > rx - 40 && bq.x < rx + 240 && bq.y > ry - 50;
      ctx.save();
      ctx.globalAlpha = hidden ? 0.28 : 0.92;
      this.drawRadar(m, rx, ry, 200, 128);
      ctx.restore();
    }

    // 중계 자막
    const c = m.commentary;
    if (c.text && c.t < 3.2) {
      const a2 = clamp(3.2 - c.t, 0, 1) * clamp(c.t * 6, 0, 1);
      ctx.save();
      ctx.globalAlpha = a2;
      ctx.font = `${compact ? 13 : 15}px ${FONT_BODY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const tw = ctx.measureText(c.text).width;
      const cy = this.touchMode ? (h > w ? 230 : 160) : compact ? h - 72 : h - 170;
      ctx.fillStyle = 'rgba(8,10,20,0.7)';
      roundRect(ctx, w / 2 - tw / 2 - 14, cy - 15, tw + 28, 30, 15);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(c.text, w / 2, cy + 1);
      ctx.restore();
    }

    // 조작 안내
    if (human && !this.touchMode && m.phase !== 'replay' && m.phase !== 'goal' && m.phase !== 'cutin') this.drawKeyHints(m, human);
  }

  private drawKeyHints(m: Match, team: TeamState) {
    const ctx = this.ctx;
    const { w } = this;
    if (w < 820) return;
    const p = team.controlled;
    let lines: string[];
    const sp = m.setPiece;
    if ((m.phase === 'setpiece' || m.phase === 'kickoff') && sp && sp.taker === p) {
      const map: Record<string, string[]> = {
        kickoff: ['J 패스로 킥오프', 'L 스루패스', '방향키 방향 지정'],
        throw: ['방향키 조준', 'J 짧은 스로인', 'I 긴 스로인'],
        corner: ['I 크로스 (길게=멀리)', 'J 짧은 패스', '방향키 조준'],
        goalkick: ['J 짧은 패스', 'I 롱킥', 'L 스루패스'],
        freekick: ['K 슛 (E 누른 채: 감아차기)', 'J 패스 · I 로빙', '방향키 조준'],
        penalty: ['K 길게 눌러 파워', '↑↓ 좌우 코너 조준', '와인드업 중 K 다시: 타이밍'],
      };
      lines = map[sp.kind];
    } else if (m.ball.owner === p) {
      lines = ['J 패스 · L 스루 · I 로빙/크로스', 'K 슛 (다시 K: 타이밍 피니시)', 'E+K 감아차기 · Q+K 칩슛', 'U 개인기 · Shift 질주', `Space 필살기 ${team.gauge >= 100 ? '준비!' : `${Math.floor(team.gauge)}%`}`];
    } else {
      lines = ['J 선수 전환', 'K 태클 · L 슬라이딩', 'I(누르기) 동료 압박', 'Space 필살 태클 (50%)'];
    }
    ctx.save();
    ctx.font = `12px ${FONT_BODY}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    const x = w - 18;
    let y = 18;
    const bw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 20;
    ctx.fillStyle = 'rgba(8,10,20,0.55)';
    roundRect(ctx, x - bw + 6, y - 6, bw, lines.length * 18 + 10, 6);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.86)';
    for (const l of lines) {
      ctx.fillText(l, x - 4, y);
      y += 18;
    }
    ctx.restore();
  }

  private drawRadar(m: Match, x: number, y: number, w: number, h: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = 'rgba(10,40,18,0.62)';
    roundRect(ctx, x - 4, y - 4, w + 8, h + 8, 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);
    ctx.beginPath();
    ctx.moveTo(x + w / 2, y);
    ctx.lineTo(x + w / 2, y + h);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + w / 2, y + h / 2, (CIRCLE_R / PITCH_W) * h, 0, Math.PI * 2);
    ctx.stroke();
    const bx = (BOX_DEPTH / PITCH_L) * w;
    const by = (BOX_HALF_W / PITCH_W) * h;
    ctx.strokeRect(x, y + h / 2 - by, bx, by * 2);
    ctx.strokeRect(x + w - bx, y + h / 2 - by, bx, by * 2);
    // 카메라 시야
    const tl = this.cam.unproject(0, this.h * 0.25);
    const br = this.cam.unproject(this.w, this.h * 0.95);
    if (tl && br) {
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.strokeRect(x + (clamp(tl.x, 0, PITCH_L) / PITCH_L) * w, y, ((clamp(br.x, 0, PITCH_L) - clamp(tl.x, 0, PITCH_L)) / PITCH_L) * w, h);
    }
    for (const t of m.teams) {
      for (const p of t.active) {
        const px = x + (clamp(p.x, 0, PITCH_L) / PITCH_L) * w;
        const py = y + (clamp(p.y, 0, PITCH_W) / PITCH_W) * h;
        ctx.fillStyle = p.isGK ? t.def.gkShirt : t.kit.shirt;
        ctx.beginPath();
        ctx.arc(px, py, p.human ? 4.5 : 3.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = p.human ? '#ffe14d' : 'rgba(0,0,0,0.6)';
        ctx.lineWidth = p.human ? 2 : 1;
        ctx.stroke();
      }
    }
    const b = m.ball;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x + (clamp(b.x, 0, PITCH_L) / PITCH_L) * w, y + (clamp(b.y, 0, PITCH_W) / PITCH_W) * h, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ─────────────────────────────── 컷인 ───────────────────────────────

  private drawCutin(m: Match) {
    const c = m.cutin!;
    const ctx = this.ctx;
    const { w, h } = this;
    const t = c.t;
    const dur = c.dur;
    const inK = clamp(t / 0.22, 0, 1);
    const outK = clamp((dur - t) / 0.25, 0, 1);
    const k = Math.min(inK, outK);
    const col = SPECIAL_COLORS[c.type];
    const team = c.p.team;
    ctx.save();
    // 집중선
    ctx.globalAlpha = 0.5 * k;
    ctx.strokeStyle = '#ffffff';
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2 + Math.floor(t * 30) * 0.13;
      const r0 = Math.min(w, h) * (0.35 + ((i * 37) % 10) * 0.02);
      ctx.lineWidth = 1 + ((i * 13) % 3);
      ctx.beginPath();
      ctx.moveTo(w / 2 + Math.cos(a) * r0, h / 2 + Math.sin(a) * r0);
      ctx.lineTo(w / 2 + Math.cos(a) * w, h / 2 + Math.sin(a) * w);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // 대각선 띠
    const bandH = h * 0.36;
    const slide = (1 - inK) * w;
    ctx.translate(slide, 0);
    ctx.beginPath();
    ctx.moveTo(0, h / 2 - bandH / 2 + 40);
    ctx.lineTo(w, h / 2 - bandH / 2 - 40);
    ctx.lineTo(w, h / 2 + bandH / 2 - 40);
    ctx.lineTo(0, h / 2 + bandH / 2 + 40);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, hexA(team.kit.shirt === '#F5F5F5' || team.kit.shirt === '#F5F5F7' ? '#3a3f55' : team.kit.shirt, 0.95 * k));
    g.addColorStop(0.55, hexA('#0b0d18', 0.92 * k));
    g.addColorStop(1, hexA(col[0], 0.9 * k));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.save();
    ctx.clip();
    // 띠 안의 줄무늬
    ctx.globalAlpha = 0.18 * k;
    ctx.fillStyle = col[1];
    for (let i = 0; i < 14; i++) {
      const xx = ((i * 140 + t * 1600) % (w + 300)) - 150;
      ctx.fillRect(xx, 0, 30, h);
    }
    ctx.globalAlpha = k;
    // 선수 실루엣 (크게)
    const scale = bandH / 2.1;
    const fakeQ: Proj = { x: w * 0.22, y: h / 2 + bandH / 2 - 8, d: 1, s: scale };
    const sprite = this.glowSprite(col[0]);
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(sprite, fakeQ.x - scale * 1.8, fakeQ.y - scale * 2.9, scale * 3.6, scale * 3.6);
    ctx.globalCompositeOperation = 'source-over';
    const saved = { facing: c.p.facing, state: c.p.state, aura: c.p.aura, human: c.p.human };
    c.p.aura = 0;
    c.p.human = false;
    c.p.state = 'kick';
    this.drawPlayer(m, c.p, fakeQ, ctx, scale / BODY_SCALE);
    Object.assign(c.p, saved);
    ctx.restore();
    // 텍스트
    const tk = clamp((t - 0.15) / 0.25, 0, 1);
    const tx = w * 0.42 + (1 - tk) * 200;
    ctx.globalAlpha = tk * k;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `${Math.round(h * 0.04)}px ${FONT_DISPLAY}`;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(`${team.def.name} · No.${c.p.def.num} ${c.p.def.name}`, tx, h / 2 - bandH * 0.22);
    const big = Math.round(Math.min(h * 0.11, w * 0.07));
    ctx.font = `${big}px ${FONT_DISPLAY}`;
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    const title = `${team.def.special.name}!!`;
    ctx.strokeText(title, tx, h / 2 + bandH * 0.02);
    const tg = ctx.createLinearGradient(0, h / 2 - big / 2, 0, h / 2 + big / 2);
    tg.addColorStop(0, '#ffffff');
    tg.addColorStop(0.5, col[1]);
    tg.addColorStop(1, col[0]);
    ctx.fillStyle = tg;
    ctx.fillText(title, tx, h / 2 + bandH * 0.02);
    ctx.font = `${Math.round(h * 0.03)}px ${FONT_DISPLAY}`;
    ctx.fillStyle = col[1];
    ctx.fillText(`필살 · ${SPECIAL_LABEL[c.type]} 속성`, tx, h / 2 + bandH * 0.25);
    ctx.restore();
  }

  // ─────────────────────────────── 배너 ───────────────────────────────

  private drawBanner(m: Match) {
    const bn = m.banner;
    if (!bn) return;
    const ctx = this.ctx;
    const { w, h } = this;
    const t = bn.t;
    const inK = clamp(t / 0.18, 0, 1);
    const outK = clamp((bn.dur - t) / 0.3, 0, 1);
    const k = Math.min(inK, outK);
    const big = bn.text.includes('GOAL') || bn.text.includes('골') || bn.text.includes('승리');
    const size = big ? Math.min(w * 0.13, h * 0.2) : Math.min(w * 0.06, h * 0.085);
    const sc = big ? 1.6 - 0.6 * inK + Math.sin(t * 6) * 0.02 : 1;
    ctx.save();
    ctx.globalAlpha = k;
    ctx.translate(w / 2, h * (big ? 0.42 : 0.3));
    ctx.scale(sc, sc);
    if (!big) {
      ctx.fillStyle = 'rgba(8,10,20,0.7)';
      ctx.fillRect(-w, -size * 0.75, w * 2, size * (bn.sub ? 2.1 : 1.5));
    }
    ctx.font = `${Math.round(size)}px ${FONT_DISPLAY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = big ? 12 : 6;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(bn.text, 0, 0);
    if (big) {
      const g = ctx.createLinearGradient(0, -size / 2, 0, size / 2);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.45, '#ffe14d');
      g.addColorStop(1, '#ff8a1f');
      ctx.fillStyle = g;
    } else ctx.fillStyle = bn.color;
    ctx.fillText(bn.text, 0, 0);
    if (bn.sub) {
      ctx.font = `${Math.round(size * (big ? 0.26 : 0.42))}px ${FONT_DISPLAY}`;
      ctx.lineWidth = 5;
      ctx.strokeText(bn.sub, 0, size * (big ? 0.72 : 0.78));
      ctx.fillStyle = '#ffffff';
      ctx.fillText(bn.sub, 0, size * (big ? 0.72 : 0.78));
    }
    ctx.restore();
  }

  // ─────────────────────────────── 승부차기 HUD ───────────────────────────────

  private drawShootoutHud(m: Match) {
    const so = m.shootout;
    if (!so) return;
    const ctx = this.ctx;
    const { w, h } = this;
    ctx.save();
    // 집계표
    const rowH = 30;
    const bx = w / 2 - 170;
    const by = 16;
    ctx.fillStyle = 'rgba(8,10,20,0.82)';
    roundRect(ctx, bx, by, 340, rowH * 2 + 16, 8);
    ctx.fill();
    for (const side of [0, 1] as const) {
      const t = m.teams[side];
      const y = by + 8 + side * rowH + rowH / 2;
      ctx.fillStyle = t.kit.shirt;
      ctx.fillRect(bx + 10, y - 9, 5, 18);
      ctx.font = `16px ${FONT_NUM}`;
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(t.def.short, bx + 22, y);
      const kicks = so.kicks[side];
      const n = Math.max(5, kicks.length + (so.turn === side ? 1 : 0));
      for (let i = 0; i < n; i++) {
        const cx = bx + 92 + i * 26;
        if (cx > bx + 300) break;
        ctx.beginPath();
        ctx.arc(cx, y, 9, 0, Math.PI * 2);
        if (i < kicks.length) {
          ctx.fillStyle = kicks[i] ? '#3dff8f' : '#ff4d4d';
          ctx.fill();
        } else {
          ctx.strokeStyle = 'rgba(255,255,255,0.5)';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
      ctx.font = `18px ${FONT_NUM}`;
      ctx.textAlign = 'right';
      ctx.fillStyle = '#ffe14d';
      ctx.fillText(String(t.pens), bx + 330, y);
    }
    // 키커 이름
    if (so.shooter) {
      ctx.font = `18px ${FONT_DISPLAY}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      const label = `${m.teams[so.turn].def.name} · ${so.shooter.def.name}`;
      ctx.strokeText(label, w / 2, by + rowH * 2 + 40);
      ctx.fillText(label, w / 2, by + rowH * 2 + 40);
    }
    // 조준점
    if (so.humanShooting && (so.stage === 'aim' || so.stage === 'runup')) {
      const q = this.proj(0, so.aimY, so.aimZ);
      if (q) {
        ctx.strokeStyle = '#ffe14d';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(q.x, q.y, 16, 0, Math.PI * 2);
        ctx.moveTo(q.x - 24, q.y);
        ctx.lineTo(q.x - 8, q.y);
        ctx.moveTo(q.x + 8, q.y);
        ctx.lineTo(q.x + 24, q.y);
        ctx.moveTo(q.x, q.y - 24);
        ctx.lineTo(q.x, q.y - 8);
        ctx.moveTo(q.x, q.y + 8);
        ctx.lineTo(q.x, q.y + 24);
        ctx.stroke();
      }
      // 파워
      const pw = 260;
      const px = w / 2 - pw / 2;
      const py = h - 70;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(px - 3, py - 3, pw + 6, 18);
      const g = ctx.createLinearGradient(px, 0, px + pw, 0);
      g.addColorStop(0, '#5dff8f');
      g.addColorStop(0.7, '#ffd34d');
      g.addColorStop(1, '#ff4d4d');
      ctx.fillStyle = g;
      ctx.fillRect(px, py, pw * so.power, 12);
      ctx.fillStyle = '#fff';
      ctx.fillRect(px + pw * 0.82, py - 4, 2, 20);
      ctx.font = `14px ${FONT_BODY}`;
      ctx.textAlign = 'center';
      ctx.fillText('방향키: 조준  ·  K 길게 눌렀다 떼기: 슛 (빨간 구간은 뜰 수 있음)', w / 2, py + 34);
    }
    if (so.humanKeeping && (so.stage === 'aim' || so.stage === 'runup' || so.stage === 'ready')) {
      ctx.font = `15px ${FONT_BODY}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff';
      ctx.fillText(so.keeperDir.locked ? '다이빙 방향 확정!' : '방향키로 다이빙 방향 선택 · K로 확정 (중앙은 그대로)', w / 2, h - 48);
      // 방향 화살표
      const gk = so.keeper;
      const q = this.proj(gk.x, CY + so.keeperDir.y * 2.6, 0.8 + Math.max(0, so.keeperDir.z) * 1.2);
      if (q && (so.keeperDir.y !== 0 || so.keeperDir.z !== 0)) {
        ctx.fillStyle = so.keeperDir.locked ? '#3dff8f' : 'rgba(255,225,77,0.85)';
        ctx.beginPath();
        ctx.arc(q.x, q.y, 14, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
}

// ─────────────────────────────── 헬퍼 ───────────────────────────────

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

export function hexA(hex: string, a: number) {
  if (hex.startsWith('rgb')) return hex;
  const n = parseInt(hex.slice(1, 7), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${clamp(a, 0, 1)})`;
}

export function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1, 7), 16);
  const r = clamp(((n >> 16) & 255) + amt, 0, 255);
  const g = clamp(((n >> 8) & 255) + amt, 0, 255);
  const b = clamp((n & 255) + amt, 0, 255);
  return `rgb(${r},${g},${b})`;
}
