import type { Exit, Location } from '../types';
import Hotspot from './Hotspot';

export function isExitEnabled(location: Location, exit: Exit, locationSolved: Record<string, boolean>): boolean {
  // Optional detours never gate on the current location's own quiz.
  if (exit.style !== 'optional' && location.quiz && !locationSolved[location.id]) return false;
  if (exit.style === 'gated' && exit.requires && !exit.requires.every((id) => locationSolved[id])) return false;
  return true;
}

interface ExitHotspotsProps {
  location: Location;
  locationSolved: Record<string, boolean>;
  onNavigate: (targetId: string) => void;
}

export default function ExitHotspots({ location, locationSolved, onNavigate }: ExitHotspotsProps) {
  return (
    <>
      {location.exits.map((exit) => {
        const enabled = isExitEnabled(location, exit, locationSolved);
        // A gated exit simply isn't there yet until its prerequisite is met — nothing to explain.
        if (exit.style === 'gated' && !enabled) return null;
        return (
          <Hotspot
            key={exit.id}
            x={exit.hotspot.x}
            y={exit.hotspot.y}
            unlocked={enabled}
            label={exit.label}
            variant={exit.style === 'optional' ? 'optional' : exit.style === 'return' ? 'return' : 'forward'}
            onTap={() => onNavigate(exit.targetId)}
          />
        );
      })}
    </>
  );
}
