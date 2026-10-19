import type { IncidentKind, TrafficStatus } from "../../../../shared/contracts/traffic";

/** 혼잡 상태 표시. 정보 미확보는 회색 점선으로, 원활(초록)과 구분한다(AC-005-03, AC-011-07). */
export const STATUS_STYLE: Record<TrafficStatus, { label: string; color: string; dash?: string; bar: string }> = {
  smooth: { label: "원활", color: "#16a34a", bar: "bg-green-600" },
  slow: { label: "서행", color: "#d97706", bar: "bg-amber-500" },
  congested: { label: "정체", color: "#dc2626", bar: "bg-red-600" },
  unknown: { label: "정보 미확보", color: "#94a3b8", dash: "6 6", bar: "bg-slate-300" },
};

export const STATUS_ORDER: TrafficStatus[] = ["smooth", "slow", "congested", "unknown"];

export const INCIDENT_LABEL: Record<IncidentKind, string> = {
  event: "돌발",
  closure: "통제",
  roadwork: "공사",
  weather: "기상",
};
