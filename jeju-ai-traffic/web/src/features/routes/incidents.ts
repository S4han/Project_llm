import type { TrafficIncident } from "../../../../shared/contracts/traffic";
import { INCIDENT_LABEL } from "./trafficStyle";

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
    };
  });
}
