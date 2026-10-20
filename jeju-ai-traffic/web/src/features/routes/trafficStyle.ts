import type { IncidentKind, TrafficStatus } from "../../../../shared/contracts/traffic";

/** 혼잡 상태 표시. 정보 미확보는 회색 점선으로, 원활(초록)과 구분한다(AC-005-03, AC-011-07). */
export const STATUS_STYLE: Record<TrafficStatus, { label: string; color: string; dash?: string; bar: string }> = {
  smooth: { label: "원활", color: "#03b26c", bar: "bg-smooth" },
  slow: { label: "서행", color: "#fe9800", bar: "bg-slow" },
  congested: { label: "정체", color: "#f04452", bar: "bg-congested" },
  unknown: { label: "정보 미확보", color: "#b0b8c1", dash: "6 6", bar: "bg-grey-300" },
};

export const STATUS_ORDER: TrafficStatus[] = ["smooth", "slow", "congested", "unknown"];

export const INCIDENT_LABEL: Record<IncidentKind, string> = {
  event: "돌발",
  closure: "통제",
  roadwork: "공사",
  weather: "기상",
};
