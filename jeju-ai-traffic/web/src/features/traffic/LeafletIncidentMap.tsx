import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import { HOME_ZOOM, JEJU_BOUNDS, NO_FACILITIES, NO_IDS, type IncidentMapProps as Props } from "./incidentMapProps";
import { addFacilityMarkers, addIncidentMarkers, addSpeedLines, FOCUS_ZOOM, popupCard, toLatLng, updateSpeedLineWeights, useLeafletMap } from "../map/leafletMap";

/** 제주 전체 교통 사건 지도(TASK-012). Leaflet(브이월드) 판: 카카오 지도를 쓸 수 없을 때(TASK-033 2.(a)). */
export function LeafletIncidentMap({ incidents, focus, viewKey, speedLines = [], speedObservedAt = null, highlightIds = NO_IDS, heightClass = "h-80", overlay = null, facilities = NO_FACILITIES, nearby = null, openFacility = null, home = null, fitKey = null, label = "교통 현황 지도", labelZoom = null }: Props) {
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

  // 이름 표시: 많이 확대했을 때만 화면 안 시설물 이름을 붙인다. 움직일 때마다 다시 그린다(글자는 textContent로만).
  const labelLayer = useRef<L.LayerGroup | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    if (!labelLayer.current || !map.hasLayer(labelLayer.current)) labelLayer.current = L.layerGroup().addTo(map);
    const layer = labelLayer.current;
    const draw = () => {
      layer.clearLayers();
      // 화면을 아직 맞추기 전(확대 수준 없음)에는 범위를 물을 수 없다. 맞춘 뒤 moveend로 다시 그린다.
      const zoom = map.getZoom() as number | undefined;
      if (labelZoom === null || zoom === undefined || zoom < labelZoom) return;
      const bounds = map.getBounds();
      let n = 0;
      for (const p of facilities) {
        if (n >= 250) break;
        if (!p.name || !bounds.contains([p.lat, p.lng])) continue;
        const el = document.createElement("span");
        el.className = "map-label";
        el.textContent = p.name;
        L.marker([p.lat, p.lng], { icon: L.divIcon({ html: el, className: "map-label-wrap", iconSize: [0, 0] }), interactive: false, keyboard: false }).addTo(layer);
        n += 1;
      }
    };
    draw();
    map.on("moveend", draw);
    return () => {
      map.off("moveend", draw);
      layer.clearLayers();
    };
  }, [mapReady, mapRef, facilities, labelZoom]);


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

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !fitKey || !facilities.length) return;
    map.fitBounds(L.latLngBounds(facilities.map((p) => [p.lat, p.lng] as L.LatLngTuple)), { padding: [24, 24], maxZoom: 15 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 검색할 때만 다시 맞춘다
  }, [mapReady, mapRef, fitKey]);

  // 목록에서 고른 시설물: 그 자리로 옮기고(확대 15 이상) 카드를 연다. 화면 맞추기(제주 전체·반경·검색 결과)보다 뒤에 두어
  // 같은 때에 둘 다 바뀌면(관광지 주변 화면에서 돌아올 때, TASK-032) 고른 곳이 이긴다.
  const openId = openFacility?.id;
  const openSeq = openFacility?.seq;
  useEffect(() => {
    const map = mapRef.current;
    const marker = openId ? facilityMarkers.current.get(openId) : undefined;
    if (!mapReady || !map || !marker) return;
    // 움직임 없이 바로 옮긴 뒤 카드를 연다. 다른 이동(검색 결과 맞추기 등)이 진행 중이거나 확대하는 중에 카드를 열면
    // 카드 자동 이동이 확대를 멈춰 멀리 본 채로 남는다(TASK-031 점검).
    map.stop();
    map.setView(marker.getLatLng(), Math.max(map.getZoom(), 15), { animate: false });
    marker.openPopup();
  }, [mapReady, mapRef, openId, openSeq]);

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
        {/* 높이는 바깥 상자에. 지도 상자의 className이 바뀌면 React가 Leaflet이 붙인 leaflet-container 등을 지워 바탕 그림이 깨진다(TASK-029 점검). */}
        <div className={`${heightClass} w-full`}>
          <div ref={attach} role="region" aria-label={label} data-speed-lines={speedLines.length} data-facilities={facilities.length} data-nearby={nearby ? "1" : "0"} className="h-full w-full overflow-hidden rounded-[20px] bg-grey-200" />
        </div>
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
