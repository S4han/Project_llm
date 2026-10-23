// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RouteOption } from "../../shared/contracts/route";
import type { TrafficIncident } from "../../shared/contracts/traffic";
import { levelOf, speedLineDrawer, zoomOf } from "../../web/src/features/map/kakaoMap";
import { kakaoFailReason, loadKakaoMaps, resetKakaoForTest } from "../../web/src/features/map/kakaoSdk";
import type { FacilityPoint, SpeedLine } from "../../web/src/features/map/leafletMap";
import { RouteMap } from "../../web/src/features/routes/RouteMap";
import { IncidentMap } from "../../web/src/features/traffic/IncidentMap";
import { fakeKakao, stubLayout, type FakeKakao } from "./fakeKakao";

const AT = "2026-10-23T00:00:00.000Z";
const CCTV: FacilityPoint = { id: "C1", type: "FTY02", name: "신광사거리", model: "MMK-H208", lat: 33.45, lng: 126.5 };
const GAS: FacilityPoint = { id: "G1", type: "GAS", name: "제주주유소", model: "", lat: 33.46, lng: 126.52, pin: { mark: "SK", price: "1,690", color: "#e2231a", low: true } };
const FAR_GAS: FacilityPoint = { ...GAS, id: "G2", lat: 34.5, lng: 128.5 };
const LINE: SpeedLine = { id: "L1", name: "노형로", points: [{ lat: 33.4, lng: 126.4 }, { lat: 33.4, lng: 126.6 }], kmh: 45, travelSeconds: 60, status: "smooth", from: "노형오거리", to: "제주시청" };
const INC: TrafficIncident = { id: "e1", kind: "event", description: "정지차량", location: { lat: 33.3, lng: 126.7 }, observedAt: AT, sourceTime: null, source: "jejuIts" };

let fake: FakeKakao;
let layout: ReturnType<typeof stubLayout>;

beforeEach(() => {
  resetKakaoForTest();
  fake = fakeKakao();
  layout = stubLayout();
});
afterEach(() => {
  cleanup();
  layout.restore();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  delete window.kakao;
  document.head.querySelectorAll("script").forEach((s) => s.remove());
});

const withKey = () => vi.stubEnv("VITE_KAKAO_MAP_KEY", "test-js-key");
const click = (lat: number, lng: number) => act(() => fake.fire(fake.created[0], "click", { latLng: new fake.maps.LatLng(lat, lng) }));

describe("카카오 지도 SDK 받기 (TASK-033 2.(a))", () => {
  it("키가 없으면 받지 않고 null(Leaflet으로)", async () => {
    vi.stubEnv("VITE_KAKAO_MAP_KEY", "");
    await expect(loadKakaoMaps()).resolves.toBeNull();
    expect(document.head.querySelector("script")).toBeNull();
  });

  it("키가 있으면 autoload=false로 한 번만 받고 kakao.maps.load 뒤에 준비", async () => {
    withKey();
    const first = loadKakaoMaps();
    expect(loadKakaoMaps()).toBe(first);
    const scripts = document.head.querySelectorAll("script");
    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.src).toBe("https://dapi.kakao.com/v2/maps/sdk.js?appkey=test-js-key&autoload=false");
    window.kakao = { maps: fake.maps };
    scripts[0]?.dispatchEvent(new Event("load"));
    await expect(first).resolves.toBe(fake.maps);
  });

  it("못 받거나(도메인·네트워크) 준비 알림이 안 오면 null", async () => {
    withKey();
    const failed = loadKakaoMaps();
    document.head.querySelector("script")?.dispatchEvent(new Event("error"));
    await expect(failed).resolves.toBeNull();

    resetKakaoForTest();
    vi.useFakeTimers();
    window.kakao = { maps: { ...fake.maps, load: () => undefined } };
    const silent = loadKakaoMaps(1000);
    vi.advanceTimersByTime(1000);
    await expect(silent).resolves.toBeNull();
    expect(kakaoFailReason()).toContain("SDK 준비 응답 없음");
  });
});

