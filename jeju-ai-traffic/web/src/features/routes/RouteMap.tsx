import { useEffect } from "react";
import L from "leaflet";
import type { RouteOption } from "../../../../shared/contracts/route";
import type { TrafficIncident } from "../../../../shared/contracts/traffic";
import { addIncidentMarkers, FOCUS_ZOOM, toLatLng, useLeafletMap, type IncidentFocus } from "../map/leafletMap";
import { STATUS_STYLE } from "./trafficStyle";

interface Props {
  routes: RouteOption[];
  selectedId: string;
  incidents: TrafficIncident[];
  onSelect: (id: string) => void;
  /** 사건 묶음을 눌렀을 때(TASK-011 계획 (b)). 없으면 경로 전체를 보여 준다. */
  focus?: IncidentFocus | null;
}

/**
 * 경로 지도(AC-007-01~03). 선택 경로는 구간 혼잡 색으로 굵게, 대체 경로는 회색 가는 선.
 * 지도를 만들지 못하면 안내만 보여 주고, 경로·시간은 아래 카드(텍스트)로 확인한다(AC-007-04).
 */
export function RouteMap({ routes, selectedId, incidents, onSelect, focus = null }: Props) {
  const { attach, mapRef, layerRef, mapReady, failed, tilesFailed } = useLeafletMap();

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!mapReady || !map || !layer) return;
    layer.clearLayers();
    const bounds = L.latLngBounds([]);

    // 대체 경로 먼저(아래), 선택 경로를 위에 그린다.
    for (const route of routes.filter((r) => r.id !== selectedId)) {
      const line = L.polyline(route.geometry.map(toLatLng), { color: "#64748b", weight: 4, opacity: 0.55 });
      line.on("click", () => onSelect(route.id));
      line.addTo(layer);
      bounds.extend(line.getBounds());
    }
    let current: TrafficIncident | undefined;
    const selected = routes.find((r) => r.id === selectedId);
    if (selected) {
      const outline = L.polyline(selected.geometry.map(toLatLng), { color: "#1e3a8a", weight: 9, opacity: 0.9 });
      outline.addTo(layer);
      bounds.extend(outline.getBounds());
      for (const seg of selected.segments) {
        const style = STATUS_STYLE[seg.status];
        L.polyline(selected.geometry.slice(seg.startIndex, seg.endIndex + 1).map(toLatLng), {
          color: style.color,
          weight: 5,
          dashArray: style.dash,
          className: `route-seg route-seg-${seg.status}`,
        }).addTo(layer);
      }
      const first = selected.geometry[0];
      const last = selected.geometry[selected.geometry.length - 1];
      if (first) L.circleMarker(toLatLng(first), { radius: 7, color: "#fff", weight: 2, fillColor: "#2563eb", fillOpacity: 1 }).bindTooltip("출발").addTo(layer);
      if (last) L.circleMarker(toLatLng(last), { radius: 7, color: "#fff", weight: 2, fillColor: "#0f172a", fillOpacity: 1 }).bindTooltip("도착").addTo(layer);
      const shown = incidents.filter((i) => selected.incidentIds.includes(i.id));
      current = addIncidentMarkers(layer, shown, focus);
    }
    if (current) map.setView(toLatLng(current.location), FOCUS_ZOOM);
    else if (bounds.isValid()) map.fitBounds(bounds, { padding: [16, 16] });
  }, [mapReady, mapRef, layerRef, routes, selectedId, incidents, onSelect, focus]);

  if (failed) {
    return (
      <p role="status" className="rounded-2xl bg-grey-100 p-3 text-sm text-grey-700">
        지도를 표시할 수 없습니다. 아래 경로 목록에서 경로와 예상시간을 확인하세요.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <div ref={attach} role="region" aria-label="경로 지도" className="h-64 w-full md:h-[45vh] lg:h-[60vh] overflow-hidden rounded-[20px] bg-grey-200" />
      {tilesFailed && (
        <p className="text-xs text-grey-600">지도 배경을 불러오지 못했습니다. 경로 선과 아래 목록은 그대로 확인할 수 있습니다.</p>
      )}
    </div>
  );
}
