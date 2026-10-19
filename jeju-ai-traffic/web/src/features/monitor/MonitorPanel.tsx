import { useEffect, useReducer, useState } from "react";
import type { Coordinate } from "../../../../shared/contracts/route";
import { adviceReducer, initialAdvice } from "../../../../shared/rules/changeAdvice";
import { buildRulesExplanation, toExplanationFacts } from "../../../../shared/rules/explanation";
import { getCurrentLocation } from "../../services/geolocation";
import { compareRoutes } from "../../services/routesApi";
import { formatDiff, formatDuration } from "../routes/format";
import { formatKstTime } from "../trip/format";
import { INTERVAL_MS, Monitor, type MonitorDeps, type MonitorState, type StopReason } from "./monitor";

const STOP_TEXT: Record<StopReason["kind"], string> = {
  user: "모니터링을 중지했습니다.",
  arrived: "목적지 부근에 도착해 재평가를 마쳤습니다.",
  quota: "",
  failures: "",
  timeLimit: "60분이 지나 재평가를 마쳤습니다. 계속하려면 다시 시작하세요.",
  noLocation: "",
};

function stopMessage(reason: StopReason): string {
  if (reason.kind === "quota") {
    return `${reason.message}${reason.retryAfter ? ` (${formatKstTime(reason.retryAfter)} 이후 다시 사용 가능)` : ""}`;
  }
  if (reason.kind === "failures") return `재평가가 연속 3회 실패해 중지했습니다. (${reason.message})`;
  if (reason.kind === "noLocation") return reason.message;
  return STOP_TEXT[reason.kind];
}

const at = (ms: number | null) => (ms === null ? "" : formatKstTime(new Date(ms).toISOString()));

interface Props {
  destination: Coordinate;
  selectedId: string;
  /** '변경'을 누르면 새로 따라갈 경로의 호출 방식(지도 강조용). */
  onFollowChange?: (id: string) => void;
  /** 테스트용 주입. */
  deps?: Partial<Omit<MonitorDeps, "destination" | "onUpdate">>;
}

