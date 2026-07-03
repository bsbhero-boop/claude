import { useState } from 'react';
import type { Scene } from '../types';
import { TOTAL_STAGES } from '../data/content';
import ProgressHeader from './ProgressHeader';
import Hotspot from './Hotspot';
import LearningPointsCard from './LearningPointsCard';
import QuizCard from './QuizCard';

interface SceneScreenProps {
  scene: Scene;
  onFirstAttempt: (sceneId: string, correct: boolean) => void;
  onAdvance: () => void;
}

export default function SceneScreen({ scene, onFirstAttempt, onAdvance }: SceneScreenProps) {
  const [unlocked, setUnlocked] = useState(false);
  const title = scene.subLabel ?? scene.stageLabel;

  return (
    <div className="flex min-h-screen flex-col bg-brand-50 pb-8">
      <ProgressHeader title={title} current={scene.stageNumber} total={TOTAL_STAGES} />

      <div className="relative w-full bg-brand-700" style={{ aspectRatio: '4 / 3' }}>
        <img src={scene.image} alt={scene.imageAlt} className="h-full w-full object-cover" />
        <Hotspot x={scene.hotspot.x} y={scene.hotspot.y} unlocked={unlocked} label="다음 장소로 이동" onTap={onAdvance} />
        {scene.subTotal && scene.subTotal > 1 && (
          <span className="absolute right-3 top-3 rounded-full bg-black/40 px-3 py-1 text-sm font-medium text-white">
            {scene.subIndex}/{scene.subTotal}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-4 px-4 py-5">
        <LearningPointsCard points={scene.learningPoints} source={scene.learningSource} />
        <QuizCard
          key={scene.id}
          quiz={scene.quiz}
          onFirstAttempt={(correct) => onFirstAttempt(scene.id, correct)}
          onSolved={() => setUnlocked(true)}
        />
        {unlocked && (
          <button
            type="button"
            data-testid="advance-button"
            onClick={onAdvance}
            className="min-h-touch mt-1 w-full rounded-xl bg-accent-600 px-4 py-3 text-lg font-semibold text-white shadow-sm active:bg-accent-700"
          >
            다음 장소로 이동 →
          </button>
        )}
      </div>
    </div>
  );
}
