interface HotspotProps {
  x: number;
  y: number;
  unlocked: boolean;
  label: string;
  onTap: () => void;
}

export default function Hotspot({ x, y, unlocked, label, onTap }: HotspotProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-testid="hotspot-advance"
      disabled={!unlocked}
      onClick={onTap}
      style={{ left: `${x}%`, top: `${y}%` }}
      className={[
        'absolute -translate-x-1/2 -translate-y-1/2',
        'flex h-16 w-16 items-center justify-center rounded-full',
        'transition-all duration-300',
        unlocked
          ? 'animate-pulseGlow cursor-pointer bg-accent-500 text-white ring-2 ring-white/80'
          : 'pointer-events-none bg-white/30 text-white/50 ring-1 ring-white/40',
      ].join(' ')}
    >
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M9 5l7 7-7 7"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
