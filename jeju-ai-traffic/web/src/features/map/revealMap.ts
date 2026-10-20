/** 지도가 화면에 다 보이지 않을 때만 지도로 스크롤한다(넓은 화면은 지도가 고정되어 보이므로 움직이지 않는다, TASK-012 반응형). */
export function revealMap(el: HTMLElement | null) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  if (r.top >= 0 && r.bottom <= window.innerHeight) return;
  el.scrollIntoView?.({ behavior: "smooth", block: "center" });
}
