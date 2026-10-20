import { useEffect, useMemo, useState } from "react";
import type { Explanation } from "../../../../shared/contracts/explanation";
import type { RouteCompareResponse } from "../../../../shared/contracts/route";
import { buildRulesExplanation, toExplanationFacts } from "../../../../shared/rules/explanation";
import { requestExplanation } from "../../services/explanationsApi";

/**
 * 추천 이유(FR-006). 규칙 기반 설명을 바로 보여 주고, 서버가 검증을 통과한 AI 설명을 주면 바꾼다.
 * 출처를 항상 표시한다(AC-006-07). 같은 결과에 대해 한 번만 요청한다.
 */
export function ExplanationCard({ data }: { data: RouteCompareResponse }) {
  const facts = useMemo(() => toExplanationFacts(data), [data]);
  const rules = useMemo(() => (facts ? buildRulesExplanation(facts, new Date()) : null), [facts]);
  const [ai, setAi] = useState<Explanation | null>(null);
  const [pending, setPending] = useState(true);

  useEffect(() => {
    if (!facts) return;
    const controller = new AbortController();
    requestExplanation(facts, controller.signal).then((res) => {
      if (controller.signal.aborted) return;
      if (res?.explanation.source === "ai") setAi(res.explanation);
      setPending(false);
    });
    return () => controller.abort();
  }, [facts]);

  const shown = ai ?? rules;
  if (!shown) return null;
  const isAi = shown.source === "ai";
  return (
    <section aria-labelledby="why-heading" className="flex flex-col gap-2 rounded-[20px] bg-white p-4">
      <div className="flex items-center gap-2">
        <h3 id="why-heading" className="font-bold text-grey-900">
          추천 이유
        </h3>
        <span className={`rounded px-2 py-0.5 text-xs font-bold ${isAi ? "bg-violet-100 text-violet-900" : "bg-grey-200 text-grey-800"}`}>
          {isAi ? "AI 생성" : "규칙 기반"}
        </span>
        {pending && !isAi && facts && <span className="text-xs text-grey-500">AI 설명 확인 중…</span>}
      </div>
      <p className="text-grey-800">{shown.text}</p>
      {isAi && <p className="text-xs text-grey-500">AI 문장은 경로 데이터와 숫자·표현을 대조해 통과한 경우에만 표시합니다.</p>}
      <details className="text-xs text-grey-600">
        <summary className="cursor-pointer select-none py-1">근거 보기</summary>
        <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-4">
          {shown.evidence.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}
