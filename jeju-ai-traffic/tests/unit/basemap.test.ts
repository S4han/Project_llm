// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import L from "leaflet";
import { addBaseTiles, vworldTileUrl } from "../../web/src/features/map/leafletMap";

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
    expect(vworldTileUrl("ABC-1")).toBe("https://api.vworld.kr/req/wmts/1.0.0/ABC-1/white/{z}/{y}/{x}.png");
  });

  it("지도용 키가 없으면 OpenStreetMap", () => {
    const map = newMap();
    addBaseTiles(map, undefined, vi.fn());
    const layer = tileLayers(map)[0]!;
    expect(tileLayers(map)).toHaveLength(1);
    expect((layer as unknown as { _url: string })._url).toContain("tile.openstreetmap.org");
    map.remove();
  });

  it("키가 있으면 브이월드, 한 장도 못 받고 4장 실패하면 OpenStreetMap으로 바꾼다", () => {
    const map = newMap();
    const onFailed = vi.fn();
    addBaseTiles(map, " KEY ", onFailed);
    const vworld = tileLayers(map)[0]!;
    expect((vworld as unknown as { _url: string })._url).toContain("api.vworld.kr/req/wmts/1.0.0/KEY/white");
    expect(vworld.getAttribution?.()).toContain("브이월드");
    fail(vworld, 3);
    expect(tileLayers(map)).toEqual([vworld]);
    fail(vworld, 1);
    const osm = tileLayers(map)[0]!;
    expect(tileLayers(map)).toHaveLength(1);
    expect((osm as unknown as { _url: string })._url).toContain("tile.openstreetmap.org");
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
