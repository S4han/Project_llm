import { useKakaoMaps } from "../map/kakaoMap";
import { KakaoFallbackNote } from "../map/KakaoFallbackNote";
import { KakaoRouteMap } from "./KakaoRouteMap";
import { LeafletRouteMap, type RouteMapProps } from "./LeafletRouteMap";

/** 경로 지도(TASK-033 1.(a)): 카카오 지도를 쓸 수 있으면 카카오, 아니면 Leaflet(브이월드)(2.(a)). */
export function RouteMap(props: RouteMapProps) {
  const { kakao, fallback } = useKakaoMaps();
  if (kakao === undefined)
    return (
      <div role="region" aria-label="경로 지도" aria-busy="true" className="flex h-64 w-full items-center justify-center rounded-[20px] bg-grey-200 text-sm text-grey-600 md:h-[45vh] lg:h-[60vh]">
        지도 불러오는 중…
      </div>
    );
  if (kakao) return <KakaoRouteMap {...props} kakao={kakao} onFail={fallback} />;
  return (
    <div className="flex flex-col gap-1">
      <LeafletRouteMap {...props} />
      <KakaoFallbackNote />
    </div>
  );
}
