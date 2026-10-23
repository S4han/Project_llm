import { useEffect, useState } from "react";
import type { TrafficIncident } from "../../../../shared/contracts/traffic";
import { FACILITY_STYLE } from "../traffic/facilityStyle";
import { STATUS_STYLE } from "../routes/trafficStyle";
import { kakaoMapsNow, loadKakaoMaps, markKakaoDead, type KAbstractOverlay, type KakaoMaps, type KCustomOverlay, type KLatLng, type KLatLngBounds, type KMap } from "./kakaoSdk";
import { gasPinElement, incidentCard, PIN_DETAIL_ZOOM, PIN_LABEL_ZOOM, popupCard, speedLineWeight, type FacilityPoint, type IncidentFocus, type SpeedLine } from "./leafletMap";

/**
 * 카카오 지도 도우미(TASK-033). 확대 수준은 Leaflet 기준(zoom)으로 생각하고 카카오 레벨로 바꿔 쓴다.
 * 카카오 레벨 1이 가장 가깝고 14가 가장 멀다. Leaflet 확대 18 ≈ 레벨 1, 9 ≈ 레벨 10.
 */
export const zoomOf = (level: number) => 19 - level;
export const levelOf = (zoom: number) => Math.min(14, Math.max(1, Math.round(19 - zoom)));

/** 바탕 그림이 이 시간 안에 한 번도 다 그려지지 않으면(한도 초과·도메인 차단 등) Leaflet으로 바꾼다. */
export const KAKAO_TILE_TIMEOUT_MS = 12_000;

/**
 * 지도 엔진 고르기(2.(a)): 키가 있고 SDK가 준비되면 카카오(값), 키가 없거나 실패하면 null(Leaflet), 받는 중이면 undefined.
 * fallback()은 카카오 지도를 만든 뒤 쓸 수 없다고 판단했을 때 부른다(이 화면에서는 다시 시도하지 않는다).
 */
export function useKakaoMaps(): { kakao: KakaoMaps | null | undefined; fallback: (reason: string) => void } {
  const [kakao, setKakao] = useState<KakaoMaps | null | undefined>(() => kakaoMapsNow());
  useEffect(() => {
    if (kakao !== undefined) return;
    let alive = true;
    void loadKakaoMaps().then((k) => alive && setKakao(k));
    return () => {
      alive = false;
    };
  }, [kakao]);
  return {
    kakao,
    fallback: (reason: string) => {
      markKakaoDead(reason);
      setKakao(null);
    },
  };
}

/** 제주도 전체가 보이는 범위. */
export const JEJU_SW = { lat: 33.11, lng: 126.14 };
export const JEJU_NE = { lat: 33.57, lng: 126.98 };

export function boundsOf(k: KakaoMaps, points: { lat: number; lng: number }[]): KLatLngBounds | null {
  if (!points.length) return null;
  const b = new k.LatLngBounds();
  for (const p of points) b.extend(new k.LatLng(p.lat, p.lng));
  return b;
}

/** 원(반경 m)이 들어가는 범위. */
export function circleBounds(k: KakaoMaps, lat: number, lng: number, meters: number): KLatLngBounds {
  const dLat = meters / 111_320;
  const dLng = meters / (111_320 * Math.cos((lat * Math.PI) / 180));
  return new k.LatLngBounds(new k.LatLng(lat - dLat, lng - dLng), new k.LatLng(lat + dLat, lng + dLng));
}

/** 범위가 보이게 맞춘다. maxZoom보다 더 가까이 가지는 않는다. */
export function fitBounds(map: KMap, b: KLatLngBounds | null, padding = 0, maxZoom?: number): void {
  if (!b || b.isEmpty()) return;
  map.setBounds(b, padding, padding, padding, padding);
  if (maxZoom !== undefined && map.getLevel() < levelOf(maxZoom)) map.setLevel(levelOf(maxZoom));
}

export function fitJeju(k: KakaoMaps, map: KMap): void {
  map.setBounds(new k.LatLngBounds(new k.LatLng(JEJU_SW.lat, JEJU_SW.lng), new k.LatLng(JEJU_NE.lat, JEJU_NE.lng)));
}

/** 그 자리로 바로 옮긴다(움직임 없이). minZoom보다 멀리 보고 있으면 가까이. */
export function jumpTo(k: KakaoMaps, map: KMap, lat: number, lng: number, minZoom: number): void {
  if (map.getLevel() > levelOf(minZoom)) map.setLevel(levelOf(minZoom));
  map.setCenter(new k.LatLng(lat, lng));
}

