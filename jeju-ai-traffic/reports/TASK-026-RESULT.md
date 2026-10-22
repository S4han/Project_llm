# TASK-026-RESULT.md — 제주 관광지 정보 결과 보고

- 보고일: 2026-10-22 / 실행 주체: Claude
- 승인 근거: 사용자 "계획 승인: TASK-026 1. (a) 2. (a) 3. (a) 4. 승인 신청 완료" (2026-10-22, `DECISIONS.md`)
- 범위 변경: Preview 빌드 실패(Vercel Hobby 함수 12개 한도) → 사용자 "범위 변경: TASK-026 함수 통합 (a)" (2026-10-22)
- 범위 변경: 사용자 "주차정보를 관광공사 API 결과 + 해당 관광지 기준 반경 1키로 주차장 정보 포함해서 출력" (2026-10-22)
- 상태: **결과 검토** (완료 승인 대기, `main` 미반영)

## 1. 변경 파일
| 파일 | 변경 |
|---|---|
| `api/traffic/[kind].ts` | (범위 변경) 교통 함수 8개(incidents·speeds·links·facilities·enforcement·parking·gas·ev)를 하나로 묶고 `tour` 추가. 주소·응답·보관은 그대로. 함수 12 → 5 |
| `api/traffic/*.ts`(8개) | 삭제(위로 통합) |
| `api/_lib/providers/ktoTour.ts` | 신규. 한국관광공사 KorService2 목록(`areaBasedList2` 제주·관광지)·소개정보(`detailIntro2`), HTML 걷어 내기, 사진은 관광공사 사진 서버만 https로, 제주 밖 좌표 제외, 모의 3곳 |
| `api/_lib/trafficTour.ts` | 신규. `GET /api/traffic/tour`(목록, 서버 하루·CDN 7일), `?id=`(상세, 관광지마다 30일), 번호 검사, 분당 30회 |
| `api/_lib/policies/quota.ts`, `shared/contracts/common.ts`, `shared/contracts/traffic.ts` | 공급자 `kto`(내부 한도 800/일), 응답 형식 |
| `web/src/services/trafficApi.ts` | `fetchTrafficTour`, `fetchTrafficTourDetail`(같은 관광지는 한 번만, 실패는 다시) |
| `web/src/features/traffic/facilityStyle.ts`, `views.ts` | 유형 `TOUR`(반경 5km, "관"), 주차 판단 `tourParking`, `/map/tour` |
| `web/src/features/map/leafletMap.ts`, `web/src/index.css` | 카드 사진·출처, 열 때 불러와 채우는 카드(`loadCard`), 긴 카드 높이 제한·위가 잘리지 않게 지도 내리기, 항목 이름 한 줄 |
| `web/src/features/traffic/TrafficDashboard.tsx` | 대시보드 "관광지" 카드, 관광지 페이지(가까운 순 목록·지도·카드), 화면 아래 출처 |
| `vite.config.ts` | 개발 서버가 경로 조각 파일(`[kind].ts`)을 찾게 |
| `tests/unit/trafficTour.test.ts`, `trafficRoute.test.ts`(신규), `TrafficDashboard.test.tsx`, `quota.test.ts`, `tests/e2e/traffic.spec.ts` | 신규·수정 |
| `reports/screenshots/TASK-026-01-tour-390.png` | 관광지 페이지·카드(모의, 바탕 그림 차단) |
| `README.md`, `.env.example`, `TASK_STATUS.md`, `tasks/TASK-026.md`, `DECISIONS.md` | 수정 |
| `api/tour-probe.ts` | 시험용 함수 추가 후 삭제(`main`에 들어가지 않음) |

## 2. 시험 호출 결과 (4건 / 승인 5건)
- 제주(areaCode 39) 관광지 **194곳**, 사진 191곳, 목록의 전화는 0곳(문의는 소개정보 `infocenter`에 있음).
- 좌표 1곳이 원천 오타(경도 12.79)라 제주 밖으로 제외된다.
- 소개정보 항목: `usetime`(이용시간), `restdate`(쉬는날), `parking`(주차, 예: "불가능"), `infocenter`(문의) 등.

