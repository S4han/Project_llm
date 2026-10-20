import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IncidentKind, SpeedStatus, TrafficIncident, TrafficLinksResponse, TrafficSpeedsResponse } from "../../../../shared/contracts/traffic";
import { isStale } from "../../../../shared/rules/traffic";
import { fetchTrafficIncidents, fetchTrafficLinks, fetchTrafficSpeeds } from "../../services/trafficApi";
import type { SpeedLine } from "../map/leafletMap";
import { IncidentFocusBar, IncidentGroupList } from "../routes/IncidentFocus";
import { groupIncidents, useIncidentFocus } from "../routes/incidents";
import { INCIDENT_LABEL, STATUS_STYLE } from "../routes/trafficStyle";
import { formatKstTime } from "../trip/format";
import { IncidentMap } from "./IncidentMap";
import { groupByRoad, joinSpeedLines } from "./speedLines";

/** 자동 갱신 간격. 서버는 제주 ITS 결과를 60초 캐시하므로 더 자주 불러도 새 정보가 없다(TASK-012 3. (a)). */
export const REFRESH_MS = 60_000;

/** 대시보드에 보이는 종류(TASK-012 1. (a): 교통기상 제외). */
const KINDS: Exclude<IncidentKind, "weather">[] = ["event", "closure", "roadwork"];

const SPEED_ORDER: SpeedStatus[] = ["smooth", "slow", "congested"];

/** 도로 목록을 한 번에 보여 줄 개수. */
const ROAD_PAGE = 20;

/** 구간 속도 원천이 약 5분 단위라, 15분이 지나면 오래된 속도로 본다. */
const SPEED_STALE_MS = 15 * 60_000;

interface Snapshot {
  incidents: TrafficIncident[];
  observedAt: string;
}

/** 마지막으로 성공한 조회와, 그 뒤의 실패·한도 안내. 실패해도 마지막 성공 결과는 남긴다. */
interface DashboardState {
  snapshot: Snapshot | null;
  problem: string | null;
  loading: boolean;
}

const EMPTY_LINES: SpeedLine[] = [];
const EMPTY_IDS: string[] = [];