/** 확대 수준에 따라 지도 상자에 map-far·map-near 표시(가격 표시 접기·주차장 글자, Leaflet과 같은 CSS). */
export function syncKakaoFarClass(map: KMap, el: HTMLElement): void {
  const zoom = zoomOf(map.getLevel());
  el.classList.toggle("map-far", zoom < PIN_DETAIL_ZOOM);
  el.classList.toggle("map-near", zoom >= PIN_LABEL_ZOOM);
}

export interface PopupOptions {
  /** 표시 위로 띄울 거리(px). */
  offset?: number;
  large?: boolean;
  /** 열 때 불러와 카드를 바꾼다(관광지 이용시간 등). */
  loadCard?: () => Promise<HTMLElement>;
}

/**
 * 지도 카드(팝업) 하나. Leaflet 팝업처럼 한 번에 하나만 열리고, 닫기(×)·지도 빈 곳 누르기로 닫는다.
 * 카드 내용은 popupCard가 만든 DOM(원천 글자는 textContent로만)을 그대로 넣는다.
 */
export class KakaoPopup {
  private overlay: KCustomOverlay | null = null;
  private seq = 0;
  constructor(
    private readonly k: KakaoMaps,
    private readonly map: KMap,
    private readonly box: HTMLElement,
  ) {}

  get isOpen(): boolean {
    return this.overlay !== null;
  }

  open(lat: number, lng: number, content: HTMLElement, opts: PopupOptions = {}): void {
    this.close();
    const id = ++this.seq;
    const wrap = document.createElement("div");
    wrap.className = `kmap-popup-wrap${opts.large ? " kmap-popup-lg" : ""}`;
    wrap.style.paddingBottom = `${(opts.offset ?? 8) + 10}px`;
    const card = document.createElement("div");
    card.className = "kmap-popup";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "kmap-popup-close";
    close.setAttribute("aria-label", "카드 닫기");
    close.textContent = "×";
    close.addEventListener("click", () => this.close());
    const body = document.createElement("div");
    body.className = "kmap-popup-content";
    if (opts.large || opts.loadCard) body.style.maxHeight = `${Math.max(260, this.box.clientHeight - 100)}px`;
    body.append(content);
    card.append(close, body);
    wrap.append(card);
    this.overlay = new this.k.CustomOverlay({ content: wrap, position: new this.k.LatLng(lat, lng), xAnchor: 0.5, yAnchor: 1, zIndex: 3000, clickable: true, map: this.map });
    if (opts.large) this.box.classList.add("popup-lg-open");
    this.fit(id, wrap);
    if (opts.loadCard)
      void opts.loadCard().then((el) => {
        if (id !== this.seq || !this.overlay) return;
        body.replaceChildren(el);
        this.fit(id, wrap);
      });
  }

  close(): void {
    this.seq += 1;
    this.overlay?.setMap(null);
    this.overlay = null;
    this.box.classList.remove("popup-lg-open");
  }

  /** 카드 위·옆이 지도 밖으로 잘리면 지도를 옮긴다(Leaflet 쪽 fitTop과 같은 규칙). */
  private fit(id: number, el: HTMLElement): void {
    setTimeout(() => {
      if (id !== this.seq) return;
      const box = this.box.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const top = r.top - box.top;
      const left = r.left - box.left;
      const right = box.right - r.right;
      const dx = left < 10 ? left - 10 : right < 10 ? 10 - right : 0;
      const dy = top < 10 ? top - 10 : 0;
      if (dx || dy) this.map.panBy(dx, dy);
    }, 300);
  }
}

/** 화면 좌표로 바꾸는 함수(그리는 캔버스 기준). */
export type Project = (lat: number, lng: number) => { x: number; y: number };

/** 캔버스에 그릴 것. 화면 안(여유 포함) 범위와 확대 수준을 받는다. */
export interface CanvasDrawer {
  draw(ctx: CanvasRenderingContext2D, project: Project, view: { south: number; west: number; north: number; east: number; zoom: number }): void;
  /** 캔버스 좌표 (x, y)를 눌렀을 때. 처리했으면 true. */
  hit(x: number, y: number): boolean;
}

