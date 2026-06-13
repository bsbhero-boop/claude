/* =========================================================
 * 3D 병원 씬 — Three.js + Kenney CC0 애셋
 * - Kenney Furniture Kit(GLB)으로 병원 내부 가구 구성
 * - Kenney Starter Kit 캐릭터(walk/idle 애니메이션 내장) 사용
 * - 애셋 로드 실패 시 절차적(박스) 표현으로 자동 폴백
 * 절차 모드(카메라 추적 + 캐릭터 이동)와 탐색 모드(자유 회전·터치)를 지원
 * ========================================================= */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { STATIONS } from './data.js';

const COLORS = {
  floor: 0xe8edf2,
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

/* 사용할 Kenney Furniture Kit 모델 목록 (assets/models/*.glb) */
const MODEL_FILES = [
  'bedSingle', 'desk', 'chairDesk', 'chairModernCushion', 'benchCushion',
  'pottedPlant', 'plantSmall2', 'toilet', 'bathroomSink', 'bathroomMirror',
  'bookcaseOpen', 'computerScreen', 'computerKeyboard', 'televisionModern',
  'doorway', 'trashcan', 'loungeSofa', 'rugDoormat', 'rugRectangle',
  'sideTableDrawers', 'coatRackStanding',
];

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

function blobShadow(radius = 0.45) {
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 20),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.15 })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.02;
  return m;
}

/* 절차적(폴백) 캐릭터 */
function makePerson({ vest = false, elder = false } = {}) {
  const g = new THREE.Group();
  const bodyColor = elder ? COLORS.elder : COLORS.companion;
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.32, 0.7, 6, 12),
    new THREE.MeshLambertMaterial({ color: bodyColor })
  );
  body.position.y = 1.0;
  g.add(body);
  if (vest) {
    const v = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.345, 0.45, 6, 12),
      new THREE.MeshLambertMaterial({ color: COLORS.companionVest })
    );
    v.position.y = 1.08;
    v.scale.z = 0.95;
    g.add(v);
  }
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.26, 14, 12),
    new THREE.MeshLambertMaterial({ color: COLORS.skin })
  );
  head.position.y = 1.78;
  g.add(head);
  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.27, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.55),
    new THREE.MeshLambertMaterial({ color: elder ? COLORS.elderHair : 0x3a3a3a })
  );
  hair.position.y = 1.82;
  g.add(hair);
  const legL = box(0.16, 0.5, 0.16, 0x44506a, -0.14, 0.27, 0);
  const legR = box(0.16, 0.5, 0.16, 0x44506a, 0.14, 0.27, 0);
  g.add(legL, legR);
  g.userData.legs = [legL, legR];
  if (elder) {
    const cane = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 1.0, 6),
      new THREE.MeshLambertMaterial({ color: 0x7a5230 })
    );
    cane.position.set(0.42, 0.52, 0.15);
    cane.rotation.z = -0.12;
    g.add(cane);
    g.rotation.x = 0.07;
  }
  g.add(blobShadow());
  return g;
}

