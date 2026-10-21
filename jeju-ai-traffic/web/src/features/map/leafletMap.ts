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

/** 사건 한 곳을 확대해 보여 줄 때의 확대 수준. 제주 ITS는 좌표 한 점만 준다. */
export const FOCUS_ZOOM = 16;

/**
 * OSM 배경의 Leaflet 지도. 컨테이너가 붙을 때 만들고 떨어질 때 지운다(콜백 ref 정리 함수).
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
      const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> 기여자',
      });
      let loaded = 0;
      let errors = 0;
      tiles.on("tileload", () => (loaded += 1));
      tiles.on("tileerror", () => {
        errors += 1;
        if (loaded === 0 && errors >= 4) setTilesFailed(true);
      });
      tiles.addTo(map);
      layerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      setMapReady(true);
    } catch {
      setFailed(true);
      return;
    }
    return () => {
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
}

export function popupCard(card: PopupCard): HTMLElement {
  const el = (tag: string, className: string, text?: string) => {
    const e = document.createElement(tag);
    e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const root = el("div", "popup-card");
  const head = el("div", "popup-card-head");
  const badge = el("span", "popup-card-badge", card.badge.text);
  badge.style.backgroundColor = card.badge.color;
  if (card.badge.textColor) badge.style.color = card.badge.textColor;
  badge.setAttribute("aria-hidden", "true");
  const titles = el("div", "popup-card-titles");
  titles.append(el("p", "popup-card-kicker", card.kicker), el("p", "popup-card-title", card.title));
  head.append(badge, titles);
  root.append(head);
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
  /** 있으면 이 카드로(주정차 단속·주차장). 없으면 제주 ITS 시설물 카드. */
  card?: PopupCard;
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

/** 교통시설물 점(유형별 색). 수백~수천 개라 캔버스로, 구간 선 위·사건 점 아래 칸에 그린다. 누르면 카드 팝업. */
export function addFacilityMarkers(map: L.Map, layer: L.LayerGroup, points: FacilityPoint[]) {
  if (!map.getPane("facilities")) map.createPane("facilities").style.zIndex = "380";
  const renderer = canvasSupported() ? L.canvas({ pane: "facilities", padding: 0.5, tolerance: 6 }) : L.svg({ pane: "facilities" });
  for (const p of points) {
    const style = FACILITY_STYLE[p.type];
    L.circleMarker([p.lat, p.lng], { renderer, pane: "facilities", radius: style.stroke ? 6 : 5, color: style.stroke ?? "#fff", weight: style.stroke ? 2 : 1.5, fillColor: style.color, fillOpacity: 1 })
      // 카드는 누를 때 만든다(점이 수천 개).
      .bindPopup(() => popupCard(p.card ?? facilityCard(p)))
      .addTo(layer);
  }
}
