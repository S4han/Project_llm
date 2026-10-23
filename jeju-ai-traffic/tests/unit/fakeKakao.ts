import type { KakaoMaps, KLatLng, KMap, KMouseEvent } from "../../web/src/features/map/kakaoSdk";

/**
 * 테스트용 가짜 카카오 지도 SDK(TASK-033). 지도 상자 400×300, 레벨마다 2배인 단순 평면 좌표.
 * 표시(CustomOverlay)는 setMap 하면 지도 상자에 붙고, 이벤트는 fire로 직접 일으킨다.
 */
export interface FakeKakao {
  maps: KakaoMaps;
  created: FakeMap[];
  overlays: { content: HTMLElement; position: KLatLng; map: unknown }[];
  shapes: { kind: "circle" | "polyline"; options: Record<string, unknown>; map: unknown; self: object }[];
  fire(target: unknown, type: string, e?: KMouseEvent): void;
}

export interface FakeMap extends KMap {
  level: number;
  center: KLatLng;
  node: HTMLElement;
  typeId: number;
  pans: [number, number][];
}

export const W = 400;
export const H = 300;

class LatLng implements KLatLng {
  constructor(
    private lat: number,
    private lng: number,
  ) {}
  getLat() {
    return this.lat;
  }
  getLng() {
    return this.lng;
  }
}

class Bounds {
  s = 90;
  n = -90;
  w = 180;
  e = -180;
  constructor(sw?: KLatLng, ne?: KLatLng) {
    if (sw) this.extend(sw);
    if (ne) this.extend(ne);
  }
  extend(ll: KLatLng) {
    this.s = Math.min(this.s, ll.getLat());
    this.n = Math.max(this.n, ll.getLat());
    this.w = Math.min(this.w, ll.getLng());
    this.e = Math.max(this.e, ll.getLng());
  }
  contain(ll: KLatLng) {
    return ll.getLat() >= this.s && ll.getLat() <= this.n && ll.getLng() >= this.w && ll.getLng() <= this.e;
  }
  isEmpty() {
    return this.s > this.n;
  }
  getSouthWest() {
    return new LatLng(this.s, this.w);
  }
  getNorthEast() {
    return new LatLng(this.n, this.e);
  }
}