export class HospitalScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.mode = 'explore';
    this.onStationTap = null;
    this.walk = null;
    this.followCam = false;
    this.camTarget = new THREE.Vector3();
    this.camPos = new THREE.Vector3();
    this.markers = new Map();
    this.disposed = false;
    this.mixers = [];
    this.models = {};
    this.modelInfo = {};
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
    this._buildProtoFurniture();
    this._buildStations();
    this._buildCharacters();
    this._bindPointer();
    this._loadAssets(); // Kenney 애셋 비동기 로드 (실패해도 폴백 유지)

    this.resize();
    window.addEventListener('resize', this._onResize = () => this.resize());
    this.renderer.setAnimationLoop(() => this._tick());
  }

  /* ---------- 조명 ---------- */
  _buildLights() {
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xb9c6d4, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(12, 25, 14);
    this.scene.add(sun);
  }

  /* ---------- 구조물 (바닥·벽·정문·키오스크 본체) ---------- */
  _buildBuilding() {
    const W = 36, D = 26, H = 3.1;
    this.dims = { W, D, H };

    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(W, 0.3, D),
      new THREE.MeshLambertMaterial({ color: COLORS.floor })
    );
    floor.position.y = -0.15;
    this.scene.add(floor);
    const line = box(0.5, 0.02, 11, 0x9fc6e8, 0, 0.01, 5.5);
    this.scene.add(line);
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(70, 40),
      new THREE.MeshLambertMaterial({ color: 0xb7d4b0 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.31;
    this.scene.add(ground);

    const wallMat = new THREE.MeshLambertMaterial({ color: COLORS.wall });
    const mkWall = (w, d, x, z, height = H) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, height, d), wallMat);
      m.position.set(x, height / 2, z);
      this.scene.add(m);
      const cap = box(w + 0.1, 0.12, d + 0.1, COLORS.wallTop, x, height + 0.06, z);
      this.scene.add(cap);
    };
    mkWall(W, 0.4, 0, -D / 2);
    mkWall(0.4, D, -W / 2, 0);
    mkWall(0.4, D, W / 2, 0);
    mkWall(W / 2 - 2.5, 0.4, -(W / 4 + 1.25), D / 2);
    mkWall(W / 2 - 2.5, 0.4, W / 4 + 1.25, D / 2);
    // 정문 게이트
    this.scene.add(box(6, 0.4, 0.7, 0x4f7cae, 0, H + 0.2, D / 2));
    this.scene.add(box(0.35, H + 0.4, 0.6, 0x4f7cae, -2.8, (H + 0.4) / 2, D / 2));
    this.scene.add(box(0.35, H + 0.4, 0.6, 0x4f7cae, 2.8, (H + 0.4) / 2, D / 2));
    const sign = roundedLabel('○○병원', { bg: '#2b5d8f' });
    sign.position.set(0, H + 2.7, D / 2);
    this.scene.add(sign);

    /* 실내 칸막이는 낮게(2.2) — 추적 카메라에서 내부가 보이도록 */
    const H2 = 2.2;
    /* 진료실 벽 (우상단) */
    this.scene.add(box(7, H2, 0.35, COLORS.clinic, 9, H2 / 2, -7));
    this.scene.add(box(0.35, H2, 5.6, COLORS.clinic, 5.6, H2 / 2, -10));
    /* 검사실 벽 (좌상단) */
    this.scene.add(box(7, H2, 0.35, COLORS.exam, -9, H2 / 2, -7));
    this.scene.add(box(0.35, H2, 5.6, COLORS.exam, -5.6, H2 / 2, -10));
    /* 화장실 벽 (우하단) */
    this.scene.add(box(4.5, H2, 0.35, COLORS.restroom, 13.5, H2 / 2, 6));
    this.scene.add(box(0.35, H2, 5, COLORS.restroom, 11.2, H2 / 2, 8.5));

    /* 영상검사 장비 (Kenney 킷에 없어 절차적 표현 유지) */
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.0, 0.3, 10, 24),
      new THREE.MeshLambertMaterial({ color: 0xf3f5f8 })
    );
    ring.position.set(-11, 1.3, -10.5);
    this.scene.add(ring);

    /* 키오스크 2대 */
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

    /* 대기실 전광판 */
    const board = roundedLabel('대기 27번 · 내과', { bg: '#15314f', fg: '#7CFC9A', fontSize: 52 });
    board.position.set(0, 2.6, -4.6);
    this.scene.add(board);
  }

  /* ---------- 절차적 가구 (애셋 로드 성공 시 제거되는 폴백) ---------- */
  _buildProtoFurniture() {
    const g = new THREE.Group();
    this.protoFurniture = g;
    // 원무과
    g.add(box(1.4, 1.1, 7, COLORS.desk, -14.6, 0.55, -1));
    g.add(box(1.7, 0.08, 7.3, COLORS.deskTop, -14.6, 1.14, -1));
    g.add(box(0.5, 0.5, 0.4, 0x3a4b63, -14.5, 1.42, -3));
    g.add(box(0.5, 0.5, 0.4, 0x3a4b63, -14.5, 1.42, 1));
    // 대기실 의자
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < 5; i++) {
        g.add(makeChair(-3 + i * 1.5, -1.5 + row * 1.8, Math.PI));
      }
    }
    // 진료실
    g.add(box(1.6, 2.2, 0.18, 0x7aa98a, 7.4, 1.1, -7));
    g.add(box(2.2, 0.8, 1.1, COLORS.deskTop, 10.5, 0.45, -10.5));
    g.add(box(2.4, 0.7, 1.0, 0xeef3f7, 13.2, 0.55, -9.5));
    // 검사실
    g.add(box(1.6, 2.2, 0.18, 0xa98ac4, -7.4, 1.1, -7));
    g.add(box(0.9, 0.5, 2.8, 0xdfe5ec, -11, 0.65, -9.6));
    // 약국
    g.add(box(1.4, 1.1, 6, COLORS.pharmacy, 14.6, 0.55, 0));
    g.add(box(1.7, 0.08, 6.3, COLORS.deskTop, 14.6, 1.14, 0));
    for (let i = 0; i < 3; i++) {
      g.add(box(0.5, 0.45, 5.4, 0xe6c684, 17.4, 0.9 + i * 0.7, 0));
    }
    // 화장실 문
    g.add(box(1.4, 2.1, 0.18, 0x5d8ba3, 12.6, 1.05, 6));
    // 화분
    g.add(makePlant(-16, 9), makePlant(16, -11), makePlant(4, 8.8), makePlant(-16, -11));
    this.scene.add(g);
  }

  /* ---------- Kenney 애셋 로드 ---------- */
  async _loadAssets() {
    const loader = new GLTFLoader();
    // 가구
    try {
      const entries = await Promise.all(
        MODEL_FILES.map((n) =>
          loader.loadAsync(`assets/models/${n}.glb`).then((g) => [n, g.scene])
        )
      );
      for (const [name, obj] of entries) {
        this.models[name] = obj;
        const bb = new THREE.Box3().setFromObject(obj);
        this.modelInfo[name] = { size: bb.getSize(new THREE.Vector3()), minY: bb.min.y };
      }
      this._buildAssetFurniture();
      this.scene.remove(this.protoFurniture);
    } catch (err) {
      console.warn('가구 애셋 로드 실패 — 기본 도형으로 표시합니다.', err);
    }
    // 캐릭터
    try {
      const gltf = await loader.loadAsync('assets/models/character.glb');
      this._upgradeCharacters(gltf);
    } catch (err) {
      console.warn('캐릭터 애셋 로드 실패 — 기본 캐릭터로 표시합니다.', err);
    }
  }

  /** 모델 인스턴스 배치. h/w/d 중 하나로 균일 스케일을 정한다.
   *  Kenney 모델은 원점이 모서리 기준이므로, 회전·스케일 적용 후
   *  바운딩박스 중심(x,z)·바닥(min.y)을 기준점에 맞춘다. */
  _place(name, x, z, { ry = 0, h, w, d, y = 0 } = {}) {
    const src = this.models[name];
    if (!src) return null;
    const info = this.modelInfo[name];
    const obj = src.clone(true);
    let s = 1;
    if (h) s = h / info.size.y;
    else if (w) s = w / info.size.x;
    else if (d) s = d / info.size.z;
    obj.scale.setScalar(s);
    obj.rotation.y = ry;
    const bb = new THREE.Box3().setFromObject(obj);
    const c = bb.getCenter(new THREE.Vector3());
    obj.position.set(x - c.x, y - bb.min.y, z - c.z);
    this.assetFurniture.add(obj);
    return obj;
  }

  _buildAssetFurniture() {
    const PI = Math.PI;
    this.assetFurniture = new THREE.Group();

    /* --- 정문 로비 --- */
    this._place('rugDoormat', 0, 11.9, { w: 4.2 });
    this._place('pottedPlant', -3.7, 11.7, { h: 1.35 });
    this._place('pottedPlant', 3.7, 11.7, { h: 1.35 });
    this._place('trashcan', 3.7, 9.6, { h: 0.85 });
    this._place('loungeSofa', -8.5, 11.6, { h: 1.05, ry: PI });
    this._place('loungeSofa', 8.5, 11.6, { h: 1.05, ry: PI });

    /* --- 키오스크 앞 매트 --- */
    this._place('rugRectangle', -6, 7.4, { w: 3.2 });

    /* --- 원무과 (좌측 벽, 직원이 -x쪽·이용자가 +x쪽) --- */
    for (const z of [-3.1, -1, 1.1] ) {
      this._place('desk', -14.5, z, { h: 1.05, ry: PI / 2 });
      this._place('computerScreen', -14.9, z + 0.3, { h: 0.5, y: 1.05, ry: -PI / 2 });
      this._place('computerKeyboard', -14.6, z - 0.3, { w: 0.5, y: 1.05, ry: -PI / 2 });
      this._place('chairDesk', -16.2, z, { h: 1.15, ry: -PI / 2 });
    }
    this._place('trashcan', -16.6, 3.4, { h: 0.7 });
    this._place('pottedPlant', -16.4, -5.6, { h: 1.35 });

    /* --- 대기실 (의자 3열, 북쪽 전광판을 바라봄) --- */
    this._place('rugRectangle', 0, 0.4, { w: 8 });
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < 5; i++) {
        this._place('chairModernCushion', -3 + i * 1.5, -1.6 + row * 1.8, { h: 1.05, ry: PI });
      }
    }
    this._place('sideTableDrawers', 0, -4.6, { h: 0.95 });
    this._place('televisionModern', 0, -4.6, { h: 0.85, y: 0.95 });
    this._place('pottedPlant', -4.6, -3.4, { h: 1.35 });
    this._place('pottedPlant', 4.6, -3.4, { h: 1.35 });

    /* --- 진료실 --- */
    this._place('doorway', 7.4, -7, { h: 2.15 });
    this._place('desk', 10.4, -10.7, { h: 1.0, ry: PI });
    this._place('computerScreen', 10.0, -10.8, { h: 0.5, y: 1.0, ry: PI });
    this._place('chairDesk', 10.4, -11.7, { h: 1.15 });
    this._place('chairModernCushion', 9.0, -9.4, { h: 1.05, ry: PI });
    this._place('chairModernCushion', 10.2, -9.4, { h: 1.05, ry: PI });
    this._place('bedSingle', 13.8, -10.3, { d: 2.4, ry: PI / 2 });
    this._place('sideTableDrawers', 13.8, -8.6, { h: 0.8 });
    this._place('coatRackStanding', 6.4, -11.8, { h: 1.8 });

    /* --- 검사실 (CT 링 아래로 침대 배치) --- */
    this._place('doorway', -7.4, -7, { h: 2.15 });
    this._place('bedSingle', -11, -9.7, { d: 2.6 });
    this._place('desk', -6.6, -11.2, { h: 1.0, ry: -PI / 2 });
    this._place('computerScreen', -6.5, -11.2, { h: 0.5, y: 1.0, ry: -PI / 2 });
    this._place('chairDesk', -7.7, -11.2, { h: 1.15, ry: PI / 2 });
    this._place('trashcan', -6.3, -8.2, { h: 0.7 });

    /* --- 약국 (우측 벽, 약 선반 + 카운터) --- */
    for (const z of [-2.1, 0, 2.1]) {
      this._place('desk', 14.5, z, { h: 1.05, ry: -PI / 2 });
      this._place('bookcaseOpen', 17.5, z, { h: 2.3, ry: -PI / 2 });
    }
    this._place('computerScreen', 14.9, 0.3, { h: 0.5, y: 1.05, ry: PI / 2 });
    this._place('chairDesk', 16.2, 0, { h: 1.15, ry: PI / 2 });
    this._place('trashcan', 16.8, 4.2, { h: 0.7 });

    /* --- 화장실 --- */
    this._place('doorway', 12.6, 6, { h: 2.15 });
    this._place('toilet', 16.6, 11.2, { h: 1.05, ry: -PI / 2 });
    this._place('bathroomSink', 12.3, 11.8, { h: 1.0, ry: PI });
    this._place('bathroomMirror', 12.3, 12.7, { h: 0.85, y: 1.45, ry: PI });

    /* --- 공용 화분·소품 --- */
    this._place('pottedPlant', -16.4, 11.5, { h: 1.4 });
    this._place('pottedPlant', 16.4, -11.4, { h: 1.4 });
    this._place('pottedPlant', -16.4, -11.4, { h: 1.4 });
    this._place('plantSmall2', 4, 8.8, { h: 0.9 });

    this.scene.add(this.assetFurniture);
  }

  /* ---------- 캐릭터 ---------- */
  _buildCharacters() {
    this.companion = makePerson({ vest: true });
    this.elder = makePerson({ elder: true });
    this.companion.position.set(-0.7, 0, 12.5);
    this.elder.position.set(0.7, 0, 12.8);
    this.scene.add(this.companion, this.elder);
  }

  /** Kenney 캐릭터(GLB, idle/walk 애니메이션 내장)로 교체 */
  _upgradeCharacters(gltf) {
    const clips = gltf.animations || [];
    const idleClip = clips.find((c) => c.name === 'idle');
    const walkClip = clips.find((c) => c.name === 'walk');
    if (!idleClip || !walkClip) return;

    const build = ({ elder = false }) => {
      const model = gltf.scene.clone(true);
      const inner = new THREE.Group();
      inner.add(model); // 모델 전방(+Z)이 이동 로직 전방과 동일

      const bb = new THREE.Box3().setFromObject(model);
      const size = bb.getSize(new THREE.Vector3());
      const targetH = elder ? 1.62 : 1.78;
      const s = targetH / size.y;
      inner.scale.setScalar(s);
      inner.position.y = -bb.min.y * s;

      const antenna = model.getObjectByName('antenna');
      if (antenna) antenna.visible = false;

      // 다리(바지)·팔 색으로 역할 구분
      const tint = (names, color) => {
        for (const nm of names) {
          const part = model.getObjectByName(nm);
          if (part && part.isMesh) {
            part.material = part.material.clone();
            part.material.color.set(color);
          }
        }
      };
      tint(['leg-left', 'leg-right'], elder ? 0x9aa3ad : 0x2c4f8a);
      if (elder) tint(['arm-left', 'arm-right', 'torso'], 0xc9ccd2);

      const torso = model.getObjectByName('torso');
      if (torso) {
        if (elder) {
          // 흰머리 (머리 윗부분 캡)
          const hair = new THREE.Mesh(
            new THREE.SphereGeometry(0.27, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.5),
            new THREE.MeshLambertMaterial({ color: COLORS.elderHair })
          );
          hair.position.set(0, 0.555, -0.01);
          hair.scale.set(1, 0.55, 1);
          torso.add(hair);
        } else {
          // 동행인력 식별 조끼 (배 부분)
          const vest = new THREE.Mesh(
            new THREE.CylinderGeometry(0.285, 0.315, 0.34, 14, 1, true),
            new THREE.MeshLambertMaterial({ color: COLORS.companionVest, side: THREE.DoubleSide })
          );
          vest.position.set(0, 0.13, 0);
          torso.add(vest);
        }
      }

      const group = new THREE.Group();
      group.add(inner);
      if (elder) {
        const cane = new THREE.Mesh(
          new THREE.CylinderGeometry(0.045, 0.045, 0.95, 8),
          new THREE.MeshLambertMaterial({ color: 0x7a5230 })
        );
        cane.position.set(0.48, 0.5, 0.18);
        cane.rotation.z = -0.1;
        group.add(cane);
        inner.rotation.x = 0.06; // 살짝 구부정한 자세
      }
      group.add(blobShadow());

      const mixer = new THREE.AnimationMixer(model);
      const actions = {
        idle: mixer.clipAction(idleClip),
        walk: mixer.clipAction(walkClip),
      };
      actions.walk.timeScale = 1.5;
      actions.idle.play();
      this.mixers.push(mixer);
      group.userData.anim = { actions, current: 'idle' };
      return group;
    };

    const swap = (oldGroup, newGroup) => {
      newGroup.position.copy(oldGroup.position);
      newGroup.rotation.y = oldGroup.rotation.y;
      this.scene.remove(oldGroup);
      this.scene.add(newGroup);
      return newGroup;
    };
    this.companion = swap(this.companion, build({ elder: false }));
    this.elder = swap(this.elder, build({ elder: true }));
  }

  /** idle ↔ walk 크로스페이드 */
  _setMoving(moving) {
    for (const p of [this.companion, this.elder]) {
      const anim = p.userData.anim;
      if (!anim) continue;
      const next = moving ? 'walk' : 'idle';
      if (anim.current === next) continue;
      const from = anim.actions[anim.current];
      const to = anim.actions[next];
      to.reset().play();
      from.crossFadeTo(to, 0.18, false);
      anim.current = next;
    }
  }

  /* ---------- 스테이션 마커 ---------- */
  _buildStations() {
    const labelColors = {
      entrance: '#2b6cb0', kiosk: '#2f3e55', reception: '#1f6f54', waiting: '#946200',
      clinic: '#3c7a52', exam: '#6b4f8f', pharmacy: '#a85d12', restroom: '#3b7a96',
    };
    for (const st of STATIONS) {
      const [x, z] = st.pos;
      const label = roundedLabel(`${st.icon} ${st.short}`, { bg: labelColors[st.id] || '#1e3a5f' });
      label.position.set(x, 3.3, z);
      this.scene.add(label);
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

  /* ---------- 입력 ---------- */
  _bindPointer() {
    const ray = new THREE.Raycaster();
    const v2 = new THREE.Vector2();
    let downX = 0, downY = 0;
    this.canvas.addEventListener('pointerdown', (e) => { downX = e.clientX; downY = e.clientY; });
    this.canvas.addEventListener('pointerup', (e) => {
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
    this._setMoving(true);
  }

  /** 캐릭터·카메라를 시작 위치로 */
  resetActors() {
    this.walk = null;
    this._setMoving(false);
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
    const dt = Math.min(this._clock.getDelta(), 0.1);
    const t = this._clock.elapsedTime;

    for (const m of this.mixers) m.update(dt);

    for (const { ring } of this.markers.values()) {
      const s = 1 + Math.sin(t * 2.6) * 0.07;
      ring.scale.set(s, s, 1);
    }

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
          // 도착하면 카메라 쪽으로 몸을 돌려 얼굴이 보이게
          for (const p of [this.companion, this.elder]) {
            p.rotation.y = Math.atan2(this.camera.position.x - p.position.x, this.camera.position.z - p.position.z);
          }
          const cb = w.onArrive;
          this.walk = null;
          this._setLegPose(0);
          this._setMoving(false);
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
      // 절차적(폴백) 캐릭터 전용 걷기 흉내 — 애셋 캐릭터는 내장 walk 클립 사용
      if (this.companion.userData.legs) {
        const swing = Math.sin(t * 9);
        this._setLegPose(swing * 0.5);
        this.companion.position.y = Math.abs(Math.sin(t * 9)) * 0.06;
        this.elder.position.y = Math.abs(Math.sin(t * 9 + 0.6)) * 0.05;
      }
    } else if (this.companion.userData.legs) {
      this.companion.position.y = Math.sin(t * 1.8) * 0.015;
      this.elder.position.y = Math.sin(t * 1.6 + 1) * 0.015;
    }

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
      if (!p.userData.legs) continue;
      const [l, r] = p.userData.legs;
      l.rotation.x = angle;
      r.rotation.x = -angle;
    }
  }
}
