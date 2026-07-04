import { useState } from 'react';
import type { Location } from '../types';
import { LOCATIONS_BY_ID, TOTAL_STAGES } from '../data/content';
import ProgressHeader from './ProgressHeader';
import ExitHotspots, { isExitEnabled } from './ExitHotspots';
import LearningPointsCard from './LearningPointsCard';
import QuizCard from './QuizCard';
import MapSheet from './MapSheet';

interface LocationScreenProps {
  location: Location;
  visitedIds: Record<string, true>;
  locationSolved: Record<string, boolean>;
  onFirstAttempt: (locationId: string, correct: boolean) => void;
  onSolved: (locationId: string) => void;
  onNavigate: (targetId: string) => void;
}

export default function LocationScreen({
  location,
  visitedIds,
  locationSolved,
  onFirstAttempt,
  onSolved,
  onNavigate,
}: LocationScreenProps) {
  const [showMap, setShowMap] = useState(false);
  const title = location.subLabel ?? location.stageLabel;
  const anchor = location.role === 'mandatory' ? location : LOCATIONS_BY_ID[location.parentId!];
  const detourLabel = location.role === 'optional' ? location.stageLabel : undefined;

  // Big, easy-to-tap buttons for every currently-available non-optional exit — the small
  // hotspot arrows stay as the "feels like a real place" affordance, this is the accessible
  // fallback for anyone who finds precise tapping on the scene image difficult.
  const availableMainExits = location.exits.filter(
    (exit) => exit.style !== 'optional' && isExitEnabled(location, exit, locationSolved),
  );

  return (
    <div className="flex min-h-screen flex-col bg-brand-50 pb-8">
      <ProgressHeader
        title={title}
        current={anchor.mapOrder}
        total={TOTAL_STAGES}
        detourLabel={detourLabel}
        onOpenMap={() => setShowMap(true)}
      />

      <div className="relative w-full bg-brand-700" style={{ aspectRatio: '4 / 3' }}>
        <img src={location.image} alt={location.imageAlt} className="h-full w-full object-cover" />
        <ExitHotspots location={location} locationSolved={locationSolved} onNavigate={onNavigate} />
        {location.subTotal && location.subTotal > 1 && (
          <span className="absolute right-3 top-3 rounded-full bg-black/40 px-3 py-1 text-sm font-medium text-white">
            {location.subIndex}/{location.subTotal}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-4 px-4 py-5">
        {location.learningPoints && (
          <LearningPointsCard points={location.learningPoints} source={location.learningSource} />
        )}

        {location.quiz && (
          <QuizCard
            key={location.id}
            quiz={location.quiz}
            onFirstAttempt={(correct) => onFirstAttempt(location.id, correct)}
            onSolved={() => onSolved(location.id)}
          />
        )}

        {availableMainExits.map((exit) => (
          <button
            key={exit.id}
            type="button"
            data-testid="advance-button"
            onClick={() => onNavigate(exit.targetId)}
            className="min-h-touch mt-1 w-full rounded-xl bg-accent-600 px-4 py-3 text-lg font-semibold text-white shadow-sm active:bg-accent-700"
          >
            {exit.label} →
          </button>
        ))}
      </div>

      {showMap && (
        <MapSheet
          currentLocationId={location.id}
          visitedIds={visitedIds}
          locationSolved={locationSolved}
          onClose={() => setShowMap(false)}
        />
      )}
    </div>
  );
}
