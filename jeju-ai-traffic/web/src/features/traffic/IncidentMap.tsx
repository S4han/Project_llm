import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import type { TrafficIncident } from "../../../../shared/contracts/traffic";
import { addIncidentMarkers, addSpeedLines, FOCUS_ZOOM, toLatLng, updateSpeedLineWeights, useLeafletMap, type IncidentFocus, type SpeedLine } from "../map/leafletMap";

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
}

const NO_IDS: string[] = [];

/** 제주 전체 교통 사건 지도(TASK-012). */
export function IncidentMap({ incidents, focus, viewKey, speedLines = [], speedObservedAt = null, highlightIds = NO_IDS, heightClass = "h-80", overlay = null }: Props) {
  const { attach, mapRef, layerRef, mapReady, failed, tilesFailed } = useLeafletMap();
  const speedLayer = useRef<L.LayerGroup | null>(null);
  const polylines = useRef<L.Polyline[]>([]);
  const highlightKey = highlightIds.join(",");

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
    else map.fitBounds(JEJU_BOUNDS);
  }, [mapReady, mapRef, currentLat, currentLng, viewKey, highlightBounds]);

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
        <div ref={attach} role="region" aria-label="교통 현황 지도" data-speed-lines={speedLines.length} className={`${heightClass} w-full overflow-hidden rounded-[20px] bg-grey-200`} />
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
