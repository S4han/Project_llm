import { useCallback, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Coordinate } from "../../../../shared/contracts/route";
import type { SpeedStatus, TrafficIncident } from "../../../../shared/contracts/traffic";
import { formatDuration } from "../routes/format";
import { FACILITY_STYLE, type FacilityKey } from "../traffic/facilityStyle";
import { INCIDENT_LABEL, STATUS_STYLE } from "../routes/trafficStyle";
import { formatKstTime } from "../trip/format";

export const toLatLng = (c: Coordinate): L.LatLngTuple => [c.lat, c.lng];

/** 지도에서 강조할 사건 묶음과 지금 확대해 보여 줄 사건. */
export interface IncidentFocus {
  label: string;
  ids: string[];
  currentId: string;
}

/** 이보다 멀리 보면(확대 수준이 작으면) 주유소·LPG 가격 표시를 상표 색 점으로 접는다(최저가 한 곳은 그대로, TASK-021 1.(a)). */
export const PIN_DETAIL_ZOOM = 14;

/** 이 이상 확대하면 동그라미로 그린 표시(주차장)에도 글자를 함께 보인다(TASK-024 1.(a)). */
export const PIN_LABEL_ZOOM = 17;

/** 확대 수준에 따라 지도 상자에 map-far·map-near 표시를 붙인다. 접기·글자 보이기는 CSS가 맡는다(표시를 다시 만들지 않음). */
export function syncFarClass(map: L.Map): void {
  const zoom = map.getZoom();
  map.getContainer().classList.toggle("map-far", zoom < PIN_DETAIL_ZOOM);
  map.getContainer().classList.toggle("map-near", zoom >= PIN_LABEL_ZOOM);
}

/** 사건 한 곳을 확대해 보여 줄 때의 확대 수준. 제주 ITS는 좌표 한 점만 준다. */
export const FOCUS_ZOOM = 16;

const OSM_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> 기여자';
const VWORLD_ATTRIBUTION = '&copy; <a href="https://www.vworld.kr">브이월드</a>(국토교통부)';

export type VworldLayer = "Base" | "Satellite" | "Hybrid";

/**
 * 브이월드 WMTS 바탕지도 주소. 기본(Base)·위성(Satellite, jpeg)·이름 겹침(Hybrid, 투명 png).
 * 흰색(white)은 건물·장소 이름이 거의 없어 기본으로 바꿨다(TASK-020 점검).
 * 지도용 키는 서비스 URL(도메인)에 묶인 공개 키라 화면 코드에 들어가도 된다.
 */
export function vworldTileUrl(key: string, layer: VworldLayer = "Base"): string {
  const ext = layer === "Satellite" ? "jpeg" : "png";
  return `https://api.vworld.kr/req/wmts/1.0.0/${encodeURIComponent(key)}/${layer}/{z}/{y}/{x}.${ext}`;
}

/**
 * 바탕지도(TASK-020). 지도용 키(VITE_VWORLD_MAP_KEY)가 있으면 브이월드 기본(Base)과 오른쪽 위 "일반 / 위성" 선택,
 * 없으면 OpenStreetMap. 위성은 위성 사진 위에 이름(Hybrid)을 겹친다.
 * 브이월드 기본 타일을 한 장도 못 받고 4장 실패하면(키·도메인 불일치 등) 선택 버튼을 없애고 OpenStreetMap으로 바꾼다.
 * OpenStreetMap까지 못 받으면 onFailed.
 */
export function addBaseTiles(map: L.Map, vworldKey: string | undefined, onFailed: () => void): void {
  const watch = (tiles: L.TileLayer, onDead: () => void) => {
    let loaded = 0;
    let errors = 0;
    let dead = false;
    tiles.on("tileload", () => (loaded += 1));
    tiles.on("tileerror", () => {
      errors += 1;
      if (!dead && loaded === 0 && errors >= 4) {
        dead = true;
        onDead();
      }
    });
    return tiles;
  };
  const addOsm = () => watch(L.tileLayer(OSM_URL, { maxZoom: 18, attribution: OSM_ATTRIBUTION }), onFailed).addTo(map);
  const key = vworldKey?.trim();
  if (!key) {
    addOsm();
    return;
  }
  const vworld = (layer: VworldLayer) => L.tileLayer(vworldTileUrl(key, layer), { maxZoom: 18, attribution: VWORLD_ATTRIBUTION });
  const satellite = L.layerGroup([vworld("Satellite"), vworld("Hybrid")]);
  const base = vworld("Base");
  const picker = L.control.layers({ 일반: base, 위성: satellite }, undefined, { collapsed: false, position: "topright" });
  watch(base, () => {
    if (!map.hasLayer(base)) return; // 위성을 보는 중이면 그대로 둔다.
    map.removeLayer(base);
    picker.remove();
    addOsm();
  }).addTo(map);
  picker.addTo(map);
}

