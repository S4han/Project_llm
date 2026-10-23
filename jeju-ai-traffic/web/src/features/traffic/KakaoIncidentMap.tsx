import { useCallback, useEffect, useMemo, useRef } from "react";
import type { KakaoMaps, KCustomOverlay, KLatLng, KOverlay } from "../map/kakaoSdk";
import { KakaoControls } from "../map/KakaoControls";
import { useKakaoMap } from "../map/useKakaoMap";
import {
  addCanvasLayer,
  addDomMarker,
  addKakaoIncidents,
  boundsOf,
  circleBounds,
  dotElement,
  facilityDrawer,
  fitBounds,
  fitJeju,
  jumpTo,
  levelOf,
  pinElement,
  speedLineDrawer,
  zoomOf,
  type CanvasLayer,
} from "../map/kakaoMap";
import { facilityCard, FOCUS_ZOOM, popupCard, speedLineCard, type FacilityPoint, type PopupCard } from "../map/leafletMap";
import { HOME_ZOOM, NO_FACILITIES, NO_IDS, type IncidentMapProps } from "./incidentMapProps";

const MY_SPOT_CARD = (title: string, footer: string): PopupCard => ({ badge: { text: "나", color: "#2272eb" }, kicker: "현재 위치", title, chips: [], rows: [], footer });

