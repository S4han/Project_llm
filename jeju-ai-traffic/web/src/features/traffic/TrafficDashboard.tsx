import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IncidentKind, SpeedStatus, TrafficIncident, TrafficLinksResponse, TrafficSpeedsResponse } from "../../../../shared/contracts/traffic";
import { isStale } from "../../../../shared/rules/traffic";
import { fetchTrafficIncidents, fetchTrafficLinks, fetchTrafficSpeeds } from "../../services/trafficApi";
import type { SpeedLine } from "../map/leafletMap";
import { IncidentFocusBar, IncidentGroupList } from "../routes/IncidentFocus";
import { groupIncidents, useIncidentFocus } from "../routes/incidents";
import { INCIDENT_LABEL, STATUS_STYLE } from "../routes/trafficStyle";
import { formatKstTime } from "../trip/format";
import { revealMap } from "../map/revealMap";
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

/** 넓은 화면에서 정보 패널 칸(위쪽 전체 폭 → PC는 오른쪽 칸). */
const PANEL = "md:col-span-2 xl:col-span-1 xl:col-start-2";
const EMPTY_IDS: string[] = [];

/** 제주 ITS 실시간 교통 현황(TASK-012). 화면이 켜져 있을 때만 1분마다 다시 조회한다. */
export function TrafficDashboard() {
  const [state, setState] = useState<DashboardState>({ snapshot: null, problem: null, loading: true });
  const [speeds, setSpeeds] = useState<TrafficSpeedsResponse | null>(null);
  const [links, setLinks] = useState<TrafficLinksResponse["links"] | null>(null);
  const [linksProblem, setLinksProblem] = useState<string | null>(null);
  // 처리 현황(도로 모양은 서버가 새로 만들 때 최대 1분, 구간 속도는 1~2초)
  const [linksLoading, setLinksLoading] = useState(true);
  const [linksStartedAt, setLinksStartedAt] = useState(() => Date.now());
  const [clock, setClock] = useState(() => Date.now());
  const [speedsBusy, setSpeedsBusy] = useState(true);
  const [speedsError, setSpeedsError] = useState(false);
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
    setSpeedsBusy(false);
    setSpeedsError(!speedResult.ok);
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
    setSpeedsBusy(true);
    void load();
  }, [load]);

  // 구간 모양은 화면을 열 때 한 번만 받는다(서버·CDN이 30일 보관). 실패하면 "다시 시도"로 다시 받는다.
  const alive = useRef(true);
  const fetchLinks = useCallback(async () => {
    const r = await fetchTrafficLinks();
    if (!alive.current) return;
    setLinksLoading(false);
    if (r.ok) {
      setLinks(r.data.links);
      setLinksProblem(null);
    } else setLinksProblem("도로 모양을 불러오지 못해 구간 속도 색을 표시할 수 없습니다.");
  }, []);
  const retryLinks = () => {
    setLinksLoading(true);
    setLinksProblem(null);
    setLinksStartedAt(Date.now());
    setClock(Date.now());
    void fetchLinks();
  };
  useEffect(() => {
    alive.current = true;
    // 콜백으로 시작한다(효과 본문에서 상태를 바로 바꾸지 않도록, 첫 조회와 같은 방식).
    const first = setTimeout(() => void fetchLinks(), 0);
    return () => {
      alive.current = false;
      clearTimeout(first);
    };
  }, [fetchLinks]);

  // 도로 모양을 받는 동안 경과 시간(초)을 1초마다 갱신한다.
  useEffect(() => {
    if (!linksLoading) return;
    const id = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(id);
  }, [linksLoading]);

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
  const linksSeconds = Math.max(0, Math.floor((clock - linksStartedAt) / 1000));
  const firstSpeeds = speeds === null && speedsBusy;
  const showProgress = linksLoading || firstSpeeds;
  const mapOverlay = showSpeeds && speedLines.length === 0 && showProgress ? "도로 소통 불러오는 중…" : null;
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
    revealMap(mapBox.current);
  };

  const chooseKind = (k: IncidentKind | "all") => {
    setKind(k);
    clearFocus();
  };
  const focusGroup = (key: string) => {
    incidentFocus.toggle(key);
    setRoadKey(null);
    revealMap(mapBox.current);
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 bg-grey-100 p-4 md:max-w-5xl xl:max-w-[96rem]">
      {/*
        반응형(TASK-012 반응형): 휴대폰은 세로 한 줄. 태블릿(md)은 도로 소통·사건 카드를 넓게, 그 아래 큰 지도와 사건 목록.
        PC·아이패드 가로(xl)는 왼쪽에 화면 높이의 지도를 고정하고 오른쪽에 정보 패널.
      */}
      <main className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_26rem] xl:grid-rows-[auto_auto_auto_auto_auto_1fr]">
        <div className={`flex items-center justify-between gap-2 ${PANEL}`}>
          <h1 className="text-[26px] font-bold tracking-tight text-grey-900">제주 실시간 교통 현황</h1>
          <a href="/route" className="shrink-0 text-sm font-semibold text-brand-700">
            경로 추천 →
          </a>
        </div>
        <div className={`flex items-center justify-between gap-2 ${PANEL}`}>
          <p className="text-sm text-grey-600">
            제주 ITS 도로 소통·돌발·통제·공사
            {state.snapshot && ` · ${formatKstTime(state.snapshot.observedAt)} 조회`}
            {state.snapshot?.incidents.some((i) => i.source === "mock") && " · 모의 데이터"}
          </p>
          <button
            type="button"
            onClick={refresh}
            disabled={state.loading}
            className="min-h-12 shrink-0 rounded-2xl bg-white px-4 font-semibold text-grey-700 disabled:opacity-50"
          >
            {state.loading ? "조회 중…" : "새로고침"}
          </button>
        </div>

        <div aria-live="polite" className={`flex flex-col gap-2 text-sm ${PANEL}`}>
          {state.problem && (
            <p role="alert" className="rounded-2xl bg-red-50 p-3 text-red-800">
              {state.problem}
              {state.snapshot && ` · 마지막 성공 ${formatKstTime(state.snapshot.observedAt)}`}
            </p>
          )}
          {stale && state.snapshot && (
            <p role="alert" className="rounded-2xl bg-amber-100 p-3 text-amber-900">
              오래된 정보입니다({Math.floor((now.getTime() - Date.parse(state.snapshot.observedAt)) / 60_000)}분 전 조회).
            </p>
          )}
        </div>

        <section aria-labelledby="speeds-heading" className={`flex flex-col gap-3 rounded-[20px] bg-white p-4 ${PANEL}`}>
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 id="speeds-heading" className="font-bold text-grey-900">
                도로 소통
              </h2>
              <p className="text-xs text-grey-600">
                화면이 켜져 있을 때 1분마다 자동 갱신{speeds && ` · 마지막 조회 ${formatKstTime(now.toISOString())}`}
                {speeds && speedsBusy && <span className="ml-1 font-semibold text-brand-700">· 갱신 중…</span>}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowSpeeds((v) => !v)}
              aria-pressed={showSpeeds}
              className={`min-h-12 shrink-0 whitespace-nowrap rounded-2xl border px-3 text-sm font-semibold ${showSpeeds ? "border-brand-600 bg-brand-50 text-brand-800" : "border-grey-300 bg-white text-grey-700"}`}
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
                  className={`flex min-h-16 w-full flex-col items-center justify-center rounded-2xl p-2 ${speedFilter === s ? "bg-brand-50 ring-2 ring-brand-600" : "bg-grey-100"}`}
                >
                  <span className="flex items-center gap-1 text-xs text-grey-600">
                    {s !== "all" && <span className={`inline-block h-1.5 w-3 rounded ${STATUS_STYLE[s].bar}`} aria-hidden="true" />}
                    {s === "all" ? "전체" : STATUS_STYLE[s].label}
                  </span>
                  {/* 다섯 자리(11,906)도 휴대폰 폭 카드에서 한 줄에 들어가도록 폭에 맞춰 글자를 줄이고 줄바꿈하지 않는다. */}
                  <span className="whitespace-nowrap text-[clamp(0.85rem,4vw,1.125rem)] font-bold tabular-nums text-grey-900">
                    {speedLines.length ? n.toLocaleString("ko-KR") : "–"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-grey-600">
            제주 ITS 구간 평균속도(원활 30km/h 이상 · 서행 15~30 · 정체 15 미만)
            {speeds?.observedAt && ` · ${formatKstTime(speeds.observedAt)} 기준`}
            {speeds?.source === "mock" && " · 모의 데이터"}. 속도 정보가 없는 도로는 표시하지 않습니다.
          </p>
          {showProgress && (
            <ol role="status" aria-label="도로 소통 처리 현황" className="flex flex-col gap-1 rounded bg-brand-50 p-2 text-sm text-brand-900">
              <li>
                {linksLoading ? (
                  <>
                    <span className="mr-1 inline-block h-3 w-3 animate-spin rounded-full border-2 border-brand-700 border-t-transparent align-middle" aria-hidden="true" />
                    ① 도로 모양 불러오는 중… {linksSeconds}초
                    <span className="block text-xs text-brand-800">처음 한 번은 최대 1분 걸릴 수 있어요.</span>
                  </>
                ) : (
                  <>① 도로 모양 {links ? "✓" : "실패"}</>
                )}
              </li>
              <li>
                {firstSpeeds ? (
                  <>
                    <span className="mr-1 inline-block h-3 w-3 animate-spin rounded-full border-2 border-brand-700 border-t-transparent align-middle" aria-hidden="true" />
                    ② 구간 속도 불러오는 중…
                  </>
                ) : (
                  <>② 구간 속도 {speeds ? "✓" : "실패"}</>
                )}
              </li>
            </ol>
          )}
          {linksProblem && (
            <div role="alert" className="flex items-center justify-between gap-2 rounded bg-amber-50 p-2 text-sm text-amber-900">
              <span>{linksProblem}</span>
              <button type="button" onClick={retryLinks} className="min-h-12 shrink-0 rounded-2xl bg-amber-700 px-3 font-semibold text-white">
                다시 시도
              </button>
            </div>
          )}
          {!linksProblem && speedsError && !speeds && !speedsBusy && (
            <div role="alert" className="flex items-center justify-between gap-2 rounded bg-amber-50 p-2 text-sm text-amber-900">
              <span>구간 속도를 불러오지 못했습니다. 네트워크 연결을 확인하세요.</span>
              <button type="button" onClick={refresh} className="min-h-12 shrink-0 rounded-2xl bg-amber-700 px-3 font-semibold text-white">
                다시 시도
              </button>
            </div>
          )}
          {!linksProblem && (speedProblem || speedStale) && (
            <p role="alert" className="rounded bg-amber-50 p-2 text-sm text-amber-900">
              {speedProblem ?? "오래된 구간 속도입니다(15분 넘게 갱신되지 않음)."}
            </p>
          )}
          {speedFilter !== "all" && speedLines.length > 0 && (
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold text-grey-700">
                {STATUS_STYLE[speedFilter].label} 도로 {roads.length.toLocaleString("ko-KR")}곳 · 구간이 많은 순
              </h3>
              {roads.length === 0 ? (
                <p className="text-sm text-grey-600">현재 {STATUS_STYLE[speedFilter].label} 구간이 없습니다.</p>
              ) : (
                <ul aria-label={`${STATUS_STYLE[speedFilter].label} 도로 목록`} className="flex flex-col gap-1">
                  {roads.slice(0, roadLimit).map((r) => (
                    <li key={r.key}>
                      <button
                        type="button"
                        onClick={() => focusRoad(r.key)}
                        aria-pressed={r.key === roadKey}
                        className={`flex min-h-12 w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm ${r.key === roadKey ? "bg-brand-50 ring-2 ring-brand-600" : "bg-grey-100"}`}
                      >
                        <span>
                          <span className="font-semibold text-grey-900">{r.label}</span>
                          <span className="text-grey-700">
                            {" "}
                            · {STATUS_STYLE[speedFilter].label} {r.count}구간 · 평균 {r.avgKmh}km/h
                          </span>
                        </span>
                        <span className="shrink-0 text-xs font-semibold text-brand-700">{r.key === roadKey ? "지도에 표시 중" : "지도에서 보기 ›"}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {roads.length > roadLimit && (
                <button
                  type="button"
                  onClick={() => setRoadLimit((n) => n + ROAD_PAGE)}
                  className="min-h-12 rounded-2xl bg-grey-100 font-semibold text-grey-700"
                >
                  더 보기 ({(roads.length - roadLimit).toLocaleString("ko-KR")}곳 남음)
                </button>
              )}
            </div>
          )}
        </section>

        <ul aria-label="종류별 건수" className={`grid grid-cols-4 gap-2 ${PANEL}`}>
          {(["all", ...KINDS] as const).map((k) => {
            const count = k === "all" ? all.length : all.filter((i) => i.kind === k).length;
            return (
              <li key={k}>
                <button
                  type="button"
                  onClick={() => chooseKind(k)}
                  aria-pressed={kind === k}
                  className={`flex min-h-16 w-full flex-col items-center justify-center rounded-2xl p-2 ${kind === k ? "bg-brand-50 ring-2 ring-brand-600" : "bg-white"}`}
                >
                  <span className="text-xs text-grey-600">{k === "all" ? "전체" : INCIDENT_LABEL[k]}</span>
                  <span className="text-xl font-bold text-grey-900">{state.snapshot ? count : "–"}</span>
                </button>
              </li>
            );
          })}
        </ul>


        <div ref={mapBox} className="flex flex-col gap-2 md:col-span-2 xl:sticky xl:top-4 xl:col-span-1 xl:col-start-1 xl:row-span-6 xl:row-start-1 xl:self-start">
          <IncidentMap
            incidents={shown}
            focus={incidentFocus.focus}
            viewKey={kind}
            speedLines={showSpeeds ? filteredLines : EMPTY_LINES}
            speedObservedAt={speeds?.observedAt ?? null}
            heightClass="h-80 md:h-[60vh] xl:h-[calc(100dvh-7rem)]"
            overlay={mapOverlay}
            highlightIds={showSpeeds ? highlightIds : EMPTY_IDS}
          />
          <IncidentFocusBar state={incidentFocus} />
          {road && speedFilter !== "all" && (
            <div role="status" className="flex flex-wrap items-center gap-2 rounded-2xl bg-brand-50 p-2 text-sm text-brand-900">
              <span className="mr-auto font-semibold">
                {road.label} {STATUS_STYLE[speedFilter].label} {road.count}구간 표시 중
              </span>
              <button type="button" onClick={() => setRoadKey(null)} className="min-h-12 rounded-2xl border border-brand-300 bg-white px-3 font-semibold text-brand-900">
                전체 보기
              </button>
            </div>
          )}
        </div>

        {state.snapshot && groups.length > 0 && (
          <section aria-labelledby="groups-heading" className={`flex flex-col gap-2 self-start rounded-[20px] bg-white pt-4 ${PANEL}`}>
            <h2 id="groups-heading" className="px-4 font-bold text-grey-900">
              감지된 사건 {shown.length}건
            </h2>
            <IncidentGroupList groups={groups} focusedKey={incidentFocus.focusedKey} onFocus={focusGroup} />
          </section>
        )}
        {state.snapshot && shown.length === 0 && (
          <p className={`self-start rounded-2xl bg-grey-100 p-3 text-sm text-grey-700 ${PANEL}`}>
            {kind === "all" ? "현재 제주 ITS에 감지된 돌발·통제·공사가 없습니다." : `현재 제주 ITS에 감지된 ${INCIDENT_LABEL[kind]} 정보가 없습니다.`} 모든 도로의 사건이
            제공되지는 않으므로, 도로에 이상이 없다는 뜻은 아닙니다.
          </p>
        )}
      </main>
      <footer className="mt-auto flex flex-col gap-1 border-t border-grey-200 pt-3 text-xs text-grey-500">
        <p className="text-sm font-semibold text-amber-800">운전 중에는 화면을 조작하지 마세요.</p>
        <p>제주 ITS가 감지한 지점 정보이며, 발생 시각·상세와 모든 도로의 상황을 포함하지 않습니다. 이 화면은 위치정보를 사용하지 않습니다.</p>
        <p>지도 © OpenStreetMap 기여자 · 교통 제주 ITS · 도로 모양 브이월드(국토교통부 교통링크)</p>
      </footer>
    </div>
  );
}