export function fakeKakao(): FakeKakao {
  const listeners = new Map<unknown, Map<string, Set<(e?: KMouseEvent) => void>>>();
  const created: FakeMap[] = [];
  const overlays: FakeKakao["overlays"] = [];
  const shapes: FakeKakao["shapes"] = [];
  const fire = (target: unknown, type: string, e?: KMouseEvent) => {
    for (const h of [...(listeners.get(target)?.get(type) ?? [])]) h(e);
  };
  // 1px당 경도(도) — 레벨 1에서 0.00001, 레벨마다 2배.
  const degPerPx = (level: number) => 0.00001 * 2 ** (level - 1);

  class FakeMapImpl implements FakeMap {
    level: number;
    center: KLatLng;
    typeId = 1;
    pans: [number, number][] = [];
    constructor(
      public node: HTMLElement,
      o: { center: KLatLng; level: number },
    ) {
      this.level = o.level;
      this.center = o.center;
      created.push(this);
    }
    setCenter(ll: KLatLng) {
      this.center = ll;
    }
    getCenter() {
      return this.center;
    }
    setLevel(level: number) {
      this.level = level;
      fire(this, "zoom_changed");
    }
    getLevel() {
      return this.level;
    }
    getBounds() {
      const d = degPerPx(this.level);
      return new Bounds(new LatLng(this.center.getLat() - (H / 2) * d, this.center.getLng() - (W / 2) * d), new LatLng(this.center.getLat() + (H / 2) * d, this.center.getLng() + (W / 2) * d)) as never;
    }
    setBounds(b: Bounds) {
      this.center = new LatLng((b.s + b.n) / 2, (b.w + b.e) / 2);
      let level = 1;
      while (level < 14 && ((b.e - b.w) / degPerPx(level) > W || (b.n - b.s) / degPerPx(level) > H)) level += 1;
      this.level = level;
    }
    panBy(dx: number, dy: number) {
      this.pans.push([dx, dy]);
    }
    relayout() {}
    setMapTypeId(id: number) {
      this.typeId = id;
    }
    addControl() {}
    getNode() {
      return this.node;
    }
    getProjection() {
      const toPoint = (ll: KLatLng) => {
        const d = degPerPx(this.level);
        return { x: W / 2 + (ll.getLng() - this.center.getLng()) / d, y: H / 2 - (ll.getLat() - this.center.getLat()) / d };
      };
      return { pointFromCoords: toPoint, containerPointFromCoords: toPoint };
    }
  }

  class CustomOverlay {
    private entry: FakeKakao["overlays"][number];
    constructor(o: { content: HTMLElement; position: KLatLng; map?: FakeMapImpl }) {
      this.entry = { content: o.content, position: o.position, map: null };
      overlays.push(this.entry);
      if (o.map) this.setMap(o.map);
    }
    setMap(map: FakeMapImpl | null) {
      this.entry.map = map;
      if (map) map.node.append(this.entry.content);
      else this.entry.content.remove();
    }
    getPosition() {
      return this.entry.position;
    }
    setPosition(ll: KLatLng) {
      this.entry.position = ll;
    }
    setContent(c: HTMLElement) {
      this.entry.content = c;
    }
    setZIndex() {}
  }

  const shape = (kind: "circle" | "polyline") =>
    class {
      private entry: FakeKakao["shapes"][number];
      constructor(o: Record<string, unknown>) {
        this.entry = { kind, options: o, map: o.map ?? null, self: this };
        shapes.push(this.entry);
      }
      setMap(map: unknown) {
        this.entry.map = map;
      }
    };

  class AbstractOverlay {
    private map: FakeMapImpl | null = null;
    private panel = document.createElement("div");
    onAdd?: () => void;
    draw?: () => void;
    onRemove?: () => void;
    setMap(map: FakeMapImpl | null) {
      if (map) {
        this.map = map;
        map.node.append(this.panel);
        this.onAdd?.();
        this.draw?.();
      } else if (this.map) {
        this.onRemove?.();
        this.map = null;
      }
    }
    getMap() {
      return this.map;
    }
    getPanels() {
      return { overlayLayer: this.panel, floatPane: this.panel };
    }
    getProjection() {
      if (!this.map) throw new Error("no map");
      return this.map.getProjection();
    }
  }

  const maps = {
    load: (cb: () => void) => cb(),
    LatLng,
    LatLngBounds: Bounds,
    Map: FakeMapImpl,
    CustomOverlay,
    Circle: shape("circle"),
    Polyline: shape("polyline"),
    AbstractOverlay,
    ZoomControl: class {},
    MapTypeControl: class {},
    ControlPosition: { TOPRIGHT: 1, RIGHT: 2 },
    MapTypeId: { ROADMAP: 1, HYBRID: 3 },
    event: {
      addListener(target: unknown, type: string, h: (e?: KMouseEvent) => void) {
        if (!listeners.has(target)) listeners.set(target, new Map());
        const byType = listeners.get(target)!;
        if (!byType.has(type)) byType.set(type, new Set());
        byType.get(type)!.add(h);
      },
      removeListener(target: unknown, type: string, h: (e?: KMouseEvent) => void) {
        listeners.get(target)?.get(type)?.delete(h);
      },
    },
  } as unknown as KakaoMaps;
  return { maps, created, overlays, shapes, fire };
}

/** 지도 상자 크기와 캔버스 그리기를 흉내 낸다(jsdom에는 둘 다 없다). 되돌리는 함수를 돌려준다. */
export function stubLayout(): { calls: string[]; restore: () => void } {
  const calls: string[] = [];
  const w = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  const h = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
  const g = HTMLCanvasElement.prototype.getContext;
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => W });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => H });
  const ctx = new Proxy(
    {},
    {
      get: (_t, prop) => (typeof prop === "string" && /^(beginPath|arc|fill|stroke|moveTo|lineTo|setTransform|clearRect)$/.test(prop) ? () => calls.push(prop) : undefined),
      set: () => true,
    },
  );
  HTMLCanvasElement.prototype.getContext = (() => ctx) as never;
  return {
    calls,
    restore: () => {
      if (w) Object.defineProperty(HTMLElement.prototype, "clientWidth", w);
      if (h) Object.defineProperty(HTMLElement.prototype, "clientHeight", h);
      HTMLCanvasElement.prototype.getContext = g;
    },
  };
}
