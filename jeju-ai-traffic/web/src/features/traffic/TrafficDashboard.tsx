import { useCallback, useEffect, useRef, useState } from "react";
import type { IncidentKind, TrafficIncident } from "../../../../shared/contracts/traffic";
import { isStale } from "../../../../shared/rules/traffic";
import { fetchTrafficIncidents } from "../../services/trafficApi";
import { IncidentFocusBar, IncidentGroupList } from "../routes/IncidentFocus";
import { groupIncidents, useIncidentFocus } from "../routes/incidents";
import { INCIDENT_LABEL } from "../routes/trafficStyle";
import { formatKstTime } from "../trip/format";
import { IncidentMap } from "./IncidentMap";

/** 자동 갱신 간격. 서버는 제주 ITS 결과를 60초 캐시하므로 더 자주 불러도 새 정보가 없다(TASK-012 3. (a)). */
export const REFRESH_MS = 60_000;

/** 대시보드에 보이는 종류(TASK-012 1. (a): 교통기상 제외). */
const KINDS: Exclude<IncidentKind, "weather">[] = ["event", "closure", "roadwork"];

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

/** 제주 ITS 실시간 교통 현황(TASK-012). 화면이 켜져 있을 때만 1분마다 다시 조회한다. */
export function TrafficDashboard() {
  const [state, setState] = useState<DashboardState>({ snapshot: null, problem: null, loading: true });
  const [kind, setKind] = useState<IncidentKind | "all">("all");
  const [now, setNow] = useState(() => new Date());
  const lastLoad = useRef(0);
  const seq = useRef(0);
  const mapBox = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const id = ++seq.current;
    lastLoad.current = Date.now();
    const result = await fetchTrafficIncidents();
    if (id !== seq.current) return;
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

  useEffect(() => {
    void load();
    const tick = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, REFRESH_MS);
    // 화면으로 돌아왔을 때 1분이 지났으면 바로 다시 조회한다.
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastLoad.current >= REFRESH_MS) refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
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

  const chooseKind = (k: IncidentKind | "all") => {
    setKind(k);
    clearFocus();
  };
  const focusGroup = (key: string) => {
    incidentFocus.toggle(key);
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

        <div ref={mapBox} className="flex flex-col gap-2">
          <IncidentMap incidents={shown} focus={incidentFocus.focus} viewKey={kind} />
          <IncidentFocusBar state={incidentFocus} />
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
        <p>지도 © OpenStreetMap 기여자 · 교통 제주 ITS</p>
      </footer>
    </div>
  );
}
