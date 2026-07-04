interface ProgressHeaderProps {
  title: string;
  current: number;
  total: number;
  unitLabel?: string;
  /** Shown as a small pill when the trainee is on an optional side-detour. */
  detourLabel?: string;
  /** Renders a "🗺 전체지도" button in the header when provided. */
  onOpenMap?: () => void;
}

export default function ProgressHeader({ title, current, total, unitLabel = '단계', detourLabel, onOpenMap }: ProgressHeaderProps) {
  const pct = Math.min(100, Math.round((current / total) * 100));

  return (
    <header className="sticky top-0 z-20 bg-brand-50/95 px-4 pb-3 pt-4 backdrop-blur">
      <div className="flex items-center justify-between">
        <span className="text-base font-semibold text-brand-600">
          {current}/{total} {unitLabel}
        </span>
        {onOpenMap && (
          <button
            type="button"
            data-testid="open-map"
            onClick={onOpenMap}
            className="min-h-touch rounded-full bg-brand-200 px-3 text-sm font-semibold text-brand-700 active:bg-brand-300"
          >
            🗺 전체지도
          </button>
        )}
      </div>
      {detourLabel && (
        <span className="mt-2 inline-flex w-fit items-center gap-1 rounded-full bg-brand-200 px-3 py-1 text-sm font-semibold text-brand-700">
          🧭 잠깐 둘러보기 · {detourLabel}
        </span>
      )}
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-brand-200">
        <div
          className="h-full rounded-full bg-accent-500 transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <h1 className="mt-2 text-2xl font-bold text-brand-900">{title}</h1>
    </header>
  );
}
