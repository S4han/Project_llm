/**
 * 짧은 메모리 캐시. 같은 키의 동시 요청은 진행 중인 로드 하나를 공유한다.
 * 실패한 로드는 저장하지 않는다. 제주 ITS 결과 60초 캐시에 쓴다.
 */
export class TtlCache<T> {
  private readonly entries = new Map<string, { value: T; expiresAt: number }>();
  private readonly inflight = new Map<string, Promise<T>>();
  private readonly ttlMs: number;
  private readonly clock: () => number;

  constructor(ttlMs: number, clock: () => number = Date.now) {
    this.ttlMs = ttlMs;
    this.clock = clock;
  }

  async getOrLoad(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(key);
    if (hit && hit.expiresAt > this.clock()) return hit.value;

    const pending = this.inflight.get(key);
    if (pending) return pending;

    const promise = load()
      .then((value) => {
        this.entries.set(key, { value, expiresAt: this.clock() + this.ttlMs });
        return value;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }
}

export const JEJU_ITS_CACHE_TTL_MS = 60_000;
