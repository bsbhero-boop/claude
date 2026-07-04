import { useCallback, useMemo, useReducer } from 'react';
import { CLOSING_QUIZ_ID, EMERGENCY_CARDS, LOCATIONS, LOCATIONS_BY_ID, OX_QUESTIONS, TOTAL_STAGES } from '../data/content';
import { generateCompletionCode } from '../lib/completionCode';
import type { CompletionPayload, EmergencyCard, Trainee } from '../types';

export type Phase = 'orientation' | 'scene' | 'closing-quiz' | 'completion';

interface EmergencyState {
  enabled: boolean;
  triggerAfterMapOrder: number;
  consumed: boolean;
  active: EmergencyCard | null;
  /** Location to actually move to once the emergency card is dismissed. */
  pendingTargetId?: string;
}

interface State {
  phase: Phase;
  trainee: Trainee | null;
  startedAt: string | null;
  currentLocationId: string;
  visitedIds: Record<string, true>;
  locationAttempted: Record<string, boolean>;
  locationFirstTryCorrect: Record<string, boolean>;
  /** Quiz eventually answered correctly — gates this location's forward/gated exits. */
  locationSolved: Record<string, boolean>;
  oxIndex: number;
  oxAttempted: Record<string, boolean>;
  oxFirstTryCorrect: Record<string, boolean>;
  emergency: EmergencyState;
  completion: CompletionPayload | null;
}

type Action =
  | { type: 'SUBMIT_ORIENTATION'; trainee: Trainee }
  | { type: 'LOCATION_QUIZ_RESULT'; locationId: string; correct: boolean }
  | { type: 'LOCATION_SOLVED'; locationId: string }
  | { type: 'NAVIGATE'; targetId: string }
  | { type: 'DISMISS_EMERGENCY' }
  | { type: 'OX_RESULT'; questionId: string; correct: boolean }
  | { type: 'ADVANCE_OX' };

const EMERGENCY_CHANCE = 0.35;
// Don't fire on the very first mandatory location or the last one — mid-flow feels natural.
const SAFE_TRIGGER_RANGE = [2, TOTAL_STAGES - 1] as const;

function rollEmergency(): EmergencyState {
  const enabled = Math.random() < EMERGENCY_CHANCE;
  const [min, max] = SAFE_TRIGGER_RANGE;
  const triggerAfterMapOrder = min + Math.floor(Math.random() * (max - min + 1));
  return { enabled, triggerAfterMapOrder, consumed: false, active: null };
}

function pickRandomCard(): EmergencyCard {
  return EMERGENCY_CARDS[Math.floor(Math.random() * EMERGENCY_CARDS.length)];
}

const FIRST_LOCATION_ID = LOCATIONS[0].id;

const initialState: State = {
  phase: 'orientation',
  trainee: null,
  startedAt: null,
  currentLocationId: FIRST_LOCATION_ID,
  visitedIds: { [FIRST_LOCATION_ID]: true },
  locationAttempted: {},
  locationFirstTryCorrect: {},
  locationSolved: {},
  oxIndex: 0,
  oxAttempted: {},
  oxFirstTryCorrect: {},
  emergency: { enabled: false, triggerAfterMapOrder: -1, consumed: false, active: null },
  completion: null,
};