/** 제주 ITS 실시간 교통 현황(TASK-012). 화면이 켜져 있을 때만 1분마다 다시 조회한다. */
export function TrafficDashboard() {
  const [state, setState] = useState<DashboardState>({ snapshot: null, problem: null, loading: true });
  const [speeds, setSpeeds] = useState<TrafficSpeedsResponse | null>(null);
  const [links, setLinks] = useState<TrafficLinksResponse["links"] | null>(null);
  const [linksProblem, setLinksProblem] = useState<string | null>(null);
  const [showSpeeds, setShowSpeeds] = useState(true);
  // 도로 소통 상태 카드·도로 목록(TASK-012 소통대시보드)
  const [speedFilter, setSpeedFilter] = useState<SpeedStatus | "all">("all");
  const [roadKey, setRoadKey] = useState<string | null>(null);
  const [roadLimit, setRoadLimit] = useState(ROAD_PAGE);
  const [kind, setKind] = useState<IncidentKind | "all">("all");
  const [now, setNow] = useState(() => new Date());
  const lastLoad = useRef(0);
  const seq = useRef(0);
  const mapBox = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const id = ++seq.current;
    lastLoad.current = Date.now();
    const speedPromise = fetchTrafficSpeeds();
    const result = await fetchTrafficIncidents();
    const speedResult = await speedPromise;
    if (id !== seq.current) return;
    // 속도는 실패해도 마지막으로 받은 값을 두고 상태만 바꾼다.
    if (speedResult.ok) setSpeeds((prev) => (speedResult.data.status === "ok" || !prev ? speedResult.data : { ...prev, status: speedResult.data.status, retryAfter: speedResult.data.retryAfter }));
    setNow(new Date());
    setState((s) => {
      if (!result.ok) return { ...s, loading: false, problem: `갱신 실패: ${result.error.message}` };
      const { data } = result;
      if (data.status === "ok" && data.observedAt) return { snapshot: { incidents: data.incidents, observedAt: data.observedAt }, problem: null, loading: false };
      const reason =
        data.status === "quotaBlocked"
          ? `교통 사건 정보 미확보(오늘 조회 한도 도달${data.retryAfter ? `, ${formatKstTime(data.retryAfter)} 이후 다시 사용 가능` : ""})`
          : "교통 사건 정보 미확보(제주 ITS 조회 실패)";
      return { ...s, loading: false, problem: reason };
    });
  }, []);

  /** 조회 중 표시를 켜고 다시 조회한다(새로고침·자동 갱신). 처음 조회는 초기 상태가 이미 조회 중이다. */
  const refresh = useCallback(() => {
    setState((s) => ({ ...s, loading: true }));
    void load();
  }, [load]);

  // 구간 모양은 화면을 열 때 한 번만 받는다(서버·CDN이 30일 보관).
  useEffect(() => {
    let alive = true;
    void fetchTrafficLinks().then((r) => {
      if (!alive) return;
      if (r.ok) setLinks(r.data.links);
      else setLinksProblem("도로 모양을 불러오지 못해 구간 속도 색을 표시할 수 없습니다.");
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    // 첫 조회도 콜백으로 시작한다(효과 본문에서 상태를 바로 바꾸지 않도록).
    const first = setTimeout(() => void load(), 0);
    const tick = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, REFRESH_MS);
    // 화면으로 돌아왔을 때 1분이 지났으면 바로 다시 조회한다.
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastLoad.current >= REFRESH_MS) refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(first);
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load, refresh]);

  const all = state.snapshot?.incidents ?? [];
  const shown = kind === "all" ? all : all.filter((i) => i.kind === kind);
  const groups = groupIncidents(shown).sort((a, b) => b.count - a.count);
  const incidentFocus = useIncidentFocus(groups);
  const { clear: clearFocus } = incidentFocus;
  const stale = state.snapshot ? isStale(state.snapshot.observedAt, now) : false;
  const speedLines = useMemo(() => (links && speeds ? joinSpeedLines(links, speeds.speeds) : []), [links, speeds]);
  const speedCounts = SPEED_ORDER.map((s) => [s, speedLines.filter((l) => l.status === s).length] as const);
  const filteredLines = useMemo(() => (speedFilter === "all" ? speedLines : speedLines.filter((l) => l.status === speedFilter)), [speedLines, speedFilter]);
  const roads = useMemo(() => (speedFilter === "all" ? [] : groupByRoad(filteredLines)), [filteredLines, speedFilter]);
  // 보고 있던 도로가 갱신 뒤 이 상태에서 빠지면 강조를 닫는다(목록에서 찾지 못하면 없는 것으로 본다).
  const road = roadKey === null ? undefined : roads.find((r) => r.key === roadKey);
  const roadIdsKey = road?.ids.join(",") ?? "";
  const highlightIds = useMemo(() => (roadIdsKey ? roadIdsKey.split(",") : EMPTY_IDS), [roadIdsKey]);
  const speedStale = speeds?.observedAt ? now.getTime() - Date.parse(speeds.observedAt) > SPEED_STALE_MS : false;
  const speedProblem =
    speeds && speeds.status !== "ok"
      ? speeds.status === "quotaBlocked"
        ? `구간 속도 정보 미확보(오늘 조회 한도 도달${speeds.retryAfter ? `, ${formatKstTime(speeds.retryAfter)} 이후 다시 사용 가능` : ""})`
        : "구간 속도 정보 미확보(제주 ITS 조회 실패)"
      : null;

  const chooseSpeed = (s: SpeedStatus | "all") => {
    setSpeedFilter(s);
    setRoadKey(null);
    setRoadLimit(ROAD_PAGE);
    setShowSpeeds(true);
  };
  const focusRoad = (key: string) => {
    setRoadKey((k) => (k === key ? null : key));
    clearFocus();
    mapBox.current?.scrollIntoView?.({ behavior: "smooth", block: "center" });
  };

  const chooseKind = (k: IncidentKind | "all") => {
    setKind(k);
    clearFocus();
  };
  const focusGroup = (key: string) => {
    incidentFocus.toggle(key);
    setRoadKey(null);
    mapBox.current?.scrollIntoView?.({ behavior: "smooth", block: "center" });
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 bg-slate-50 p-4">
      <main className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-2xl font-bold text-slate-900">제주 실시간 교통 현황</h1>
          <a href="/" className="shrink-0 text-sm font-semibold text-blue-700">
            ← 경로 추천
          </a>
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-slate-600">
            제주 ITS 돌발·통제·공사
            {state.snapshot && ` · ${formatKstTime(state.snapshot.observedAt)} 조회`}
            {state.snapshot?.incidents.some((i) => i.source === "mock") && " · 모의 데이터"}
            <span className="block text-xs">화면이 켜져 있을 때 1분마다 자동 갱신</span>
          </p>
          <button
            type="button"
            onClick={refresh}
            disabled={state.loading}
            className="min-h-12 shrink-0 rounded-lg border border-slate-300 bg-white px-3 font-semibold text-slate-800 disabled:opacity-50"
          >
            {state.loading ? "조회 중…" : "새로고침"}
          </button>
        </div>

        <div aria-live="polite" className="flex flex-col gap-2 text-sm">
          {state.problem && (
            <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">
              {state.problem}
              {state.snapshot && ` · 마지막 성공 ${formatKstTime(state.snapshot.observedAt)}`}
            </p>
          )}
          {stale && state.snapshot && (
            <p role="alert" className="rounded-lg bg-amber-100 p-3 text-amber-900">
              오래된 정보입니다({Math.floor((now.getTime() - Date.parse(state.snapshot.observedAt)) / 60_000)}분 전 조회).
            </p>
          )}
        </div>

        <ul aria-label="종류별 건수" className="grid grid-cols-4 gap-2">
          {(["all", ...KINDS] as const).map((k) => {
            const count = k === "all" ? all.length : all.filter((i) => i.kind === k).length;
            return (
              <li key={k}>
                <button
                  type="button"
                  onClick={() => chooseKind(k)}
                  aria-pressed={kind === k}
                  className={`flex min-h-16 w-full flex-col items-center justify-center rounded-xl border p-2 ${kind === k ? "border-blue-600 bg-blue-50 ring-2 ring-blue-600/30" : "border-slate-200 bg-white"}`}
                >
                  <span className="text-xs text-slate-600">{k === "all" ? "전체" : INCIDENT_LABEL[k]}</span>
                  <span className="text-xl font-bold text-slate-900">{state.snapshot ? count : "–"}</span>
                </button>
              </li>
            );
          })}
        </ul>

        <section aria-labelledby="speeds-heading" className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3">
          <div className="flex items-center justify-between gap-2">
            <h2 id="speeds-heading" className="font-bold text-slate-900">
              도로 소통
            </h2>
            <button
              type="button"
              onClick={() => setShowSpeeds((v) => !v)}
              aria-pressed={showSpeeds}
              className={`min-h-12 rounded-lg border px-3 text-sm font-semibold ${showSpeeds ? "border-blue-600 bg-blue-50 text-blue-800" : "border-slate-300 bg-white text-slate-700"}`}
            >
              {showSpeeds ? "지도에 표시 중" : "지도에 표시"}
            </button>
          </div>
          <ul aria-label="구간 소통 건수" className="grid grid-cols-4 gap-2">
            {([["all", speedLines.length], ...speedCounts] as const).map(([s, n]) => (
              <li key={s}>
                <button
                  type="button"
                  onClick={() => chooseSpeed(s)}
                  aria-pressed={speedFilter === s}
                  className={`flex min-h-16 w-full flex-col items-center justify-center rounded-xl border p-2 ${speedFilter === s ? "border-blue-600 bg-blue-50 ring-2 ring-blue-600/30" : "border-slate-200 bg-white"}`}
                >
                  <span className="flex items-center gap-1 text-xs text-slate-600">
                    {s !== "all" && <span className={`inline-block h-1.5 w-3 rounded ${STATUS_STYLE[s].bar}`} aria-hidden="true" />}
                    {s === "all" ? "전체" : STATUS_STYLE[s].label}
                  </span>
                  <span className="text-lg font-bold text-slate-900">{speedLines.length ? n.toLocaleString("ko-KR") : "–"}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-slate-600">
            제주 ITS 구간 평균속도(원활 30km/h 이상 · 서행 15~30 · 정체 15 미만)
            {speeds?.observedAt && ` · ${formatKstTime(speeds.observedAt)} 기준`}
            {speeds?.source === "mock" && " · 모의 데이터"}. 속도 정보가 없는 도로는 표시하지 않습니다.
          </p>
          {(speedProblem || linksProblem || speedStale) && (
            <p role="alert" className="rounded bg-amber-50 p-2 text-sm text-amber-900">
              {speedProblem ?? linksProblem ?? "오래된 구간 속도입니다(15분 넘게 갱신되지 않음)."}
            </p>
          )}
          {speedFilter !== "all" && speedLines.length > 0 && (
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold text-slate-800">
                {STATUS_STYLE[speedFilter].label} 도로 {roads.length.toLocaleString("ko-KR")}곳 · 구간이 많은 순
              </h3>
              {roads.length === 0 ? (
                <p className="text-sm text-slate-600">현재 {STATUS_STYLE[speedFilter].label} 구간이 없습니다.</p>
              ) : (
                <ul aria-label={`${STATUS_STYLE[speedFilter].label} 도로 목록`} className="flex flex-col gap-1">
                  {roads.slice(0, roadLimit).map((r) => (
                    <li key={r.key}>
                      <button
                        type="button"
                        onClick={() => focusRoad(r.key)}
                        aria-pressed={r.key === roadKey}
                        className={`flex min-h-12 w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-sm ${r.key === roadKey ? "bg-blue-100 ring-2 ring-blue-600" : "bg-slate-50"}`}
                      >
                        <span>
                          <span className="font-semibold text-slate-900">{r.label}</span>
                          <span className="text-slate-700">
                            {" "}
                            · {STATUS_STYLE[speedFilter].label} {r.count}구간 · 평균 {r.avgKmh}km/h
                          </span>
                        </span>
                        <span className="shrink-0 text-xs font-semibold text-blue-700">{r.key === roadKey ? "지도에 표시 중" : "지도에서 보기 ›"}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {roads.length > roadLimit && (
                <button
                  type="button"
                  onClick={() => setRoadLimit((n) => n + ROAD_PAGE)}
                  className="min-h-12 rounded-lg border border-slate-300 bg-white font-semibold text-slate-800"
                >
                  더 보기 ({(roads.length - roadLimit).toLocaleString("ko-KR")}곳 남음)
                </button>
              )}
            </div>
          )}
        </section>

        <div ref={mapBox} className="flex flex-col gap-2">
          <IncidentMap
            incidents={shown}
            focus={incidentFocus.focus}
            viewKey={kind}
            speedLines={showSpeeds ? filteredLines : EMPTY_LINES}
            speedObservedAt={speeds?.observedAt ?? null}
            highlightIds={showSpeeds ? highlightIds : EMPTY_IDS}
          />
          <IncidentFocusBar state={incidentFocus} />
          {road && speedFilter !== "all" && (
            <div role="status" className="flex flex-wrap items-center gap-2 rounded-lg bg-blue-50 p-2 text-sm text-blue-900">
              <span className="mr-auto font-semibold">
                {road.label} {STATUS_STYLE[speedFilter].label} {road.count}구간 표시 중
              </span>
              <button type="button" onClick={() => setRoadKey(null)} className="min-h-12 rounded-lg border border-blue-300 bg-white px-3 font-semibold text-blue-900">
                전체 보기
              </button>
            </div>
          )}
        </div>

        {state.snapshot && groups.length > 0 && (
          <section aria-labelledby="groups-heading" className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white pt-4">
            <h2 id="groups-heading" className="px-4 font-bold text-slate-900">
              감지된 사건 {shown.length}건
            </h2>
            <IncidentGroupList groups={groups} focusedKey={incidentFocus.focusedKey} onFocus={focusGroup} />
          </section>
        )}
        {state.snapshot && shown.length === 0 && (
          <p className="rounded-lg bg-slate-100 p-3 text-sm text-slate-700">
            {kind === "all" ? "현재 제주 ITS에 감지된 돌발·통제·공사가 없습니다." : `현재 제주 ITS에 감지된 ${INCIDENT_LABEL[kind]} 정보가 없습니다.`} 모든 도로의 사건이
            제공되지는 않으므로, 도로에 이상이 없다는 뜻은 아닙니다.
          </p>
        )}
      </main>
      <footer className="mt-auto flex flex-col gap-1 border-t border-slate-200 pt-3 text-xs text-slate-500">
        <p className="text-sm font-semibold text-amber-800">운전 중에는 화면을 조작하지 마세요.</p>
        <p>제주 ITS가 감지한 지점 정보이며, 발생 시각·상세와 모든 도로의 상황을 포함하지 않습니다. 이 화면은 위치정보를 사용하지 않습니다.</p>
        <p>지도 © OpenStreetMap 기여자 · 교통 제주 ITS · 도로 모양 브이월드(국토교통부 교통링크)</p>
      </footer>
    </div>
  );
}
