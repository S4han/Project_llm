import { useMemo, useRef, useState } from "react";
import type { Place } from "../../shared/contracts/place";
import type { RouteCompareRequest } from "../../shared/contracts/route";
import { RouteResults, type CompareState } from "./features/routes/RouteResults";
import { TripForm } from "./features/trip/TripForm";
import { readRouteTarget } from "./features/trip/routeLink";
import { originLocation } from "./features/trip/types";
import { compareRoutes } from "./services/routesApi";

export function App() {
  const [state, setState] = useState<CompareState>({ kind: "idle" });
  const lastRequest = useRef<{ request: RouteCompareRequest; destination: Place } | null>(null);
  // 늦게 도착한 이전 응답이 새 상태를 덮어쓰지 않도록 요청 번호를 센다.
  const seq = useRef(0);
  // 교통 현황의 주차장에서 넘어오면(/route?to=…) 목적지를 정하고 현재 위치로 바로 조회한다(TASK-017).
  const target = useMemo(() => readRouteTarget(window.location.search), []);

  async function run(request: RouteCompareRequest, destination: Place) {
    const id = ++seq.current;
    lastRequest.current = { request, destination };
    setState({ kind: "loading" });
    const result = await compareRoutes(request);
    if (id !== seq.current) return;
    setState(result.ok ? { kind: "done", data: result.data, destination } : { kind: "error", error: result.error });
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col gap-5 bg-grey-100 p-4 pb-28 md:max-w-5xl md:pb-4 xl:max-w-[96rem]">
      {/* 반응형(TASK-012 반응형): 넓은 화면(md)은 왼쪽에 제목·출발지·목적지, 오른쪽에 경로 결과. */}
      <main className="grid grid-cols-1 gap-5 md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] md:grid-rows-[auto_1fr] md:items-start xl:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
        <div className="flex items-center justify-between gap-2 md:col-start-1">
          <h1 className="text-[26px] font-bold tracking-tight text-grey-900">제주 AI 교통 경로 추천</h1>
          <a href="/" className="shrink-0 text-sm font-semibold text-brand-700">
            ← 교통 현황
          </a>
        </div>
        <div className="md:col-start-1">
          <TripForm
            busy={state.kind === "loading"}
            initialDestination={target}
            autoStart={target !== null}
            onRequestRoute={(origin, destination) =>
              run({ origin: originLocation(origin), destination: destination.location }, destination)
            }
            onSelectionChange={() => {
              seq.current += 1;
              setState({ kind: "idle" });
            }}
          />
        </div>
        <div className="md:col-start-2 md:row-span-2 md:row-start-1">
          <RouteResults
            state={state}
            onRetry={() => lastRequest.current && run(lastRequest.current.request, lastRequest.current.destination)}
          />
        </div>
      </main>
      <footer className="mt-auto flex flex-col gap-1 border-t border-grey-200 pt-3 text-xs text-grey-500">
        <p>위치는 경로 조회에만 쓰고 저장하지 않습니다. 예상시간은 참고용입니다.</p>
        <p>지도 © 브이월드(국토교통부)·OpenStreetMap 기여자 · 경로 카카오모빌리티 · 교통 제주 ITS · 설명 Cloudflare Workers AI</p>
      </footer>
    </div>
  );
}
