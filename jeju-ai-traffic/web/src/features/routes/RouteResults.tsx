import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApiError } from "../../../../shared/contracts/common";
import type { Place } from "../../../../shared/contracts/place";
import type { RouteCompareResponse, RouteOption } from "../../../../shared/contracts/route";
import type { IncidentsStatus, TrafficIncident } from "../../../../shared/contracts/traffic";
import { durationDiffSeconds } from "../../../../shared/rules/route";
import { isStale, trafficShares } from "../../../../shared/rules/traffic";
import { errorMessage, formatKstTime } from "../trip/format";
import { formatDiff, formatDistance, formatDuration } from "./format";
import { ExplanationCard } from "./ExplanationCard";
import { MonitorPanel } from "../monitor/MonitorPanel";
import { NavigationPanel } from "./NavigationPanel";
import { RouteMap, type IncidentFocus } from "./RouteMap";
import { groupIncidents, type IncidentGroup } from "./incidents";
import { STATUS_ORDER, STATUS_STYLE } from "./trafficStyle";

export type CompareState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "done"; data: RouteCompareResponse; destination: Place }
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

interface IncidentListProps {
  groups: IncidentGroup[];
  focusedKey: string | null;
  onFocus: (key: string) => void;
}

/** 사건 묶음 목록. 누르면 지도에서 그 지점을 보여 준다(TASK-011 계획 (b)). */
function IncidentList({ groups, focusedKey, onFocus }: IncidentListProps) {
  return (
    <ul aria-label="확인된 교통 사건" className="flex flex-col gap-1 px-4 pb-4 text-sm">
      {groups.map((g) => (
        <li key={g.key}>
          <button
            type="button"
            onClick={() => onFocus(g.key)}
            aria-pressed={g.key === focusedKey}
            className={`w-full rounded px-2 py-2 text-left text-red-900 ${g.key === focusedKey ? "bg-red-100 ring-2 ring-red-600" : "bg-red-50"}`}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="font-semibold">
                {g.label} {g.count}건
              </span>
              <span className="shrink-0 text-xs font-semibold text-red-800">{g.key === focusedKey ? "지도에 표시 중" : "지도에서 보기 ›"}</span>
            </span>
            <span className="block text-xs text-red-800/80">
              {g.latestSourceTime
                ? `원천 ${formatKstTime(g.latestSourceTime)}`
                : `제주 ITS가 감지한 정보로, 발생 시각과 상세는 제공되지 않습니다 · 조회 ${formatKstTime(g.observedAt)}`}
              {g.mock && " · 모의 데이터"}
            </span>
          </button>
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
  focusedKey: string | null;
  onFocus: (key: string) => void;
}

function RouteCard({ route, recommended, tied, selected, incidents, onSelect, focusedKey, onFocus }: CardProps) {
  const isRecommended = route.id === recommended.id;
  const routeIncidents = incidents.filter((i) => route.incidentIds.includes(i.id));
  return (
    <li
      aria-label={route.label}
      className={`rounded-xl border bg-white ${selected ? "border-blue-600 shadow-sm ring-2 ring-blue-600/30" : "border-slate-200"}`}
    >
      <button type="button" onClick={onSelect} aria-pressed={selected} className="w-full p-4 text-left">
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
      </button>
      {selected && routeIncidents.length > 0 && (
        <IncidentList groups={groupIncidents(routeIncidents)} focusedKey={focusedKey} onFocus={onFocus} />
      )}
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

function Results({ data, destination, onRetry }: { data: RouteCompareResponse; destination: Place; onRetry: () => void }) {
  const { routes, recommendedRouteId, tiedRouteIds, observedAt, incidents, incidentsStatus, incidentsObservedAt } = data;
  const [selectedId, setSelectedId] = useState(recommendedRouteId ?? routes[0]?.id ?? "");
  // 지도에서 보고 있는 사건 묶음(key)과 그 안의 몇 번째 지점인지. 경로를 바꾸면 닫는다.
  const [focused, setFocused] = useState<{ key: string; index: number } | null>(null);
  const select = useCallback((id: string) => {
    setSelectedId(id);
    setFocused(null);
  }, []);
  const mapBox = useRef<HTMLDivElement>(null);
  const now = useNow();
  const selectedRoute = routes.find((r) => r.id === selectedId);
  const groups = selectedRoute ? groupIncidents(incidents.filter((i) => selectedRoute.incidentIds.includes(i.id))) : [];
  const group = focused ? groups.find((g) => g.key === focused.key) : undefined;
  const current = group ? group.items[focused!.index % group.items.length] : undefined;
  // 지도는 focus가 바뀔 때만 다시 그리므로 값이 같으면 같은 객체를 쓴다(30초 시계 갱신 등으로 화면이 다시 맞춰지지 않게).
  const focusLabel = group?.label;
  const focusIds = group?.items.map((i) => i.id).join(",");
  const currentId = current?.id;
  const focus = useMemo<IncidentFocus | null>(
    () => (focusLabel && focusIds && currentId ? { label: focusLabel, ids: focusIds.split(","), currentId } : null),
    [focusLabel, focusIds, currentId],
  );
  const recommended = routes.find((r) => r.id === recommendedRouteId);
  if (!recommended) return null;

  const focusGroup = (key: string) => {
    setFocused((f) => (f?.key === key ? null : { key, index: 0 }));
    mapBox.current?.scrollIntoView?.({ behavior: "smooth", block: "center" });
  };
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
      <div ref={mapBox} className="flex flex-col gap-2">
        <RouteMap routes={routes} selectedId={selectedId} incidents={incidents} onSelect={select} focus={focus} />
        {group && focused && (
          <div role="status" className="flex flex-wrap items-center gap-2 rounded-lg bg-red-50 p-2 text-sm text-red-900">
            <span className="mr-auto font-semibold">
              {group.label} {group.items.length > 1 ? `${(focused.index % group.items.length) + 1}/${group.items.length}번째 지점` : "지점"} 표시 중
            </span>
            {group.items.length > 1 && (
              <button
                type="button"
                onClick={() => setFocused({ key: group.key, index: (focused.index + 1) % group.items.length })}
                className="min-h-12 rounded-lg bg-red-700 px-3 font-semibold text-white"
              >
                다음 지점 ›
              </button>
            )}
            <button type="button" onClick={() => setFocused(null)} className="min-h-12 rounded-lg border border-red-300 bg-white px-3 font-semibold text-red-900">
              전체 보기
            </button>
          </div>
        )}
      </div>
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
        <p className="rounded-lg bg-slate-100 p-3 text-sm text-slate-700">카카오 추천 경로(실시간 교통 반영)를 보여 줍니다. 다른 경로와는 비교하지 않습니다.</p>
      )}
      {tiedRouteIds.length > 0 && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          예상시간이 같은 경로가 있어 거리가 짧은 경로를 추천합니다.
        </p>
      )}
      <NavigationPanel destination={destination} />
      <MonitorPanel
        destination={destination.location}
        selectedId={selectedId}
        onFollowChange={(id) => routes.some((r) => r.id === id) && select(id)}
      />
      <ExplanationCard data={data} />
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
            focusedKey={route.id === selectedId ? (focused?.key ?? null) : null}
            onFocus={focusGroup}
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
  return <Results key={state.data.observedAt} data={state.data} destination={state.destination} onRetry={onRetry} />;
}
