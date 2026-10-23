/**
 * 카카오 지도 JavaScript SDK(TASK-033). 키(VITE_KAKAO_MAP_KEY)는 카카오 개발자 콘솔에 등록한 사이트 도메인에서만 동작하는
 * 공개 키라 화면 코드에 들어가도 된다(로그·출력에는 남기지 않는다). 키가 없거나 SDK를 정해진 시간 안에 받지 못하면 null을 돌려주고
 * 지도는 Leaflet(브이월드)으로 그린다(2.(a)).
 */

/** 쓰는 부분만 적은 카카오 지도 형식. */
export interface KLatLng {
  getLat(): number;
  getLng(): number;
}
export interface KPoint {
  x: number;
  y: number;
}
export interface KLatLngBounds {
  extend(ll: KLatLng): void;
  contain(ll: KLatLng): boolean;
  isEmpty(): boolean;
  getSouthWest(): KLatLng;
  getNorthEast(): KLatLng;
}
export interface KProjection {
  pointFromCoords(ll: KLatLng): KPoint;
  containerPointFromCoords(ll: KLatLng): KPoint;
}
export interface KMap {
  setCenter(ll: KLatLng): void;
  getCenter(): KLatLng;
  setLevel(level: number, options?: { animate?: boolean | { duration: number }; anchor?: KLatLng }): void;
  getLevel(): number;
  getBounds(): KLatLngBounds;
  setBounds(b: KLatLngBounds, top?: number, right?: number, bottom?: number, left?: number): void;
  panBy(dx: number, dy: number): void;
  relayout(): void;
  setMapTypeId(id: number): void;
  addControl(control: unknown, position: number): void;
  getProjection(): KProjection;
  getNode(): HTMLElement;
}
export interface KOverlay {
  setMap(map: KMap | null): void;
}
export interface KCustomOverlay extends KOverlay {
  getPosition(): KLatLng;
  setPosition(ll: KLatLng): void;
  setContent(content: HTMLElement): void;
  setZIndex(z: number): void;
}
export interface KAbstractOverlay extends KOverlay {
  getPanels(): { overlayLayer: HTMLElement; floatPane: HTMLElement };
  getProjection(): KProjection;
  getMap(): KMap | null;
}
export interface KMouseEvent {
  latLng: KLatLng;
  point?: KPoint;
}

interface StrokeOptions {
  strokeWeight?: number;
  strokeColor?: string;
  strokeOpacity?: number;
  strokeStyle?: string;
  zIndex?: number;
}

export interface KakaoMaps {
  load(cb: () => void): void;
  LatLng: new (lat: number, lng: number) => KLatLng;
  LatLngBounds: new (sw?: KLatLng, ne?: KLatLng) => KLatLngBounds;
  Map: new (el: HTMLElement, options: { center: KLatLng; level: number }) => KMap;
  CustomOverlay: new (options: { content: HTMLElement; position: KLatLng; xAnchor?: number; yAnchor?: number; zIndex?: number; clickable?: boolean; map?: KMap }) => KCustomOverlay;
  Circle: new (options: StrokeOptions & { center: KLatLng; radius: number; fillColor?: string; fillOpacity?: number; map?: KMap }) => KOverlay;
  Polyline: new (options: StrokeOptions & { path: KLatLng[]; map?: KMap }) => KOverlay;
  AbstractOverlay: new () => KAbstractOverlay;
  ZoomControl: new () => unknown;
  MapTypeControl: new () => unknown;
  ControlPosition: { TOPRIGHT: number; RIGHT: number };
  MapTypeId: { ROADMAP: number; HYBRID: number };
  event: {
    addListener(target: unknown, type: string, handler: (e?: KMouseEvent) => void): void;
    removeListener(target: unknown, type: string, handler: (e?: KMouseEvent) => void): void;
  };
}

declare global {
  interface Window {
    kakao?: { maps?: KakaoMaps };
  }
}

/** SDK를 받고 준비될 때까지 기다리는 최대 시간. 도메인이 등록되지 않으면 준비 알림이 오지 않을 수 있다. */
export const KAKAO_LOAD_TIMEOUT_MS = 8000;

let pending: Promise<KakaoMaps | null> | null = null;
let ready: KakaoMaps | null | undefined;
/** 지도를 만든 뒤 바탕 그림을 받지 못했다(한도 초과 등). 이 화면에서는 다시 시도하지 않고 Leaflet으로 그린다. */
let dead = false;

export function kakaoMapKey(): string {
  return (import.meta.env.VITE_KAKAO_MAP_KEY ?? "").trim();
}

/** 이미 결과가 정해졌으면 그 값(준비된 SDK 또는 null), 아직이면 undefined. */
export function kakaoMapsNow(): KakaoMaps | null | undefined {
  if (dead || !kakaoMapKey()) return null;
  return ready;
}

/** 카카오 지도를 쓸 수 없다고 표시한다(바탕 그림 실패 등). */
export function markKakaoDead(): void {
  dead = true;
}

/** SDK를 한 번만 받는다(autoload=false 후 kakao.maps.load). 실패·시간 초과는 null. */
export function loadKakaoMaps(timeoutMs = KAKAO_LOAD_TIMEOUT_MS): Promise<KakaoMaps | null> {
  const key = kakaoMapKey();
  if (!key || dead) return Promise.resolve(null);
  if (pending) return pending;
  pending = new Promise<KakaoMaps | null>((resolve) => {
    let settled = false;
    const done = (v: KakaoMaps | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ready = v;
      resolve(v);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    const start = () => {
      const maps = window.kakao?.maps;
      if (!maps?.load) return done(null);
      try {
        maps.load(() => done(window.kakao?.maps ?? null));
      } catch {
        done(null);
      }
    };
    if (window.kakao?.maps?.load) return start();
    const script = document.createElement("script");
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&autoload=false`;
    script.async = true;
    script.onload = start;
    script.onerror = () => done(null);
    document.head.append(script);
  });
  return pending;
}

/** 테스트용: 받은 상태를 지운다. */
export function resetKakaoForTest(): void {
  pending = null;
  ready = undefined;
  dead = false;
}