export interface CanvasLayer {
  redraw(): void;
  /** 지도 위 한 점을 눌렀을 때. 처리했으면 true. */
  hitAt(ll: KLatLng): boolean;
  remove(): void;
}

/**
 * 점·선 수천 개를 그리는 캔버스 층(3.(a)·4.(a)). 카카오 지도 위 칸(overlayLayer)에 붙여 끌 때 함께 움직이고,
 * 멈추면(idle) 화면 안(가로·세로 반 화면 여유)만 다시 그린다. 좌표 변환은 매번 화면 세 꼭짓점으로 맞춘 1차식이라 빠르다
 * (제주 정도 넓이에서는 오차가 1px 안팎). 누르기는 지도 click에서 hitAt으로 넘겨받는다.
 */
export function addCanvasLayer(k: KakaoMaps, map: KMap, drawer: CanvasDrawer, zIndex: number): CanvasLayer {
  const canvas = document.createElement("canvas");
  canvas.className = "kmap-canvas";
  canvas.style.position = "absolute";
  canvas.style.pointerEvents = "none";
  canvas.style.zIndex = String(zIndex);
  const overlay = new k.AbstractOverlay() as KAbstractOverlay & { onAdd: () => void; draw: () => void; onRemove: () => void };
  let project: Project | null = null;
  const draw = () => {
    if (!overlay.getMap()) return;
    const proj = overlay.getProjection();
    const node = map.getNode();
    const w = node.clientWidth;
    const h = node.clientHeight;
    if (!w || !h) return;
    const padX = Math.round(w / 2);
    const padY = Math.round(h / 2);
    const b = map.getBounds();
    const sw = b.getSouthWest();
    const ne = b.getNorthEast();
    const nw = new k.LatLng(ne.getLat(), sw.getLng());
    // 패널 좌표와 지도 상자 좌표의 차이(끌면 패널이 움직인다).
    const pc = proj.pointFromCoords(nw);
    const cc = proj.containerPointFromCoords(nw);
    const originX = pc.x - cc.x - padX;
    const originY = pc.y - cc.y - padY;
    const p0 = proj.pointFromCoords(nw);
    const pE = proj.pointFromCoords(new k.LatLng(ne.getLat(), ne.getLng()));
    const pS = proj.pointFromCoords(sw);
    const dLng = ne.getLng() - sw.getLng() || 1e-9;
    const dLat = sw.getLat() - ne.getLat() || -1e-9;
    const lat0 = ne.getLat();
    const lng0 = sw.getLng();
    const ax = (pE.x - p0.x) / dLng;
    const ay = (pE.y - p0.y) / dLng;
    const bx = (pS.x - p0.x) / dLat;
    const by = (pS.y - p0.y) / dLat;
    project = (lat, lng) => ({ x: p0.x - originX + ax * (lng - lng0) + bx * (lat - lat0), y: p0.y - originY + ay * (lng - lng0) + by * (lat - lat0) });
    const cw = w + padX * 2;
    const ch = h + padY * 2;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(cw * ratio);
    canvas.height = Math.round(ch * ratio);
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${ch}px`;
    canvas.style.left = `${originX}px`;
    canvas.style.top = `${originY}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    const latPad = (ne.getLat() - sw.getLat()) / 2;
    const lngPad = (ne.getLng() - sw.getLng()) / 2;
    drawer.draw(ctx, project, { south: sw.getLat() - latPad, north: ne.getLat() + latPad, west: sw.getLng() - lngPad, east: ne.getLng() + lngPad, zoom: zoomOf(map.getLevel()) });
  };
  overlay.onAdd = () => overlay.getPanels().overlayLayer.append(canvas);
  overlay.onRemove = () => canvas.remove();
  overlay.draw = draw;
  overlay.setMap(map);
  k.event.addListener(map, "idle", draw);
  return {
    redraw: draw,
    hitAt: (ll) => {
      if (!project) return false;
      const p = project(ll.getLat(), ll.getLng());
      return drawer.hit(p.x, p.y);
    },
    remove: () => {
      k.event.removeListener(map, "idle", draw);
      overlay.setMap(null);
    },
  };
}

const inView = (v: { south: number; west: number; north: number; east: number }, lat: number, lng: number) => lat >= v.south && lat <= v.north && lng >= v.west && lng <= v.east;

