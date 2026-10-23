import { kakaoFailReason } from "./kakaoSdk";

/** 카카오 지도 키가 있는데 브이월드 지도로 바꿨으면 그 까닭을 한 줄로(TASK-033 점검: 설정 확인용). 키가 없으면 아무것도 안 보인다. */
export function KakaoFallbackNote() {
  const reason = kakaoFailReason();
  if (!reason) return null;
  return (
    <p className="text-xs text-grey-500" data-map-fallback={reason}>
      카카오 지도를 쓸 수 없어 브이월드 지도로 보여 줍니다 · {reason}
    </p>
  );
}
