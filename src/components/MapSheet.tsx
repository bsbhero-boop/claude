import { LOCATIONS, MANDATORY_LOCATIONS } from '../data/content';
import type { Location } from '../types';

interface MapSheetProps {
  currentLocationId: string;
  visitedIds: Record<string, true>;
  locationSolved: Record<string, boolean>;
  onClose: () => void;
}

/** Informational only — tapping a stage never navigates. Moving still always happens via the
 *  exit buttons/hotspots inside the actual scene, to keep controls dead simple on a phone. */
export default function MapSheet({ currentLocationId, visitedIds, locationSolved, onClose }: MapSheetProps) {
  const stageOrders = [...new Set(MANDATORY_LOCATIONS.map((l) => l.mapOrder))].sort((a, b) => a - b);

  const optionalByParentOrder = new Map<number, Location[]>();
  for (const l of LOCATIONS) {
    if (l.role !== 'optional') continue;
    const parent = LOCATIONS.find((p) => p.id === l.parentId);
    if (!parent) continue;
    const list = optionalByParentOrder.get(parent.mapOrder) ?? [];
    list.push(l);
    optionalByParentOrder.set(parent.mapOrder, list);
  }

  const current = LOCATIONS.find((l) => l.id === currentLocationId);
  const currentAnchorOrder = current
    ? current.role === 'mandatory'
      ? current.mapOrder
      : (LOCATIONS.find((l) => l.id === current.parentId)?.mapOrder ?? -1)
    : -1;

  return (
    <div
      data-testid="map-sheet"
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 shadow-xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-brand-900">🗺 전체 지도</h2>
          <button
            type="button"
            data-testid="map-close"
            onClick={onClose}
            className="min-h-touch rounded-lg px-3 text-lg font-semibold text-brand-500"
          >
            닫기
          </button>
        </div>

        <ol className="mt-4 flex flex-col gap-3">
          {stageOrders.map((order) => {
            const stageLocations = MANDATORY_LOCATIONS.filter((l) => l.mapOrder === order);
            const solved = stageLocations.every((l) => locationSolved[l.id]);
            const isCurrent = order === currentAnchorOrder;
            const optionalHere = optionalByParentOrder.get(order) ?? [];

            return (
              <li key={order} className="flex items-start gap-3">
                <span
                  className={[
                    'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold',
                    solved
                      ? 'bg-accent-600 text-white'
                      : isCurrent
                        ? 'bg-white text-accent-700 ring-2 ring-accent-500'
                        : 'bg-brand-100 text-brand-400',
                  ].join(' ')}
                >
                  {order}
                </span>
                <div className="flex flex-1 flex-col gap-1">
                  <p className="text-lg font-semibold text-brand-900">
                    {stageLocations.map((l) => l.subLabel ?? l.stageLabel).join(' · ')}
                  </p>
                  {optionalHere.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {optionalHere.map((l) => (
                        <span
                          key={l.id}
                          className={[
                            'rounded-full px-2.5 py-1 text-xs font-semibold',
                            visitedIds[l.id]
                              ? 'bg-brand-200 text-brand-700'
                              : 'bg-brand-50 text-brand-400 ring-1 ring-brand-200',
                          ].join(' ')}
                        >
                          {visitedIds[l.id] ? '✓ ' : ''}
                          {l.stageLabel}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>

        <p className="mt-4 text-sm text-brand-400">
          지금 위치와 진행 상황을 보여드려요. 실제 이동은 화면 속 출구 버튼으로 해주세요.
        </p>
      </div>
    </div>
  );
}
