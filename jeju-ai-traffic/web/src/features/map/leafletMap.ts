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
 * 팝업 내용을 DOM으로 만든다. 원천 데이터(도로명·설치 위치 등)를 HTML로 해석하지 않도록 글자로만 넣는다.
 * link가 있으면 새 창으로 여는 링크를 덧붙인다.
 */
export function popupContent(text: string, link?: { href: string; label: string; note?: string; sameTab?: boolean }): HTMLElement {
  const el = document.createElement("div");
  const p = document.createElement("p");
  // 줄바꿈(주정차 단속 운영 시간 등)을 그대로 보인다.
  p.style.whiteSpace = "pre-line";
  p.textContent = text;
  el.append(p);
  if (link?.note) {
    const note = document.createElement("p");
    note.className = "popup-note";
    note.textContent = link.note;
    el.append(note);
  }
  if (link) {
    const a = document.createElement("a");
    a.href = link.href;
    // 바깥 사이트는 새 창(opener 차단), 이 서비스 안 화면(경로 안내)은 같은 창.
    if (!link.sameTab) {
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    }
    a.textContent = link.label;
    a.className = "popup-link";
    el.append(a);
  }
  return el;
}

/** 카드형 팝업 내용(TASK-017 주차장). 원천 글자는 모두 textContent로만 넣는다. */
export interface PopupCard {
  /** 머리 표시(예: "P"). color는 배경색. */
  badge: { text: string; color: string };
  /** 작은 분류 이름(예: "주차장"). */
  kicker: string;
  title: string;
  chips: string[];
  /** 눈에 띄게 보일 숫자 하나(예: 48 · "면"). */
  stat?: { value: string; unit: string };
  rows: { label: string; lines: string[] }[];
  /** 맨 아래 흐린 글(주소 등). */
  footer?: string;
  /** 아래 꽉 찬 버튼(이 서비스 안 화면, 같은 창). */
  action?: { href: string; label: string };
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
    root.append(a);
  }
  return root;
}

/** 사건 묶음 이름과 같은 규칙(돌발은 내용만, 나머지는 종류 + 내용). */
function incidentLabel(i: TrafficIncident): string {
  return i.kind === "event" ? i.description : `${INCIDENT_LABEL[i.kind]} ${i.description}`;
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
    const at = formatKstTime(incident.sourceTime ?? incident.observedAt);
    marker.bindPopup(popupContent(`${incidentLabel(incident)}(${incident.source === "mock" ? "모의 데이터" : "제주 ITS 감지"}) · ${incident.sourceTime ? "원천" : "조회"} ${at}`));
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
  const at = observedAt ? ` · ${formatKstTime(observedAt)} 기준` : "";
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
    pl.bindPopup(popupContent(`${line.name || "도로명 없음"} · 평균 ${line.kmh}km/h · 통행 ${formatDuration(line.travelSeconds)}${at}`)).addTo(layer);
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
  /** 팝업 둘째 줄부터(주정차 단속: 주소·CCTV 수·운영 시간, TASK-016). */
  detail?: string;
  /** 팝업 아래 링크(이 서비스 안 화면, 같은 창). */
  link?: { href: string; label: string };
  /** 있으면 글자 팝업 대신 카드형 팝업(주차장, TASK-017). */
  card?: PopupCard;
  lat: number;
  lng: number;
}

/** 교통시설물 점(유형별 색). 수백~수천 개라 캔버스로, 구간 선 위·사건 점 아래 칸에 그린다. 누르면 "유형 · 설치 위치 · 모델". */
export function addFacilityMarkers(map: L.Map, layer: L.LayerGroup, points: FacilityPoint[]) {
  if (!map.getPane("facilities")) map.createPane("facilities").style.zIndex = "380";
  const renderer = canvasSupported() ? L.canvas({ pane: "facilities", padding: 0.5, tolerance: 6 }) : L.svg({ pane: "facilities" });
  for (const p of points) {
    const style = FACILITY_STYLE[p.type];
    L.circleMarker([p.lat, p.lng], { renderer, pane: "facilities", radius: style.stroke ? 6 : 5, color: style.stroke ?? "#fff", weight: style.stroke ? 2 : 1.5, fillColor: style.color, fillOpacity: 1 })
      .bindPopup(
        p.card
          ? popupCard(p.card)
          : popupContent(
          `${style.label} · ${p.name || "위치 이름 없음"}${p.model ? ` · 모델 ${p.model}` : ""}${p.detail ? `\n${p.detail}` : ""}`,
          // CCTV·웹카메라는 영상 API가 없고 사이트에 카메라별 주소도 없어(영상은 사이트 안 팝업), 공식 사이트 첫 화면으로 연결하고 찾는 방법을 안내한다(TASK-014).
          p.link
            ? { ...p.link, sameTab: true }
            : p.type === "FTY02" || p.type === "FTY03"
            ? {
                href: JEJU_ITS_SITE,
                label: "제주 ITS 교통정보센터 열기 ↗",
                note: `영상 보기: 사이트 왼쪽 'CCTV' 메뉴 → 지도에서 '${p.name || "같은 위치"}' 카메라 선택`,
              }
            : undefined,
        ),
      )
      .addTo(layer);
  }
}
