import { useCallback, useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Coordinate, RouteOption } from "../../../../shared/contracts/route";
import type { TrafficIncident } from "../../../../shared/contracts/traffic";
import { INCIDENT_LABEL, STATUS_STYLE } from "./trafficStyle";

interface Props {
  routes: RouteOption[];
  selectedId: string;
  incidents: TrafficIncident[];
  onSelect: (id: string) => void;
}

const toLatLng = (c: Coordinate): L.LatLngTuple => [c.lat, c.lng];

/**
 * 경로 지도(AC-007-01~03). 선택 경로는 구간 혼잡 색으로 굵게, 대체 경로는 회색 가는 선.
 * 지도를 만들지 못하면 안내만 보여 주고, 경로·시간은 아래 카드(텍스트)로 확인한다(AC-007-04).
 */
export function RouteMap({ routes, selectedId, incidents, onSelect }: Props) {
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [tilesFailed, setTilesFailed] = useState(false);

  // 지도는 컨테이너가 붙을 때 만들고 떨어질 때 지운다(콜백 ref 정리 함수).
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
      for (const id of selected.incidentIds) {
        const incident = incidents.find((i) => i.id === id);
        if (!incident) continue;
        L.circleMarker(toLatLng(incident.location), { radius: 8, color: "#fff", weight: 2, fillColor: "#b91c1c", fillOpacity: 1, className: "incident-marker" })
          .bindTooltip(`${INCIDENT_LABEL[incident.kind]}: ${incident.description}`)
          .addTo(layer);
      }
    }
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [16, 16] });
  }, [mapReady, routes, selectedId, incidents, onSelect]);

  if (failed) {
    return (
      <p role="status" className="rounded-lg bg-slate-100 p-3 text-sm text-slate-700">
        지도를 표시할 수 없습니다. 아래 경로 목록에서 경로와 예상시간을 확인하세요.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <div ref={attach} role="region" aria-label="경로 지도" className="h-64 w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-100" />
      {tilesFailed && (
        <p className="text-xs text-slate-600">지도 배경을 불러오지 못했습니다. 경로 선과 아래 목록은 그대로 확인할 수 있습니다.</p>
      )}
    </div>
  );
}