/**
 * 브이월드(키 없으면 OSM) 배경의 Leaflet 지도. 컨테이너가 붙을 때 만들고 떨어질 때 지운다(콜백 ref 정리 함수).
 * 그릴 것은 layer에 넣는다. 지도를 만들지 못하면 failed, 배경 타일을 못 받으면 tilesFailed.
 */
export function useLeafletMap() {
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [tilesFailed, setTilesFailed] = useState(false);

  const attach = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    let map: L.Map;
    try {
      map = L.map(el, { zoomControl: true, attributionControl: true });
      addBaseTiles(map, import.meta.env.VITE_VWORLD_MAP_KEY, () => setTilesFailed(true));
      map.on("zoomend", () => syncFarClass(map));
      layerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      setMapReady(true);
    } catch {
      setFailed(true);
      return;
    }
    // 지도 상자 크기가 바뀌면(검색 뒤 지도를 키울 때 등) Leaflet에 알려 바탕 그림을 새 크기로 채운다.
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => map.invalidateSize());
    resize?.observe(el);
    return () => {
      resize?.disconnect();
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      setMapReady(false);
    };
  }, []);

  return { attach, mapRef, layerRef, mapReady, failed, tilesFailed };
}

/**
 * 제주 ITS 교통정보센터 지도 화면(공식 사이트, CCTV 메뉴가 있는 화면). CCTV 영상 API가 없고
 * 카메라를 골라도 주소가 바뀌지 않아(사용자 확인) 카메라별 링크는 만들 수 없다(TASK-014).
 */
export const JEJU_ITS_SITE = "https://www.jejuits.go.kr/main/mainView.do";

/**
 * 카드형 팝업 내용(TASK-017, 지도의 모든 팝업). 원천 글자(도로명·설치 위치 등)는 HTML로 해석하지 않도록 모두 textContent로만 넣는다.
 */
export interface PopupCard {
  /** 머리 표시(예: "P"). color는 배경색, textColor는 글자색(기본 흰색). */
  badge: { text: string; color: string; textColor?: string };
  /** 작은 분류 이름(예: "주차장"). */
  kicker: string;
  title: string;
  chips: string[];
  /** 눈에 띄게 보일 숫자 하나(예: 48 · "면"). */
  stat?: { value: string; unit: string };
  rows: { label: string; lines: string[] }[];
  /** 맨 아래 흐린 글(주소 등). */
  footer?: string;
  /** 아래 꽉 찬 버튼. 이 서비스 안 화면은 같은 창, external이면 새 창(opener 차단). */
  action?: { href: string; label: string; external?: boolean };
  /** 제목 아래 사진 한 장과 출처(관광지, TASK-026). https 주소만 그린다. */
  image?: { src: string; alt: string; credit: string };
  /** 한눈에 볼 큰 칸(관광지 주차·주변 주차장·쉬는날, TASK-026 점검). tone은 색(좋음 초록·나쁨 빨강·보통 회색). */
  tiles?: { label: string; value: string; sub?: string; tone: "good" | "bad" | "neutral"; action?: { label: string; onClick: () => void } }[];
  /** lg면 넓고 글자가 큰 카드(관광지). */
  size?: "lg";
  /** 아래 작은 바깥 링크(새 창, opener 차단). 예: 비짓제주 상세(TASK-028). */
  links?: { href: string; label: string }[];
}