/** Actually moves the trainee — used both for a plain NAVIGATE and to resume after an emergency card. */
function performNavigate(state: State, targetId: string): State {
  if (targetId === CLOSING_QUIZ_ID) {
    return { ...state, phase: 'closing-quiz', oxIndex: 0 };
  }
  if (!LOCATIONS_BY_ID[targetId]) return state;
  return {
    ...state,
    currentLocationId: targetId,
    visitedIds: { ...state.visitedIds, [targetId]: true },
  };
}

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

    case 'LOCATION_QUIZ_RESULT': {
      if (state.locationAttempted[action.locationId]) return state;
      return {
        ...state,
        locationAttempted: { ...state.locationAttempted, [action.locationId]: true },
        locationFirstTryCorrect: { ...state.locationFirstTryCorrect, [action.locationId]: action.correct },
      };
    }

    case 'LOCATION_SOLVED': {
      if (state.locationSolved[action.locationId]) return state;
      return { ...state, locationSolved: { ...state.locationSolved, [action.locationId]: true } };
    }

    case 'NAVIGATE': {
      const from = LOCATIONS_BY_ID[state.currentLocationId];
      const to = LOCATIONS_BY_ID[action.targetId];
      const isMandatoryHop = Boolean(from && to && from.role === 'mandatory' && to.role === 'mandatory');

      if (
        isMandatoryHop &&
        state.emergency.enabled &&
        !state.emergency.consumed &&
        from.mapOrder === state.emergency.triggerAfterMapOrder
      ) {
        return {
          ...state,
          emergency: { ...state.emergency, consumed: true, active: pickRandomCard(), pendingTargetId: action.targetId },
        };
      }
      return performNavigate(state, action.targetId);
    }

    case 'DISMISS_EMERGENCY': {
      const { pendingTargetId } = state.emergency;
      const cleared: State = { ...state, emergency: { ...state.emergency, active: null, pendingTargetId: undefined } };
      return pendingTargetId ? performNavigate(cleared, pendingTargetId) : cleared;
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

function buildCompletion(state: State): CompletionPayload {
  const locationCorrect = Object.values(state.locationFirstTryCorrect).filter(Boolean).length;
  const oxCorrect = Object.values(state.oxFirstTryCorrect).filter(Boolean).length;
  const total = Object.keys(state.locationAttempted).length + OX_QUESTIONS.length;
  const now = new Date();
  return {
    name: state.trainee?.name ?? '',
    org: state.trainee?.org ?? '',
    completedAt: now.toISOString(),
    score: `${locationCorrect + oxCorrect}/${total}`,
    completionCode: generateCompletionCode(now),
  };
}

export function useSimulation() {
  const [state, dispatch] = useReducer(reducer, initialState);

  const submitOrientation = useCallback((trainee: Trainee) => dispatch({ type: 'SUBMIT_ORIENTATION', trainee }), []);
  const submitLocationAnswer = useCallback(
    (locationId: string, correct: boolean) => dispatch({ type: 'LOCATION_QUIZ_RESULT', locationId, correct }),
    [],
  );
  const markLocationSolved = useCallback((locationId: string) => dispatch({ type: 'LOCATION_SOLVED', locationId }), []);
  const navigate = useCallback((targetId: string) => dispatch({ type: 'NAVIGATE', targetId }), []);
  const dismissEmergency = useCallback(() => dispatch({ type: 'DISMISS_EMERGENCY' }), []);
  const submitOxAnswer = useCallback(
    (questionId: string, correct: boolean) => dispatch({ type: 'OX_RESULT', questionId, correct }),
    [],
  );
  const advanceOx = useCallback(() => dispatch({ type: 'ADVANCE_OX' }), []);

  const currentLocation = LOCATIONS_BY_ID[state.currentLocationId];
  const currentOxQuestion = OX_QUESTIONS[state.oxIndex];

  const progress = useMemo(() => {
    if (state.phase === 'scene' && currentLocation) {
      const anchor = currentLocation.role === 'mandatory' ? currentLocation : LOCATIONS_BY_ID[currentLocation.parentId!];
      return {
        current: anchor.mapOrder,
        total: TOTAL_STAGES,
        detourLabel: currentLocation.role === 'optional' ? currentLocation.stageLabel : undefined,
      };
    }
    if (state.phase === 'closing-quiz') {
      return { current: state.oxIndex + 1, total: OX_QUESTIONS.length };
    }
    return null;
  }, [state.phase, state.oxIndex, currentLocation]);

  return {
    state,
    currentLocation,
    currentOxQuestion,
    progress,
    actions: {
      submitOrientation,
      submitLocationAnswer,
      markLocationSolved,
      navigate,
      dismissEmergency,
      submitOxAnswer,
      advanceOx,
    },
  };
}
