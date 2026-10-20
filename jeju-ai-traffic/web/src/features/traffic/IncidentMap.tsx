import { useEffect } from "react";
import type { TrafficIncident } from "../../../../shared/contracts/traffic";
import { addIncidentMarkers, FOCUS_ZOOM, toLatLng, useLeafletMap, type IncidentFocus } from "../map/leafletMap";

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
}

/** 제주 전체 교통 사건 지도(TASK-012). */
export function IncidentMap({ incidents, focus, viewKey }: Props) {
  const { attach, mapRef, layerRef, mapReady, failed, tilesFailed } = useLeafletMap();

  useEffect(() => {
    const layer = layerRef.current;
    if (!mapReady || !layer) return;
    layer.clearLayers();
    addIncidentMarkers(layer, incidents, focus);
  }, [mapReady, layerRef, incidents, focus]);

  const current = focus ? incidents.find((i) => i.id === focus.currentId) : undefined;
  const currentLat = current?.location.lat;
  const currentLng = current?.location.lng;
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    if (currentLat !== undefined && currentLng !== undefined) map.setView(toLatLng({ lat: currentLat, lng: currentLng }), FOCUS_ZOOM);
    else map.fitBounds(JEJU_BOUNDS);
  }, [mapReady, mapRef, currentLat, currentLng, viewKey]);

  if (failed) {
    return (
      <p role="status" className="rounded-lg bg-slate-100 p-3 text-sm text-slate-700">
        지도를 표시할 수 없습니다. 아래 목록에서 사건을 확인하세요.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <div ref={attach} role="region" aria-label="교통 현황 지도" className="h-80 w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-100" />
      {tilesFailed && <p className="text-xs text-slate-600">지도 배경을 불러오지 못했습니다. 사건 표시와 아래 목록은 그대로 확인할 수 있습니다.</p>}
    </div>
  );
}