export function popupCard(card: PopupCard): HTMLElement {
  const el = (tag: string, className: string, text?: string) => {
    const e = document.createElement(tag);
    e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const root = el("div", card.size === "lg" ? "popup-card popup-card-lg" : "popup-card");
  const head = el("div", "popup-card-head");
  const badge = el("span", "popup-card-badge", card.badge.text);
  badge.style.backgroundColor = card.badge.color;
  if (card.badge.textColor) badge.style.color = card.badge.textColor;
  badge.setAttribute("aria-hidden", "true");
  const titles = el("div", "popup-card-titles");
  titles.append(el("p", "popup-card-kicker", card.kicker), el("p", "popup-card-title", card.title));
  head.append(badge, titles);
  root.append(head);
  if (card.image && card.image.src.startsWith("https://")) {
    const fig = el("figure", "popup-card-photo");
    const img = el("img", "") as HTMLImageElement;
    img.src = card.image.src;
    img.alt = card.image.alt;
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    fig.append(img, el("figcaption", "", card.image.credit));
    root.append(fig);
  }
  if (card.tiles?.length) {
    const grid = el("div", "popup-card-tiles");
    for (const t of card.tiles) {
      // 누를 수 있는 칸(관광지 주변 주차장 지도에 보기, TASK-027)은 버튼으로. 글자는 textContent로만.
      const tile = el(t.action ? "button" : "div", `popup-card-tile tone-${t.tone}${t.action ? " popup-card-tile-action" : ""}`);
      tile.append(el("span", "popup-card-tile-label", t.label), el("strong", "popup-card-tile-value", t.value));
      if (t.sub) tile.append(el("span", "popup-card-tile-sub", t.sub));
      if (t.action) {
        const action = t.action;
        (tile as HTMLButtonElement).type = "button";
        tile.append(el("span", "popup-card-tile-go", action.label));
        tile.addEventListener("click", () => action.onClick());
      }
      grid.append(tile);
    }
    root.append(grid);
  }
  if (card.chips.length || card.stat) {
    const meta = el("div", "popup-card-meta");
    for (const c of card.chips) meta.append(el("span", "popup-card-chip", c));
    if (card.stat) {
      const stat = el("span", "popup-card-stat");
      stat.append(el("strong", "", card.stat.value), document.createTextNode(card.stat.unit));
      meta.append(stat);
    }
    root.append(meta);
  }
  if (card.rows.length) {
    const dl = el("dl", "popup-card-rows");
    for (const r of card.rows) {
      const dd = el("dd", "");
      for (const line of r.lines) dd.append(el("span", "popup-card-line", line));
      dl.append(el("dt", "", r.label), dd);
    }
    root.append(dl);
  }
  if (card.footer) root.append(el("p", "popup-card-footer", card.footer));
  for (const l of card.links ?? []) {
    if (!/^https:\/\//.test(l.href)) continue;
    const a = el("a", "popup-card-link", l.label) as HTMLAnchorElement;
    a.href = l.href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    root.append(a);
  }
  if (card.action) {
    const a = el("a", "popup-card-action", card.action.label) as HTMLAnchorElement;
    a.href = card.action.href;
    if (card.action.external) {
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    }
    root.append(a);
  }
  return root;
}

const INCIDENT_MARK: Record<TrafficIncident["kind"], string> = { event: "!", closure: "✕", roadwork: "공", weather: "기" };

/** 사건 카드: 종류 표시·내용, 원천(또는 조회) 시각. 원천 시각이 없으면 상세가 없다고 안내. */
export function incidentCard(i: TrafficIncident): PopupCard {
  return {
    badge: { text: INCIDENT_MARK[i.kind], color: "#b91c1c" },
    kicker: `${INCIDENT_LABEL[i.kind]} · ${i.source === "mock" ? "모의 데이터" : "제주 ITS 감지"}`,
    title: i.description || INCIDENT_LABEL[i.kind],
    chips: [],
    rows: [{ label: i.sourceTime ? "원천" : "조회", lines: [formatKstTime(i.sourceTime ?? i.observedAt)] }],
    footer: i.sourceTime ? undefined : "발생 시각과 상세는 제공되지 않습니다.",
  };
}

/** 도로 소통 선 카드: 상태 색 표시·도로명, 평균속도 강조, 구간(A → B)·통행 시간. */
export function speedLineCard(line: SpeedLine, observedAt: string | null): PopupCard {
  const st = STATUS_STYLE[line.status];
  const section = line.from && line.to && line.from !== line.to ? `${line.from} → ${line.to}` : line.from || line.to || "";
  return {
    badge: { text: st.label.slice(0, 1), color: st.color },
    kicker: `도로 소통 · ${st.label}`,
    title: line.name || "도로명 없음",
    chips: [st.label],
    stat: { value: String(line.kmh), unit: "km/h" },
    rows: [...(section ? [{ label: "구간", lines: [section] }] : []), { label: "통행", lines: [formatDuration(line.travelSeconds)] }],
    footer: observedAt ? `${formatKstTime(observedAt)} 기준 · 제주 ITS 평균속도` : undefined,
  };
}

/**
 * 사건 점을 그린다. 강조 중인 묶음은 크게, 지금 보는 지점은 노란 테두리로 가장 크게 위에, 나머지는 흐리게.
 * 점을 누르면 설명 팝업. 지금 보는 지점의 사건을 돌려준다(확대 위치용).
 */
export function addIncidentMarkers(layer: L.LayerGroup, incidents: TrafficIncident[], focus: IncidentFocus | null): TrafficIncident | undefined {
  const ordered = [...incidents].sort((a, b) => Number(a.id === focus?.currentId) - Number(b.id === focus?.currentId));
  for (const incident of ordered) {
    const inFocus = focus?.ids.includes(incident.id) ?? false;
    const current = incident.id === focus?.currentId;
    const faded = focus !== null && !inFocus;
    const marker = L.circleMarker(toLatLng(incident.location), {
      radius: current ? 13 : inFocus ? 10 : 8,
      color: current ? "#facc15" : "#fff",
      weight: current ? 4 : 2,
      fillColor: "#b91c1c",
      fillOpacity: faded ? 0.3 : 1,
      opacity: faded ? 0.5 : 1,
      className: `incident-marker${inFocus ? " incident-focus" : ""}${current ? " incident-current" : ""}`,
    });
    marker.bindPopup(popupCard(incidentCard(incident)));
    marker.addTo(layer);
    if (current) marker.openPopup();
  }
  return incidents.find((i) => i.id === focus?.currentId);
}

let canvasOk: boolean | undefined;
/** 캔버스로 그릴 수 있는지(그릴 수 없는 환경에서는 SVG로 그린다). */
function canvasSupported(): boolean {
  if (canvasOk === undefined) {
    try {
      canvasOk = Boolean(document.createElement("canvas").getContext("2d"));
    } catch {
      canvasOk = false;
    }
  }
  return canvasOk;
}

/** 속도를 입힌 구간 하나(TASK-012). */
export interface SpeedLine {
  id: string;
  name: string;
  points: Coordinate[];
  kmh: number;
  travelSeconds: number;
  status: SpeedStatus;
  /** 구간 시작·끝 지점 이름(TASK-015). 모르면 "" 또는 없음. */
  from?: string;
  to?: string;
}

/** 확대 수준에 따른 구간 선 두께. 섬 전체(9~10)에서는 가늘게 그려 선이 뭉쳐 보이지 않게 한다(TASK-012 "3. (a)"). */
export function speedLineWeight(zoom: number, highlighted: boolean): number {
  const base = zoom <= 10 ? 1.5 : zoom <= 11 ? 2 : zoom <= 13 ? 3 : 4;
  return highlighted ? base + 4 : base;
}

/**
 * 구간 속도 선을 그린다. 수천 개라 SVG 대신 캔버스로 그리고, 사건 점보다 아래 칸(pane)에 둔다.
 * 강조 구간(highlightIds)은 굵게 맨 위에. 선을 누르면 "도로명 · 평균 34km/h · 통행 2분 · HH:MM 기준" 팝업.
 * 확대 수준이 바뀌면 updateSpeedLineWeights로 두께만 바꾼다.
 */
export function addSpeedLines(map: L.Map, layer: L.LayerGroup, lines: SpeedLine[], observedAt: string | null, highlightIds: Set<string> = new Set()): L.Polyline[] {
  if (!map.getPane("speeds")) map.createPane("speeds").style.zIndex = "350";
  const renderer = canvasSupported() ? L.canvas({ pane: "speeds", padding: 0.5, tolerance: 6 }) : L.svg({ pane: "speeds" });
  const zoom = map.getZoom() || 10;
  const ordered = [...lines].sort((a, b) => Number(highlightIds.has(a.id)) - Number(highlightIds.has(b.id)));
  return ordered.map((line) => {
    const highlighted = highlightIds.has(line.id);
    const pl = L.polyline(line.points.map(toLatLng), {
      renderer,
      pane: "speeds",
      color: STATUS_STYLE[line.status].color,
      weight: speedLineWeight(zoom, highlighted),
      opacity: highlightIds.size > 0 && !highlighted ? 0.35 : 0.9,
    });
    (pl as L.Polyline & { highlighted?: boolean }).highlighted = highlighted;
    pl.bindPopup(() => popupCard(speedLineCard(line, observedAt))).addTo(layer);
    return pl;
  });
}

export function updateSpeedLineWeights(map: L.Map, polylines: L.Polyline[]) {
  const zoom = map.getZoom();
  for (const pl of polylines) pl.setStyle({ weight: speedLineWeight(zoom, Boolean((pl as L.Polyline & { highlighted?: boolean }).highlighted)) });
}

/** 지도에 찍을 교통시설물 하나(TASK-013). */
export interface FacilityPoint {
  id: string;
  type: FacilityKey;
  name: string;
  model: string;
  /** 있으면 이 카드로(주정차 단속·주차장·주유소). 없으면 제주 ITS 시설물 카드. */
  card?: PopupCard;
  /** 있으면 팝업을 열 때 불러와 카드를 바꾼다(관광지 이용시간·주차, TASK-026). 그동안은 card를 보인다. */
  loadCard?: () => Promise<PopupCard>;
  /** 있으면 card 대신 팝업을 열 때 만든다(관광지 1,400곳을 미리 만들지 않기 위해, TASK-031). */
  cardFn?: () => PopupCard;
  /** 큰 카드(size lg)인지. cardFn을 쓰면 미리 알 수 없어 따로 준다. */
  large?: boolean;
  /**
   * 있으면 점 대신 상표 색 가격 표시(주유소, TASK-018). low면 최저가 강조. fold면 멀리 볼 때 작은 점으로 접는다(TASK-021).
   * dot이면 평소에는 표시 글자(mark)만 든 색 동그라미, 아주 크게 확대했을 때만 글자를 함께(주차장, TASK-024). top이면 다른 표시보다 위에.
   */
  pin?: { mark: string; price: string | null; color: string; textColor?: string; low: boolean; fold?: boolean; dot?: boolean; top?: boolean };
  lat: number;
  lng: number;
}

/** 제주 ITS 시설물 카드: 유형 표시·설치 위치·모델. CCTV·웹카메라는 영상 API가 없고 사이트에 카메라별 주소도 없어
 * (영상은 사이트 안 팝업) 공식 사이트 지도 화면으로 연결하고 찾는 방법을 안내한다(TASK-014). */
export function facilityCard(p: FacilityPoint): PopupCard {
  const style = FACILITY_STYLE[p.type];
  const video = p.type === "FTY02" || p.type === "FTY03";
  return {
    badge: { text: style.mark, color: style.markBg ?? style.color, textColor: style.markFg },
    kicker: style.label,
    title: p.name || "위치 이름 없음",
    chips: [],
    rows: p.model ? [{ label: "모델", lines: [p.model] }] : [],
    footer: video ? `영상 보기: 사이트 왼쪽 'CCTV' 메뉴 → 지도에서 '${p.name || "같은 위치"}' 카메라 선택` : "제주 ITS 교통시설물",
    action: video ? { href: JEJU_ITS_SITE, label: "제주 ITS 교통정보센터 열기 ↗", external: true } : undefined,
  };
}

/** 주유소 가격 표시: 상표 색 바탕에 "SK 1,867", 최저가는 금색 테두리와 "최저". 아래 꼭짓점이 위치. */
function gasPinIcon(pin: NonNullable<FacilityPoint["pin"]>): L.DivIcon {
  const root = document.createElement("div");
  root.className = `gas-pin${pin.low ? " gas-pin-low" : pin.fold ? " gas-pin-fold" : ""}${pin.dot ? " gas-pin-dot" : ""}`;
  root.style.backgroundColor = pin.color;
  root.style.color = pin.textColor ?? "#fff";
  root.style.setProperty("--pin-color", pin.color);
  const mark = document.createElement("span");
  mark.className = "gas-pin-mark";
  mark.textContent = pin.mark;
  root.append(mark);
  if (pin.price) {
    const price = document.createElement("strong");
    price.textContent = pin.price;
    root.append(price);
  }
  if (pin.low) {
    const low = document.createElement("span");
    low.className = "gas-pin-tag";
    low.textContent = "최저";
    root.append(low);
  }
  return L.divIcon({ html: root, className: "gas-pin-wrap", iconSize: [0, 0] });
}

/**
 * 시설물 점을 그리는 캔버스는 지도마다 하나만 만들어 다시 쓴다. 점을 다시 그릴 때마다 새로 만들면
 * 빈 캔버스가 칸에 쌓여 메모리를 쓰고 움직일 때마다 함께 다시 그려진다(TASK-032 점검).
 */
const facilityRenderers = new WeakMap<L.Map, L.Renderer>();
function facilityRenderer(map: L.Map): L.Renderer {
  let r = facilityRenderers.get(map);
  if (!r) {
    r = canvasSupported() ? L.canvas({ pane: "facilities", padding: 0.5, tolerance: 6 }) : L.svg({ pane: "facilities" });
    facilityRenderers.set(map, r);
  }
  return r;
}

/** 교통시설물 점(유형별 색). 수백~수천 개라 캔버스로, 구간 선 위·사건 점 아래 칸에 그린다. 누르면 카드 팝업. */
/** 점을 그리고 ID → 표시를 돌려준다(목록에서 고른 주유소의 카드를 여는 데 쓴다, TASK-018). */
export function addFacilityMarkers(map: L.Map, layer: L.LayerGroup, points: FacilityPoint[]): Map<string, L.Marker | L.CircleMarker> {
  const byId = new Map<string, L.Marker | L.CircleMarker>();
  if (!map.getPane("facilities")) map.createPane("facilities").style.zIndex = "380";
  const renderer = facilityRenderer(map);
  for (const p of points) {
    const style = FACILITY_STYLE[p.type];
    const large = p.large ?? p.card?.size === "lg";
    const m: L.Marker | L.CircleMarker = p.pin
      ? // 주유소: 반경 안 수십 곳이라 DOM 표시로 그린다. 글자는 고정 상표 표시와 숫자뿐(원천 이름은 카드에서만 textContent로).
        L.marker([p.lat, p.lng], { icon: gasPinIcon(p.pin), keyboard: false, title: p.name, zIndexOffset: p.pin.low ? 1000 : p.type === "TOUR" ? 800 : p.pin.top ? 500 : 0 })
      : // 점이 수천 개라 캔버스로, 구간 선 위·사건 점 아래 칸에 그린다.
        L.circleMarker([p.lat, p.lng], { renderer, pane: "facilities", radius: style.stroke ? 6 : 5, color: style.stroke ?? "#fff", weight: style.stroke ? 2 : 1.5, fillColor: style.color, fillOpacity: 1 });
    // 카드는 누를 때 만든다. 큰 카드(관광지·숙소)는 지도 폭·높이에 맞춰 넓고 길게, 넘치면 안에서 넘긴다(TASK-026 점검: 위가 잘림).
    // 값이 없는 옵션은 아예 넘기지 않는다. offset: undefined는 Leaflet 기본값을 지워 팝업 위치 계산이 깨진다(TASK-031 점검: 점을 눌러도 카드가 안 열림).
    const options: L.PopupOptions = {};
    if (p.pin) options.offset = p.pin.dot ? [0, -8] : [0, -30];
    if (large) options.maxWidth = 360;
    if (large || p.loadCard) options.maxHeight = Math.max(260, map.getSize().y - 100);
    m.bindPopup(() => popupCard(p.cardFn?.() ?? p.card ?? facilityCard(p)), options).addTo(layer);
    // 카드 위(또는 옆)가 지도 밖으로 잘리면 지도를 옮긴다. Leaflet 자동 이동은 열 때 이동 직후의 맞춤을 건너뛰고
    // 목록에서 고를 때의 화면 이동과 겹치므로, 움직임이 끝난 뒤(0.3초) 직접 맞춘다.
    const fitTop = () =>
      setTimeout(() => {
        const el = m.isPopupOpen() ? m.getPopup()?.getElement() : undefined;
        if (!el) return;
        const box = map.getContainer().getBoundingClientRect();
        const r = el.getBoundingClientRect();
        const top = r.top - box.top;
        // 왼쪽·오른쪽도 잘리면 맞춘다(관광 검색: 지도 가장자리 관광지를 목록에서 고를 때, TASK-031 점검).
        const left = r.left - box.left;
        const right = box.right - r.right;
        const dx = left < 10 ? left - 10 : right < 10 ? 10 - right : 0;
        const dy = top < 10 ? top - 10 : 0;
        if (dx || dy) map.panBy([dx, dy]);
      }, 300);
    if (large) {
      // 큰 카드가 열려 있는 동안은 지도 위 버튼(확대·제주 전체)을 감춰 카드를 가리지 않게 한다.
      m.on("popupopen", () => {
        map.getContainer().classList.add("popup-lg-open");
        fitTop();
      });
      m.on("popupclose", () => map.getContainer().classList.remove("popup-lg-open"));
    }
    const load = p.loadCard;
    if (load) {
      m.on("popupopen", () =>
        void load().then((card) => {
          if (!m.isPopupOpen()) return;
          m.setPopupContent(popupCard(card));
          fitTop();
        }),
      );
    }
    byId.set(p.id, m);
  }
  return byId;
}
