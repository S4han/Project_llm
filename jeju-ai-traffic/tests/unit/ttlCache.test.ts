import { describe, expect, it } from "vitest";
import { TtlCache } from "../../api/_lib/policies/ttlCache";

describe("TtlCache", () => {
  it("동시 요청은 로드 1회를 공유한다", async () => {
    const cache = new TtlCache<number>(60_000);
    let loads = 0;
    const load = async () => {
      loads += 1;
      return 42;
    };
    const values = await Promise.all(Array.from({ length: 5 }, () => cache.getOrLoad("its", load)));
    expect(values).toEqual([42, 42, 42, 42, 42]);
    expect(loads).toBe(1);
  });

  it("TTL 안에서는 다시 로드하지 않고, 지나면 다시 로드한다", async () => {
    let now = 0;
    const cache = new TtlCache<number>(60_000, () => now);
    let loads = 0;
    const load = async () => ++loads;
    await cache.getOrLoad("its", load);
    now = 59_999;
    expect(await cache.getOrLoad("its", load)).toBe(1);
    now = 60_000;
    expect(await cache.getOrLoad("its", load)).toBe(2);
  });

  it("실패한 로드는 저장하지 않는다", async () => {
    const cache = new TtlCache<number>(60_000);
    await expect(cache.getOrLoad("its", async () => Promise.reject(new Error("x")))).rejects.toThrow("x");
    expect(await cache.getOrLoad("its", async () => 7)).toBe(7);
  });
});
