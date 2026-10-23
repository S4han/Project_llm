import { useKakaoMaps } from "../map/kakaoMap";
import { KakaoFallbackNote } from "../map/KakaoFallbackNote";
import type { IncidentMapProps } from "./incidentMapProps";
import { KakaoIncidentMap } from "./KakaoIncidentMap";
import { LeafletIncidentMap } from "./LeafletIncidentMap";

/**
 * 교통·관광 지도(TASK-033 1.(a)). 카카오 지도 키가 있고 SDK가 준비되면 카카오 지도, 키가 없거나 SDK·바탕 그림을 받지 못하면
 * 지금까지의 Leaflet(브이월드) 지도로 자동으로 그린다(2.(a)). SDK를 받는 동안은 같은 크기의 빈 상자.
 */
export function IncidentMap(props: IncidentMapProps) {
  const { kakao, fallback } = useKakaoMaps();
  if (kakao === undefined)
    return (
      <div className={`${props.heightClass ?? "h-80"} w-full`}>
        <div role="region" aria-label={props.label ?? "교통 현황 지도"} aria-busy="true" className="flex h-full w-full items-center justify-center rounded-[20px] bg-grey-200 text-sm text-grey-600">
          지도 불러오는 중…
        </div>
      </div>
    );
  if (kakao) return <KakaoIncidentMap {...props} kakao={kakao} onFail={fallback} />;
  return (
    <div className="flex flex-col gap-1">
      <LeafletIncidentMap {...props} />
      <KakaoFallbackNote />
    </div>
  );
}