/** 5분 재평가(FR-009). 화면이 켜져 있고 이 페이지가 열려 있을 때만 동작한다. */
export function MonitorPanel({ destination, selectedId, onFollowChange, deps }: Props) {
  const [state, setState] = useState<MonitorState | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [advice, dispatch] = useReducer(adviceReducer, selectedId, initialAdvice);
  const [monitor] = useState(() => {
    let prev: MonitorState | null = null;
    return new Monitor({
      destination,
      locate: getCurrentLocation,
      compare: (origin) => compareRoutes({ origin, destination, purpose: "reevaluation" }),
      ...deps,
      onUpdate: (s) => {
        // 새 재평가 결과마다 변경 안내를 판단하고, 멈추면 떠 있던 안내를 닫는다(FR-010).
        if (s.lastData && s.lastData !== prev?.lastData && s.status === "running") dispatch({ type: "data", data: s.lastData });
        if (s.status === "stopped" && prev?.status === "running") dispatch({ type: "stop" });
        prev = s;
        setState(s);
        setNow(Date.now());
      },
    });
  });
  useEffect(() => () => monitor.dispose(), [monitor]);
  useEffect(() => {
    if (state?.status !== "running") return;
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, [state?.status]);

  const running = state?.status === "running";
  const data = state?.lastData ?? null;
  const same = data?.routes.find((r) => r.id === advice.followed) ?? null;
  const fastest = data?.routes.find((r) => r.id === data.recommendedRouteId) ?? null;
  const facts = data ? toExplanationFacts(data) : null;
  const minutesLeft = state?.nextAt ? Math.max(1, Math.ceil((state.nextAt - now) / 60_000)) : null;

  return (
    <section aria-labelledby="monitor-heading" className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 id="monitor-heading" className="font-bold text-slate-900">
          교통상황 재평가
        </h3>
        {running ? (
          <button type="button" onClick={() => monitor.stop()} className="min-h-12 rounded-lg border border-slate-300 px-4 font-semibold text-slate-800">
            중지
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              dispatch({ type: "reset", followed: selectedId });
              monitor.start();
            }}
            className="min-h-12 rounded-lg bg-indigo-700 px-4 font-semibold text-white"
          >
            {state?.status === "stopped" ? "다시 시작" : "모니터링 시작"}
          </button>
        )}
      </div>
      <p className="text-xs text-slate-600">
        {INTERVAL_MS / 60_000}분마다 현재 위치에서 다시 조회합니다. 화면이 켜져 있고 이 페이지가 열려 있을 때만 동작하며, 다른 앱으로 전환하거나 화면이 꺼지면 멈춥니다. 최대 60분.
      </p>
      <p className="text-sm font-semibold text-amber-800">운전 중에는 화면을 조작하지 마세요.</p>

      <div aria-live="polite" className="flex flex-col gap-1 text-sm">
        {running && state.inFlight && <p className="text-slate-600">재평가 중…</p>}
        {running && !state.inFlight && state.paused && <p className="text-amber-800">화면이 비활성이라 재평가를 멈췄습니다. 화면으로 돌아오면 이어서 진행합니다.</p>}
        {running && !state.inFlight && !state.paused && minutesLeft !== null && (
          <p className="text-slate-700">모니터링 중 · 다음 갱신 약 {minutesLeft}분 후</p>
        )}
        {running && state.wasPaused && !state.paused && <p className="text-xs text-slate-500">화면이 비활성이었던 동안에는 재평가하지 않았습니다.</p>}
        {state?.lastError && running && (
          <p role="alert" className="rounded bg-red-50 p-2 text-red-800">
            갱신 실패: {state.lastError}
            {state.lastSuccessAt !== null && ` · 마지막 성공 ${at(state.lastSuccessAt)}`}
          </p>
        )}
        {state?.status === "stopped" && state.stopReason && (
          <p role="status" className="rounded bg-slate-100 p-2 text-slate-800">
            {stopMessage(state.stopReason)}
            {state.lastSuccessAt !== null && ` · 마지막 성공 ${at(state.lastSuccessAt)}`}
          </p>
        )}
      </div>

      {advice.pending && (
        <div role="alert" aria-labelledby="advice-heading" className="flex flex-col gap-2 rounded-lg border-2 border-orange-500 bg-orange-50 p-3">
          <p id="advice-heading" className="font-bold text-orange-900">
            더 빠른 경로가 있습니다
          </p>
          <p className="text-sm text-orange-900">
            <strong>{advice.pending.toLabel}</strong> 경로가 지금 경로보다 남은 시간 기준 약 <strong>{Math.round(advice.pending.savingsSeconds / 60)}분</strong> 빠릅니다.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                const to = advice.pending?.to;
                dispatch({ type: "accept" });
                if (to) onFollowChange?.(to);
              }}
              className="min-h-12 flex-1 rounded-lg bg-orange-600 font-semibold text-white"
            >
              변경
            </button>
            <button type="button" onClick={() => dispatch({ type: "decline" })} className="min-h-12 flex-1 rounded-lg border border-orange-400 bg-white font-semibold text-orange-900">
              유지
            </button>
          </div>
        </div>
      )}
      {advice.notice && (
        <p role="status" className="text-sm text-slate-700">
          {advice.notice.kind === "accepted" &&
            `${advice.notice.label} 경로로 바꿨습니다. 외부 내비로 안내 중이라면 내비에서 경로를 다시 확인하세요.`}
          {advice.notice.kind === "declined" && "지금 경로를 유지합니다. 같은 경로 안내는 5분 이상 더 빨라질 때만 다시 알립니다."}
          {advice.notice.kind === "withdrawn" && "더 이상 5분 이상 빠르지 않아 안내를 닫았습니다."}
        </p>
      )}

      {data && (
        <div className="flex flex-col gap-1 border-t border-slate-100 pt-2 text-sm">
          <p className="text-xs text-slate-500">
            {formatKstTime(data.observedAt)} 현재 위치 기준{state?.status === "stopped" ? " (마지막 성공 결과)" : ""}
          </p>
          {same ? (
            <p>
              선택 경로(같은 방식으로 다시 조회) <strong>{same.label}</strong>: 남은 예상 <strong>{formatDuration(same.durationSeconds)}</strong>
            </p>
          ) : (
            <p className="text-slate-600">선택한 방식의 경로가 이번 조회에 없어 비교할 수 없습니다.</p>
          )}
          {fastest && same && fastest.id !== same.id && (
            <p>
              가장 빠른 경로 <strong>{fastest.label}</strong>: {formatDuration(fastest.durationSeconds)} (선택 경로 대비{" "}
              {formatDiff(fastest.durationSeconds - same.durationSeconds).replace("추천 경로보다 ", "").replace("추천 경로와 ", "")})
            </p>
          )}
          {fastest && same && fastest.id === same.id && <p>현재 선택 경로가 가장 빠릅니다.</p>}
          {facts && <p className="text-xs text-slate-600">{buildRulesExplanation(facts, new Date()).text}</p>}
        </div>
      )}
    </section>
  );
}
