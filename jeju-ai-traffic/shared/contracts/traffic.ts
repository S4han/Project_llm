import type { Coordinate } from "./route.js";
import type { IsoDateTime } from "./common.js";

/** 구간 혼잡 상태. 공급자가 값을 주지 않으면 unknown이며, unknown은 정상 소통이 아니다. */
export type TrafficStatus = "smooth" | "slow" | "congested" | "unknown";

/** 제주 ITS 확인 사건 종류: 돌발, 통제, 공사, 교통기상. */
export type IncidentKind = "event" | "closure" | "roadwork" | "weather";

export interface TrafficIncident {
  id: string;
  kind: IncidentKind;
  description: string;
  location: Coordinate;
  observedAt: IsoDateTime;
  source: "jejuIts";
}