describe("카카오 지도 도우미", () => {
  it("확대 수준 ↔ 카카오 레벨", () => {
    expect(levelOf(15)).toBe(4);
    expect(zoomOf(4)).toBe(15);
    expect(levelOf(30)).toBe(1);
    expect(levelOf(0)).toBe(14);
  });

  it("도로 선: 화면 밖 구간은 그리지 않고, 1.5px 안의 점은 건너뛰고, 선 가까이 누르면 그 구간", () => {
    const opened: string[] = [];
    const out: SpeedLine = { ...LINE, id: "OUT", points: [{ lat: 40, lng: 130 }, { lat: 40.1, lng: 130.1 }] };
    const dense: SpeedLine = { ...LINE, id: "D", points: [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.1 }, { lat: 0, lng: 0.2 }, { lat: 0, lng: 10 }] };
    const drawer = speedLineDrawer([out, dense], new Set(), (l) => opened.push(l.id));
    const lineTo: number[][] = [];
    const ctx = { beginPath() {}, moveTo() {}, lineTo: (x: number, y: number) => lineTo.push([x, y]), stroke() {} } as unknown as CanvasRenderingContext2D;
    // 경도 1도 = 1px
    drawer.draw(ctx, (lat, lng) => ({ x: lng, y: -lat }), { south: -5, north: 5, west: -5, east: 20, zoom: 12 });
    expect(lineTo).toEqual([[10, -0]]);
    expect(drawer.hit(5, 3)).toBe(true);
    expect(drawer.hit(5, 20)).toBe(false);
    expect(opened).toEqual(["D"]);
  });
});

