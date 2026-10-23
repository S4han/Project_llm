import { useCallback, useEffect, useRef, useState } from "react";
import type { KakaoMaps, KMap } from "./kakaoSdk";
import { KAKAO_TILE_TIMEOUT_MS, KakaoPopup, syncKakaoFarClass } from "./kakaoMap";

/**
 * 카카오 지도를 만드는 콜백 ref(TASK-033). 바탕 그림이 정해진 시간 안에 한 번도 그려지지 않거나 지도를 만들지 못하면 onFail(→ Leaflet).
 */
export function useKakaoMap(k: KakaoMaps, onFail: (reason: string) => void) {
  const [map, setMap] = useState<KMap | null>(null);
  const popupRef = useRef<KakaoPopup | null>(null);
  const failRef = useRef(onFail);
  useEffect(() => {
    failRef.current = onFail;
  }, [onFail]);
  const attach = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) return;
      let m: KMap;
      try {
        m = new k.Map(el, { center: new k.LatLng(33.38, 126.55), level: 10 });
      } catch {
        failRef.current("지도를 만들지 못함");
        return;
      }
      let loaded = false;
      const onTiles = () => (loaded = true);
      k.event.addListener(m, "tilesloaded", onTiles);
      const timer = setTimeout(() => !loaded && failRef.current("바탕 그림을 받지 못함(한도·도메인 확인)"), KAKAO_TILE_TIMEOUT_MS);
      const onZoom = () => syncKakaoFarClass(m, el);
      k.event.addListener(m, "zoom_changed", onZoom);
      syncKakaoFarClass(m, el);
      // 지도 상자 크기가 바뀌면(검색 뒤 지도를 키울 때 등) 카카오 지도에 알린다.
      const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => m.relayout());
      resize?.observe(el);
      popupRef.current = new KakaoPopup(k, m, el);
      setMap(m);
      return () => {
        clearTimeout(timer);
        resize?.disconnect();
        k.event.removeListener(m, "tilesloaded", onTiles);
        k.event.removeListener(m, "zoom_changed", onZoom);
        popupRef.current?.close();
        popupRef.current = null;
        setMap(null);
        el.replaceChildren();
      };
    },
    [k],
  );
  return { attach, map, popupRef };
}
