import type { TrafficLinksResponse, TrafficSpeedsResponse } from "../../../../shared/contracts/traffic";
import { decodePolyline } from "../../../../shared/rules/polyline";
import { speedStatus } from "../../../../shared/rules/traffic";
import type { SpeedLine } from "../map/leafletMap";

/** 구간 모양과 속도를 합친다. 속도가 없는 구간은 그리지 않는다(정보 없음을 '원활'로 칠하지 않음). */
export function joinSpeedLines(links: TrafficLinksResponse["links"], speeds: TrafficSpeedsResponse["speeds"]): SpeedLine[] {
  const out: SpeedLine[] = [];
  for (const [id, name, encoded] of links) {
    const s = speeds[id];
    if (!s) continue;
    out.push({ id, name, points: decodePolyline(encoded), kmh: s[0], travelSeconds: s[1], status: speedStatus(s[0]) });
  }
  return out;
}
