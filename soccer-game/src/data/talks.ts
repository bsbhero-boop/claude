import type { Personality } from '../game/types';

export const PERSONALITY_LABEL: Record<Personality, string> = {
  passionate: '열정적',
  calm: '침착함',
  nervous: '예민함',
  confident: '자신만만',
  determined: '승부욕',
};

export const PERSONALITY_DESC: Record<Personality, string> = {
  passionate: '감정에 호소하는 말에 크게 반응한다.',
  calm: '차분한 조언을 선호하고 큰 소리에는 무덤덤하다.',
  nervous: '압박에 약하다. 부담을 덜어주면 살아난다.',
  confident: '칭찬과 신뢰에 강하지만 질책을 싫어한다.',
  determined: '높은 요구와 승리에 대한 집착에 불이 붙는다.',
};

export const MORALE_LABEL = ['최악', '나쁨', '불안', '보통', '좋음', '매우 좋음', '최고'];

export function moraleLabel(m: number) {
  return MORALE_LABEL[Math.max(0, Math.min(6, Math.round(m) + 3))];
}

export type Tone = 'calm' | 'assertive' | 'passionate';

export const TONES: { id: Tone; label: string; desc: string }[] = [
  { id: 'calm', label: '차분하게', desc: '침착한 목소리로 한 명 한 명 눈을 맞춘다' },
  { id: 'assertive', label: '단호하게', desc: '팔짱을 끼고 낮고 단호하게 말한다' },
  { id: 'passionate', label: '열정적으로', desc: '주먹을 불끈 쥐고 라커룸이 울리도록 외친다' },
];

const TONE_MUL: Record<Tone, Record<Personality, number>> = {
  calm: { nervous: 1.3, calm: 1.25, passionate: 0.7, confident: 1, determined: 0.9 },
  assertive: { nervous: 0.8, calm: 1, passionate: 1, confident: 0.85, determined: 1.35 },
  passionate: { nervous: 0.7, calm: 0.75, passionate: 1.45, confident: 1.05, determined: 1.15 },
};
const TONE_SHIFT: Record<Tone, Record<Personality, number>> = {
  calm: { nervous: 0.15, calm: 0.1, passionate: -0.1, confident: 0, determined: 0 },
  assertive: { nervous: -0.15, calm: 0, passionate: 0, confident: -0.1, determined: 0.1 },
  passionate: { nervous: -0.2, calm: -0.05, passionate: 0.2, confident: 0.05, determined: 0.05 },
};

export interface TalkContext {
  /** 우리 팀 전력 - 상대 전력 (overall 차) */
  favorite: number;
  /** 우리 득점 - 상대 득점 */
  scoreDiff: number;
  /** 0: 8강, 1: 4강, 2: 결승 */
  stage: number;
}

export interface TalkOption {
  id: string;
  text: string;
  /** 상황 기본 효과 */
  base: (c: TalkContext) => number;
  pers: Partial<Record<Personality, number>>;
  /** 효과의 흔들림 (클수록 도박) */
  variance?: number;
  /** 감독 동작 묘사 */
  act?: string;
}

export const PRE_TALKS: TalkOption[] = [
  {
    id: 'believe',
    text: '너희는 이길 자격이 있다. 스스로를 믿어라.',
    base: () => 0.4,
    pers: { confident: 0.5, nervous: 0.3, calm: 0.2, passionate: 0.2, determined: 0.2 },
  },
  {
    id: 'relax',
    text: '부담 갖지 마라. 즐기고 오면 된다.',
    base: (c) => (c.favorite < -2 ? 0.4 : c.favorite > 2 ? -0.15 : 0.15) + (c.stage === 2 ? 0.2 : 0),
    pers: { nervous: 0.8, calm: 0.25, passionate: -0.35, determined: -0.25 },
  },
  {
    id: 'demand',
    text: '오늘은 반드시 이겨야 한다. 변명은 없다.',
    base: (c) => (c.favorite > 1 ? 0.35 : -0.1) + (c.stage === 2 ? 0.2 : 0),
    pers: { determined: 0.75, passionate: 0.45, confident: 0.1, nervous: -0.85 },
    variance: 0.35,
  },
  {
    id: 'underdog',
    text: '아무도 우리를 주목하지 않는다. 증명해 보여라.',
    base: (c) => (c.favorite < -1 ? 0.75 : -0.45),
    pers: { passionate: 0.4, determined: 0.4, confident: -0.2, nervous: 0.1 },
  },
  {
    id: 'fans',
    text: '관중석을 봐라. 저 사람들을 위해 모든 걸 쏟아부어라!',
    base: () => 0.3,
    pers: { passionate: 0.75, determined: 0.2, calm: -0.2, nervous: -0.35 },
    variance: 0.25,
  },
  {
    id: 'silent',
    text: '(아무 말 없이 고개를 끄덕인다) …나가서 보여줘.',
    base: () => 0.05,
    pers: { confident: 0.35, calm: 0.3, nervous: -0.3, passionate: -0.1 },
  },
];

