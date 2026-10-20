import { formatKstTime } from "../trip/format";
import type { IncidentFocusState, IncidentGroup } from "./incidents";

export interface IncidentListProps {
  groups: IncidentGroup[];
  focusedKey: string | null;
  onFocus: (key: string) => void;
}

/** 사건 묶음 목록. 누르면 지도에서 그 지점을 보여 준다(TASK-011 계획 (b)). */
export function IncidentGroupList({ groups, focusedKey, onFocus }: IncidentListProps) {
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

/** 지도 아래 안내: "정지차량 감지 1/3번째 지점 표시 중 · 다음 지점 › · 전체 보기". 묶음을 보고 있지 않으면 없음. */
export function IncidentFocusBar({ state }: { state: IncidentFocusState }) {
  const { group, index, next, clear } = state;
  if (!group) return null;
  const many = group.items.length > 1;
  return (
    <div role="status" className="flex flex-wrap items-center gap-2 rounded-lg bg-red-50 p-2 text-sm text-red-900">
      <span className="mr-auto font-semibold">
        {group.label} {many ? `${index + 1}/${group.items.length}번째 지점` : "지점"} 표시 중
      </span>
      {many && (
        <button type="button" onClick={next} className="min-h-12 rounded-lg bg-red-700 px-3 font-semibold text-white">
          다음 지점 ›
        </button>
      )}
      <button type="button" onClick={clear} className="min-h-12 rounded-lg border border-red-300 bg-white px-3 font-semibold text-red-900">
        전체 보기
      </button>
    </div>
  );
}
