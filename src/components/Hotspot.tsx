interface HotspotProps {
  x: number;
  y: number;
  unlocked: boolean;
  label: string;
  onTap: () => void;
  /** 'optional' renders a small always-tappable pin (side detours never gate on quiz state). */
  variant?: 'forward' | 'optional' | 'return';
}

export default function Hotspot({ x, y, unlocked, label, onTap, variant = 'forward' }: HotspotProps) {
  const isOptional = variant === 'optional';
  const isReturn = variant === 'return';
  const tappable = isOptional || unlocked;

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-testid={isOptional ? 'hotspot-optional' : 'hotspot-advance'}
      disabled={!tappable}
      onClick={onTap}
      style={{ left: `${x}%`, top: `${y}%` }}
      className={[
        'absolute -translate-x-1/2 -translate-y-1/2',
        'flex items-center justify-center rounded-full',
        isOptional ? 'h-12 w-12' : 'h-16 w-16',
        'transition-all duration-300',
        tappable
          ? isOptional
            ? 'cursor-pointer bg-brand-500/90 text-white ring-2 ring-white/70 active:bg-brand-600'
            : 'animate-pulseGlow cursor-pointer bg-accent-500 text-white ring-2 ring-white/80'
          : 'pointer-events-none bg-white/30 text-white/50 ring-1 ring-white/40',
      ].join(' ')}
    >
      {isOptional ? (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      ) : (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden className={isReturn ? 'rotate-180' : undefined}>
          <path
            d="M9 5l7 7-7 7"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}
