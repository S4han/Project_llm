import { useRef, useState } from "react";
import type { RouteCompareRequest } from "../../shared/contracts/route";
import { RouteResults, type CompareState } from "./features/routes/RouteResults";
import { TripForm } from "./features/trip/TripForm";
import { originLocation } from "./features/trip/types";
import { compareRoutes } from "./services/routesApi";

export function App() {
  const [state, setState] = useState<CompareState>({ kind: "idle" });
  const lastRequest = useRef<RouteCompareRequest | null>(null);
  // 늦게 도착한 이전 응답이 새 상태를 덮어쓰지 않도록 요청 번호를 센다.
  const seq = useRef(0);

  async function run(request: RouteCompareRequest) {
    const id = ++seq.current;
    lastRequest.current = request;
    setState({ kind: "loading" });
    const result = await compareRoutes(request);
    if (id !== seq.current) return;
    setState(result.ok ? { kind: "done", data: result.data } : { kind: "error", error: result.error });
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-5 bg-slate-50 p-4">
      <h1 className="text-2xl font-bold text-slate-900">제주 AI 교통 경로 추천</h1>
      <TripForm
        busy={state.kind === "loading"}
        onRequestRoute={(origin, destination) =>
          run({ origin: originLocation(origin), destination: destination.location })
        }
        onSelectionChange={() => {
          seq.current += 1;
          setState({ kind: "idle" });
        }}
      />
      <RouteResults state={state} onRetry={() => lastRequest.current && run(lastRequest.current)} />
    </main>
  );
}
