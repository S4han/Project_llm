const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 한국 시간 기준 날짜 키(YYYY-MM-DD). 사용량은 이 날짜 단위로 초기화된다. */
export function kstDayKey(now: Date): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 다음 한국 시간 0시(UTC Date). */
export function nextKstMidnight(now: Date): Date {
  const kstMs = now.getTime() + KST_OFFSET_MS;
  return new Date(Math.floor(kstMs / DAY_MS) * DAY_MS + DAY_MS - KST_OFFSET_MS);
}
