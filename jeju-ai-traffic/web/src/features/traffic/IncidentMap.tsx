import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import type { TrafficIncident } from "../../../../shared/contracts/traffic";
import { addFacilityMarkers, addIncidentMarkers, addSpeedLines, FOCUS_ZOOM, popupCard, toLatLng, updateSpeedLineWeights, useLeafletMap, type FacilityPoint, type IncidentFocus, type SpeedLine } from "../map/leafletMap";

/** 내 위치 기준으로 열 때의 확대 수준. 휴대폰 폭에서 주변 약 3km가 보인다(TASK-023 2.(a)). */
export const HOME_ZOOM = 14;

/** 제주도 전체가 보이는 범위. */
const JEJU_BOUNDS: [[number, number], [number, number]] = [
  [33.11, 126.14],
  [33.57, 126.98],
];

interface Props {
  incidents: TrafficIncident[];
  focus: IncidentFocus | null;
  /** 바뀌면 제주 전체 화면으로 다시 맞춘다(종류 필터 등). 1분 자동 갱신으로는 사용자가 옮긴 화면을 건드리지 않는다. */
  viewKey: string;
  /** 구간 속도 선(TASK-012). 비어 있으면 그리지 않는다. */
  speedLines?: SpeedLine[];
  speedObservedAt?: string | null;
  /** 도로 목록에서 고른 구간(TASK-012 소통대시보드). 있으면 굵게 강조하고 모두 보이게 확대한다. */
  highlightIds?: string[];
  /** 지도 높이(반응형 클래스). */
  heightClass?: string;
  /** 지도 가운데에 반투명으로 띄울 안내(예: "도로 소통 불러오는 중…"). */
  overlay?: string | null;
  /** 켜 둔 유형의 교통시설물(TASK-013). */
  facilities?: FacilityPoint[];
  /** 내 위치와 조회 반경(TASK-016 주정차 단속). 있으면 원과 내 위치 점을 그리고 원이 보이게 맞춘다. */
  nearby?: { lat: number; lng: number; radiusMeters: number; spot?: boolean } | null;
  /** 바뀌면 그 시설물로 옮기고 카드를 연다(주유소 목록, TASK-018). seq는 같은 곳을 다시 고를 때 구분용. */
  openFacility?: { id: string; seq: number } | null;
  /** 화면을 열 때 확인한 내 위치(TASK-023). 있으면 제주 전체 대신 내 위치 기준으로 열고 "제주 전체" 버튼을 보인다. */
  home?: { lat: number; lng: number } | null;
}

const NO_IDS: string[] = [];
const NO_FACILITIES: FacilityPoint[] = [];

