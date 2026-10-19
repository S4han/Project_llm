// 합성 데이터: 카카오 로컬 키워드 검색 문서의 응답 형식을 따른 가짜 값. 실제 응답 원문이 아니다.
export const KAKAO_KEYWORD_BODY = {
  meta: { total_count: 5, pageable_count: 5, is_end: true },
  documents: [
    {
      id: "1001",
      place_name: "성산일출봉",
      address_name: "제주특별자치도 서귀포시 성산읍 성산리 1",
      road_address_name: "",
      x: "126.9425",
      y: "33.4581",
    },
    {
      id: "1002",
      place_name: "제주국제공항",
      address_name: "제주특별자치도 제주시 용담이동 2002",
      road_address_name: "제주특별자치도 제주시 공항로 2",
      x: "126.4929",
      y: "33.5066",
    },
    // 제주 밖 주소 → 제외
    { id: "1003", place_name: "부산역", address_name: "부산 동구 초량동 1187-1", road_address_name: "", x: "129.0414", y: "35.1151" },
    // 무효 좌표 → 제외
    { id: "1004", place_name: "좌표없음", address_name: "제주특별자치도 제주시 어딘가", road_address_name: "", x: "", y: "" },
    // 범위 밖 좌표(주소는 제주) → 제외
    { id: "1005", place_name: "범위밖", address_name: "제주특별자치도 제주시 어딘가", road_address_name: "", x: "180", y: "90" },
  ],
};
