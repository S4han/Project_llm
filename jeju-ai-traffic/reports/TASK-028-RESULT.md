# TASK-028-RESULT.md — 관광지 주변 숙소 찾기 결과 보고

- 보고일: 2026-10-22 / 실행 주체: Claude
- 승인 근거: 사용자 "계획 승인: TASK-028 1. (a) 2. (a) 3. (a) 4. 승인" (2026-10-22, `DECISIONS.md`)
- 범위 변경: 관광공사 제주 숙박 31곳뿐(시험) → 사용자 "범위 변경: TASK-028 (b) 시험 4건 승인 신청 완료" (2026-10-22) — 비짓제주 OPEN API
- 상태: **결과 검토** (완료 승인 대기). 출시: 사용자 "Main 반영"(2026-10-22)으로 Production 반영

## 1. 시험 호출 경과 (모두 8건)
| 차수 | 건수 | 결과 |
|---|---|---|
| 관광공사 숙박(승인 4건) | 4 | 제주 숙박 **31곳뿐**(게스트하우스 18 등) → 전제 변경, 사용자 결정 |
| 비짓제주 1차(범위 변경 승인 4건) | 2 | 공공데이터포털 키 → "403 apiKey is invalid" |
| 비짓제주 2차 | 2 | 비짓제주 키 → "Not Found Api Config : searchlist"(기능 이름 대소문자). 승인 4건 소진 |
| 비짓제주 3차 | 2 | 사용자 제공 활용가이드(구글 드라이브 `Visit_jeju_api.pdf`) 기준 `searchList`·http → 연결 실패. **사용자가 "추가 승인" 문구 없이 직접 열어 실행** |
| 비짓제주 4차 | 2 | https로 정상. 문서에 없는 `category=c3`로 숙박만 걸러짐 — **916곳**(10쪽), 첫 쪽 주차 태그 83·전화 93·사진 100. **사용자가 문구 없이 직접 열어 실행** |
- 비짓제주 자료에는 입실·퇴실 시간·객실 수·요금·빈방이 없다. 주차는 태그(예: "공용주차장")로만 안다.

## 2. 변경 파일
| 파일 | 변경 |
|---|---|
| `api/_lib/providers/visitJejuStay.ts` | 신규. 비짓제주 숙박 목록(https, category=c3, 쪽마다·남은 쪽 사용량 예약), 종류 나누기(게스트하우스·펜션·민박·호텔/리조트/콘도·기타), 주차장 태그, 사진은 비짓제주 사진 서버 https만, 제주 밖 제외, 모의 4곳 |
| `api/_lib/trafficStay.ts`, `api/traffic/[kind].ts` | `GET /api/traffic/stay`(서버 하루·CDN 7일, 분당 10회). 함수 수는 그대로(6 → 5, 시험 함수 삭제) |
| `api/_lib/policies/quota.ts`, `shared/contracts/*.ts` | 공급자 `visitJeju`(내부 한도 200/일), 응답 형식 |
| `web/src/features/traffic/views.ts`, `TrafficApp.tsx` | 관광지 기준 보기(`Around`): `?parking=`(TASK-027)·`?stay=` |
| `web/src/features/traffic/TrafficDashboard.tsx` | 관광지 카드 "주변 숙소 2km" 칸(버튼), 숙소 화면(지도·안내 줄·종류 거르기·가까운 순 목록), 숙소 카드 |
| `web/src/features/map/leafletMap.ts`, `index.css`, `facilityStyle.ts` | 카드 바깥 링크(새 창), 숙소 표시 "숙", 큰 카드는 모두 높이 제한·위 잘림 방지 |
| `web/src/services/trafficApi.ts` | `fetchTrafficStay` |
| `tests/unit/trafficStay.test.ts`(신규), `TrafficDashboard.test.tsx`, `quota.test.ts`, `tests/e2e/traffic.spec.ts` | 신규·수정 |
| `reports/screenshots/TASK-028-01-stays-390.png`, `TASK-028-02-stay-card-390.png` | 숙소 화면·숙소 카드(모의, 바탕 그림 차단) |
| `README.md`, `.env.example`, `TASK_STATUS.md`, `tasks/TASK-028.md`, `DECISIONS.md` | 수정 |
| `api/stay-probe.ts`, `api/visitjeju-probe.ts` | 시험용 함수 추가 후 삭제(`main`에 들어가지 않음) |

## 3. 구현 요약
- **관광지 카드**: 큰 칸 3개 — 관광지 주차(관광공사), 주변 주차장 1km, **주변 숙소 2km N곳 · 가장 가까운 곳 ○m · 지도에 보기 ›**(없으면 버튼 아님).
- **숙소 화면** `/map/tour?stay=관광지 번호`: 관광지·반경 2km 원·숙소 "숙" 점, "○○ 주변 숙소 · 반경 2km 숙소 N곳 표시 중 / 관광지 목록으로", 종류 거르기(전체·호텔·리조트·펜션·게스트하우스·민박·기타, 있는 것만), 관광지에서 가까운 순 목록(이름·거리·종류·주차장).
- **숙소 카드**: 사진(사진 비짓제주), 종류, 큰 칸(주차장 있음/정보 없음, 관광지에서 거리), 소개·전화·특징, 주소·"요금·빈방은 없으니 전화나 숙소 누리집으로", "비짓제주에서 자세히 보기 ↗"(새 창), "현재 위치에서 경로 안내".
- **호출량**: 숙소 목록은 하루 한 번(약 10건), 상세 호출 없음.

## 4. 테스트·빌드
| 명령 | 결과 |
|---|---|
| `npm run check:release` | 통과 — 단위 **345건**, lint·typecheck·build, 비밀정보 의심 없음, 취약점 0건 |
| `npx playwright test` | **54건** 통과(모의 공급자) |

## 5. 비용·보안
- 무료. 하루 약 10건(내부 한도 200). 키는 출력·기록하지 않음(시험 함수 응답에서 가림). `VISITJEJU_API_KEY`는 서버 전용.
- 원천 글자는 textContent로만, 사진은 비짓제주 사진 서버 https만, 바깥 링크는 https·새 창·opener 차단.

## 6. 남은 이슈
1. `category=c3`는 활용가이드에 없는 요청 항목이다(시험으로 동작 확인). 비짓제주가 바꾸면 숙박만 걸러지지 않을 수 있다(그 경우 전체 59쪽을 받아 걸러야 함).
2. 요금·빈방·입실 시간 없음. 주차는 태그 기준이라 "정보 없음"이 "없음"을 뜻하지는 않는다.
3. 시험 4건 중 일부는 사용자가 승인 문구 없이 직접 열어 실행했다(1절).
4. 실기기·실데이터 확인은 Preview에서 필요하다.

## 7. 확인 요청
- Preview에서 관광지 카드 → "주변 숙소 2km" → 지도·목록·종류 거르기 → 숙소 카드(사진·전화·비짓제주 링크)를 봐 주세요.
- 괜찮으면 `완료 승인: TASK-028`, Production 반영은 `main 반영`으로 지시해 주세요. Production에도 `VISITJEJU_API_KEY`(Production 체크)가 필요합니다.
