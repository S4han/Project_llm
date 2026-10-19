import type { RouteCompareRequest, RouteOption } from "../../../shared/contracts/route.js";
import type { TrafficIncident } from "../../../shared/contracts/traffic.js";
import { ProviderError } from "../errors.js";
import type { ExplanationInput, ExplanationProvider, RouteProvider, TrafficProvider } from "./types.js";

/** 모의 공급자 동작: 정상 응답, 한도 초과(429), 장애. */
export type MockBehavior = "ok" | "rate_limited" | "unavailable";

function fail(behavior: MockBehavior): void {
  if (behavior === "rate_limited") throw new ProviderError("rate_limited", "mock 429");
  if (behavior === "unavailable") throw new ProviderError("unavailable", "mock unavailable");
}

/** 외부 호출 없이 동작하는 모의 공급자. calls로 호출 횟수를 확인한다. */
export class MockRouteProvider implements RouteProvider {
  readonly id = "kakao" as const;
  readonly callsPerRequest: number;
  calls = 0;
  behavior: MockBehavior = "ok";
  private readonly routes: RouteOption[];

  constructor(routes: RouteOption[], callsPerRequest = 3) {
    this.routes = routes;
    this.callsPerRequest = callsPerRequest;
  }

  async fetchRoutes(_request: RouteCompareRequest): Promise<RouteOption[]> {
    this.calls += 1;
    fail(this.behavior);
    return this.routes;
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
