// 합성 데이터: 카카오모빌리티 길찾기 응답 형식을 따른 가짜 값. 실제 응답 원문이 아니다(TASK-001 저장 금지 조건).
export const DIRECTIONS_OK = {
  trans_id: "synthetic",
  routes: [
    {
      result_code: 0,
      result_msg: "길찾기 성공",
      summary: { distance: 52300, duration: 4166 },
      sections: [
        {
          roads: [
            { name: "가상로", distance: 30000, traffic_state: 4, vertexes: [126.4929, 33.5066, 126.49, 33.45] },
            { name: "가상로2", distance: 22300, traffic_state: 2, vertexes: [126.52, 33.35, 126.5601, 33.2541] },
          ],
        },
      ],
    },
  ],
};

export const directionsNoRoute = (code: number, msg: string) => ({
  trans_id: "synthetic",
  routes: [{ result_code: code, result_msg: msg }],
});
