/**
 * 사용자(IP)별 고정 창 빈도 제한. 키는 메모리에만 두고 로그에 남기지 않는다.
 * 인스턴스마다 따로 센다(quota와 같은 한계).
 */
export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly clock: () => number;

  constructor(limit: number, windowMs: number, clock: () => number = Date.now) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.clock = clock;
  }

  /** 허용되면 null, 막히면 다시 허용되는 시각(ms). */
  tryAcquire(key: string): number | null {
    const now = this.clock();
    if (this.windows.size > 5000) this.prune(now);
    const current = this.windows.get(key);
    if (!current || now - current.start >= this.windowMs) {
      this.windows.set(key, { start: now, count: 1 });
      return null;
    }
    if (current.count >= this.limit) return current.start + this.windowMs;
    current.count += 1;
    return null;
  }

  private prune(now: number): void {
    for (const [key, w] of this.windows) {
      if (now - w.start >= this.windowMs) this.windows.delete(key);
    }
  }
}

/** 장소 검색 빈도 제한: 분당 20회 (DECISIONS 2026-10-19 TASK-004 "2. 승인"). */
export const PLACE_SEARCH_PER_MINUTE = 20;
