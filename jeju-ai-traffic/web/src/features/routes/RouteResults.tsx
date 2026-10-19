import { useCallback, useEffect, useState } from "react";
import type { ApiError } from "../../../../shared/contracts/common";
import type { RouteCompareResponse, RouteOption } from "../../../../shared/contracts/route";
import type { IncidentsStatus, TrafficIncident } from "../../../../shared/contracts/traffic";
import { durationDiffSeconds } from "../../../../shared/rules/route";
import { isStale, trafficShares } from "../../../../shared/rules/traffic";
import { errorMessage, formatKstTime } from "../trip/format";
import { formatDiff, formatDistance, formatDuration } from "./format";
import { RouteMap } from "./RouteMap";
import { INCIDENT_LABEL, STATUS_ORDER, STATUS_STYLE } from "./trafficStyle";

export type CompareState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "done"; data: RouteCompareResponse }
  | { kind: "error"; error: ApiError };

function Badge({ tone, children }: { tone: "blue" | "amber"; children: string }) {
  const color = tone === "blue" ? "bg-blue-700 text-white" : "bg-amber-100 text-amber-900";
  return <span className={`rounded px-2 py-0.5 text-xs font-bold ${color}`}>{children}</span>;
}

/** 거리 기준 혼잡 비율 막대와 문구(AC-005-02·03). */
function TrafficBar({ route }: { route: RouteOption }) {
  const shares = trafficShares(route.segments);
  const parts = STATUS_ORDER.filter((s) => shares[s] > 0);
  return (
    <div className="mt-2 flex flex-col gap-1">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-200" aria-hidden="true">
        {parts.map((s) => (
          <span key={s} className={STATUS_STYLE[s].bar} style={{ width: `${shares[s] * 100}%` }} />
        ))}
      </div>
      <p className="text-xs text-slate-600">
        {parts.map((s) => `${STATUS_STYLE[s].label} ${Math.round(shares[s] * 100)}%`).join(" · ")}
      </p>
    </div>
  );
}

function IncidentList({ incidents }: { incidents: TrafficIncident[] }) {
  return (
    <ul className="mt-2 flex flex-col gap-1 text-sm">
      {incidents.map((i) => (
        <li key={i.id} className="rounded bg-red-50 px-2 py-1 text-red-900">
          <span className="font-semibold">{INCIDENT_LABEL[i.kind]}</span> {i.description}
          <span className="block text-xs text-red-800/80">
            {i.sourceTime ? `원천 ${formatKstTime(i.sourceTime)}` : `조회 ${formatKstTime(i.observedAt)}`}
            {i.source === "mock" && " · 모의 데이터"}
          </span>
        </li>
      ))}
    </ul>
  );
}

interface CardProps {
  route: RouteOption;
  recommended: RouteOption;
  tied: boolean;
  selected: boolean;
  incidents: TrafficIncident[];
  onSelect: () => void;
}

function RouteCard({ route, recommended, tied, selected, incidents, onSelect }: CardProps) {
  const isRecommended = route.id === recommended.id;
  const routeIncidents = incidents.filter((i) => route.incidentIds.includes(i.id));
  return (
    <li aria-label={route.label}>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={`w-full rounded-xl border p-4 text-left ${selected ? "border-blue-600 bg-white shadow-sm ring-2 ring-blue-600/30" : "border-slate-200 bg-white"}`}
      >
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-slate-900">{route.label}</span>
          {isRecommended && <Badge tone="blue">추천</Badge>}
          {tied && <Badge tone="amber">동률</Badge>}
          {selected && <span className="ml-auto text-xs font-semibold text-blue-700">지도에 표시 중</span>}
        </span>
        <span className="mt-1 block text-2xl font-bold text-slate-900">{formatDuration(route.durationSeconds)}</span>
        <span className="block text-sm text-slate-600">
          {formatDistance(route.distanceMeters)}
          {!isRecommended && ` · ${formatDiff(durationDiffSeconds(route, recommended))}`}
        </span>
        <TrafficBar route={route} />
        {routeIncidents.length > 0 && (
          <span className="mt-1 block text-sm font-semibold text-red-800">확인된 교통 사건 {routeIncidents.length}건</span>
        )}
        {selected && routeIncidents.length > 0 && <IncidentList incidents={routeIncidents} />}
      </button>
    </li>
  );
}

