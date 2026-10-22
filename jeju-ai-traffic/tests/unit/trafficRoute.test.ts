import { describe, expect, it } from "vitest";
import { GET, trafficKind } from "../../api/traffic/[kind]";

describe("교통 정보 함수 통합 (TASK-026 범위 변경)", () => {
  it("주소의 마지막 경로를 종류로 읽는다", () => {
    expect(trafficKind("https://x.vercel.app/api/traffic/gas")).toBe("gas");
    expect(trafficKind("https://x.vercel.app/api/traffic/links?v=2")).toBe("links");
    expect(trafficKind("https://x.vercel.app/api/traffic/ev/")).toBe("ev");
  });

  it("모르는 종류는 400 INVALID_INPUT, 아는 종류는 그 처리기(모의 공급자)", async () => {
    const bad = await GET(new Request("https://x.vercel.app/api/traffic/nothing"));
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe("INVALID_INPUT");
    const proto = await GET(new Request("https://x.vercel.app/api/traffic/constructor"));
    expect(proto.status).toBe(400);
    const ok = await GET(new Request("https://x.vercel.app/api/traffic/incidents", { headers: { "x-real-ip": "10.9.9.9" } }));
    expect(ok.status).toBe(200);
    expect(Array.isArray(((await ok.json()) as { incidents: unknown[] }).incidents)).toBe(true);
  });
});
