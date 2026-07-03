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

export interface Scene {
  id: string;
  /** 1-7, drives the "N/7 단계" progress display */
  stageNumber: number;
  stageLabel: string;
  /** For stages split across multiple screens (e.g. 수납 / 약국) */
  subLabel?: string;
  subIndex?: number;
  subTotal?: number;
  image: string;
  imageAlt: string;
  /** Percent-based position of the "next" hotspot on the scene image */
  hotspot: { x: number; y: number };
  learningPoints: string[];
  learningSource: string;
  quiz: Quiz;
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
