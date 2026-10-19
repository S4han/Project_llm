// 합성 데이터: TASK-001에서 확인한 제주 ITS 응답 형식({result, info_cnt, info[]}, latitude·longitude·link_id)을 따른 가짜 값.
// 설명·시각 필드 이름은 미확인이라 후보 이름 중 하나를 쓴다. 실제 응답 원문이 아니다.
export const ITS_EVENTS = {
  result: "success",
  info_cnt: 3,
  info: [
    { id: "e1", event_name: "정지차량", latitude: "33.4366", longitude: "126.4242", link_id: "4060001", update_time: "2026-10-19 15:58:00" },
    { id: "e2", event_name: "정지차량", latitude: "33.4366", longitude: "126.4242", link_id: "4060001" },
    { latitude: "90", longitude: "180", link_id: "x" },
  ],
};
export const ITS_EMPTY = { result: "success", info_cnt: 0, info: [] };
export const ITS_WORKS = {
  result: "success",
  info_cnt: 1,
  info: [{ latitude: 33.4, longitude: 126.6185, link_id: "4070002", reg_date: "20261019093000" }],
};
export const ITS_NOT_REGISTERED = { result: "code not registered", info_cnt: 0, info: [] };
