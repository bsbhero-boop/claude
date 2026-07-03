import { useCallback, useMemo, useReducer } from 'react';
import { EMERGENCY_CARDS, OX_QUESTIONS, SCENES } from '../data/content';
import { generateCompletionCode } from '../lib/completionCode';
import type { CompletionPayload, EmergencyCard, Trainee } from '../types';

export type Phase = 'orientation' | 'scene' | 'closing-quiz' | 'completion';

interface EmergencyState {
  enabled: boolean;
  triggerAfterIndex: number;
  consumed: boolean;
  active: EmergencyCard | null;
}

interface State {
  phase: Phase;
  trainee: Trainee | null;
  startedAt: string | null;
  sceneIndex: number;
  sceneAttempted: Record<string, boolean>;
  sceneFirstTryCorrect: Record<string, boolean>;
  oxIndex: number;
  oxAttempted: Record<string, boolean>;
  oxFirstTryCorrect: Record<string, boolean>;
  emergency: EmergencyState;
  completion: CompletionPayload | null;
}

type Action =
  | { type: 'SUBMIT_ORIENTATION'; trainee: Trainee }
  | { type: 'SCENE_QUIZ_RESULT'; sceneId: string; correct: boolean }
  | { type: 'ADVANCE_SCENE' }
  | { type: 'DISMISS_EMERGENCY' }
  | { type: 'OX_RESULT'; questionId: string; correct: boolean }
  | { type: 'ADVANCE_OX' };

const EMERGENCY_CHANCE = 0.35;
// Don't fire on the very first or very last scene transition — mid-flow feels natural.
const SAFE_TRIGGER_RANGE = [1, SCENES.length - 2] as const;

function rollEmergency(): EmergencyState {
  const enabled = Math.random() < EMERGENCY_CHANCE;
  const [min, max] = SAFE_TRIGGER_RANGE;
  const triggerAfterIndex = min + Math.floor(Math.random() * (max - min + 1));
  return { enabled, triggerAfterIndex, consumed: false, active: null };
}

function pickRandomCard(): EmergencyCard {
  return EMERGENCY_CARDS[Math.floor(Math.random() * EMERGENCY_CARDS.length)];
}

const initialState: State = {
  phase: 'orientation',
  trainee: null,
  startedAt: null,
  sceneIndex: 0,
  sceneAttempted: {},
  sceneFirstTryCorrect: {},
  oxIndex: 0,
  oxAttempted: {},
  oxFirstTryCorrect: {},
  emergency: { enabled: false, triggerAfterIndex: -1, consumed: false, active: null },
  completion: null,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'SUBMIT_ORIENTATION':
      return {
        ...state,
        phase: 'scene',
        trainee: action.trainee,
        startedAt: new Date().toISOString(),
        emergency: rollEmergency(),
      };

    case 'SCENE_QUIZ_RESULT': {
      if (state.sceneAttempted[action.sceneId]) return state;
      return {
        ...state,
        sceneAttempted: { ...state.sceneAttempted, [action.sceneId]: true },
        sceneFirstTryCorrect: { ...state.sceneFirstTryCorrect, [action.sceneId]: action.correct },
      };
    }

    case 'ADVANCE_SCENE': {
      if (
        state.emergency.enabled &&
        !state.emergency.consumed &&
        state.sceneIndex === state.emergency.triggerAfterIndex
      ) {
        return {
          ...state,
          emergency: { ...state.emergency, consumed: true, active: pickRandomCard() },
        };
      }
      return advanceFromScene(state);
    }

    case 'DISMISS_EMERGENCY': {
      const cleared = { ...state.emergency, active: null };
      return advanceFromScene({ ...state, emergency: cleared });
    }

    case 'OX_RESULT': {
      if (state.oxAttempted[action.questionId]) return state;
      return {
        ...state,
        oxAttempted: { ...state.oxAttempted, [action.questionId]: true },
        oxFirstTryCorrect: { ...state.oxFirstTryCorrect, [action.questionId]: action.correct },
      };
    }

    case 'ADVANCE_OX': {
      const nextIndex = state.oxIndex + 1;
      if (nextIndex >= OX_QUESTIONS.length) {
        return { ...state, phase: 'completion', completion: buildCompletion(state) };
      }
      return { ...state, oxIndex: nextIndex };
    }

    default:
      return state;
  }
}

function advanceFromScene(state: State): State {
  const nextIndex = state.sceneIndex + 1;
  if (nextIndex >= SCENES.length) {
    return { ...state, phase: 'closing-quiz', oxIndex: 0 };
  }
  return { ...state, sceneIndex: nextIndex };
}

function buildCompletion(state: State): CompletionPayload {
  const sceneCorrect = Object.values(state.sceneFirstTryCorrect).filter(Boolean).length;
  const oxCorrect = Object.values(state.oxFirstTryCorrect).filter(Boolean).length;
  const total = SCENES.length + OX_QUESTIONS.length;
  const now = new Date();
  return {
    name: state.trainee?.name ?? '',
    org: state.trainee?.org ?? '',
    completedAt: now.toISOString(),
    score: `${sceneCorrect + oxCorrect}/${total}`,
    completionCode: generateCompletionCode(now),
  };
}

export function useSimulation() {
  const [state, dispatch] = useReducer(reducer, initialState);

  const submitOrientation = useCallback((trainee: Trainee) => dispatch({ type: 'SUBMIT_ORIENTATION', trainee }), []);
  const submitSceneAnswer = useCallback(
    (sceneId: string, correct: boolean) => dispatch({ type: 'SCENE_QUIZ_RESULT', sceneId, correct }),
    [],
  );
  const advanceScene = useCallback(() => dispatch({ type: 'ADVANCE_SCENE' }), []);
  const dismissEmergency = useCallback(() => dispatch({ type: 'DISMISS_EMERGENCY' }), []);
  const submitOxAnswer = useCallback(
    (questionId: string, correct: boolean) => dispatch({ type: 'OX_RESULT', questionId, correct }),
    [],
  );
  const advanceOx = useCallback(() => dispatch({ type: 'ADVANCE_OX' }), []);

  const currentScene = SCENES[state.sceneIndex];
  const currentOxQuestion = OX_QUESTIONS[state.oxIndex];

  const progress = useMemo(() => {
    if (state.phase === 'scene' && currentScene) {
      return { current: currentScene.stageNumber, total: SCENES[SCENES.length - 1].stageNumber };
    }
    if (state.phase === 'closing-quiz') {
      return { current: state.oxIndex + 1, total: OX_QUESTIONS.length };
    }
    return null;
  }, [state.phase, state.oxIndex, currentScene]);

  return {
    state,
    currentScene,
    currentOxQuestion,
    progress,
    actions: {
      submitOrientation,
      submitSceneAnswer,
      advanceScene,
      dismissEmergency,
      submitOxAnswer,
      advanceOx,
    },
  };
}
