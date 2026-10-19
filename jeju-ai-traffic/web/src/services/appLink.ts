/** 앱 주소 이동 후 이 시간(ms)이 지나도 페이지가 보이면 앱이 열리지 않은 것으로 본다(TASK-008 "3. 승인"). */
export const APP_OPEN_TIMEOUT_MS = 1500;

/**
 * 앱 주소(nmap:// 등)로 이동을 시도한다. 브라우저는 설치 여부를 알려 주지 않으므로,
 * 시간 안에 페이지가 숨겨지지 않으면 onFail을 부른다. 정리 함수를 돌려준다.
 */
export function openAppLink(
  url: string,
  onFail: () => void,
  env: { doc: Document; navigate: (url: string) => void } = {
    doc: document,
    navigate: (u) => {
      window.location.href = u;
    },
  },
): () => void {
  const { doc } = env;
  const cleanup = () => {
    clearTimeout(timer);
    doc.removeEventListener("visibilitychange", onHide);
  };
  const onHide = () => {
    if (doc.visibilityState === "hidden") cleanup();
  };
  const timer = setTimeout(() => {
    cleanup();
    if (doc.visibilityState === "visible") onFail();
  }, APP_OPEN_TIMEOUT_MS);
  doc.addEventListener("visibilitychange", onHide);
  env.navigate(url);
  return cleanup;
}
