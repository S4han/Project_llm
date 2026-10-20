import { useCallback, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Coordinate } from "../../../../shared/contracts/route";
import type { SpeedStatus, TrafficIncident } from "../../../../shared/contracts/traffic";
import { formatDuration } from "../routes/format";
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
    marker.bindPopup(`${incidentLabel(incident)}(${incident.source === "mock" ? "모의 데이터" : "제주 ITS 감지"}) · ${incident.sourceTime ? "원천" : "조회"} ${at}`);
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
    pl.bindPopup(`${line.name || "도로명 없음"} · 평균 ${line.kmh}km/h · 통행 ${formatDuration(line.travelSeconds)}${at}`).addTo(layer);
    return pl;
  });
}

export function updateSpeedLineWeights(map: L.Map, polylines: L.Polyline[]) {
  const zoom = map.getZoom();
  for (const pl of polylines) pl.setStyle({ weight: speedLineWeight(zoom, Boolean((pl as L.Polyline & { highlighted?: boolean }).highlighted)) });
}
