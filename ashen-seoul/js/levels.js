'use strict';
// ── 레벨 데이터 ───────────────────────────────────────────────────
// 한 글자 = 한 칸(32×63px). 세 줄이 한 화면 높이.
//  ' ' 빈칸     '_' 바닥     '#' 콘크리트 벽   '|' 기둥(테마별)   '=' 잔해 바닥
//  'T' 조명+바닥 't' 조명(바닥 없음)  — 지하철: 형광등 / 다리: 불타는 드럼통 / 타워: 비상등
//  'W' 광고판·전망창(바닥 없음)  'w' 같은 장식+바닥
//  '~' 무너지는 바닥   '^' 유리 조각·철근(살금살금이면 안전)
//  'x' 고장난 방화셔터(주기적으로 내리꽂힘)   'z' 끊어진 전선(주기적으로 감전)
//  'A'~'D' 셔터 문     'a'~'d' 같은 글자 셔터를 여는 스위치 발판
//  'E' 비상구  'e' 비상구 전원 스위치   'h' 구급상자  'L' 혈청(최대 체력+1)  'S' 쇠파이프
//  '@' 시작  'g' 약탈자  'k' 감염자  'V' 두목 독사  'Q' 동생 하나
const LEVELS = [
  {
    name: '제1장 · 시청역 2호선',
    place: '지하 2층 승강장',
    theme: 'subway',
    trackRow: 5,
    rows: [
      '#   t     t     t         t     t     t    #',
      '#         __h_                             #',
      '#_@_w_S_|__w_|__k__w_                      #',
      '#####################___x__z_|a__k_e__|__  #',
      '#       t           t           t          #',
      '#_E__A____^_____g__z______________h________#',
    ],
    gates: { A: 0 },
    guards: [
      { kind: 'zombie', facing: -1, hp: 2, look: 'zombie' },
      { kind: 'zombie', facing: -1, hp: 2, look: 'zombie2' },
      { kind: 'raider', facing: 1, hp: 3, skill: 0, look: 'raider' },
    ],
    signs: [{ c: 1, r: 2, text: '시청' }, { c: 31, r: 3, text: '시청' }],
    hints: [
      { c: 2, r: 2, text: '←→ 걷기·달리기   ↑ 점프   ↓ 웅크리기' },
      { c: 6, r: 2, text: '쇠파이프다! 행동(Shift)으로 줍기' },
      { c: 9, r: 2, text: '턱 아래에서 ↑: 매달리기 → 다시 ↑: 기어오르기' },
      { c: 12, r: 1, text: '구급상자 위에서 행동(Shift): 치료' },
      { c: 22, r: 3, text: '고장난 방화셔터 — 올라간 순간에 지나가라' },
      { c: 26, r: 3, text: '끊어진 전선 — 불꽃이 튈 때 밟으면 감전된다' },
      { c: 39, r: 3, text: '승강장 끝: 가장자리를 등지고 ↓로 매달린 뒤 ↓로 내려가기' },
      { c: 13, r: 5, text: '행동(Shift)+방향키: 살금살금 걸으면 유리 조각도 안전' },
      { c: 4, r: 5, text: '비상구가 잠겨 있다… 승강장의 전원 스위치를 찾자' },
    ],
  },
  {
    name: '제2장 · 한강대교',
    place: '노들섬 북단',
    theme: 'bridge',
    doorOpen: true,
    rows: [
      '#                                                  #',
      '#               __h_                               #',
      '#@___T__g__|   __T__~~_|_k__T__       ___a_T_g__A_E#',
      '#               _________|__z____k_z__##############',
      '#             __                      ##############',
      '#          _L_                        ##############',
    ],
    gates: { A: 6 },
    props: [
      { type: 'bus', c0: 16, c1: 19, r: 1 },
      { type: 'car', c: 3, r: 2, color: '#6a2a2a' }, { type: 'car', c: 27, r: 2, color: '#d8d4c8' },
      { type: 'car', c: 39, r: 2, color: '#2a4a6a' },
    ],
    guards: [
      { kind: 'raider', facing: -1, hp: 3, skill: 1, look: 'raider' },
      { kind: 'zombie', facing: -1, hp: 3, look: 'zombie' },
      { kind: 'raider', facing: -1, hp: 4, skill: 2, look: 'raider2' },
      { kind: 'zombie', facing: -1, hp: 3, look: 'zombie2' },
    ],
    hints: [
      { c: 10, r: 2, text: '다리가 끊겼다. 달리다가 가장자리에서 ↑' },
      { c: 27, r: 3, text: '전선 두 가닥 — 불꽃 사이의 틈을 노려라' },
      { c: 30, r: 2, text: '끊어진 상판… 아래 점검 통로로 내려가자' },
      { c: 39, r: 2, text: '검문소 차단 셔터 스위치 — 열려 있는 시간이 짧다' },
      { c: 12, r: 5, text: '혈청이다! 최대 체력이 늘어난다' },
    ],
  },
  {
    name: '제3장 · 남산타워',
    place: '전망대',
    theme: 'tower',
    rows: [
      '# W   W   W   W       W   W   W    #',
      '# W   W   W   W  _L_  W   W   W    #',
      '#_Q_B_w__V_w__|_w___g_w_z__T__ ____#',
      '########################### ___#####',
      '#    t    W     t   W    ___########',
      '#@_T__k_|_x__^__T___h____###########',
    ],
    gates: { B: 0 },
    props: [{ type: 'locks', c0: 1, c1: 3, r: 2 }, { type: 'locks', c0: 16, c1: 18, r: 2 }],
    bossGate: 'B',
    guards: [
      { kind: 'raider', facing: 1, hp: 6, skill: 3, look: 'boss' },
      { kind: 'raider', facing: 1, hp: 4, skill: 2, look: 'raider2' },
      { kind: 'zombie', facing: -1, hp: 3, look: 'zombie' },
    ],
    hints: [
      { c: 8, r: 5, text: '전망대는 위층이다. 방화셔터를 지나 계단 쪽으로' },
      { c: 23, r: 5, text: '턱을 차례로 붙잡고 위층으로 올라가자' },
      { c: 15, r: 2, text: '독사: “헬기 자리는 하나뿐이야. 내 거라고!”' },
    ],
  },
];

// 약탈자 기량 단계 (0 풋내기 → 3 두목)
const SKILLS = [
  { parry: 0.12, react: 0.16, cd: [1.3, 2.2], riposte: 0.15, wind: 0.3 },
  { parry: 0.3, react: 0.12, cd: [0.9, 1.7], riposte: 0.3, wind: 0.27 },
  { parry: 0.45, react: 0.1, cd: [0.7, 1.4], riposte: 0.4, wind: 0.25 },
  { parry: 0.6, react: 0.08, cd: [0.5, 1.1], riposte: 0.55, wind: 0.23 },
];
