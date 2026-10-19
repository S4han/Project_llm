import { describe, expect, it } from "vitest";
import { kstDayKey, nextKstMidnight } from "../../api/_lib/policies/kstDay";

describe("KST 날짜 경계", () => {
  it("UTC 14:59는 KST 23:59로 같은 날, 15:00은 다음 날이다", () => {
    expect(kstDayKey(new Date("2026-10-19T14:59:59.999Z"))).toBe("2026-10-19");
    expect(kstDayKey(new Date("2026-10-19T15:00:00.000Z"))).toBe("2026-10-20");
  });

  it("다음 KST 0시를 UTC로 돌려준다", () => {
    expect(nextKstMidnight(new Date("2026-10-19T03:00:00.000Z")).toISOString()).toBe("2026-10-19T15:00:00.000Z");
    expect(nextKstMidnight(new Date("2026-10-19T15:00:00.000Z")).toISOString()).toBe("2026-10-20T15:00:00.000Z");
  });
});
