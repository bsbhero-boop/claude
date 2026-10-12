import { TEAMS, teamById } from './data/teams';
import type { Difficulty, MatchResult, TeamDef } from './game/types';

export interface FixtureResult {
  round: number;
  home: string;
  away: string;
  hg: number;
  ag: number;
  hp?: number;
  ap?: number;
  winner: string;
  user: boolean;
  scorers?: string[];
}

export interface TournamentState {
  version: 1;
  userTeam: string;
  /** 8강 대진 순서 (0-1, 2-3, 4-5, 6-7) */
  bracket: string[];
  results: FixtureResult[];
  round: number;
  /** 사용자 팀 선수별 사기 */
  morale: number[];
  difficulty: Difficulty;
  halfMinutes: number;
  eliminated: boolean;
  champion: string | null;
}

export const ROUND_NAMES = ['8강', '4강', '결승'];

function shuffle<T>(arr: T[]) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function newTournament(userTeam: string, difficulty: Difficulty, halfMinutes: number): TournamentState {
  const others = shuffle(TEAMS.filter((t) => t.id !== userTeam).map((t) => t.id)).slice(0, 7);
  const bracket = [userTeam, ...others];
  // 사용자 팀 위치도 섞는다 (대진표 느낌)
  const slot = Math.floor(Math.random() * 8);
  [bracket[0], bracket[slot]] = [bracket[slot], bracket[0]];
  return {
    version: 1,
    userTeam,
    bracket,
    results: [],
    round: 0,
    morale: teamById(userTeam).players.map(() => 0.3),
    difficulty,
    halfMinutes,
    eliminated: false,
    champion: null,
  };
}

/** 해당 라운드의 대진 */
export function pairings(s: TournamentState, round: number): [string, string][] {
  let alive = s.bracket.slice();
  for (let r = 0; r < round; r++) {
    const next: string[] = [];
    for (let i = 0; i < alive.length; i += 2) {
      const res = s.results.find((x) => x.round === r && ((x.home === alive[i] && x.away === alive[i + 1]) || (x.home === alive[i + 1] && x.away === alive[i])));
      next.push(res ? res.winner : '?');
    }
    alive = next;
  }
  const out: [string, string][] = [];
  for (let i = 0; i < alive.length; i += 2) out.push([alive[i], alive[i + 1]]);
  return out;
}

export function userFixture(s: TournamentState): [string, string] | null {
  if (s.eliminated || s.champion) return null;
  return pairings(s, s.round).find((p) => p.includes(s.userTeam)) ?? null;
}

function poisson(lambda: number) {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= Math.random();
  } while (p > L);
  return k - 1;
}

export function simulate(a: TeamDef, b: TeamDef, round: number): FixtureResult {
  const la = 1.25 * Math.exp((a.att - b.def) / 14 + (a.mid - b.mid) / 30);
  const lb = 1.25 * Math.exp((b.att - a.def) / 14 + (b.mid - a.mid) / 30);
  const hg = poisson(la);
  const ag = poisson(lb);
  let hp: number | undefined;
  let ap: number | undefined;
  let winner = hg > ag ? a.id : b.id;
  if (hg === ag) {
    hp = 0;
    ap = 0;
    for (let i = 0; i < 5; i++) {
      if (Math.random() < 0.76) hp++;
      if (Math.random() < 0.76) ap++;
    }
    while (hp === ap) {
      if (Math.random() < 0.72) hp++;
      if (Math.random() < 0.72) ap++;
    }
    winner = hp > ap ? a.id : b.id;
  }
  const pickScorers = (t: TeamDef, n: number) =>
    Array.from({ length: n }, () => {
      const fw = t.players.filter((p) => p.role !== 'GK');
      const weighted = fw.flatMap((p) => Array(p.role === 'FW' ? 4 : p.role === 'MF' ? 2 : 1).fill(p.name));
      return weighted[Math.floor(Math.random() * weighted.length)];
    });
  return { round, home: a.id, away: b.id, hg, ag, hp, ap, winner, user: false, scorers: [...pickScorers(a, hg), ...pickScorers(b, ag)] };
}

export function recordUserMatch(s: TournamentState, home: string, away: string, r: MatchResult) {
  let winner: string;
  if (r.homeGoals !== r.awayGoals) winner = r.homeGoals > r.awayGoals ? home : away;
  else winner = (r.homePens ?? 0) > (r.awayPens ?? 0) ? home : away;
  s.results.push({
    round: s.round,
    home,
    away,
    hg: r.homeGoals,
    ag: r.awayGoals,
    hp: r.homePens,
    ap: r.awayPens,
    winner,
    user: true,
    scorers: r.goals.map((g) => g.scorer),
  });
  // 같은 라운드 다른 경기 시뮬레이션
  for (const [a, b] of pairings(s, s.round)) {
    if (a === home || a === away) continue;
    s.results.push(simulate(teamById(a), teamById(b), s.round));
  }
  if (winner !== s.userTeam) s.eliminated = true;
  if (s.round === 2) {
    s.champion = winner;
  }
  s.round++;
  return winner;
}

/** 탈락 후 남은 경기를 모두 시뮬레이션 */
export function simulateRest(s: TournamentState) {
  while (s.round <= 2 && !s.champion) {
    for (const [a, b] of pairings(s, s.round)) {
      if (s.results.some((x) => x.round === s.round && (x.home === a || x.away === a))) continue;
      s.results.push(simulate(teamById(a), teamById(b), s.round));
    }
    if (s.round === 2) {
      const f = s.results.find((x) => x.round === 2);
      s.champion = f ? f.winner : null;
    }
    s.round++;
  }
}

const SAVE_KEY = 'blaze-eleven-save-v1';

export function saveTournament(s: TournamentState | null) {
  try {
    if (!s) localStorage.removeItem(SAVE_KEY);
    else localStorage.setItem(SAVE_KEY, JSON.stringify(s));
  } catch {
    /* 저장소를 쓸 수 없는 환경 */
  }
}

export function loadTournament(): TournamentState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as TournamentState;
    if (s.version !== 1 || !s.bracket || s.champion || s.eliminated) return null;
    return s;
  } catch {
    return null;
  }
}
