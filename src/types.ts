export interface QuizOption {
  id: string;
  text: string;
  correct: boolean;
}

export interface QuizFeedback {
  correct: string;
  incorrect: string;
}

export interface Quiz {
  situation: string;
  options: QuizOption[];
  feedback: QuizFeedback;
  source: string;
}

export type ExitStyle = 'forward' | 'optional' | 'return' | 'gated';

export interface Exit {
  id: string;
  /** a11y label + mini-map legend text, e.g. "약국으로 이동" */
  label: string;
  /** Percent-based position of this exit's tap target on the scene image */
  hotspot: { x: number; y: number };
  targetId: string;
  style: ExitStyle;
  /** Only meaningful on 'gated' exits: all of these location ids must be solved first */
  requires?: string[];
}

export interface Location {
  id: string;
  role: 'mandatory' | 'optional';
  /** Drives the "N/7 단계" progress display — shared across branch pairs like billing/pharmacy */
  mapOrder: number;
  stageLabel: string;
  /** For stages split across multiple screens (e.g. 수납 / 약국) */
  subLabel?: string;
  subIndex?: number;
  subTotal?: number;
  /** Only set on optional locations: the mandatory location they branch off of */
  parentId?: string;
  image: string;
  imageAlt: string;
  /** Optional pure-flavor locations may skip learning points entirely */
  learningPoints?: string[];
  learningSource?: string;
  /** Optional pure-flavor locations have no quiz — visiting them never gates anything */
  quiz?: Quiz;
  exits: Exit[];
}

export interface EmergencyCard {
  id: string;
  title: string;
  responseSteps: string[];
  symptoms?: string[];
  quiz: Quiz;
  source: string;
}

export interface OXQuestion {
  id: string;
  category: string;
  prompt: string;
  answer: 'O' | 'X';
  explanation: string;
}

export interface Trainee {
  name: string;
  org: string;
}

export interface CompletionPayload {
  name: string;
  org: string;
  completedAt: string;
  score: string;
  completionCode: string;
}
