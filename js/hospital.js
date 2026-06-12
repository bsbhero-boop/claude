/* =========================================================
 * 3D 병원 씬 — Three.js
 * 절차 모드(카메라 추적 + 캐릭터 이동)와 탐색 모드(자유 회전·터치)를 지원
 * ========================================================= */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STATIONS } from './data.js';

const COLORS = {
  floor: 0xe8edf2,
  floorLine: 0xd2dae3,
  wall: 0xf7f9fb,
  wallTop: 0xdfe6ee,
  desk: 0x8fb6d9,
  deskTop: 0xffffff,
  chair: 0x6f9ed6,
  chairLeg: 0x9aa7b5,
  kiosk: 0x2f3e55,
  kioskScreen: 0x6fd3ff,
  clinic: 0xbcd9c4,
  exam: 0xd9c9e8,
  pharmacy: 0xf3d9a8,
  restroom: 0xc4dde8,
  plant: 0x4f9e63,
  pot: 0xb98b5a,
  companion: 0x2563eb,
  companionVest: 0xf59e0b,
  elder: 0x8b95a3,
  elderHair: 0xdfe3e8,
  skin: 0xf2c9a4,
};

function roundedLabel(text, opts = {}) {
  const { bg = '#1e3a5f', fg = '#ffffff', fontSize = 58 } = opts;
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = bg;
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(4, 4, 504, 120, 28);
    ctx.fill();
  } else {
    ctx.fillRect(4, 4, 504, 120);
  }
  ctx.fillStyle = fg;
  ctx.font = `700 ${fontSize}px "Pretendard","Apple SD Gothic Neo","Malgun Gothic",sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 70);
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(3.4, 0.85, 1);
  return sprite;
}

function box(w, h, d, color, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshLambertMaterial({ color })
  );
  m.position.set(x, y, z);
  return m;
}

function makeChair(x, z, rotY = 0) {
  const g = new THREE.Group();
  g.add(box(0.7, 0.1, 0.7, COLORS.chair, 0, 0.45, 0));
  g.add(box(0.7, 0.65, 0.1, COLORS.chair, 0, 0.8, -0.3));
  const legs = box(0.55, 0.45, 0.55, COLORS.chairLeg, 0, 0.22, 0);
  legs.scale.set(0.85, 1, 0.85);
  g.add(legs);
  g.position.set(x, 0, z);
  g.rotation.y = rotY;
  return g;
}

function makePlant(x, z) {
  const g = new THREE.Group();
  g.add(box(0.55, 0.55, 0.55, COLORS.pot, 0, 0.28, 0));
  const leaf = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 8, 6),
    new THREE.MeshLambertMaterial({ color: COLORS.plant })
  );
  leaf.position.y = 1.0;
  leaf.scale.y = 1.3;
  g.add(leaf);
  g.position.set(x, 0, z);
  return g;
}

function makePerson({ vest = false, elder = false } = {}) {
  const g = new THREE.Group();
  const bodyColor = elder ? COLORS.elder : COLORS.companion;
  // 몸통
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.32, 0.7, 6, 12),
    new THREE.MeshLambertMaterial({ color: bodyColor })
  );
  body.position.y = 1.0;
  g.add(body);
  // 조끼(동행인력 식별)
  if (vest) {
    const v = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.345, 0.45, 6, 12),
      new THREE.MeshLambertMaterial({ color: COLORS.companionVest })
    );
    v.position.y = 1.08;
    v.scale.z = 0.95;
    g.add(v);
  }
  // 머리
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.26, 14, 12),
    new THREE.MeshLambertMaterial({ color: COLORS.skin })
  );
  head.position.y = 1.78;
  g.add(head);
  // 머리카락
  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.27, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.55),
    new THREE.MeshLambertMaterial({ color: elder ? COLORS.elderHair : 0x3a3a3a })
  );
  hair.position.y = 1.82;
  g.add(hair);
  // 다리
  const legL = box(0.16, 0.5, 0.16, 0x44506a, -0.14, 0.27, 0);
  const legR = box(0.16, 0.5, 0.16, 0x44506a, 0.14, 0.27, 0);
  g.add(legL, legR);
  g.userData.legs = [legL, legR];
  // 지팡이(어르신)
  if (elder) {
    const cane = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 1.0, 6),
      new THREE.MeshLambertMaterial({ color: 0x7a5230 })
    );
    cane.position.set(0.42, 0.52, 0.15);
    cane.rotation.z = -0.12;
    g.add(cane);
    g.rotation.x = 0.07; // 살짝 구부정한 자세
  }
  // 그림자 원판
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.45, 20),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.15 })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  g.add(shadow);
  return g;
}

export class HospitalScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.mode = 'explore';
    this.onStationTap = null;
    this.walk = null;            // 이동 상태
    this.followCam = false;
    this.camTarget = new THREE.Vector3();
    this.camPos = new THREE.Vector3();
    this.markers = new Map();
    this.disposed = false;
    this._clock = new THREE.Clock();

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xcfe3f2);
    this.scene.fog = new THREE.Fog(0xcfe3f2, 45, 80);

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
    this._setOverviewCamera();
    this.camera.lookAt(0, 0, 0);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0.5, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.46;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 45;

    this._buildLights();
    this._buildBuilding();
    this._buildStations();
    this._buildCharacters();
    this._bindPointer();

    this.resize();
    window.addEventListener('resize', this._onResize = () => this.resize());
    this.renderer.setAnimationLoop(() => this._tick());
  }

  /* ---------- 구성 ---------- */
  _buildLights() {
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xb9c6d4, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(12, 25, 14);
    this.scene.add(sun);
  }

  _buildBuilding() {
    const W = 36, D = 26, H = 3.1;
    // 바닥
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(W, 0.3, D),
      new THREE.MeshLambertMaterial({ color: COLORS.floor })
    );
    floor.position.y = -0.15;
    this.scene.add(floor);
    // 바닥 안내선 (정문 → 대기실)
    const line = box(0.5, 0.02, 11, 0x9fc6e8, 0, 0.01, 5.5);
    this.scene.add(line);
    // 외부 잔디
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(70, 40),
      new THREE.MeshLambertMaterial({ color: 0xb7d4b0 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.31;
    this.scene.add(ground);

    const wallMat = new THREE.MeshLambertMaterial({ color: COLORS.wall });
    const mkWall = (w, d, x, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, H, d), wallMat);
      m.position.set(x, H / 2, z);
      this.scene.add(m);
      const cap = box(w + 0.1, 0.12, d + 0.1, COLORS.wallTop, x, H + 0.06, z);
      this.scene.add(cap);
    };
    // 북·동·서 벽 + 남쪽(정문 개구부 포함)
    mkWall(W, 0.4, 0, -D / 2);
    mkWall(0.4, D, -W / 2, 0);
    mkWall(0.4, D, W / 2, 0);
    mkWall(W / 2 - 2.5, 0.4, -(W / 4 + 1.25), D / 2);
    mkWall(W / 2 - 2.5, 0.4, W / 4 + 1.25, D / 2);
    // 정문 게이트
    const gate = box(6, 0.4, 0.7, 0x4f7cae, 0, H + 0.2, D / 2);
    this.scene.add(gate);
    const gateL = box(0.35, H + 0.4, 0.6, 0x4f7cae, -2.8, (H + 0.4) / 2, D / 2);
    const gateR = box(0.35, H + 0.4, 0.6, 0x4f7cae, 2.8, (H + 0.4) / 2, D / 2);
    this.scene.add(gateL, gateR);
    const sign = roundedLabel('○○병원', { bg: '#2b5d8f' });
    sign.position.set(0, H + 2.7, D / 2);
    this.scene.add(sign);

    /* --- 원무과 (좌측 벽) --- */
    this.scene.add(box(1.4, 1.1, 7, COLORS.desk, -14.6, 0.55, -1));
    this.scene.add(box(1.7, 0.08, 7.3, COLORS.deskTop, -14.6, 1.14, -1));
    this.scene.add(box(0.5, 0.5, 0.4, 0x3a4b63, -14.5, 1.42, -3)); // 모니터
    this.scene.add(box(0.5, 0.5, 0.4, 0x3a4b63, -14.5, 1.42, 1));

    /* --- 키오스크 2대 --- */
    for (const dx of [-0.9, 0.9]) {
      const k = new THREE.Group();
      k.add(box(0.9, 1.5, 0.55, COLORS.kiosk, 0, 0.75, 0));
      const screen = box(0.74, 0.85, 0.07, COLORS.kioskScreen, 0, 1.45, 0.28);
      screen.rotation.x = -0.28;
      k.add(screen);
      k.add(box(0.8, 0.12, 0.45, 0x1f2a3d, 0, 0.06, 0.1));
      k.position.set(-6 + dx, 0, 8.6);
      k.rotation.y = Math.PI;
      this.scene.add(k);
    }

    /* --- 대기실 의자 --- */
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < 5; i++) {
        this.scene.add(makeChair(-3 + i * 1.5, -1.5 + row * 1.8, Math.PI));
      }
    }
    // 전광판
    const board = roundedLabel('대기 27번 · 내과', { bg: '#15314f', fg: '#7CFC9A', fontSize: 52 });
    board.position.set(0, 2.6, -4.2);
    this.scene.add(board);

    /* --- 진료실 (우상단) --- */
    this.scene.add(box(7, H, 0.35, COLORS.clinic, 9, H / 2, -7));
    this.scene.add(box(0.35, H, 5.6, COLORS.clinic, 5.6, H / 2, -10));
    this.scene.add(box(1.6, 2.2, 0.18, 0x7aa98a, 7.4, 1.1, -7)); // 문
    this.scene.add(box(2.2, 0.8, 1.1, COLORS.deskTop, 10.5, 0.45, -10.5)); // 진료 책상
    this.scene.add(box(2.4, 0.7, 1.0, 0xeef3f7, 13.2, 0.55, -9.5)); // 진찰 침대

    /* --- 검사실 (좌상단) --- */
    this.scene.add(box(7, H, 0.35, COLORS.exam, -9, H / 2, -7));
    this.scene.add(box(0.35, H, 5.6, COLORS.exam, -5.6, H / 2, -10));
    this.scene.add(box(1.6, 2.2, 0.18, 0xa98ac4, -7.4, 1.1, -7)); // 문
    // 영상 장비(도넛형)
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.0, 0.3, 10, 24),
      new THREE.MeshLambertMaterial({ color: 0xf3f5f8 })
    );
    ring.position.set(-11, 1.3, -10.5);
    this.scene.add(ring);
    this.scene.add(box(0.9, 0.5, 2.8, 0xdfe5ec, -11, 0.65, -9.6));

    /* --- 약국 (우측 벽) --- */
    this.scene.add(box(1.4, 1.1, 6, COLORS.pharmacy, 14.6, 0.55, 0));
    this.scene.add(box(1.7, 0.08, 6.3, COLORS.deskTop, 14.6, 1.14, 0));
    // 약 선반
    for (let i = 0; i < 3; i++) {
      this.scene.add(box(0.5, 0.45, 5.4, 0xe6c684, 17.4, 0.9 + i * 0.7, 0));
    }

    /* --- 화장실 (우하단) --- */
    this.scene.add(box(4.5, H, 0.35, COLORS.restroom, 13.5, H / 2, 6));
    this.scene.add(box(0.35, H, 5, COLORS.restroom, 11.2, H / 2, 8.5));
    this.scene.add(box(1.4, 2.1, 0.18, 0x5d8ba3, 12.6, 1.05, 6)); // 문

    /* --- 화분/소품 --- */
    this.scene.add(makePlant(-16, 9), makePlant(16, -11), makePlant(4, 8.8), makePlant(-16, -11));
  }

  _buildStations() {
    const labelColors = {
      entrance: '#2b6cb0', kiosk: '#2f3e55', reception: '#1f6f54', waiting: '#946200',
      clinic: '#3c7a52', exam: '#6b4f8f', pharmacy: '#a85d12', restroom: '#3b7a96',
    };
    for (const st of STATIONS) {
      const [x, z] = st.pos;
      // 안내 표지판
      const label = roundedLabel(`${st.icon} ${st.short}`, { bg: labelColors[st.id] || '#1e3a5f' });
      label.position.set(x, 3.3, z);
      this.scene.add(label);
      // 바닥 마커(클릭 대상)
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.75, 1.05, 28),
        new THREE.MeshBasicMaterial({ color: 0x2f80d8, transparent: true, opacity: 0.55, side: THREE.DoubleSide })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(x, 0.03, z);
      ring.userData.stationId = st.id;
      this.scene.add(ring);
      const hit = new THREE.Mesh(
        new THREE.CylinderGeometry(1.6, 1.6, 3.6, 10),
        new THREE.MeshBasicMaterial({ visible: false })
      );
      hit.position.set(x, 1.8, z);
      hit.userData.stationId = st.id;
      this.scene.add(hit);
      this.markers.set(st.id, { ring, hit, pos: new THREE.Vector3(x, 0, z) });
    }
  }

  _buildCharacters() {
    this.companion = makePerson({ vest: true });
    this.elder = makePerson({ elder: true });
    this.companion.position.set(-0.7, 0, 12.5);
    this.elder.position.set(0.7, 0, 12.8);
    this.scene.add(this.companion, this.elder);
  }

  /* ---------- 입력 ---------- */
  _bindPointer() {
    const ray = new THREE.Raycaster();
    const v2 = new THREE.Vector2();
    let downX = 0, downY = 0;
    this.canvas.addEventListener('pointerdown', (e) => { downX = e.clientX; downY = e.clientY; });
    this.canvas.addEventListener('pointerup', (e) => {
      // 드래그(카메라 회전)와 탭 구분
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 8) return;
      if (this.mode !== 'explore' || !this.onStationTap) return;
      const r = this.canvas.getBoundingClientRect();
      v2.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(v2, this.camera);
      const hits = ray.intersectObjects([...this.markers.values()].map((m) => m.hit));
      if (hits.length) this.onStationTap(hits[0].object.userData.stationId);
    });
  }

  /* ---------- 공개 API ---------- */
  setMode(mode) {
    this.mode = mode;
    this.followCam = false;
    this.controls.enabled = true;
    if (mode === 'explore') {
      this.controls.target.set(0, 0.5, 0);
      this._setOverviewCamera();
    }
  }

  /** 세로(모바일) 화면에서는 병원 전체가 보이도록 더 멀리서 시작 */
  _setOverviewCamera() {
    const aspect = (this.canvas.clientWidth || 1) / (this.canvas.clientHeight || 1);
    if (aspect < 0.8) this.camera.position.set(0, 30, 36);
    else this.camera.position.set(0, 22, 26);
  }

  setMarkersVisible(visible) {
    for (const { ring } of this.markers.values()) ring.visible = visible;
  }

  highlightStation(id) {
    for (const [sid, { ring }] of this.markers) {
      ring.material.color.set(sid === id ? 0xff8a3d : 0x2f80d8);
      ring.material.opacity = sid === id ? 0.9 : 0.55;
    }
  }

  /** 두 캐릭터를 스테이션으로 이동. 도착 시 onArrive 호출 */
  walkTo(stationId, onArrive, { follow = false } = {}) {
    const m = this.markers.get(stationId);
    if (!m) { onArrive && onArrive(); return; }
    const target = m.pos.clone();
    const from = this.companion.position.clone();
    // 중앙 통로를 경유해 벽 통과를 피함
    const mid = new THREE.Vector3(target.x * 0.35, 0, 4.0);
    const path = from.distanceTo(target) > 7 ? [from, mid, target] : [from, target];
    this.walk = { path, seg: 0, t: 0, onArrive, speed: 3.0 };
    this.followCam = follow;
    if (follow) this.controls.enabled = false;
    this.highlightStation(stationId);
  }

  /** 캐릭터·카메라를 시작 위치로 */
  resetActors() {
    this.walk = null;
    this.companion.position.set(-0.7, 0, 12.5);
    this.elder.position.set(0.7, 0, 12.8);
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    window.removeEventListener('resize', this._onResize);
    this.renderer.dispose();
  }

  /* ---------- 프레임 루프 ---------- */
  _tick() {
    if (this.disposed) return;
    const dt = Math.min(this._clock.getDelta(), 0.05);
    const t = this._clock.elapsedTime;

    // 마커 펄스
    for (const { ring } of this.markers.values()) {
      const s = 1 + Math.sin(t * 2.6) * 0.07;
      ring.scale.set(s, s, 1);
    }

    // 캐릭터 이동
    if (this.walk) {
      const w = this.walk;
      const a = w.path[w.seg], b = w.path[w.seg + 1];
      const segLen = a.distanceTo(b) || 0.001;
      w.t += (w.speed * dt) / segLen;
      if (w.t >= 1) {
        w.t = 0; w.seg++;
        if (w.seg >= w.path.length - 1) {
          this.companion.position.copy(w.path[w.path.length - 1]).add(new THREE.Vector3(-0.65, 0, 0.5));
          this.elder.position.copy(w.path[w.path.length - 1]).add(new THREE.Vector3(0.65, 0, 0.8));
          const cb = w.onArrive;
          this.walk = null;
          this._setLegPose(0);
          cb && cb();
          return;
        }
      }
      const cur = a.clone().lerp(b, Math.min(w.t, 1));
      const dir = b.clone().sub(a).normalize();
      const side = new THREE.Vector3(-dir.z, 0, dir.x);
      this.companion.position.copy(cur).addScaledVector(side, -0.62);
      this.elder.position.copy(cur).addScaledVector(side, 0.62).addScaledVector(dir, -0.35);
      const ang = Math.atan2(dir.x, dir.z);
      this.companion.rotation.y = ang;
      this.elder.rotation.y = ang;
      // 걷기 애니메이션
      const swing = Math.sin(t * 9);
      this._setLegPose(swing * 0.5);
      this.companion.position.y = Math.abs(Math.sin(t * 9)) * 0.06;
      this.elder.position.y = Math.abs(Math.sin(t * 9 + 0.6)) * 0.05;
    } else {
      // 대기 중 살짝 숨쉬기
      this.companion.position.y = Math.sin(t * 1.8) * 0.015;
      this.elder.position.y = Math.sin(t * 1.6 + 1) * 0.015;
    }

    // 추적 카메라 (절차 모드)
    if (this.followCam) {
      const c = this.companion.position;
      // 정문 근처에서는 건물 안쪽에서 바라보도록 카메라 방향을 전환
      const dz = c.z > 4 ? -7.5 : 7.5;
      this.camPos.set(c.x + 4, 6.2, c.z + dz);
      this.camera.position.lerp(this.camPos, 1 - Math.pow(0.001, dt));
      this.camTarget.lerp(new THREE.Vector3(c.x, 1.2, c.z), 1 - Math.pow(0.0005, dt));
      this.camera.lookAt(this.camTarget);
    } else {
      this.controls.update();
    }

    this.renderer.render(this.scene, this.camera);
  }

  _setLegPose(angle) {
    for (const p of [this.companion, this.elder]) {
      const [l, r] = p.userData.legs;
      l.rotation.x = angle;
      r.rotation.x = -angle;
    }
  }
}
