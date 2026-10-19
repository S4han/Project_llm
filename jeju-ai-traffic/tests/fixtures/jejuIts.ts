// 합성 데이터: TASK-006 실호출(2026-10-19)에서 확인한 제주 ITS 응답 형식을 따른 가짜 값. 실제 응답 원문이 아니다.
// 돌발: ocrr_id·latitude·longitude·heading·link_id·code / 공사: …·whole_lane·block_lane·text
export const ITS_EVENTS = {
  result: "success",
  info_cnt: 4,
  info: [
    { ocrr_id: "RA_0000000001", latitude: 33.4366, longitude: 126.4242, heading: -1, link_id: "4050000001", code: 534 },
    { ocrr_id: "RA_0000000002", latitude: 33.4366, longitude: 126.4242, heading: -1, link_id: "4050000001", code: 534 },
    { ocrr_id: "RA_0000000003", latitude: 33.41, longitude: 126.4, heading: -1, link_id: "4050000002", code: 258 },
    { ocrr_id: "RA_0000000004", latitude: 33.39, longitude: 126.38, heading: -1, link_id: "4050000003", code: 999 },
  ],
};
export const ITS_EMPTY = { result: "success", info_cnt: 0, info: [] };
export const ITS_WORKS = {
  result: "success",
  info_cnt: 2,
  info: [
    { ocrr_id: "2001", latitude: 33.4, longitude: 126.6185, heading: -1, link_id: "4050000010", whole_lane: 2, block_lane: "01", text: "가상교차로 - 가상마을" },
    // 실호출에서 본 무효 좌표 형식
    { ocrr_id: "2002", latitude: 90.00000001, longitude: 180.00000001, heading: -1, link_id: "4050000011", whole_lane: 2, block_lane: "00", text: "무효 좌표 공사" },
  ],
};
export const ITS_NOT_REGISTERED = { result: "code not registered", info_cnt: 0, info: [] };
