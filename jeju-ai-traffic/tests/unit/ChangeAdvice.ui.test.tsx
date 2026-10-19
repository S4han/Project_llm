// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RouteCompareResponse, RouteOption } from "../../shared/contracts/route";
import { MonitorPanel } from "../../web/src/features/monitor/MonitorPanel";
import type { LocationResult } from "../../web/src/services/geolocation";
import type { RouteCompareResult } from "../../web/src/services/routesApi";

const DEST = { lat: 33.2541, lng: 126.5601 };
const route = (id: string, label: string, sec: number): RouteOption => ({
  id, provider: "kakao", label, durationSeconds: sec, distanceMeters: 1, geometry: [], observedAt: "2026-10-19T07:05:00.000Z", trafficStatus: "smooth", segments: [], incidentIds: [],
});
const data = (followedSec: number, altSec: number): RouteCompareResponse => ({
  routes: [route("recommend", "카카오 추천", altSec), route("via1100", "1100도로 경유", followedSec)],
  recommendedRouteId: altSec <= followedSec ? "recommend" : "via1100",
  tiedRouteIds: [], observedAt: "2026-10-19T07:05:00.000Z", stale: false, incidents: [], incidentsStatus: "ok", incidentsObservedAt: null,
});

afterEach(cleanup);

/** 재평가 결과를 차례로 돌려주고, 다음 회차는 tick()으로 직접 실행한다. */
function setup(results: RouteCompareResponse[]) {
  const timers: (() => void)[] = [];
  const onFollowChange = vi.fn();
  const queue = [...results];
  render(
    <MonitorPanel
      destination={DEST}
      selectedId="via1100"
      onFollowChange={onFollowChange}
      deps={{
        locate: async (): Promise<LocationResult> => ({ kind: "ok", location: { lat: 33.5066, lng: 126.4929 }, accuracyMeters: 10 }),
        compare: async (): Promise<RouteCompareResult> => ({ ok: true, data: queue.shift() ?? results[results.length - 1]! }),
        setTimer: (fn) => {
          timers.push(fn);
          return timers.length;
        },
        clearTimer: () => {},
        isVisible: () => true,
        onVisibilityChange: () => () => {},
      }}
    />,
  );
  const tick = async () => {
    await act(async () => {
      timers.shift()?.();
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
  };
  const start = async () => {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "모니터링 시작" }));
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
  };
  return { tick, start, onFollowChange };
}

const advice = () => screen.queryByRole("alert", { name: "더 빠른 경로가 있습니다" });

describe("경로 변경 안내 화면 (FR-010)", () => {
  it("4분 59초 단축이면 안내하지 않는다 (AC-010-02)", async () => {
    const { start } = setup([data(3600, 3301)]);
    await start();
    expect(screen.getByText(/선택 경로\(같은 방식으로 다시 조회\)/)).toBeTruthy();
    expect(advice()).toBeNull();
  });

  it("정확히 5분이면 안내한다 (AC-010-03)", async () => {
    const { start } = setup([data(3600, 3300)]);
    await start();
    expect(advice()?.textContent).toContain("카카오 추천 경로가 지금 경로보다 남은 시간 기준 약 5분 빠릅니다.");
  });

  it("'유지'하면 안내를 닫고 지금 경로를 유지한다 (AC-010-06)", async () => {
    const { start, onFollowChange } = setup([data(3600, 3120)]);
    await start();
    fireEvent.click(screen.getByRole("button", { name: "유지" }));
    expect(advice()).toBeNull();
    expect(screen.getByText(/지금 경로를 유지합니다/)).toBeTruthy();
    expect(onFollowChange).not.toHaveBeenCalled();
    expect(screen.getByText(/1100도로 경유/, { selector: "strong" })).toBeTruthy();
  });

  it("유지한 같은 조합은 다음 회차에 다시 안내하지 않는다 (AC-010-07)", async () => {
    const { start, tick } = setup([data(3600, 3120), data(3600, 3100)]);
    await start();
    fireEvent.click(screen.getByRole("button", { name: "유지" }));
    await tick();
    expect(advice()).toBeNull();
  });

  it("'변경'하면 따라가는 경로가 바뀌고 외부 내비 재확인을 안내한다", async () => {
    const { start, onFollowChange } = setup([data(3600, 3120)]);
    await start();
    fireEvent.click(screen.getByRole("button", { name: "변경" }));
    expect(onFollowChange).toHaveBeenCalledWith("recommend");
    expect(screen.getByText("카카오 추천 경로로 바꿨습니다. 외부 내비로 안내 중이라면 내비에서 경로를 다시 확인하세요.")).toBeTruthy();
    expect(screen.getByText("현재 선택 경로가 가장 빠릅니다.")).toBeTruthy();
  });

  it("답하지 않은 안내는 다음 회차에 숫자만 갱신, 5분 미만이 되면 닫고 알린다", async () => {
    const { start, tick } = setup([data(3600, 3120), data(3600, 3000), data(3600, 3500)]);
    await start();
    expect(advice()?.textContent).toContain("약 8분");
    await tick();
    expect(screen.getAllByRole("alert", { name: "더 빠른 경로가 있습니다" })).toHaveLength(1);
    expect(advice()?.textContent).toContain("약 10분");
    await tick();
    expect(advice()).toBeNull();
    expect(screen.getByText("더 이상 5분 이상 빠르지 않아 안내를 닫았습니다.")).toBeTruthy();
  });

  it("모니터링을 중지하면 떠 있던 안내를 닫는다", async () => {
    const { start } = setup([data(3600, 3120)]);
    await start();
    expect(advice()).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "중지" }));
    expect(advice()).toBeNull();
  });
});
