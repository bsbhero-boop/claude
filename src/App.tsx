import { useSimulation } from './state/useSimulation';
import OrientationScreen from './components/OrientationScreen';
import SceneScreen from './components/SceneScreen';
import EmergencyOverlay from './components/EmergencyOverlay';
import OXQuizScreen from './components/OXQuizScreen';
import CompletionScreen from './components/CompletionScreen';

export default function App() {
  const { state, currentScene, currentOxQuestion, actions } = useSimulation();

  if (state.phase === 'orientation') {
    return <OrientationScreen onStart={actions.submitOrientation} />;
  }

  if (state.phase === 'scene' && currentScene) {
    return (
      <>
        <SceneScreen
          key={currentScene.id}
          scene={currentScene}
          onFirstAttempt={actions.submitSceneAnswer}
          onAdvance={actions.advanceScene}
        />
        {state.emergency.active && (
          <EmergencyOverlay card={state.emergency.active} onContinue={actions.dismissEmergency} />
        )}
      </>
    );
  }

  if (state.phase === 'closing-quiz' && currentOxQuestion) {
    return (
      <OXQuizScreen
        key={currentOxQuestion.id}
        question={currentOxQuestion}
        index={state.oxIndex}
        onResult={actions.submitOxAnswer}
        onAdvance={actions.advanceOx}
      />
    );
  }

  if (state.phase === 'completion' && state.completion) {
    return <CompletionScreen completion={state.completion} />;
  }

  return null;
}
