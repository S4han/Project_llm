/** 예상시간 표시: "1시간 9분", "45분", 30초 미만 반올림이면 "1분 미만". */
export function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return "1분 미만";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}분`;
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
}

export function formatDistance(meters: number): string {
  return `${(meters / 1000).toFixed(1)}km`;
}

/** 추천 경로와의 차이(초). 60초 미만은 "1분 미만 차이". 판단은 초 단위, 표시만 분 반올림. */
export function formatDiff(diffSeconds: number): string {
  if (diffSeconds === 0) return "추천 경로와 예상시간 같음";
  if (Math.abs(diffSeconds) < 60) return "추천 경로와 1분 미만 차이";
  return `추천 경로보다 ${Math.round(Math.abs(diffSeconds) / 60)}분 ${diffSeconds > 0 ? "느림" : "빠름"}`;
}