export const HALF_TALKS: TalkOption[] = [
  {
    id: 'praise',
    text: '잘하고 있다. 이대로만 하면 된다.',
    base: (c) => (c.scoreDiff > 0 ? 0.6 : c.scoreDiff === 0 ? 0.1 : -0.5),
    pers: { confident: 0.2, nervous: 0.3 },
  },
  {
    id: 'complacent',
    text: '방심하지 마라. 아직 아무것도 끝나지 않았다.',
    base: (c) => (c.scoreDiff > 0 ? 0.45 : c.scoreDiff === 0 ? 0.1 : -0.3),
    pers: { determined: 0.35, confident: -0.2, calm: 0.1 },
  },
  {
    id: 'believe',
    text: '아직 45분이 남았다. 난 너희를 믿는다.',
    base: (c) => (c.scoreDiff < 0 ? 0.55 : c.scoreDiff === 0 ? 0.3 : 0.1),
    pers: { nervous: 0.3, passionate: 0.2, confident: 0.1 },
  },
  {
    id: 'angry',
    text: '이게 지금 뭐하는 플레이야!',
    act: '물병을 걷어찬다. 라커룸이 얼어붙는다.',
    base: (c) => (c.scoreDiff < 0 ? 0.25 : c.scoreDiff === 0 ? -0.1 : -0.75),
    pers: { passionate: 0.6, determined: 0.55, nervous: -1.0, confident: -0.45, calm: -0.1 },
    variance: 0.6,
  },
  {
    id: 'more',
    text: '너희는 이것보다 훨씬 더 잘할 수 있다. 보여줘.',
    base: (c) => (c.scoreDiff <= 0 ? 0.35 : 0.1),
    pers: { determined: 0.4, confident: 0.3, nervous: -0.1 },
  },
  {
    id: 'nopressure',
    text: '결과는 신경 쓰지 마라. 우리 축구를 하자.',
    base: (c) => (c.scoreDiff < 0 ? 0.3 : 0),
    pers: { nervous: 0.6, calm: 0.2, passionate: -0.3 },
  },
];

export const POST_TALKS: TalkOption[] = [
  {
    id: 'proud',
    text: '정말 자랑스럽다. 오늘 밤은 마음껏 즐겨라.',
    base: () => 0.45,
    pers: { passionate: 0.3, nervous: 0.3, confident: 0.2 },
  },
  {
    id: 'focus',
    text: '아직 아무것도 이룬 게 없다. 다음 경기만 생각하자.',
    base: () => 0.3,
    pers: { determined: 0.5, calm: 0.2, confident: -0.2 },
  },
  {
    id: 'critical',
    text: '이겼지만 경기력은 실망스럽다.',
    base: () => -0.2,
    pers: { determined: 0.45, passionate: 0.1, nervous: -0.6, confident: -0.5 },
    variance: 0.3,
  },
];

export const ACE_TALKS: TalkOption[] = [
  {
    id: 'hero',
    text: '오늘 경기는 네 손에 달렸다. 해결해줘.',
    base: () => 0.35,
    pers: { confident: 0.6, determined: 0.4, passionate: 0.4, nervous: -0.6 },
  },
  {
    id: 'push',
    text: '네 실력은 이게 전부가 아니잖아. 더 분발해.',
    base: () => 0.15,
    pers: { determined: 0.5, passionate: 0.2, confident: -0.4, nervous: -0.3 },
  },
  {
    id: 'ease',
    text: '혼자 다 하려고 하지 마. 동료들을 믿어.',
    base: () => 0.25,
    pers: { nervous: 0.55, calm: 0.25, confident: -0.1 },
  },
];

export function talkEffect(opt: TalkOption, tone: Tone, pers: Personality, ctx: TalkContext) {
  const raw = opt.base(ctx) + (opt.pers[pers] ?? 0);
  const v = opt.variance ?? 0.15;
  const noise = (Math.random() - 0.5) * 2 * v;
  return raw * TONE_MUL[tone][pers] + TONE_SHIFT[tone][pers] + noise;
}

export function reactionText(delta: number, pers: Personality) {
  if (delta >= 0.9) return pers === 'passionate' ? '눈빛이 이글거린다!' : pers === 'nervous' ? '긴장이 완전히 풀렸다!' : '의욕이 불타오른다!';
  if (delta >= 0.4) return pers === 'confident' ? '자신감이 넘친다' : pers === 'calm' ? '고개를 끄덕인다' : '의욕이 생겼다';
  if (delta > -0.25) return pers === 'calm' ? '차분하게 듣고 있다' : pers === 'nervous' ? '조금 안정된 듯하다' : '별다른 반응이 없다';
  if (delta > -0.8)
    return pers === 'nervous' ? '긴장한 것 같다' : pers === 'confident' ? '기분이 상한 표정이다' : pers === 'passionate' ? '답답해 한다' : pers === 'determined' ? '실망한 눈치다' : '무덤덤하다';
  return pers === 'nervous' ? '완전히 위축됐다' : pers === 'confident' ? '코웃음을 친다' : '불만이 가득하다';
}

