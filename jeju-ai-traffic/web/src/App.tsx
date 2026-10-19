import { useState } from "react";
import { TripForm } from "./features/trip/TripForm";

// 경로 비교는 TASK-005에서 연결한다. 지금은 출발지·목적지 선택까지만 제공한다.
export function App() {
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-5 bg-slate-50 p-4">
      <h1 className="text-2xl font-bold text-slate-900">제주 AI 교통 경로 추천</h1>
      <TripForm
        onRequestRoute={(_origin, destination) =>
          setNotice(`${destination.name}까지의 경로 비교는 다음 단계에서 제공됩니다.`)
        }
      />
      {notice && (
        <p role="status" className="rounded-lg bg-slate-200 p-3 text-sm text-slate-800">
          {notice}
        </p>
      )}
    </main>
  );
}
