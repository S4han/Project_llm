# TASK-016 — 주정차 단속 CCTV 지도 표시

- 상태: **완료** (2026-10-20, `reports/TASK-016-RESULT.md`) (사용자 "계획 승인: TASK-016 1. (a) 2. (a) 3. 승인 키 등록 완료", 2026-10-20)
- 근거: 사용자가 공공데이터포털 안내서와 `https://www.data.go.kr/data/15109175/openapi.do`(제주특별자치도 제주시_주정차 단속 CCTV 조회 서비스) 전달
- 선행 작업: TASK-015

## 범위
- 공공데이터포털 명세(페이지 안 Swagger): `https://apis.data.go.kr/6510000/parkingControlCctvService/getParkingControlCctvList`, 파라미터 serviceKey·pageNo·numOfRows, 응답 item: dataCd·instlPlaceNm·instlAdres·rtateCctvCnt·auditCctvCnt·operTimeInfo·laCrdnt·loCrdnt·regDt
- 시험 호출 5건 이내(Preview 임시 함수, 확인 후 삭제, main 미반영)
- `GET /api/traffic/enforcement`(서버 하루·CDN 7일 보관, 키 없으면 모의)
- 1.(a) 교통시설물 카드에 "주정차 단속" 유형 추가(기본 꺼짐) 2.(a) 점 팝업: 설치장소·주소·운영시간·회전형/검지 3. 키 이름 `DATA_GO_KR_API_KEY`(일반 인증키 Decoding)
- 제주시만 제공(서귀포시 없음), 위치만(영상 없음)

## 사용자 확인 지점
결과 검토 후 완료 승인. main 반영은 별도 지시.
