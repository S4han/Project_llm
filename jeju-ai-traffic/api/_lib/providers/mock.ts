import type { RouteCompareRequest, RouteOption } from "../../../shared/contracts/route.js";
import type { TrafficIncident } from "../../../shared/contracts/traffic.js";
import type { RouteQuery, RouteResult } from "../../../shared/rules/route.js";
import { ProviderError } from "../errors.js";
import type { ExplanationInput, ExplanationProvider, RouteProvider, TrafficProvider } from "./types.js";

/** 모의 공급자 동작: 정상 응답, 한도 초과(429), 장애. */
export type MockBehavior = "ok" | "rate_limited" | "unavailable";

function fail(behavior: MockBehavior): void {
  if (behavior === "rate_limited") throw new ProviderError("rate_limited", "mock 429");
  if (behavior === "unavailable") throw new ProviderError("unavailable", "mock unavailable");
}

/**
 * 외부 호출 없이 동작하는 모의 공급자. calls로 호출 횟수를 확인한다.
 * routes에서 id가 호출 종류(query.kind)와 같은 경로를 돌려주고, 없으면 경로 없음(notFound).
 * behaviors로 호출 종류별 동작을 바꿀 수 있다.
 */
export class MockRouteProvider implements RouteProvider {
  readonly id = "kakao" as const;
  calls = 0;
  behavior: MockBehavior = "ok";
  behaviors: Partial<Record<RouteQuery["kind"], MockBehavior>> = {};
  private readonly routes: RouteOption[];

  constructor(routes: RouteOption[]) {
    this.routes = routes;
  }

  async fetchRoute(_request: RouteCompareRequest, query: RouteQuery): Promise<RouteResult> {
    this.calls += 1;
    fail(this.behaviors[query.kind] ?? this.behavior);
    const route = this.routes.find((r) => r.id === query.kind);
    return route ? { ok: true, route } : { ok: false, reason: "notFound" };
  }
}

export class MockTrafficProvider implements TrafficProvider {
  readonly id = "jejuIts" as const;
  calls = 0;
  behavior: MockBehavior = "ok";
  private readonly incidents: TrafficIncident[];

  constructor(incidents: TrafficIncident[]) {
    this.incidents = incidents;
  }

  async fetchIncidents(): Promise<TrafficIncident[]> {
    this.calls += 1;
    fail(this.behavior);
    return this.incidents;
  }
}

export class MockExplanationProvider implements ExplanationProvider {
  readonly id = "ai" as const;
  calls = 0;
  behavior: MockBehavior = "ok";
  private readonly text: string;

  constructor(text: string) {
    this.text = text;
  }

  async explain(_input: ExplanationInput): Promise<{ text: string }> {
    this.calls += 1;
    fail(this.behavior);
    return { text: this.text };
  }
}