/** 제주 전체 교통 사건 지도(TASK-012). */
export function IncidentMap({ incidents, focus, viewKey, speedLines = [], speedObservedAt = null, highlightIds = NO_IDS, heightClass = "h-80", overlay = null, facilities = NO_FACILITIES, nearby = null, openFacility = null, home = null }: Props) {
  const { attach, mapRef, layerRef, mapReady, failed, tilesFailed } = useLeafletMap();
  const speedLayer = useRef<L.LayerGroup | null>(null);
  const polylines = useRef<L.Polyline[]>([]);
  const highlightKey = highlightIds.join(",");

  const facilityLayer = useRef<L.LayerGroup | null>(null);
  const facilityMarkers = useRef(new Map<string, L.Marker | L.CircleMarker>());
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    if (!facilityLayer.current || !map.hasLayer(facilityLayer.current)) facilityLayer.current = L.layerGroup().addTo(map);
    facilityLayer.current.clearLayers();
    facilityMarkers.current = addFacilityMarkers(map, facilityLayer.current, facilities);
  }, [mapReady, mapRef, facilities]);

  // 목록에서 고른 시설물: 그 자리로 옮기고(확대 15 이상) 카드를 연다.
  const openId = openFacility?.id;
  const openSeq = openFacility?.seq;
  useEffect(() => {
    const map = mapRef.current;
    const marker = openId ? facilityMarkers.current.get(openId) : undefined;
    if (!mapReady || !map || !marker) return;
    map.setView(marker.getLatLng(), Math.max(map.getZoom(), 15));
    marker.openPopup();
  }, [mapReady, mapRef, openId, openSeq]);

  // 내 위치 반경 원(TASK-016). 좌표는 화면에만 쓰고 보내지 않는다.
  const nearbyLayer = useRef<L.LayerGroup | null>(null);
  const nearbyLat = nearby?.lat;
  const nearbyLng = nearby?.lng;
  const nearbyRadius = nearby?.radiusMeters;
  // spot이면 원의 중심이 내 위치가 아니라 관광지(관광지 주변 주차장, TASK-027): 중심에 "나" 점을 찍지 않고 내 위치 점은 따로.
  const nearbySpot = nearby?.spot ?? false;
  const homeLat = home?.lat;
  const homeLng = home?.lng;
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    if (!nearbyLayer.current || !map.hasLayer(nearbyLayer.current)) nearbyLayer.current = L.layerGroup().addTo(map);
    nearbyLayer.current.clearLayers();
    if (nearbyLat === undefined || nearbyLng === undefined || nearbyRadius === undefined || nearbySpot) {
      if (nearbyLat !== undefined && nearbyLng !== undefined && nearbyRadius !== undefined)
        L.circle(toLatLng({ lat: nearbyLat, lng: nearbyLng }), { radius: nearbyRadius, color: "#4f46e5", weight: 1.5, dashArray: "6 6", fillColor: "#4f46e5", fillOpacity: 0.06, interactive: false }).addTo(nearbyLayer.current);
      // 주변 유형을 켜지 않았어도 내 위치 점은 보인다(TASK-023).
      if (homeLat === undefined || homeLng === undefined) return;
      L.circleMarker(toLatLng({ lat: homeLat, lng: homeLng }), { radius: 7, color: "#fff", weight: 2, fillColor: "#2272eb", fillOpacity: 1 })
        .bindPopup(
          popupCard({
            badge: { text: "나", color: "#2272eb" },
            kicker: "현재 위치",
            title: "내 위치",
            chips: [],
            rows: [],
            footer: "위치는 이 기기에서 지도 표시에만 쓰고 보내거나 저장하지 않습니다.",
          }),
        )
        .addTo(nearbyLayer.current);
      return;
    }
    const center = toLatLng({ lat: nearbyLat, lng: nearbyLng });
    L.circle(center, { radius: nearbyRadius, color: "#111827", weight: 1.5, dashArray: "6 6", fillColor: "#facc15", fillOpacity: 0.08, interactive: false }).addTo(nearbyLayer.current);
    L.circleMarker(center, { radius: 7, color: "#fff", weight: 2, fillColor: "#2272eb", fillOpacity: 1 })
      .bindPopup(
        popupCard({
          badge: { text: "나", color: "#2272eb" },
          kicker: "현재 위치",
          title: `반경 ${nearbyRadius / 1000}km 안을 보는 중`,
          chips: [],
          rows: [],
          footer: "위치는 이 기기에서 거리 계산에만 쓰고 보내거나 저장하지 않습니다.",
        }),
      )
      .addTo(nearbyLayer.current);
  }, [mapReady, mapRef, nearbyLat, nearbyLng, nearbyRadius, nearbySpot, homeLat, homeLng]);

  // 확대 수준이 바뀌면 선 두께만 바꾼다(다시 그리지 않음).
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const onZoom = () => updateSpeedLineWeights(map, polylines.current);
    map.on("zoomend", onZoom);
    return () => {
      map.off("zoomend", onZoom);
    };
  }, [mapReady, mapRef]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    // 지도가 새로 만들어졌으면 층도 새로 만든다.
    if (!speedLayer.current || !map.hasLayer(speedLayer.current)) speedLayer.current = L.layerGroup().addTo(map);
    speedLayer.current.clearLayers();
    polylines.current = addSpeedLines(map, speedLayer.current, speedLines, speedObservedAt, new Set(highlightKey ? highlightKey.split(",") : []));
  }, [mapReady, mapRef, speedLines, speedObservedAt, highlightKey]);

  useEffect(() => {
    const layer = layerRef.current;
    if (!mapReady || !layer) return;
    layer.clearLayers();
    addIncidentMarkers(layer, incidents, focus);
  }, [mapReady, layerRef, incidents, focus]);

  const current = focus ? incidents.find((i) => i.id === focus.currentId) : undefined;
  const currentLat = current?.location.lat;
  const currentLng = current?.location.lng;
  // 강조할 도로 구간이 모두 보이는 범위. 구간 모양이 바뀌어도(1분 갱신) 같은 도로면 화면을 다시 맞추지 않는다.
  const highlightBounds = useMemo(() => {
    if (!highlightKey) return null;
    const ids = new Set(highlightKey.split(","));
    const b = L.latLngBounds([]);
    for (const l of speedLines) if (ids.has(l.id)) for (const p of l.points) b.extend(toLatLng(p));
    return b.isValid() ? b : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 도로를 바꿀 때만 다시 맞춘다
  }, [highlightKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    if (currentLat !== undefined && currentLng !== undefined) map.setView(toLatLng({ lat: currentLat, lng: currentLng }), FOCUS_ZOOM);
    else if (highlightBounds) map.fitBounds(highlightBounds, { padding: [24, 24], maxZoom: 15 });
    else if (nearbyLat !== undefined && nearbyLng !== undefined && nearbyRadius !== undefined) map.fitBounds(L.latLng(nearbyLat, nearbyLng).toBounds(nearbyRadius * 2), { padding: [12, 12] });
    else if (homeLat !== undefined && homeLng !== undefined) map.setView(toLatLng({ lat: homeLat, lng: homeLng }), HOME_ZOOM);
    else map.fitBounds(JEJU_BOUNDS);
  }, [mapReady, mapRef, currentLat, currentLng, viewKey, highlightBounds, nearbyLat, nearbyLng, nearbyRadius, homeLat, homeLng]);

  if (failed) {
    return (
      <p role="status" className="rounded-2xl bg-grey-100 p-3 text-sm text-grey-700">
        지도를 표시할 수 없습니다. 아래 목록에서 사건을 확인하세요.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <div className="relative">
        <div ref={attach} role="region" aria-label="교통 현황 지도" data-speed-lines={speedLines.length} data-facilities={facilities.length} data-nearby={nearby ? "1" : "0"} className={`${heightClass} w-full overflow-hidden rounded-[20px] bg-grey-200`} />
        {home && mapReady && (
          <button
            type="button"
            onClick={() => mapRef.current?.fitBounds(JEJU_BOUNDS)}
            className="map-home-btn absolute bottom-6 left-2 z-[500] min-h-11 rounded-xl bg-white px-3 text-sm font-semibold text-grey-800 shadow-md ring-1 ring-grey-300"
          >
            제주 전체
          </button>
        )}
        {overlay && (
          <div className="pointer-events-none absolute inset-0 z-[500] flex items-center justify-center">
            <p className="rounded-2xl bg-white/85 px-4 py-2 text-sm font-semibold text-grey-700 shadow">{overlay}</p>
          </div>
        )}
      </div>
      {tilesFailed && <p className="text-xs text-grey-600">지도 배경을 불러오지 못했습니다. 사건 표시와 아래 목록은 그대로 확인할 수 있습니다.</p>}
    </div>
  );
}
