// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RouteCompareResponse, RouteOption } from "../../shared/contracts/route";
import { MonitorPanel } from "../../web/src/features/monitor/MonitorPanel";
import type { LocationResult } from "../../web/src/services/geolocation";
import type { RouteCompareResult } from "../../web/src/services/routesApi";

const DEST = { lat: 33.2541, lng: 126.5601 };
const AT = "2026-10-19T07:05:00.000Z";
const route = (id: string, label: string, sec: number): RouteOption => ({
  id, provider: "kakao", label, durationSeconds: sec, distanceMeters: 40000, geometry: [], observedAt: AT, trafficStatus: "smooth",
  segments: [{ startIndex: 0, endIndex: 1, status: "smooth", distanceMeters: 40000 }], incidentIds: [],
});
const data = (routes: RouteOption[], recommended: string): RouteCompareResponse => ({
  routes, recommendedRouteId: recommended, tiedRouteIds: [], observedAt: AT, stale: false, incidents: [], incidentsStatus: "ok", incidentsObservedAt: AT,
});
const OK = async (): Promise<LocationResult> => ({ kind: "ok", location: { lat: 33.5066, lng: 126.4929 }, accuracyMeters: 10 });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderPanel(compare: () => Promise<RouteCompareResult>, selectedId = "via1100", locate = OK) {
  const spy = vi.fn(compare);
  render(<MonitorPanel destination={DEST} selectedId={selectedId} deps={{ locate, compare: spy }} />);
  return spy;
}

describe("교통상황 재평가 화면 (FR-009)", () => {
  it("시작 전: 동작 조건(화면 켜짐·페이지 열림, 최대 60분)을 안내한다 (AC-009-06)", () => {
    renderPanel(async () => ({ ok: true, data: data([], "x") }));
    expect(screen.getByText(/화면이 켜져 있고 이 페이지가 열려 있을 때만 동작하며/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "모니터링 시작" })).toBeTruthy();
    expect(screen.getByText("운전 중에는 화면을 조작하지 마세요.")).toBeTruthy();
  });

  it("시작하면 즉시 재평가해 선택 경로와 가장 빠른 경로의 남은 시간을 비교한다 (AC-009-01·04)", async () => {
    const spy = renderPanel(async () => ({ ok: true, data: data([route("recommend", "카카오 추천", 3000), route("via1100", "1100도로 경유", 3600)], "recommend") }));
    fireEvent.click(screen.getByRole("button", { name: "모니터링 시작" }));
    expect(await screen.findByText(/선택 경로\(같은 방식으로 다시 조회\)/)).toBeTruthy();
    expect(spy).toHaveBeenCalledTimes(1);
    const section = screen.getByRole("region", { name: "교통상황 재평가" });
    expect(section.textContent).toContain("1100도로 경유: 남은 예상 1시간");
    expect(section.textContent).toContain("가장 빠른 경로 카카오 추천: 50분 (선택 경로 대비 10분 빠름)");
    expect(section.textContent).toMatch(/다음 갱신 약 5분 후/);
    expect(screen.getByRole("button", { name: "중지" })).toBeTruthy();
  });

  it("경로가 하나면 남은 예상시간만 보여 주고(비교 문구 없음), 같은 방식 경로가 없으면 비교 불가", async () => {
    renderPanel(async () => ({ ok: true, data: data([route("via1100", "1100도로 경유", 3000)], "via1100") }));
    fireEvent.click(screen.getByRole("button", { name: "모니터링 시작" }));
    expect(await screen.findByText(/남은 예상/)).toBeTruthy();
    expect(screen.queryByText("현재 선택 경로가 가장 빠릅니다.")).toBeNull();
    cleanup();
    renderPanel(async () => ({ ok: true, data: data([route("recommend", "카카오 추천", 3000)], "recommend") }), "via516");
    fireEvent.click(screen.getByRole("button", { name: "모니터링 시작" }));
    expect(await screen.findByText(/선택한 방식의 경로가 이번 조회에 없어 비교할 수 없습니다/)).toBeTruthy();
  });

  it("중지하면 '다시 시작'이 나온다 (AC-009-05)", async () => {
    renderPanel(async () => ({ ok: true, data: data([route("via1100", "1100도로 경유", 3000)], "via1100") }));
    fireEvent.click(screen.getByRole("button", { name: "모니터링 시작" }));
    fireEvent.click(await screen.findByRole("button", { name: "중지" }));
    expect(screen.getByText(/모니터링을 중지했습니다\. · 마지막 성공/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "다시 시작" })).toBeTruthy();
  });

  it("갱신 실패는 사유를 표시하고 모니터링을 유지한다 (AC-009-07)", async () => {
    renderPanel(async () => ({ ok: false, error: { code: "PROVIDER_UNAVAILABLE", message: "네트워크 연결을 확인한 뒤 다시 시도하세요." } }));
    fireEvent.click(screen.getByRole("button", { name: "모니터링 시작" }));
    expect((await screen.findByRole("alert")).textContent).toContain("갱신 실패: 네트워크 연결을 확인한 뒤 다시 시도하세요.");
    expect(screen.getByRole("button", { name: "중지" })).toBeTruthy();
  });

  it("조회 한도면 중지하고 사유와 재사용 시각을 보여 준다 (AC-009-08·09)", async () => {
    renderPanel(async () => ({
      ok: false,
      error: { code: "QUOTA_BLOCKED", message: "무료 호출 여유분이 부족해 자동 재평가를 중단했습니다.", retryAfter: "2026-10-19T15:00:00.000Z" },
    }));
    fireEvent.click(screen.getByRole("button", { name: "모니터링 시작" }));
    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("무료 호출 여유분이 부족해 자동 재평가를 중단했습니다. (10월 20일 00:00 이후 다시 사용 가능)");
    expect(screen.getByRole("button", { name: "다시 시작" })).toBeTruthy();
  });

  it("화면이 숨겨지면 멈춤 안내, 위치 권한이 없으면 시작하지 못한다", async () => {
    renderPanel(async () => ({ ok: true, data: data([route("via1100", "1100도로 경유", 3000)], "via1100") }));
    fireEvent.click(screen.getByRole("button", { name: "모니터링 시작" }));
    await screen.findByText(/남은 예상/);
    const vis = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(screen.getByText(/화면이 비활성이라 재평가를 멈췄습니다/)).toBeTruthy();
    vis.mockRestore();

    cleanup();
    const spy = renderPanel(async () => ({ ok: true, data: data([], "x") }), "via1100", async (): Promise<LocationResult> => ({ kind: "denied" }));
    fireEvent.click(screen.getByRole("button", { name: "모니터링 시작" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("위치 권한이 없어 재평가할 수 없습니다."));
    expect(spy).not.toHaveBeenCalled();
  });
});
