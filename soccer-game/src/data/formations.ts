import type { FormationId, Role } from '../game/types';

/**
 * 포메이션 슬롯. u: 자기 골라인(0) → 상대 골라인(1), v: 공격 방향 기준 왼쪽(0) → 오른쪽(1).
 * 값은 "중앙 블록에서 수비 대형을 갖췄을 때"의 기준 위치다.
 */
export interface Slot {
  label: string;
  role: Role;
  u: number;
  v: number;
  /** 측면 선수(풀백·윙어) — 공격 시 넓게 벌린다 */
  wide?: boolean;
}

const back4: Slot[] = [
  { label: 'LB', role: 'DF', u: 0.2, v: 0.12, wide: true },
  { label: 'CB', role: 'DF', u: 0.17, v: 0.37 },
  { label: 'CB', role: 'DF', u: 0.17, v: 0.63 },
  { label: 'RB', role: 'DF', u: 0.2, v: 0.88, wide: true },
];

const GK: Slot = { label: 'GK', role: 'GK', u: 0.025, v: 0.5 };

export const FORMATIONS: Record<FormationId, Slot[]> = {
  '4-4-2': [
    GK,
    ...back4,
    { label: 'LM', role: 'MF', u: 0.4, v: 0.13, wide: true },
    { label: 'CM', role: 'MF', u: 0.36, v: 0.38 },
    { label: 'CM', role: 'MF', u: 0.36, v: 0.62 },
    { label: 'RM', role: 'MF', u: 0.4, v: 0.87, wide: true },
    { label: 'ST', role: 'FW', u: 0.56, v: 0.4 },
    { label: 'ST', role: 'FW', u: 0.58, v: 0.6 },
  ],
  '4-3-3': [
    GK,
    ...back4,
    { label: 'CDM', role: 'MF', u: 0.33, v: 0.5 },
    { label: 'CM', role: 'MF', u: 0.4, v: 0.3 },
    { label: 'CM', role: 'MF', u: 0.4, v: 0.7 },
    { label: 'LW', role: 'FW', u: 0.58, v: 0.14, wide: true },
    { label: 'ST', role: 'FW', u: 0.62, v: 0.5 },
    { label: 'RW', role: 'FW', u: 0.58, v: 0.86, wide: true },
  ],
  '4-2-3-1': [
    GK,
    ...back4,
    { label: 'CDM', role: 'MF', u: 0.32, v: 0.4 },
    { label: 'CDM', role: 'MF', u: 0.32, v: 0.6 },
    { label: 'LAM', role: 'MF', u: 0.48, v: 0.16, wide: true },
    { label: 'CAM', role: 'MF', u: 0.5, v: 0.5 },
    { label: 'RAM', role: 'MF', u: 0.48, v: 0.84, wide: true },
    { label: 'ST', role: 'FW', u: 0.63, v: 0.5 },
  ],
  '3-5-2': [
    GK,
    { label: 'CB', role: 'DF', u: 0.17, v: 0.27 },
    { label: 'CB', role: 'DF', u: 0.15, v: 0.5 },
    { label: 'CB', role: 'DF', u: 0.17, v: 0.73 },
    { label: 'LWB', role: 'MF', u: 0.36, v: 0.08, wide: true },
    { label: 'CDM', role: 'MF', u: 0.32, v: 0.5 },
    { label: 'CM', role: 'MF', u: 0.4, v: 0.32 },
    { label: 'CM', role: 'MF', u: 0.4, v: 0.68 },
    { label: 'RWB', role: 'MF', u: 0.36, v: 0.92, wide: true },
    { label: 'ST', role: 'FW', u: 0.58, v: 0.4 },
    { label: 'ST', role: 'FW', u: 0.6, v: 0.6 },
  ],
};

export const FORMATION_IDS: FormationId[] = ['4-4-2', '4-3-3', '4-2-3-1', '3-5-2'];

export const FORMATION_DESC: Record<FormationId, string> = {
  '4-4-2': '균형 잡힌 두 줄 수비. 투톱의 연계가 강점.',
  '4-3-3': '넓은 스리톱으로 측면을 흔든다. 압박에 유리.',
  '4-2-3-1': '두 명의 수비형 미드필더로 안정감, 공격형 미드필더가 창의성.',
  '3-5-2': '윙백이 오르내리며 중원 숫자 싸움에서 우위.',
};