function incidentsNote(status: IncidentsStatus, observedAt: string | null, count: number): string {
  if (status === "quotaBlocked") return "교통 사건 정보 미확보(조회 한도 도달).";
  if (status === "unavailable") return "교통 사건 정보 미확보(조회 실패).";
  const at = observedAt ? ` (${formatKstTime(observedAt)} 조회)` : "";
  if (count === 0) return `제주 ITS${at}: 경로 주변 사건이 확인되지 않았습니다. 모든 도로의 사건이 제공되지는 않습니다.`;
  return `제주 ITS 돌발·통제·공사 정보(경로 200m 이내)${at}.`;
}

/** 30초마다 현재 시각을 갱신한다(오래된 정보 판단용). */
function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function Results({ data, onRetry }: { data: RouteCompareResponse; onRetry: () => void }) {
  const { routes, recommendedRouteId, tiedRouteIds, observedAt, incidents, incidentsStatus, incidentsObservedAt } = data;
  const [selectedId, setSelectedId] = useState(recommendedRouteId ?? routes[0]?.id ?? "");
  const select = useCallback((id: string) => setSelectedId(id), []);
  const now = useNow();
  const recommended = routes.find((r) => r.id === recommendedRouteId);
  if (!recommended) return null;
  const ordered = [recommended, ...routes.filter((r) => r !== recommended).sort((a, b) => a.durationSeconds - b.durationSeconds)];
  const mock = routes.some((r) => r.provider === "mock");
  const stale = isStale(observedAt, now);

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
      {stale && (
        <div role="alert" className="flex items-center justify-between gap-2 rounded-lg bg-amber-100 p-3 text-sm text-amber-900">
          <span>오래된 정보입니다({Math.floor((now.getTime() - Date.parse(observedAt)) / 60_000)}분 전 조회). 다시 조회하세요.</span>
          <button type="button" onClick={onRetry} className="min-h-12 shrink-0 rounded-lg bg-amber-700 px-3 font-semibold text-white">
            다시 조회
          </button>
        </div>
      )}
      <RouteMap routes={routes} selectedId={selectedId} incidents={incidents} onSelect={select} />
      <ul aria-label="혼잡 범례" className="flex flex-wrap gap-3 text-xs text-slate-700">
        {STATUS_ORDER.map((s) => (
          <li key={s} className="flex items-center gap-1">
            <span className={`inline-block h-1.5 w-5 rounded ${STATUS_STYLE[s].bar}`} aria-hidden="true" />
            {STATUS_STYLE[s].label}
          </li>
        ))}
      </ul>
      <p className="text-xs text-slate-600">
        혼잡도는 카카오모빌리티 구간 평균값입니다. {incidentsNote(incidentsStatus, incidentsObservedAt, incidents.length)}
      </p>
      {routes.length === 1 && (
        <p className="rounded-lg bg-slate-100 p-3 text-sm text-slate-700">대체 경로 없음: 제공된 경로가 하나입니다.</p>
      )}
      {tiedRouteIds.length > 0 && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          예상시간이 같은 경로가 있어 거리가 짧은 경로를 추천합니다.
        </p>
      )}
      <ul aria-label="경로 목록" className="flex flex-col gap-2">
        {ordered.map((route) => (
          <RouteCard
            key={route.id}
            route={route}
            recommended={recommended}
            tied={tiedRouteIds.includes(route.id)}
            selected={route.id === selectedId}
            incidents={incidents}
            onSelect={() => select(route.id)}
          />
        ))}
      </ul>
    </section>
  );
}

interface Props {
  state: CompareState;
  onRetry: () => void;
}

/** 경로 비교 결과(AC-003, AC-004, AC-005, AC-007). */
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
          <button type="button" onClick={onRetry} className="min-h-12 self-start rounded-lg bg-red-700 px-4 font-semibold text-white">
            다시 시도
          </button>
        )}
      </div>
    );
  }
  // 새 응답마다 선택 상태를 추천 경로로 초기화한다.
  return <Results key={state.data.observedAt} data={state.data} onRetry={onRetry} />;
}