export interface PressQuestion {
  q: string;
  answers: { text: string; us: Partial<Record<Personality, number>> & { all?: number }; them: number }[];
}

export const PRESS: PressQuestion[] = [
  {
    q: '상대 에이스 {ace} 선수를 어떻게 막을 생각인가요?',
    answers: [
      { text: '철저히 준비했습니다. 문제없습니다.', us: { all: 0.1, calm: 0.15, confident: 0.1 }, them: -0.15 },
      { text: '솔직히 과대평가된 선수라고 봅니다.', us: { confident: 0.35, passionate: 0.2, nervous: -0.1 }, them: 0.45 },
      { text: '훌륭한 선수죠. 존중합니다.', us: { nervous: 0.15, calm: 0.1 }, them: 0.05 },
    ],
  },
  {
    q: '오늘 경기, 스코어를 예상해 주시죠.',
    answers: [
      { text: '두 골 차로 우리가 이깁니다.', us: { confident: 0.35, passionate: 0.15, nervous: -0.35 }, them: 0.3 },
      { text: '쉽지 않은 경기가 될 겁니다.', us: { calm: 0.2, nervous: 0.1 }, them: -0.05 },
      { text: '예측은 하지 않습니다.', us: { all: 0.02 }, them: 0 },
    ],
  },
  {
    q: '{stage}에 오른 소감 한마디 부탁드립니다.',
    answers: [
      { text: '이제 시작일 뿐입니다.', us: { determined: 0.35, confident: 0.1 }, them: 0.05 },
      { text: '선수들이 정말 자랑스럽습니다.', us: { all: 0.18, nervous: 0.1 }, them: 0 },
      { text: '우리 목표는 오직 우승입니다.', us: { passionate: 0.35, determined: 0.25, nervous: -0.25 }, them: 0.15 },
    ],
  },
  {
    q: '상대 감독이 "우리가 한 수 위"라고 말했는데요?',
    answers: [
      { text: '경기장에서 보여드리죠.', us: { determined: 0.35, passionate: 0.25 }, them: 0 },
      { text: '말은 누구나 할 수 있습니다.', us: { confident: 0.3, passionate: 0.2, calm: -0.05 }, them: 0.25 },
      { text: '그분 의견을 존중합니다.', us: { calm: 0.2, nervous: 0.1, passionate: -0.15 }, them: -0.1 },
    ],
  },
];

export const COMMENTARY = {
  goal: [
    '{p}! 골~~! 골입니다!!',
    '들어갑니다! {p}의 득점!',
    '골망이 출렁입니다! {p}!!',
    '{p}, 침착하게 마무리합니다! 골!',
    '경기장이 떠나갈 듯한 함성! {p}의 골!',
  ],
  specialGoal: [
    '이게 바로 필살기입니다! {p}!!!',
    '골키퍼가 손 쓸 틈도 없었습니다! {p}의 필살 골!!',
    '전설이 탄생하는 순간! {p}!!!',
  ],
  ownGoal: ['아~ 이럴 수가! {p}의 자책골입니다!', '불운한 장면! {p} 발에 맞고 들어갑니다!'],
  shot: ['{p}, 슈팅!', '{p}의 슛!', '{p}, 때립니다!', '{p}, 과감한 슈팅!'],
  longShot: ['{p}, 먼 거리에서 중거리 슛!', '{p}의 대포알 같은 중거리!'],
  finesse: ['{p}, 감아찹니다!', '{p}의 감아차기!'],
  chip: ['{p}, 키퍼 키를 넘기는 칩슛!', '{p}, 살짝 띄웁니다!'],
  save: ['{p}, 막아냅니다!', '{p}의 멋진 선방!', '{p}, 슈퍼 세이브!', '손끝으로 쳐냅니다! {p}!'],
  catch: ['{p}, 안정적으로 잡아냅니다.', '{p}가 품에 안습니다.'],
  miss: ['{p}의 슛, 아깝게 벗어납니다!', '아~ {p}, 골문을 외면합니다!', '{p}, 하늘 높이 날아갑니다…'],
  post: ['골대를 맞고 나옵니다!!', '골포스트! 아깝습니다!', '크로스바를 강타합니다!'],
  intercept: ['{p}, 패스를 끊어냅니다!', '{p}의 인터셉트!', '{p}, 길목을 읽었습니다!'],
};

export const STAGE_NAMES = ['8강', '4강', '결승'];
