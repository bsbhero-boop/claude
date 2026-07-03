interface LearningPointsCardProps {
  points: string[];
  source: string;
}

export default function LearningPointsCard({ points, source }: LearningPointsCardProps) {
  return (
    <div className="rounded-2xl bg-brand-800 p-5 text-brand-50 shadow-sm">
      <p className="text-lg font-semibold">✅ 핵심 포인트</p>
      <ul className="mt-3 flex flex-col gap-2">
        {points.map((point, i) => (
          <li key={i} className="flex gap-2 text-lg leading-snug">
            <span className="text-accent-400" aria-hidden>·</span>
            <span>{point}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-brand-300">출처: {source}</p>
    </div>
  );
}
