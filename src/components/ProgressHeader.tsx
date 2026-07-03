interface ProgressHeaderProps {
  title: string;
  current: number;
  total: number;
  unitLabel?: string;
}

export default function ProgressHeader({ title, current, total, unitLabel = '단계' }: ProgressHeaderProps) {
  const pct = Math.min(100, Math.round((current / total) * 100));

  return (
    <header className="sticky top-0 z-20 bg-brand-50/95 px-4 pb-3 pt-4 backdrop-blur">
      <div className="flex items-center justify-between">
        <span className="text-base font-semibold text-brand-600">
          {current}/{total} {unitLabel}
        </span>
      </div>
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
