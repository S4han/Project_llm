import type { ApiError } from "../../../../shared/contracts/common";
import type { RouteCompareResponse, RouteOption } from "../../../../shared/contracts/route";
import { durationDiffSeconds } from "../../../../shared/rules/route";
import { errorMessage, formatKstTime } from "../trip/format";
import { formatDiff, formatDistance, formatDuration } from "./format";

export type CompareState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "done"; data: RouteCompareResponse }
  | { kind: "error"; error: ApiError };

function Badge({ tone, children }: { tone: "blue" | "amber"; children: string }) {
  const color = tone === "blue" ? "bg-blue-700 text-white" : "bg-amber-100 text-amber-900";
  return <span className={`rounded px-2 py-0.5 text-xs font-bold ${color}`}>{children}</span>;
}

function RouteCard({ route, recommended, tied }: { route: RouteOption; recommended: RouteOption; tied: boolean }) {
  const isRecommended = route.id === recommended.id;
  return (
    <li
      aria-label={route.label}
      className={`rounded-xl border p-4 ${isRecommended ? "border-blue-600 bg-white shadow-sm" : "border-slate-200 bg-white"}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-slate-900">{route.label}</span>
        {isRecommended && <Badge tone="blue">추천</Badge>}
        {tied && <Badge tone="amber">동률</Badge>}
      </div>
      <p className="mt-1 text-2xl font-bold text-slate-900">{formatDuration(route.durationSeconds)}</p>
      <p className="text-sm text-slate-600">
        {formatDistance(route.distanceMeters)}
        {!isRecommended && ` · ${formatDiff(durationDiffSeconds(route, recommended))}`}
      </p>
    </li>
  );
}

interface Props {
  state: CompareState;
  onRetry: () => void;
}

/** 경로 비교 결과(AC-003-02~05, AC-004-02~04). 교통 상태는 TASK-006에서 표시한다. */
export function RouteResults({ state, onRetry }: Props) {
  if (state.kind === "idle") return null;
  if (state.kind === "loading") {
    return (
      <p aria-live="polite" className="text-slate-600">
        경로를 조회하는 중…
      </p>
    );
  }
  if (state.kind === "error") {
    const retryable = state.error.code === "PROVIDER_UNAVAILABLE";
    return (
      <div role="alert" className="flex flex-col gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-800">
        <p>{errorMessage(state.error)}</p>
        {retryable && (
          <button
            type="button"
            onClick={onRetry}
            className="min-h-12 self-start rounded-lg bg-red-700 px-4 font-semibold text-white"
          >
            다시 시도
          </button>
        )}
      </div>
    );
  }

  const { routes, recommendedRouteId, tiedRouteIds, observedAt } = state.data;
  const recommended = routes.find((r) => r.id === recommendedRouteId);
  if (!recommended) return null;
  const ordered = [recommended, ...routes.filter((r) => r !== recommended).sort((a, b) => a.durationSeconds - b.durationSeconds)];
  const mock = routes.some((r) => r.provider === "mock");

  return (
    <section aria-labelledby="routes-heading" className="flex flex-col gap-3">
      <div>
        <h2 id="routes-heading" className="text-lg font-bold text-slate-900">
          경로 비교
        </h2>
        <p className="text-sm text-slate-600">
          {formatKstTime(observedAt)} 조회 기준 · {mock ? "모의 데이터" : "카카오모빌리티 예상시간"}
        </p>
      </div>
      {routes.length === 1 && (
        <p className="rounded-lg bg-slate-100 p-3 text-sm text-slate-700">대체 경로 없음: 제공된 경로가 하나입니다.</p>
      )}
      {tiedRouteIds.length > 0 && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          예상시간이 같은 경로가 있어 거리가 짧은 경로를 추천합니다.
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {ordered.map((route) => (
          <RouteCard key={route.id} route={route} recommended={recommended} tied={tiedRouteIds.includes(route.id)} />
        ))}
      </ul>
    </section>
  );
}