/** 시설물 점(캔버스, 화면 안만). onOpen은 눌린 점. */
export function facilityDrawer(points: FacilityPoint[], onOpen: (p: FacilityPoint) => void): CanvasDrawer {
  let drawn: { p: FacilityPoint; x: number; y: number; r: number }[] = [];
  return {
    draw(ctx, project, view) {
      drawn = [];
      for (const p of points) {
        if (p.pin || !inView(view, p.lat, p.lng)) continue;
        const style = FACILITY_STYLE[p.type];
        const r = style.stroke ? 6 : 5;
        const { x, y } = project(p.lat, p.lng);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = style.color;
        ctx.fill();
        ctx.lineWidth = style.stroke ? 2 : 1.5;
        ctx.strokeStyle = style.stroke ?? "#fff";
        ctx.stroke();
        drawn.push({ p, x, y, r });
      }
    },
    hit(x, y) {
      // 위에 그린 것부터, 반지름 + 6px 안(손가락 여유).
      for (let i = drawn.length - 1; i >= 0; i -= 1) {
        const d = drawn[i];
        if (d && (d.x - x) ** 2 + (d.y - y) ** 2 <= (d.r + 6) ** 2) {
          onOpen(d.p);
          return true;
        }
      }
      return false;
    },
  };
}

/** 점에서 선분까지 거리의 제곱. */
function segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2;
}

/**
 * 구간 속도 선(캔버스, 4.(a)). 화면 안에 걸친 구간만, 앞 점과 1.5px도 안 떨어진 점은 건너뛰어(멀리 볼 때 단순하게) 그린다.
 * 같은 색·두께·투명도끼리 한 번에 그린다. 강조 구간은 굵게 맨 위. onOpen은 눌린 구간과 누른 곳.
 */
export function speedLineDrawer(lines: SpeedLine[], highlightIds: Set<string>, onOpen: (line: SpeedLine, x: number, y: number) => void): CanvasDrawer {
  const boxes = lines.map((l) => {
    let s = 90;
    let n = -90;
    let w = 180;
    let e = -180;
    for (const p of l.points) {
      s = Math.min(s, p.lat);
      n = Math.max(n, p.lat);
      w = Math.min(w, p.lng);
      e = Math.max(e, p.lng);
    }
    return { line: l, s, n, w, e, top: highlightIds.has(l.id) };
  });
  const ordered = [...boxes].sort((a, b) => Number(a.top) - Number(b.top));
  let drawn: { line: SpeedLine; pts: number[]; width: number }[] = [];
  return {
    draw(ctx, project, view) {
      drawn = [];
      const groups = new Map<string, { color: string; width: number; alpha: number; paths: number[][] }>();
      const order: string[] = [];
      for (const b of ordered) {
        if (b.n < view.south || b.s > view.north || b.e < view.west || b.w > view.east) continue;
        const width = speedLineWeight(view.zoom, b.top);
        const alpha = highlightIds.size > 0 && !b.top ? 0.35 : 0.9;
        const color = STATUS_STYLE[b.line.status].color;
        const pts: number[] = [];
        let lx = Infinity;
        let ly = Infinity;
        const last = b.line.points.length - 1;
        b.line.points.forEach((p, i) => {
          const { x, y } = project(p.lat, p.lng);
          if (i !== 0 && i !== last && (x - lx) ** 2 + (y - ly) ** 2 < 2.25) return;
          pts.push(x, y);
          lx = x;
          ly = y;
        });
        if (pts.length < 4) continue;
        // 강조 구간은 따로 묶어 맨 위에 그린다.
        const key = `${b.top ? 1 : 0}|${color}|${width}|${alpha}`;
        let g = groups.get(key);
        if (!g) {
          g = { color, width, alpha, paths: [] };
          groups.set(key, g);
          order.push(key);
        }
        g.paths.push(pts);
        drawn.push({ line: b.line, pts, width });
      }
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      order.sort((a, b) => Number(a[0]) - Number(b[0]));
      for (const key of order) {
        const g = groups.get(key);
        if (!g) continue;
        ctx.beginPath();
        for (const pts of g.paths) {
          ctx.moveTo(pts[0] ?? 0, pts[1] ?? 0);
          for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i] ?? 0, pts[i + 1] ?? 0);
        }
        ctx.globalAlpha = g.alpha;
        ctx.strokeStyle = g.color;
        ctx.lineWidth = g.width;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    },
    hit(x, y) {
      for (let i = drawn.length - 1; i >= 0; i -= 1) {
        const d = drawn[i];
        if (!d) continue;
        const tol = (d.width / 2 + 6) ** 2;
        for (let j = 2; j < d.pts.length; j += 2) {
          if (segDist2(x, y, d.pts[j - 2] ?? 0, d.pts[j - 1] ?? 0, d.pts[j] ?? 0, d.pts[j + 1] ?? 0) <= tol) {
            onOpen(d.line, x, y);
            return true;
          }
        }
      }
      return false;
    },
  };
}

