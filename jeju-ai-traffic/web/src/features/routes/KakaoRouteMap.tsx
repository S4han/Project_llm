import { useEffect } from "react";
import type { TrafficIncident } from "../../../../shared/contracts/traffic";
import type { KakaoMaps, KOverlay } from "../map/kakaoSdk";
import { addDomMarker, addKakaoIncidents, boundsOf, dotElement, fitBounds, levelOf } from "../map/kakaoMap";
import { KakaoControls } from "../map/KakaoControls";
import { FOCUS_ZOOM } from "../map/leafletMap";
import { useKakaoMap } from "../map/useKakaoMap";
import type { RouteMapProps } from "./LeafletRouteMap";
import { STATUS_STYLE } from "./trafficStyle";

/** 경로 지도(AC-007-01~03) 카카오 지도 판(TASK-033). 선택 경로는 구간 혼잡 색으로 굵게, 대체 경로는 회색 가는 선(누르면 고름). */
export function KakaoRouteMap({ kakao: k, onFail, routes, selectedId, incidents, onSelect, focus = null }: RouteMapProps & { kakao: KakaoMaps; onFail: () => void }) {
  const { attach, map, popupRef } = useKakaoMap(k, onFail);

  useEffect(() => {
    if (!map) return;
    const onClick = () => popupRef.current?.close();
    k.event.addListener(map, "click", onClick);
    return () => k.event.removeListener(map, "click", onClick);
  }, [k, map, popupRef]);

  useEffect(() => {
    const popup = popupRef.current;
    if (!map || !popup) return;
    const items: KOverlay[] = [];
    const path = (geometry: { lat: number; lng: number }[]) => geometry.map((c) => new k.LatLng(c.lat, c.lng));
    const all: { lat: number; lng: number }[] = [];
    // 대체 경로 먼저(아래), 선택 경로를 위에 그린다.
    for (const route of routes.filter((r) => r.id !== selectedId)) {
      const line = new k.Polyline({ map, path: path(route.geometry), strokeWeight: 4, strokeColor: "#64748b", strokeOpacity: 0.55, zIndex: 1 });
      k.event.addListener(line, "click", () => onSelect(route.id));
      items.push(line);
      all.push(...route.geometry);
    }
    let current: TrafficIncident | undefined;
    const selected = routes.find((r) => r.id === selectedId);
    if (selected) {
      items.push(new k.Polyline({ map, path: path(selected.geometry), strokeWeight: 9, strokeColor: "#1e3a8a", strokeOpacity: 0.9, zIndex: 2 }));
      all.push(...selected.geometry);
      for (const seg of selected.segments) {
        const style = STATUS_STYLE[seg.status];
        items.push(new k.Polyline({ map, path: path(selected.geometry.slice(seg.startIndex, seg.endIndex + 1)), strokeWeight: 5, strokeColor: style.color, strokeOpacity: 1, strokeStyle: style.dash ? "shortdash" : "solid", zIndex: 3 }));
      }
      const first = selected.geometry[0];
      const last = selected.geometry[selected.geometry.length - 1];
      if (first) items.push(addDomMarker(k, map, first.lat, first.lng, dotElement({ radius: 7, color: "#fff", weight: 2, fill: "#2563eb", title: "출발" }), { zIndex: 600 }));
      if (last) items.push(addDomMarker(k, map, last.lat, last.lng, dotElement({ radius: 7, color: "#fff", weight: 2, fill: "#0f172a", title: "도착" }), { zIndex: 600 }));
      const shown = incidents.filter((i) => selected.incidentIds.includes(i.id));
      const added = addKakaoIncidents(k, map, popup, shown, focus);
      items.push(...added.overlays);
      current = added.current;
    }
    if (current) {
      map.setLevel(levelOf(FOCUS_ZOOM));
      map.setCenter(new k.LatLng(current.location.lat, current.location.lng));
    } else fitBounds(map, boundsOf(k, all), 16);
    return () => {
      popup.close();
      for (const o of items) o.setMap(null);
    };
  }, [k, map, popupRef, routes, selectedId, incidents, onSelect, focus]);

  return (
    <div className="relative h-64 w-full md:h-[45vh] lg:h-[60vh]">
      <div ref={attach} role="region" aria-label="경로 지도" data-map-engine="kakao" className="h-full w-full overflow-hidden rounded-[20px] bg-grey-200" />
      <KakaoControls map={map} kakao={k} />
    </div>
  );
}
