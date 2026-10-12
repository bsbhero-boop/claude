// 경기장 규격 (미터). x: 0(왼쪽 골라인) → 105(오른쪽 골라인), y: 0(먼 쪽 터치라인) → 68(카메라 쪽 터치라인)

export const PITCH_L = 105;
export const PITCH_W = 68;
export const CX = PITCH_L / 2;
export const CY = PITCH_W / 2;

export const GOAL_HALF_W = 3.66;
export const GOAL_H = 2.44;
export const GOAL_DEPTH = 2.2;
export const POST_R = 0.07;
export const BALL_R = 0.11;

export const BOX_DEPTH = 16.5;
export const BOX_HALF_W = 20.16;
export const SIX_DEPTH = 5.5;
export const SIX_HALF_W = 9.16;
export const PEN_SPOT = 11;
export const CIRCLE_R = 9.15;

export const GRAVITY = 10.5;

export const PLAYER_R = 0.42;
export const CONTROL_R = 0.75;

/** 기본 달리기 속도(m/s) — 아케이드 감각을 위해 실제보다 약간 빠르다 */
export const RUN_SPEED = 6.3;
export const SPRINT_SPEED = 8.6;

export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;
