import { useCallback, useMemo, useState } from "react";
import type { TrafficIncident } from "../../../../shared/contracts/traffic";
import type { IncidentFocus } from "../map/leafletMap";
import { INCIDENT_LABEL } from "./trafficStyle";

export type IncidentGroup = ReturnType<typeof groupIncidents>[number];

/** 같은 종류·내용의 사건을 한 줄로 묶는다(예: "정지차량 감지 3건", TASK-011). */
export function groupIncidents(incidents: TrafficIncident[]) {
  const groups = new Map<string, { first: TrafficIncident; items: TrafficIncident[] }>();
  for (const i of incidents) {
    const key = `${i.kind}|${i.description}`;
    const g = groups.get(key);
    if (g) g.items.push(i);
    else groups.set(key, { first: i, items: [i] });
  }
  return [...groups.entries()].map(([key, { first, items }]) => {
    const label = first.kind === "event" ? `${first.description} 감지` : `${INCIDENT_LABEL[first.kind]} ${first.description}`;
    const times = items.map((i) => i.sourceTime).filter((t): t is string => t !== null).sort();
    return {
      key,
      label,
      count: items.length,
      latestSourceTime: times.at(-1) ?? null,
      observedAt: first.observedAt,
      mock: items.some((i) => i.source === "mock"),
      /** 지도에서 한 곳씩 보여 줄 사건(입력 순서). */
      items,
    };
  });
}

/**
 * 지도에서 보고 있는 사건 묶음과 그 안의 몇 번째 지점인지(TASK-011 계획 (b)).
 * 묶음이 목록에서 사라지면(경로 변경·새로 조회) 자동으로 닫힌 것으로 본다.
 */
export function useIncidentFocus(groups: IncidentGroup[]) {
  const [focused, setFocused] = useState<{ key: string; index: number } | null>(null);
  const group = focused ? groups.find((g) => g.key === focused.key) : undefined;
  const index = group && focused ? focused.index % group.items.length : 0;
  const current = group?.items[index];

  // 지도는 focus가 바뀔 때만 다시 그리므로 값이 같으면 같은 객체를 쓴다(시계 갱신 등으로 화면이 다시 맞춰지지 않게).
  const label = group?.label;
  const ids = group?.items.map((i) => i.id).join(",");
  const currentId = current?.id;
  const focus = useMemo<IncidentFocus | null>(
    () => (label && ids && currentId ? { label, ids: ids.split(","), currentId } : null),
    [label, ids, currentId],
  );

  const toggle = useCallback((key: string) => setFocused((f) => (f?.key === key ? null : { key, index: 0 })), []);
  const next = useCallback(() => setFocused((f) => f && { key: f.key, index: f.index + 1 }), []);
  const clear = useCallback(() => setFocused(null), []);
  return { focus, group, index, focusedKey: group ? group.key : null, toggle, next, clear };
}

export type IncidentFocusState = ReturnType<typeof useIncidentFocus>;
