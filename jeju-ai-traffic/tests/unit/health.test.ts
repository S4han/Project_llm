import { describe, expect, it } from "vitest";
import { buildHealth } from "../../api/_lib/health";
import { GET } from "../../api/health";

describe("buildHealth", () => {
  const now = new Date("2026-10-19T00:00:00.000Z");

  it("리전과 시각을 담아 ok를 반환한다", () => {
    expect(buildHealth("icn1", now)).toEqual({
      status: "ok",
      service: "jeju-ai-traffic",
      region: "icn1",
      checkedAt: "2026-10-19T00:00:00.000Z",
    });
  });

  it("리전이 없으면 local로 표시한다", () => {
    expect(buildHealth(undefined, now).region).toBe("local");
    expect(buildHealth("", now).region).toBe("local");
  });
});

describe("GET /api/health", () => {
  it("200, JSON, no-store로 응답한다", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.service).toBe("jeju-ai-traffic");
  });
});
