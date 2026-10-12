export type Role = 'GK' | 'DF' | 'MF' | 'FW';

export type Personality = 'passionate' | 'calm' | 'nervous' | 'confident' | 'determined';

export type SpecialType =
  | 'fire'
  | 'thunder'
  | 'tornado'
  | 'meteor'
  | 'ice'
  | 'phantom'
  | 'dragon'
  | 'tiger';

export type FormationId = '4-4-2' | '4-3-3' | '4-2-3-1' | '3-5-2';

export interface Kit {
  shirt: string;
  shorts: string;
  socks: string;
  /** 등번호·줄무늬 등 보조 색 */
  accent: string;
  /** 세로 줄무늬 유니폼 */
  stripes?: boolean;
}

export interface PlayerDef {
  name: string;
  num: number;
  /** 포메이션 슬롯 라벨 (ST, CB …) — 포메이션에서 채워짐 */
  role: Role;
  pac: number;
  sho: number;
  pas: number;
  dri: number;
  def: number;
  gk: number;
  personality: Personality;
  ace: boolean;
  skin: string;
  hair: string;
}

export interface TeamDef {
  id: string;
  name: string;
  short: string;
  nick: string;
  home: Kit;
  away: Kit;
  gkShirt: string;
  formation: FormationId;
  style: string;
  special: { type: SpecialType; name: string };
  /** 공격/중원/수비/골키퍼 능력치 (0~99) */
  att: number;
  mid: number;
  def: number;
  gkr: number;
  players: PlayerDef[];
  manager: string;
}

export interface Tactics {
  formation: FormationId;
  /** -2(매우 수비적) .. 2(매우 공격적) */
  mentality: number;
  /** 0 낮음, 1 보통, 2 높음 */
  pressing: number;
}

export type Difficulty = 0 | 1 | 2 | 3;

export interface MatchConfig {
  home: TeamDef;
  away: TeamDef;
  /** 사람이 조종하는 팀: 0=home, 1=away, -1=둘 다 CPU(관전/테스트) */
  humanSide: 0 | 1 | -1;
  halfMinutes: number;
  difficulty: Difficulty;
  homeTactics: Tactics;
  awayTactics: Tactics;
  /** 선수별 사기 (-3..3), 인덱스는 players와 동일 */
  homeMorale: number[];
  awayMorale: number[];
  knockout: boolean;
  stageName: string;
  night: boolean;
}

export interface TeamStats {
  shots: number;
  onTarget: number;
  passes: number;
  passesDone: number;
  tackles: number;
  fouls: number;
  corners: number;
  possessionTime: number;
  specials: number;
  saves: number;
}

export interface GoalEvent {
  side: 0 | 1;
  scorer: string;
  minute: number;
  special: boolean;
  penalty?: boolean;
}

export interface MatchResult {
  homeGoals: number;
  awayGoals: number;
  homePens?: number;
  awayPens?: number;
  stats: [TeamStats, TeamStats];
  goals: GoalEvent[];
  ratings: [number[], number[]];
  mom: { side: 0 | 1; index: number; rating: number };
}