describe("카카오 교통·관광 지도 (TASK-033)", () => {
  const renderMap = async (props: Partial<Parameters<typeof IncidentMap>[0]> = {}) => {
    withKey();
    window.kakao = { maps: fake.maps };
    const view = render(<IncidentMap incidents={[INC]} focus={null} viewKey="all" facilities={[CCTV, GAS, FAR_GAS]} speedLines={[LINE]} speedObservedAt={AT} label="테스트 지도" {...props} />);
    await vi.waitFor(() => expect(screen.getByRole("region", { name: "테스트 지도" }).dataset.mapEngine).toBe("kakao"));
    const region = screen.getByRole("region", { name: "테스트 지도" });
    return { view, region, map: fake.created[0]! };
  };

  it("키가 있으면 카카오 지도로, 처음에는 제주 전체", async () => {
    const { region, map } = await renderMap();
    expect(region.dataset.facilities).toBe("3");
    expect(region.dataset.speedLines).toBe("1");
    expect(map.center.getLat()).toBeCloseTo(33.34, 2);
    expect(map.center.getLng()).toBeCloseTo(126.56, 2);
  });

  it("점은 캔버스(화면 안만), 가격 표시는 화면 안 것만 DOM", async () => {
    const { region } = await renderMap();
    expect(layout.calls).toContain("arc");
    expect(region.querySelectorAll(".gas-pin")).toHaveLength(1);
    expect(region.querySelector(".incident-marker")).not.toBeNull();
  });

  it("점을 누르면 카드, 빈 곳을 누르면 닫힘, 도로 선을 누르면 도로 카드", async () => {
    await renderMap();
    click(33.45, 126.5);
    expect(screen.getByText("신광사거리")).toBeTruthy();
    click(33.2, 126.3);
    expect(screen.queryByText("신광사거리")).toBeNull();
    click(33.4, 126.45);
    expect(screen.getByText("노형로")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "카드 닫기" }));
    expect(screen.queryByText("노형로")).toBeNull();
  });

  it("가격 표시·사건 점을 눌러도 카드", async () => {
    const { region } = await renderMap();
    fireEvent.click(region.querySelector(".gas-pin")!);
    expect(screen.getByText("제주주유소")).toBeTruthy();
    fireEvent.click(region.querySelector(".incident-marker")!);
    expect(screen.getByText("정지차량")).toBeTruthy();
  });

  it("목록에서 고르면 확대 15 이상으로 옮기고 카드를 연다", async () => {
    const { map } = await renderMap({ openFacility: { id: "C1", seq: 1 } });
    expect(map.level).toBeLessThanOrEqual(levelOf(15));
    expect(map.center.getLat()).toBe(33.45);
    expect(screen.getByText("신광사거리")).toBeTruthy();
  });

  it("내 위치 반경 원, 일반/위성 선택", async () => {
    const { map } = await renderMap({ nearby: { lat: 33.45, lng: 126.5, radiusMeters: 1000 } });
    expect(fake.shapes.filter((s) => s.kind === "circle" && s.map)).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "위성" }));
    expect(map.typeId).toBe(fake.maps.MapTypeId.HYBRID);
    expect(screen.getByRole("button", { name: "위성" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("바탕 그림이 정해진 시간 안에 안 그려지면 Leaflet으로 바꾼다", async () => {
    const { region } = await renderMap();
    expect(region.dataset.mapEngine).toBe("kakao");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    vi.useFakeTimers();
    // 지도를 다시 만들어 가짜 시계 위에서 시간 초과를 일으킨다.
    cleanup();
    render(<IncidentMap incidents={[]} focus={null} viewKey="all" label="다시 지도" />);
    const again = screen.getByRole("region", { name: "다시 지도" });
    expect(again.dataset.mapEngine).toBe("kakao");
    act(() => vi.advanceTimersByTime(12_000));
    expect(screen.getByRole("region", { name: "다시 지도" }).dataset.mapEngine).toBeUndefined();
    expect(screen.getByRole("region", { name: "다시 지도" }).classList.contains("leaflet-container")).toBe(true);
    expect(screen.getByText(/카카오 지도를 쓸 수 없어 브이월드 지도로 보여 줍니다 · 바탕 그림을 받지 못함/)).toBeTruthy();
  });

  it("바탕 그림이 그려지면(tilesloaded) 카카오 지도를 그대로 둔다", async () => {
    await renderMap();
    vi.useFakeTimers();
    cleanup();
    render(<IncidentMap incidents={[]} focus={null} viewKey="all" label="다시 지도" />);
    const map = fake.created[fake.created.length - 1];
    act(() => fake.fire(map, "tilesloaded"));
    act(() => vi.advanceTimersByTime(12_000));
    expect(screen.getByRole("region", { name: "다시 지도" }).dataset.mapEngine).toBe("kakao");
  });
});

describe("카카오 경로 지도 (TASK-033)", () => {
  const route = (id: string, lng: number): RouteOption => ({
    id,
    provider: "mock",
    label: id,
    durationSeconds: 600,
    distanceMeters: 5000,
    geometry: [{ lat: 33.4, lng }, { lat: 33.5, lng: lng + 0.1 }],
    observedAt: AT,
    trafficStatus: "smooth",
    segments: [{ startIndex: 0, endIndex: 1, status: "slow", distanceMeters: 5000 }],
    incidentIds: [],
  });

  it("선택 경로는 굵게·구간 색, 대체 경로를 누르면 고른다", async () => {
    withKey();
    window.kakao = { maps: fake.maps };
    const onSelect = vi.fn();
    render(<RouteMap routes={[route("a", 126.5), route("b", 126.6)]} selectedId="a" incidents={[]} onSelect={onSelect} />);
    await vi.waitFor(() => expect(screen.getByRole("region", { name: "경로 지도" }).dataset.mapEngine).toBe("kakao"));
    const lines = fake.shapes.filter((s) => s.kind === "polyline" && s.map);
    expect(lines.map((l) => l.options.strokeWeight)).toEqual([4, 9, 5]);
    const alt = fake.shapes.find((s) => s.options.strokeWeight === 4);
    act(() => fake.fire(alt?.self, "click"));
    expect(onSelect).toHaveBeenCalledWith("b");
    expect(screen.getByRole("button", { name: "출발" })).toBeTruthy();
  });
});
