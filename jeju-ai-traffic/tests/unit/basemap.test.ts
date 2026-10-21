// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import L from "leaflet";
import { addBaseTiles, addFacilityMarkers, PIN_DETAIL_ZOOM, PIN_LABEL_ZOOM, syncFarClass, vworldTileUrl } from "../../web/src/features/map/leafletMap";

function tileLayers(map: L.Map): L.TileLayer[] {
  const out: L.TileLayer[] = [];
  map.eachLayer((l) => {
    if (l instanceof L.TileLayer) out.push(l);
  });
  return out;
}

function newMap(): L.Map {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return L.map(el).setView([33.5, 126.5], 12);
}

const fail = (layer: L.TileLayer, n: number) => {
  for (let i = 0; i < n; i += 1) layer.fire("tileerror");
};

describe("바탕지도(TASK-020)", () => {
  it("브이월드 흰색 WMTS 주소", () => {
    expect(vworldTileUrl("ABC-1")).toBe("https://api.vworld.kr/req/wmts/1.0.0/ABC-1/Base/{z}/{y}/{x}.png");
  });

  it("위성 jpeg·이름 겹침 png 주소", () => {
    expect(vworldTileUrl("K", "Satellite")).toBe("https://api.vworld.kr/req/wmts/1.0.0/K/Satellite/{z}/{y}/{x}.jpeg");
    expect(vworldTileUrl("K", "Hybrid")).toBe("https://api.vworld.kr/req/wmts/1.0.0/K/Hybrid/{z}/{y}/{x}.png");
  });

  it("키가 있으면 일반/위성 선택이 생기고, 위성을 고르면 위성 사진 위에 이름을 겹친다", () => {
    const map = newMap();
    addBaseTiles(map, "KEY", vi.fn());
    const labels = [...map.getContainer().querySelectorAll(".leaflet-control-layers-base label")].map((l) => l.textContent?.trim());
    expect(labels).toEqual(["일반", "위성"]);
    const radios = map.getContainer().querySelectorAll<HTMLInputElement>(".leaflet-control-layers-base input");
    expect(radios[0]!.checked).toBe(true);
    radios[1]!.click();
    const urls = tileLayers(map).map((l) => (l as unknown as { _url: string })._url);
    expect(urls).toEqual([expect.stringContaining("/Satellite/"), expect.stringContaining("/Hybrid/")]);
    map.remove();
  });

  it("지도용 키가 없으면 선택 없이 OpenStreetMap", () => {
    const map = newMap();
    addBaseTiles(map, undefined, vi.fn());
    const layer = tileLayers(map)[0]!;
    expect(tileLayers(map)).toHaveLength(1);
    expect(map.getContainer().querySelector(".leaflet-control-layers")).toBeNull();
    expect((layer as unknown as { _url: string })._url).toContain("tile.openstreetmap.org");
    map.remove();
  });

  it("키가 있으면 브이월드, 한 장도 못 받고 4장 실패하면 OpenStreetMap으로 바꾼다", () => {
    const map = newMap();
    const onFailed = vi.fn();
    addBaseTiles(map, " KEY ", onFailed);
    const vworld = tileLayers(map)[0]!;
    expect((vworld as unknown as { _url: string })._url).toContain("api.vworld.kr/req/wmts/1.0.0/KEY/Base");
    expect(vworld.getAttribution?.()).toContain("브이월드");
    fail(vworld, 3);
    expect(tileLayers(map)).toEqual([vworld]);
    fail(vworld, 1);
    const osm = tileLayers(map)[0]!;
    expect(tileLayers(map)).toHaveLength(1);
    expect((osm as unknown as { _url: string })._url).toContain("tile.openstreetmap.org");
    expect(map.getContainer().querySelector(".leaflet-control-layers")).toBeNull();
    expect(onFailed).not.toHaveBeenCalled();
    fail(osm, 4);
    expect(onFailed).toHaveBeenCalledTimes(1);
    map.remove();
  });

  it("브이월드 타일을 한 장이라도 받았으면 바꾸지 않는다", () => {
    const map = newMap();
    addBaseTiles(map, "KEY", vi.fn());
    const vworld = tileLayers(map)[0]!;
    vworld.fire("tileload");
    fail(vworld, 10);
    expect(tileLayers(map)).toEqual([vworld]);
    map.remove();
  });
});

describe("주유소 가격 표시 접기(TASK-021)", () => {
  it("멀리 보면 map-far, 최저가가 아닌 주유소 표시만 접는 표시(fold)를 단다", () => {
    const map = newMap();
    const layer = L.layerGroup().addTo(map);
    const pin = { mark: "SK", price: "1,867", color: "#e30", fold: true };
    addFacilityMarkers(map, layer, [
      { id: "a", type: "GAS", name: "가", model: "", lat: 33.5, lng: 126.5, pin: { ...pin, low: true } },
      { id: "b", type: "GAS", name: "나", model: "", lat: 33.501, lng: 126.5, pin: { ...pin, low: false } },
      { id: "c", type: "EV", name: "다", model: "", lat: 33.502, lng: 126.5, pin: { mark: "⚡", price: "1/2", color: "#0a0", low: false } },
    ]);
    const el = map.getContainer();
    expect([...el.querySelectorAll(".gas-pin")].map((p) => p.className)).toEqual(["gas-pin gas-pin-low", "gas-pin gas-pin-fold", "gas-pin"]);
    map.setZoom(PIN_DETAIL_ZOOM - 1, { animate: false });
    syncFarClass(map);
    expect(el.classList.contains("map-far")).toBe(true);
    map.setZoom(PIN_DETAIL_ZOOM, { animate: false });
    syncFarClass(map);
    expect(el.classList.contains("map-far")).toBe(false);
    map.remove();
  });
});

describe("주차장 동그라미 표시(TASK-024)", () => {
  it("dot이면 gas-pin-dot, top(무료)이면 위에, 확대 17 이상이면 map-near", () => {
    const map = newMap();
    const layer = L.layerGroup().addTo(map);
    const pin = { mark: "P", color: "#1d4ed8", low: false, fold: true, dot: true };
    const markers = addFacilityMarkers(map, layer, [
      { id: "free", type: "PARK", name: "무료", model: "", lat: 33.5, lng: 126.5, pin: { ...pin, price: "무료", top: true } },
      { id: "paid", type: "PARK", name: "유료", model: "", lat: 33.5, lng: 126.5, pin: { ...pin, price: "유료", top: false } },
    ]);
    expect([...map.getContainer().querySelectorAll(".gas-pin")].map((p) => p.className)).toEqual(["gas-pin gas-pin-fold gas-pin-dot", "gas-pin gas-pin-fold gas-pin-dot"]);
    expect((markers.get("free") as L.Marker).options.zIndexOffset).toBe(500);
    expect((markers.get("paid") as L.Marker).options.zIndexOffset).toBe(0);
    const el = map.getContainer();
    for (const [zoom, far, near] of [[PIN_DETAIL_ZOOM - 1, true, false], [PIN_DETAIL_ZOOM, false, false], [PIN_LABEL_ZOOM, false, true]] as const) {
      map.setZoom(zoom, { animate: false });
      syncFarClass(map);
      expect([el.classList.contains("map-far"), el.classList.contains("map-near")]).toEqual([far, near]);
    }
    map.remove();
  });
});