/** DOM 동그라미 표시(사건·내 위치·출발·도착). 크기 0 상자 가운데에 그린다. */
export function dotElement(o: { radius: number; color: string; weight: number; fill: string; fillOpacity?: number; opacity?: number; className?: string; title?: string }): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "kmap-dot-wrap";
  const dot = document.createElement(o.title ? "button" : "div");
  dot.className = `kmap-dot${o.className ? ` ${o.className}` : ""}`;
  const size = o.radius * 2;
  dot.style.width = `${size}px`;
  dot.style.height = `${size}px`;
  dot.style.border = `${o.weight}px solid ${o.color}`;
  dot.style.backgroundColor = o.fill;
  dot.style.opacity = String(o.opacity ?? 1);
  if (o.fillOpacity !== undefined && o.fillOpacity < 1) dot.style.backgroundColor = hexAlpha(o.fill, o.fillOpacity);
  if (o.title) {
    (dot as HTMLButtonElement).type = "button";
    dot.title = o.title;
    dot.setAttribute("aria-label", o.title);
  }
  wrap.append(dot);
  return wrap;
}

function hexAlpha(hex: string, a: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  return `rgba(${parseInt(m[1] ?? "0", 16)}, ${parseInt(m[2] ?? "0", 16)}, ${parseInt(m[3] ?? "0", 16)}, ${a})`;
}

/** 크기 0 상자에 넣은 표시를 지도에 올린다. 누르면 onClick. */
export function addDomMarker(k: KakaoMaps, map: KMap, lat: number, lng: number, content: HTMLElement, opts: { zIndex?: number; onClick?: () => void } = {}): KCustomOverlay {
  if (opts.onClick) {
    const onClick = opts.onClick;
    content.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
    });
  }
  return new k.CustomOverlay({ content, position: new k.LatLng(lat, lng), xAnchor: 0, yAnchor: 0, zIndex: opts.zIndex ?? 1, clickable: Boolean(opts.onClick), map });
}

/** 주유소·주차장 가격 표시(Leaflet과 같은 DOM·CSS). */
export function pinElement(pin: NonNullable<FacilityPoint["pin"]>): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "gas-pin-wrap kmap-pin-wrap";
  wrap.append(gasPinElement(pin));
  return wrap;
}

/** 사건 점(DOM, 수십 곳). 지금 보는 지점은 노란 테두리로 크게 위에. 누르면 카드. 지금 보는 사건을 돌려준다. */
export function addKakaoIncidents(k: KakaoMaps, map: KMap, popup: KakaoPopup, incidents: TrafficIncident[], focus: IncidentFocus | null): { overlays: KCustomOverlay[]; current: TrafficIncident | undefined } {
  const overlays: KCustomOverlay[] = [];
  let current: TrafficIncident | undefined;
  for (const incident of incidents) {
    const inFocus = focus?.ids.includes(incident.id) ?? false;
    const isCurrent = incident.id === focus?.currentId;
    const faded = focus !== null && !inFocus;
    const el = dotElement({
      radius: isCurrent ? 13 : inFocus ? 10 : 8,
      color: isCurrent ? "#facc15" : "#fff",
      weight: isCurrent ? 4 : 2,
      fill: "#b91c1c",
      opacity: faded ? 0.5 : 1,
      className: `incident-marker${inFocus ? " incident-focus" : ""}${isCurrent ? " incident-current" : ""}`,
    });
    const open = () => popup.open(incident.location.lat, incident.location.lng, popupCard(incidentCard(incident)), { offset: isCurrent ? 13 : 8 });
    overlays.push(addDomMarker(k, map, incident.location.lat, incident.location.lng, el, { zIndex: isCurrent ? 900 : inFocus ? 800 : 700, onClick: open }));
    if (isCurrent) {
      current = incident;
      open();
    }
  }
  return { overlays, current };
}