## 3. 구현 요약
- **대시보드**: "그 밖의 정보"에 "관광지 N곳 · 반경 5km 안"(위치 없으면 제주 전체).
- **관광지 페이지** `/map/tour`: 반경 5km 관광지를 "관" 동그라미로(확대 17 이상이면 이름), 가까운 순 목록 10곳씩.
- **카드**(점이나 목록을 누르면): 대표 사진·"사진 한국관광공사", 주차 칩(주차 가능/불가/정보 없음), 이용시간·쉬는날·주차(원문)·문의, 주소, "바뀌었을 수 있으니 방문 전 확인", "현재 위치에서 경로 안내". 상세는 누를 때만 불러오며 그동안 "불러오는 중…".
- **주변 주차장(범위 변경)**: 카드에 관광공사 주차 정보(칩·원문)와 함께 "주변 주차장" 줄. 관광지 기준 반경 1km 주차장(전국주차장정보표준데이터, 화면을 열 때 이미 받는 자료) 수·무료 수, 가까운 3곳의 이름·거리·요금 구분(무료/유료/일부유료). 칩 "주변 주차장 N곳". 없으면 "반경 1km 안 주차장 없음". 외부 호출 추가 없음.
- **주차 판단**: "불가·없음" → 불가, "가능·있음·N대·주차장" → 가능, 그 밖·빈 값 → 정보 없음(원문은 그대로 보임).
- **호출량**: 목록은 하루 한 번(194곳 1건), 상세는 관광지마다 30일에 한 번. 하루 수십 건 수준.

## 4. 테스트·빌드
| 명령 | 결과 |
|---|---|
| `npm run check:release` | 통과 — 단위 **335건**, lint·typecheck·build, 비밀정보 의심 없음, 취약점 0건 |
| `npx playwright test` | **52건** 통과(모의 공급자) |

신규 테스트: 글자 정리·사진 주소(관광공사만·https)·목록/상세 정규화·제주 밖 제외·한도 오류·보관(같은 관광지 재호출 없음)·잘못된 번호 400·주차 판단(단위), 함수 통합 종류 해석·모르는 종류 400(단위), 대시보드 카드·관광지 목록·카드 불러오기·주변 주차장(반경 1km·가까운 순·무료 수, 단위·e2e), 카드 위가 지도 안에 보임(e2e).

## 5. 비용·보안
- 시험 호출 4건, 운영도 하루 수십 건(무료, 내부 한도 800). 키는 출력·기록하지 않았다(시험 함수 응답에서도 가림).
- 원천 글자는 HTML을 걷어 내고 textContent로만 그린다. 사진은 관광공사 사진 서버 주소만 허용.
- 위치는 기기에서만 사용(변경 없음).

## 6. 남은 이슈
1. 함수 통합 뒤 실제 Vercel에서 모든 교통 정보가 그대로 나오는지는 사용자 Preview 확인이 필요하다(로컬·테스트는 통과).
2. 관광공사 자료는 194곳으로 비짓제주보다 적을 수 있고 운영시간이 최신이 아닐 수 있다(카드에 안내).
3. 사진은 저작권 구분(Type1 출처표시·Type3 변경금지)에 맞게 출처를 표시하고 자르지 않고 맞춰 보이게만 한다(화면 크기에 맞춰 일부가 가려질 수 있음).
4. 실기기 확인 전.

## 7. 확인 요청
- Preview에서 대시보드 카드 숫자·각 지도 페이지가 전처럼 나오는지(함수 통합), 관광지 카드 → 지도 → 관광지를 눌러 이용시간·주차가 나오는지 봐 주세요.
- 괜찮으면 `완료 승인: TASK-026`, Production 반영은 `main 반영`으로 지시해 주세요.