/** 제주 전체 교통 사건 지도(TASK-012). 카카오 지도 판(TASK-033): 같은 props, 같은 화면 맞추기 규칙. */
export function KakaoIncidentMap({
  kakao: k,
  onFail,
  incidents,
  focus,
  viewKey,
  speedLines = [],
  speedObservedAt = null,
  highlightIds = NO_IDS,
  heightClass = "h-80",
  overlay = null,
  facilities = NO_FACILITIES,
  nearby = null,
  openFacility = null,
  home = null,
  fitKey = null,
  label = "교통 현황 지도",
  labelZoom = null,
}: IncidentMapProps & { kakao: KakaoMaps; onFail: (reason: string) => void }) {
  const { attach, map, popupRef } = useKakaoMap(k, onFail);
  const highlightKey = highlightIds.join(",");
  const clickAt = useRef<KLatLng | null>(null);
  const facilityLayer = useRef<CanvasLayer | null>(null);
  const speedLayer = useRef<CanvasLayer | null>(null);

  // 지도 빈 곳을 누르면: 위에 있는 점부터, 다음 도로 선, 아무것도 없으면 카드를 닫는다.
  useEffect(() => {
    if (!map) return;
    const onClick = (e?: { latLng: KLatLng }) => {
      if (!e) return;
      clickAt.current = e.latLng;
      if (facilityLayer.current?.hitAt(e.latLng)) return;
      if (speedLayer.current?.hitAt(e.latLng)) return;
      popupRef.current?.close();
    };
    k.event.addListener(map, "click", onClick);
    return () => k.event.removeListener(map, "click", onClick);
  }, [k, map, popupRef]);

  const openPoint = useCallback(
    (p: FacilityPoint) => {
      const load = p.loadCard;
      popupRef.current?.open(p.lat, p.lng, popupCard(p.cardFn?.() ?? p.card ?? facilityCard(p)), {
        offset: p.pin ? (p.pin.dot ? 10 : 34) : 6,
        large: p.large ?? p.card?.size === "lg",
        loadCard: load ? () => load().then(popupCard) : undefined,
      });
    },
    [popupRef],
  );

  // 시설물: 작은 점은 캔버스(화면 안만), 가격·주차 표시는 화면 안에 든 것만 DOM으로(움직임이 멈출 때마다 맞춘다).
  useEffect(() => {
    if (!map) return;
    const layer = addCanvasLayer(k, map, facilityDrawer(facilities, openPoint), 2);
    facilityLayer.current = layer;
    const pins = facilities.filter((p) => p.pin);
    const shown = new Map<string, KCustomOverlay>();
    const syncPins = () => {
      const b = map.getBounds();
      const sw = b.getSouthWest();
      const ne = b.getNorthEast();
      const dLat = (ne.getLat() - sw.getLat()) / 4;
      const dLng = (ne.getLng() - sw.getLng()) / 4;
      for (const p of pins) {
        const visible = p.lat >= sw.getLat() - dLat && p.lat <= ne.getLat() + dLat && p.lng >= sw.getLng() - dLng && p.lng <= ne.getLng() + dLng;
        const cur = shown.get(p.id);
        if (visible && !cur && p.pin) {
          const z = p.pin.low ? 1000 : p.type === "TOUR" ? 800 : p.pin.top ? 500 : 100;
          shown.set(p.id, addDomMarker(k, map, p.lat, p.lng, pinElement(p.pin), { zIndex: z, onClick: () => openPoint(p) }));
        } else if (!visible && cur) {
          cur.setMap(null);
          shown.delete(p.id);
        }
      }
    };
    syncPins();
    k.event.addListener(map, "idle", syncPins);
    return () => {
      k.event.removeListener(map, "idle", syncPins);
      for (const o of shown.values()) o.setMap(null);
      layer.remove();
      facilityLayer.current = null;
    };
  }, [k, map, facilities, openPoint]);

  // 이름 표시: 많이 확대했을 때만 화면 안 시설물(최대 250곳)에 이름을 붙인다(글자는 textContent로만).
  useEffect(() => {
    if (!map || labelZoom === null) return;
    let labels: KCustomOverlay[] = [];
    const draw = () => {
      for (const o of labels) o.setMap(null);
      labels = [];
      if (zoomOf(map.getLevel()) < labelZoom) return;
      const b = map.getBounds();
      for (const p of facilities) {
        if (labels.length >= 250) break;
        if (!p.name || !b.contain(new k.LatLng(p.lat, p.lng))) continue;
        const wrap = document.createElement("div");
        wrap.className = "map-label-wrap kmap-label-wrap";
        const el = document.createElement("span");
        el.className = "map-label";
        el.textContent = p.name;
        wrap.append(el);
        labels.push(addDomMarker(k, map, p.lat, p.lng, wrap, { zIndex: 50 }));
      }
    };
    draw();
    k.event.addListener(map, "idle", draw);
    return () => {
      k.event.removeListener(map, "idle", draw);
      for (const o of labels) o.setMap(null);
    };
  }, [k, map, facilities, labelZoom]);

  // 내 위치 반경 원(TASK-016)과 내 위치 점(TASK-023). 좌표는 화면에만 쓰고 보내지 않는다.
  const nearbyLat = nearby?.lat;
  const nearbyLng = nearby?.lng;
  const nearbyRadius = nearby?.radiusMeters;
  const nearbySpot = nearby?.spot ?? false;
  const homeLat = home?.lat;
  const homeLng = home?.lng;
  useEffect(() => {
    if (!map) return;
    const items: KOverlay[] = [];
    const me = (lat: number, lng: number, card: PopupCard) => {
      const el = dotElement({ radius: 7, color: "#fff", weight: 2, fill: "#2272eb", className: "kmap-me" });
      items.push(addDomMarker(k, map, lat, lng, el, { zIndex: 950, onClick: () => popupRef.current?.open(lat, lng, popupCard(card), { offset: 7 }) }));
    };
    if (nearbyLat !== undefined && nearbyLng !== undefined && nearbyRadius !== undefined) {
      const center = new k.LatLng(nearbyLat, nearbyLng);
      items.push(
        new k.Circle(
          nearbySpot
            ? { map, center, radius: nearbyRadius, strokeWeight: 1.5, strokeColor: "#4f46e5", strokeStyle: "shortdash", fillColor: "#4f46e5", fillOpacity: 0.06 }
            : { map, center, radius: nearbyRadius, strokeWeight: 1.5, strokeColor: "#111827", strokeStyle: "shortdash", fillColor: "#facc15", fillOpacity: 0.08 },
        ),
      );
      if (!nearbySpot) me(nearbyLat, nearbyLng, MY_SPOT_CARD(`반경 ${nearbyRadius / 1000}km 안을 보는 중`, "위치는 이 기기에서 거리 계산에만 쓰고 보내거나 저장하지 않습니다."));
    }
    if ((nearbySpot || nearbyLat === undefined) && homeLat !== undefined && homeLng !== undefined) me(homeLat, homeLng, MY_SPOT_CARD("내 위치", "위치는 이 기기에서 지도 표시에만 쓰고 보내거나 저장하지 않습니다."));
    return () => {
      for (const o of items) o.setMap(null);
    };
  }, [k, map, popupRef, nearbyLat, nearbyLng, nearbyRadius, nearbySpot, homeLat, homeLng]);

  // 구간 속도 선(캔버스, 화면 안 구간만). 누르면 누른 자리에 카드.
  useEffect(() => {
    if (!map) return;
    const ids = new Set(highlightKey ? highlightKey.split(",") : []);
    const layer = addCanvasLayer(
      k,
      map,
      speedLineDrawer(speedLines, ids, (line) => {
        const at = clickAt.current;
        if (at) popupRef.current?.open(at.getLat(), at.getLng(), popupCard(speedLineCard(line, speedObservedAt)), { offset: 0 });
      }),
      1,
    );
    speedLayer.current = layer;
    return () => {
      layer.remove();
      speedLayer.current = null;
    };
  }, [k, map, popupRef, speedLines, speedObservedAt, highlightKey]);

  useEffect(() => {
    if (!map || !popupRef.current) return;
    const { overlays } = addKakaoIncidents(k, map, popupRef.current, incidents, focus);
    return () => {
      for (const o of overlays) o.setMap(null);
    };
  }, [k, map, popupRef, incidents, focus]);

  const current = focus ? incidents.find((i) => i.id === focus.currentId) : undefined;
  const currentLat = current?.location.lat;
  const currentLng = current?.location.lng;
  // 강조할 도로 구간이 모두 보이는 범위. 같은 도로면(1분 갱신) 다시 맞추지 않는다.
  const highlightPoints = useMemo(() => {
    if (!highlightKey) return null;
    const ids = new Set(highlightKey.split(","));
    const pts = speedLines.filter((l) => ids.has(l.id)).flatMap((l) => l.points);
    return pts.length ? pts : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 도로를 바꿀 때만 다시 맞춘다
  }, [highlightKey]);

  useEffect(() => {
    if (!map) return;
    if (currentLat !== undefined && currentLng !== undefined) {
      map.setLevel(levelOf(FOCUS_ZOOM));
      map.setCenter(new k.LatLng(currentLat, currentLng));
    } else if (highlightPoints) fitBounds(map, boundsOf(k, highlightPoints), 24, 15);
    else if (nearbyLat !== undefined && nearbyLng !== undefined && nearbyRadius !== undefined) fitBounds(map, circleBounds(k, nearbyLat, nearbyLng, nearbyRadius), 12);
    else if (homeLat !== undefined && homeLng !== undefined) {
      map.setLevel(levelOf(HOME_ZOOM));
      map.setCenter(new k.LatLng(homeLat, homeLng));
    } else fitJeju(k, map);
  }, [k, map, currentLat, currentLng, viewKey, highlightPoints, nearbyLat, nearbyLng, nearbyRadius, homeLat, homeLng]);

  useEffect(() => {
    if (!map || !fitKey || !facilities.length) return;
    fitBounds(map, boundsOf(k, facilities), 24, 15);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 검색할 때만 다시 맞춘다
  }, [k, map, fitKey]);

  // 목록에서 고른 시설물: 그 자리로 바로 옮기고(확대 15 이상) 카드를 연다. 화면 맞추기보다 뒤에 두어 같은 때에 바뀌면 고른 곳이 이긴다.
  const openId = openFacility?.id;
  const openSeq = openFacility?.seq;
  useEffect(() => {
    const p = openId ? facilities.find((f) => f.id === openId) : undefined;
    if (!map || !p) return;
    jumpTo(k, map, p.lat, p.lng, 15);
    openPoint(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 고를 때만 연다(점 목록 갱신으로 다시 열지 않음)
  }, [k, map, openId, openSeq]);

  return (
    <div className="flex flex-col gap-1">
      <div className="relative">
        <div className={`${heightClass} relative w-full`}>
          <div ref={attach} role="region" aria-label={label} data-map-engine="kakao" data-speed-lines={speedLines.length} data-facilities={facilities.length} data-nearby={nearby ? "1" : "0"} className="h-full w-full overflow-hidden rounded-[20px] bg-grey-200" />
          <KakaoControls map={map} kakao={k} />
        </div>
        {home && map && (
          <button type="button" onClick={() => fitJeju(k, map)} className="map-home-btn absolute bottom-6 left-2 z-[500] min-h-11 rounded-xl bg-white px-3 text-sm font-semibold text-grey-800 shadow-md ring-1 ring-grey-300">
            제주 전체
          </button>
        )}
        {overlay && (
          <div className="pointer-events-none absolute inset-0 z-[500] flex items-center justify-center">
            <p className="rounded-2xl bg-white/85 px-4 py-2 text-sm font-semibold text-grey-700 shadow">{overlay}</p>
          </div>
        )}
      </div>
    </div>
  );
}
