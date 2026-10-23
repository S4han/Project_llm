import type { SpeedStatus, TrafficSpeedsResponse } from "../../../../shared/contracts/traffic";
import { speedStatus } from "../../../../shared/rules/traffic";

/** 오늘 날짜(제주 = 한국 시간), 예: "10월 23일(금)". */
export function todayLabel(now: Date): string {
  const parts = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "short" }).formatToParts(now);
  const v = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${v("month")} ${v("day")}일(${v("weekday")})`;
}

/** 구간 평균속도 → 원활·서행·정체 비율(%, 합 100). 구간이 없으면 null. */
export function speedShares(speeds: TrafficSpeedsResponse["speeds"]): Record<SpeedStatus, number> | null {
  const counts: Record<SpeedStatus, number> = { smooth: 0, slow: 0, congested: 0 };
  for (const [kmh] of Object.values(speeds)) counts[speedStatus(kmh)] += 1;
  const total = counts.smooth + counts.slow + counts.congested;
  if (!total) return null;
  const slow = Math.round((counts.slow / total) * 100);
  const congested = Math.round((counts.congested / total) * 100);
  return { smooth: 100 - slow - congested, slow, congested };
}
