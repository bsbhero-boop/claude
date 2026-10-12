import type { FormationId, Personality, PlayerDef, Role, SpecialType, TeamDef, Kit } from '../game/types';

// 모든 선수 이름은 가상의 인물입니다.

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

interface TeamSeed {
  id: string;
  name: string;
  short: string;
  nick: string;
  manager: string;
  home: Kit;
  away: Kit;
  gkShirt: string;
  formation: FormationId;
  style: string;
  special: { type: SpecialType; name: string };
  att: number;
  mid: number;
  def: number;
  gkr: number;
  ace: { name: string; role: Role; num: number };
  /** 이름 조합 방식: given-surname 순서인지, 성-이름 순서인지 */
  order: 'gs' | 'sg' | 'kor';
  given: string[];
  surnames: string[];
  skins: string[];
  hairs: string[];
}

const SKIN = {
  light: '#F1C9A5',
  fair: '#E8B48F',
  tan: '#C98E62',
  brown: '#A0673F',
  dark: '#6E4527',
  east: '#EBC29C',
};
const HAIR = {
  black: '#1C1A1A',
  brown: '#4A2E1E',
  blond: '#D8B25A',
  ginger: '#A4552B',
  dark: '#2B2018',
};

const SEEDS: TeamSeed[] = [
  {
    id: 'kor',
    name: '대한민국',
    short: 'KOR',
    nick: '태극전사',
    manager: '홍길수',
    home: { shirt: '#D7263D', shorts: '#16161C', socks: '#D7263D', accent: '#FFFFFF' },
    away: { shirt: '#F4F4F6', shorts: '#F4F4F6', socks: '#F4F4F6', accent: '#D7263D' },
    gkShirt: '#2BB673',
    formation: '4-2-3-1',
    style: '빠른 역습과 끈질긴 압박',
    special: { type: 'tiger', name: '백호 포효슛' },
    att: 82,
    mid: 80,
    def: 78,
    gkr: 79,
    ace: { name: '강태풍', role: 'FW', num: 7 },
    order: 'kor',
    surnames: ['김', '이', '박', '최', '정', '조', '윤', '장', '임', '한', '오', '서', '신', '권', '황', '안', '송', '류', '홍'],
    given: ['민준', '서준', '도윤', '예준', '시우', '하준', '지호', '주원', '지훈', '건우', '우진', '현우', '선우', '유찬', '태윤', '승현', '재원', '동현', '은호', '태민'],
    skins: [SKIN.east, SKIN.fair],
    hairs: [HAIR.black, HAIR.dark],
  },
  {
    id: 'bra',
    name: '브라질',
    short: 'BRA',
    nick: '셀레상',
    manager: '아우구스투 레모스',
    home: { shirt: '#F7D117', shorts: '#1E4FB5', socks: '#FFFFFF', accent: '#1D8F3C' },
    away: { shirt: '#1E4FB5', shorts: '#FFFFFF', socks: '#1E4FB5', accent: '#F7D117' },
    gkShirt: '#7E3FB8',
    formation: '4-3-3',
    style: '화려한 개인기와 삼바 리듬',
    special: { type: 'tornado', name: '삼바 사이클론' },
    att: 90,
    mid: 86,
    def: 82,
    gkr: 84,
    ace: { name: '카이우 마젤라', role: 'FW', num: 10 },
    order: 'gs',
    given: ['하파엘', '치아구', '루카스', '마테우스', '가브리에우', '다비', '에두아르두', '페드루', '길례르미', '주앙', '펠리피', '브루누', '레안드루'],
    surnames: ['모우라', '시케이라', '알렌카르', '피녜이루', '카르발류', '메스키타', '바헤투', '코헤아', '텔레스', '하모스', '프레이타스', '다코스타'],
    skins: [SKIN.tan, SKIN.brown, SKIN.dark, SKIN.fair],
    hairs: [HAIR.black, HAIR.dark, HAIR.brown],
  },
  {
    id: 'arg',
    name: '아르헨티나',
    short: 'ARG',
    nick: '알비셀레스테',
    manager: '오스카르 베니테스',
    home: { shirt: '#75AADB', shorts: '#16161C', socks: '#FFFFFF', accent: '#FFFFFF', stripes: true },
    away: { shirt: '#25285A', shorts: '#25285A', socks: '#25285A', accent: '#75AADB' },
    gkShirt: '#E8E23A',
    formation: '4-4-2',
    style: '날카로운 탱고 패스워크',
    special: { type: 'phantom', name: '탱고 미라주' },
    att: 89,
    mid: 85,
    def: 83,
    gkr: 84,
    ace: { name: '마르코 카르데나스', role: 'FW', num: 10 },
    order: 'gs',
    given: ['마티아스', '니콜라스', '에세키엘', '곤살로', '파쿤도', '이그나시오', '토마스', '산티아고', '페데리코', '아구스틴', '후안', '에밀리아노'],
    surnames: ['페레이라', '소사', '카브랄', '에스칼란테', '갈라르사', '오헤다', '키로가', '바르가스', '아길라르', '폰세', '레데스마', '산도발'],
    skins: [SKIN.light, SKIN.fair, SKIN.tan],
    hairs: [HAIR.dark, HAIR.brown, HAIR.black],
  },
  {
    id: 'fra',
    name: '프랑스',
    short: 'FRA',
    nick: '레 블뢰',
    manager: '장피에르 로랑',
    home: { shirt: '#1F2C5C', shorts: '#FFFFFF', socks: '#D2232A', accent: '#FFFFFF' },
    away: { shirt: '#F3F3F5', shorts: '#1F2C5C', socks: '#F3F3F5', accent: '#1F2C5C' },
    gkShirt: '#F28C28',
    formation: '4-3-3',
    style: '폭발적인 스피드와 피지컬',
    special: { type: 'thunder', name: '블뢰 라이트닝' },
    att: 89,
    mid: 87,
    def: 85,
    gkr: 85,
    ace: { name: '노아 바슐레', role: 'FW', num: 10 },
    order: 'gs',
    given: ['위고', '테오', '루카', '막심', '클레망', '바티스트', '쥘', '라파엘', '니콜라', '에탕', '놀랑', '아드리앵'],
    surnames: ['르페브르', '모로', '지라르', '뒤부아', '랑베르', '퐁텐', '루소', '보네', '마르샹', '프티장', '가르니에', '슈발리에'],
    skins: [SKIN.light, SKIN.brown, SKIN.dark, SKIN.tan],
    hairs: [HAIR.black, HAIR.brown, HAIR.dark],
  },
  {
    id: 'ger',
    name: '독일',
    short: 'GER',
    nick: '전차군단',
    manager: '디터 슈나이더',
    home: { shirt: '#F5F5F5', shorts: '#17171A', socks: '#F5F5F5', accent: '#17171A' },
    away: { shirt: '#2C2F36', shorts: '#2C2F36', socks: '#2C2F36', accent: '#E03A3E' },
    gkShirt: '#2BB673',
    formation: '4-2-3-1',
    style: '정확한 조직력과 강철 같은 체력',
    special: { type: 'meteor', name: '아이언 메테오' },
    att: 85,
    mid: 87,
    def: 84,
    gkr: 87,
    ace: { name: '마티아스 아이젠', role: 'MF', num: 8 },
    order: 'gs',
    given: ['루카스', '요나스', '레온', '펠릭스', '니클라스', '팀', '율리안', '막시밀리안', '파울', '얀니크', '니코', '슈테판'],
    surnames: ['바그너', '슈미트', '호프만', '크라우제', '베커', '리히터', '볼프', '하르트만', '브라운', '침머만', '케슬러', '로트'],
    skins: [SKIN.light, SKIN.light, SKIN.fair, SKIN.brown],
    hairs: [HAIR.blond, HAIR.brown, HAIR.dark],
  },
  {
    id: 'eng',
    name: '잉글랜드',
    short: 'ENG',
    nick: '삼사자',
    manager: '그레이엄 웰스',
    home: { shirt: '#F5F5F7', shorts: '#1F2A4D', socks: '#F5F5F7', accent: '#C8102E' },
    away: { shirt: '#C8102E', shorts: '#C8102E', socks: '#C8102E', accent: '#FFFFFF' },
    gkShirt: '#E8E23A',
    formation: '4-3-3',
    style: '강한 측면과 세트피스',
    special: { type: 'fire', name: '라이언 블레이즈' },
    att: 86,
    mid: 86,
    def: 84,
    gkr: 82,
    ace: { name: '올리 레인하트', role: 'FW', num: 9 },
    order: 'gs',
    given: ['잭', '올리버', '찰리', '조지', '해리슨', '루이스', '앨피', '이선', '리스', '코너', '샘', '타일러'],
    surnames: ['웰링턴', '브룩스', '콜린스', '페어필드', '헤이스팅스', '랭글리', '손더스', '페닝턴', '휘태커', '크로프트', '하트웰', '블랙우드'],
    skins: [SKIN.light, SKIN.fair, SKIN.brown, SKIN.dark],
    hairs: [HAIR.brown, HAIR.blond, HAIR.ginger, HAIR.black],
  },
  {
    id: 'esp',
    name: '스페인',
    short: 'ESP',
    nick: '라 로하',
    manager: '페르난도 이에로나',
    home: { shirt: '#C21F2B', shorts: '#1F2A4D', socks: '#1F2A4D', accent: '#F5C518' },
    away: { shirt: '#F1E6C2', shorts: '#F1E6C2', socks: '#F1E6C2', accent: '#C21F2B' },
    gkShirt: '#2E9CCA',
    formation: '4-3-3',
    style: '끝없는 티키타카 점유율',
    special: { type: 'dragon', name: '엘 드라곤 캐논' },
    att: 84,
    mid: 90,
    def: 83,
    gkr: 83,
    ace: { name: '라파 카스테야노', role: 'MF', num: 8 },
    order: 'gs',
    given: ['하비에르', '다니엘', '파블로', '알레한드로', '마르코스', '아드리안', '알바로', '이반', '엔리케', '호르헤', '마리오', '루벤'],
    surnames: ['로페스', '가르시아', '산체스', '모레노', '나바로', '몬테로', '이달고', '세라노', '크레스포', '베가', '오르티스', '루이스'],
    skins: [SKIN.light, SKIN.fair, SKIN.tan],
    hairs: [HAIR.dark, HAIR.brown, HAIR.black],
  },
  {
    id: 'por',
    name: '포르투갈',
    short: 'POR',
    nick: '항해왕',
    manager: '조르즈 페헤이라',
    home: { shirt: '#9E1B32', shorts: '#1E5B3A', socks: '#9E1B32', accent: '#F2C14E' },
    away: { shirt: '#F4F4F2', shorts: '#F4F4F2', socks: '#F4F4F2', accent: '#9E1B32' },
    gkShirt: '#2BB673',
    formation: '4-3-3',
    style: '테크니션들의 창의적인 공격',
    special: { type: 'fire', name: '나비게이터 플레임' },
    att: 87,
    mid: 84,
    def: 81,
    gkr: 82,
    ace: { name: '누누 칼데이라', role: 'FW', num: 7 },
    order: 'gs',
    given: ['주앙', '디오구', '루이', '티아구', '히카르두', '누누', '미겔', '안드레', '곤살루', '파비우', '하파엘', '세르지우'],
    surnames: ['실바', '산투스', '코스타', '마르케스', '피게이라', '메스키타', '토헤스', '비에이라', '핀투', '알메이다', '네베스', '카르발류'],
    skins: [SKIN.fair, SKIN.tan, SKIN.brown],
    hairs: [HAIR.dark, HAIR.black, HAIR.brown],
  },
  {
    id: 'ned',
    name: '네덜란드',
    short: 'NED',
    nick: '오렌지 군단',
    manager: '헹크 판 바스턴',
    home: { shirt: '#F36C21', shorts: '#16161C', socks: '#F36C21', accent: '#16161C' },
    away: { shirt: '#23305E', shorts: '#23305E', socks: '#23305E', accent: '#F36C21' },
    gkShirt: '#9BD13A',
    formation: '4-3-3',
    style: '토털 풋볼의 유산',
    special: { type: 'tornado', name: '오렌지 볼텍스' },
    att: 84,
    mid: 84,
    def: 83,
    gkr: 81,
    ace: { name: '시머 판레이우엔', role: 'MF', num: 10 },
    order: 'gs',
    given: ['다안', '셈', '바스', '룩', '예스퍼', '팀', '스테인', '바우트', '시머', '티스', '라우리스', '요엘'],
    surnames: ['얀선', '바커르', '피서르', '스밋', '메이르', '더흐로트', '보스', '페르베이크', '클라선', '하위스만', '데브리스', '물데르'],
    skins: [SKIN.light, SKIN.light, SKIN.brown, SKIN.dark],
    hairs: [HAIR.blond, HAIR.brown, HAIR.black],
  },
  {
    id: 'ita',
    name: '이탈리아',
    short: 'ITA',
    nick: '아주리',
    manager: '카를로 페라티',
    home: { shirt: '#1F5AA6', shorts: '#FFFFFF', socks: '#1F5AA6', accent: '#FFFFFF' },
    away: { shirt: '#F5F5F5', shorts: '#1F5AA6', socks: '#F5F5F5', accent: '#1F5AA6' },
    gkShirt: '#F28C28',
    formation: '3-5-2',
    style: '빗장 수비 카테나치오',
    special: { type: 'ice', name: '아주리 프로스트' },
    att: 81,
    mid: 83,
    def: 88,
    gkr: 86,
    ace: { name: '프란체스코 갈로', role: 'FW', num: 9 },
    order: 'gs',
    given: ['로렌초', '알레산드로', '마테오', '레오나르도', '안드레아', '리카르도', '토마소', '자코모', '파비오', '다비데', '니콜로', '페데리코'],
    surnames: ['로시', '루소', '에스포지토', '비앙키', '로마노', '콜롬보', '리치', '마리노', '그레코', '브루노', '콘티', '데루카'],
    skins: [SKIN.light, SKIN.fair, SKIN.tan],
    hairs: [HAIR.dark, HAIR.black, HAIR.brown],
  },
  {
    id: 'jpn',
    name: '일본',
    short: 'JPN',
    nick: '사무라이 블루',
    manager: '모리타 겐지',
    home: { shirt: '#1A2F6B', shorts: '#FFFFFF', socks: '#1A2F6B', accent: '#E03A3E' },
    away: { shirt: '#F4F4F6', shorts: '#1A2F6B', socks: '#F4F4F6', accent: '#1A2F6B' },
    gkShirt: '#E8E23A',
    formation: '4-2-3-1',
    style: '정교한 패스와 높은 활동량',
    special: { type: 'ice', name: '블루 블리자드' },
    att: 80,
    mid: 83,
    def: 78,
    gkr: 77,
    ace: { name: '시라이시 하야테', role: 'MF', num: 10 },
    order: 'sg',
    surnames: ['사토', '스즈키', '다카하시', '다나카', '와타나베', '이토', '야마모토', '나카무라', '고바야시', '가토', '요시다', '야마다'],
    given: ['하루토', '소타', '유토', '렌', '하야토', '다이키', '쇼', '겐타', '류세이', '가이토', '소마', '유키'],
    skins: [SKIN.east, SKIN.fair],
    hairs: [HAIR.black, HAIR.dark, HAIR.brown],
  },
  {
    id: 'uru',
    name: '우루과이',
    short: 'URU',
    nick: '라 셀레스테',
    manager: '엔소 페레스',
    home: { shirt: '#5DADE2', shorts: '#16161C', socks: '#16161C', accent: '#FFFFFF' },
    away: { shirt: '#F4F4F6', shorts: '#16161C', socks: '#F4F4F6', accent: '#5DADE2' },
    gkShirt: '#F28C28',
    formation: '4-4-2',
    style: '투지 넘치는 가라 차루아',
    special: { type: 'thunder', name: '셀레스테 썬더' },
    att: 83,
    mid: 79,
    def: 83,
    gkr: 80,
    ace: { name: '가스톤 레예스', role: 'FW', num: 9 },
    order: 'gs',
    given: ['세바스티안', '마티아스', '니콜라스', '로드리고', '페데리코', '가스톤', '브루노', '디에고', '마르틴', '파쿤도', '기예르모', '호아킨'],
    surnames: ['페레스', '곤살레스', '로드리게스', '페르난데스', '소사', '마르케스', '아코스타', '라미레스', '비에라', '올리베라', '카스트로', '쿠냐'],
    skins: [SKIN.light, SKIN.fair, SKIN.tan],
    hairs: [HAIR.dark, HAIR.black, HAIR.brown],
  },
];

const PERSONALITIES: Personality[] = ['passionate', 'calm', 'nervous', 'confident', 'determined'];

// 11명 구성: GK 1, DF 4, MF 4, FW 2 (포메이션이 달라도 라인업 배정 시 재배치)
const ROLE_PLAN: Role[] = ['GK', 'DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'MF', 'FW', 'FW'];
const NUMBERS: number[] = [1, 2, 4, 5, 3, 6, 8, 14, 11, 9, 17];

function buildTeam(s: TeamSeed): TeamDef {
  const rnd = mulberry32(hashStr(s.id));
  const pickR = <T>(arr: T[]) => arr[Math.floor(rnd() * arr.length)];
  const used = new Set<string>();
  const makeName = () => {
    for (let tries = 0; tries < 50; tries++) {
      const g = pickR(s.given);
      const f = pickR(s.surnames);
      const n = s.order === 'kor' ? f + g : s.order === 'sg' ? `${f} ${g}` : `${g} ${f}`;
      if (!used.has(n) && n !== s.ace.name) {
        used.add(n);
        return n;
      }
    }
    return `${pickR(s.given)} ${used.size}`;
  };
  const v = (base: number, spread = 6) => Math.round(Math.max(40, Math.min(97, base + (rnd() - 0.5) * 2 * spread)));

  const players: PlayerDef[] = ROLE_PLAN.map((role, i) => {
    const isAce = false;
    const p: PlayerDef = {
      name: makeName(),
      num: NUMBERS[i],
      role,
      pac: 0,
      sho: 0,
      pas: 0,
      dri: 0,
      def: 0,
      gk: 0,
      personality: pickR(PERSONALITIES),
      ace: isAce,
      skin: pickR(s.skins),
      hair: pickR(s.hairs),
    };
    if (role === 'GK') {
      Object.assign(p, { pac: v(60), sho: v(40), pas: v(62), dri: v(45), def: v(40), gk: v(s.gkr, 3) });
    } else if (role === 'DF') {
      Object.assign(p, {
        pac: v(s.def - 6),
        sho: v(s.att - 30),
        pas: v(s.mid - 10),
        dri: v(s.mid - 14),
        def: v(s.def + 2),
        gk: 20,
      });
    } else if (role === 'MF') {
      Object.assign(p, {
        pac: v(s.mid - 4),
        sho: v(s.att - 10),
        pas: v(s.mid + 2),
        dri: v(s.mid),
        def: v(s.def - 14),
        gk: 20,
      });
    } else {
      Object.assign(p, {
        pac: v(s.att),
        sho: v(s.att + 1),
        pas: v(s.mid - 8),
        dri: v(s.att - 2),
        def: v(s.def - 40),
        gk: 20,
      });
    }
    return p;
  });

  // 에이스 배치: 같은 역할의 마지막 선수를 에이스로 교체
  const aceIdx = (() => {
    for (let i = players.length - 1; i >= 0; i--) if (players[i].role === s.ace.role) return i;
    return 10;
  })();
  const a = players[aceIdx];
  a.name = s.ace.name;
  a.num = s.ace.num;
  a.ace = true;
  a.personality = 'confident';
  a.pac = Math.min(97, a.pac + 6);
  a.sho = Math.min(97, a.sho + 8);
  a.dri = Math.min(97, a.dri + 8);
  a.pas = Math.min(97, a.pas + 5);
  // 번호 중복 방지
  const seen = new Set<number>([a.num]);
  players.forEach((p, i) => {
    if (i === aceIdx) return;
    let n = p.num;
    while (seen.has(n)) n += 10;
    p.num = n;
    seen.add(n);
  });

  return {
    id: s.id,
    name: s.name,
    short: s.short,
    nick: s.nick,
    manager: s.manager,
    home: s.home,
    away: s.away,
    gkShirt: s.gkShirt,
    formation: s.formation,
    style: s.style,
    special: s.special,
    att: s.att,
    mid: s.mid,
    def: s.def,
    gkr: s.gkr,
    players,
  };
}

export const TEAMS: TeamDef[] = SEEDS.map(buildTeam);

export const teamById = (id: string) => TEAMS.find((t) => t.id === id)!;

export const overall = (t: TeamDef) => Math.round((t.att + t.mid + t.def + t.gkr) / 4);

export const stars = (t: TeamDef) => {
  const o = overall(t);
  return o >= 86 ? 5 : o >= 84 ? 4.5 : o >= 82 ? 4 : o >= 80 ? 3.5 : 3;
};

export const SPECIAL_LABEL: Record<SpecialType, string> = {
  fire: '화염',
  thunder: '번개',
  tornado: '회오리',
  meteor: '유성',
  ice: '빙결',
  phantom: '환영',
  dragon: '용',
  tiger: '백호',
};

export const SPECIAL_DESC: Record<SpecialType, string> = {
  fire: '불꽃을 두른 초고속 드라이브 슛. 궤적을 따라 화염이 타오른다.',
  thunder: '번개처럼 지그재그로 꺾이며 골문을 찌른다.',
  tornado: '거대한 회오리를 일으키며 크게 휘어 들어간다.',
  meteor: '하늘 높이 솟구친 뒤 유성처럼 내리꽂힌다.',
  ice: '얼음 결정을 흩뿌리며 닿는 선수를 얼려버린다.',
  phantom: '공이 셋으로 갈라져 골키퍼를 현혹한다.',
  dragon: '용이 승천하듯 굽이치며 날아간다.',
  tiger: '백호의 포효와 함께 발톱 자국을 남기는 강슛.',
};

/** 두 키트 색이 충돌하는지 (RGB 거리) */
export function colorDistance(a: string, b: string) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ar = (pa >> 16) & 255,
    ag = (pa >> 8) & 255,
    ab = pa & 255;
  const br = (pb >> 16) & 255,
    bg = (pb >> 8) & 255,
    bb = pb & 255;
  return Math.sqrt((ar - br) ** 2 + (ag - bg) ** 2 + (ab - bb) ** 2);
}

export function pickKits(home: TeamDef, away: TeamDef): [Kit, Kit] {
  const hk = home.home;
  let ak = away.home;
  if (colorDistance(hk.shirt, ak.shirt) < 120 || colorDistance(hk.shorts, ak.shirt) < 40) ak = away.away;
  if (colorDistance(hk.shirt, ak.shirt) < 120) ak = away.away;
  return [hk, ak];
}
