# TASK-013-RESULT.md — 교통시설물 지도 표시 결과 보고

- 보고일: 2026-10-20 / 실행 주체: Claude
- 승인 근거: 사용자 "계획 승인: TASK-013 1. (a) 2. 승인 3. 승인 4. 승인" (2026-10-20). `DECISIONS.md` 참조
- 상태: **완료** (사용자 "완료 승인: TASK-013", 2026-10-20). 공개 반영: main `ee106a5`

## 1. 시험 호출(승인 10건 이내, 사용 7건)
| 차수 | 내용 | 결과 |
|---|---|---|
| 1차(2건) | 안내 페이지대로 `fdtType=FTY01`, 기존 키·실시간 교통정보 키 | 둘 다 HTTP 400 |
| 2차(3건) | 기존 키로 파라미터 이름 3가지 + 오류 본문 표시 | 서버 메시지 "Required String parameter 'fcltType' is not present" → **파라미터는 `fcltType`**(안내 페이지 표의 fdtType은 오기). `fcltType` + 기존 키는 "code not registered" |
| 3차(2건) | `fcltType`, 실시간 교통정보 키(`JEJU_ITS_TRAFFIC_API_KEY`) | **success** — VMS 68개, CCTV 202개 |

- 항목: `fclt_id`, `fclt_type`, `fclt_lctn`, `mdl_nm`, `x_crdn`, `y_crdn`. **`x_crdn`이 위도, `y_crdn`이 경도**(이름이 반대). CCTV 일부 좌표 0(무효), 모델명 "-"는 없음.
- 별도 활용 신청 없이 실시간 교통정보 키로 조회된다. 전용 키(`JEJU_ITS_FACILITY_API_KEY`)를 등록하면 그 키를 먼저 쓴다.
- 임시 확인 함수(`api/facility-probe.ts`)는 삭제했다(main 미반영).

## 2. 변경 파일
| 파일 | 변경 |
|---|---|
| `api/_lib/providers/jejuItsFacilities.ts` | 신규 — 7개 유형 1건씩(`fcltType`), 좌표 정규화(위도·경도 교정, 0·제주 밖 제외), ID 중복 제거, 일부 실패 시 받은 것 + 실패 유형 |
| `api/_lib/trafficFacilities.ts`, `api/traffic/facilities.ts` | 신규 — `GET /api/traffic/facilities`, 서버 메모리 하루 + CDN 7일(일부 실패 시 1시간), 제주 ITS 일일 한도 사용(1회 7건), IP별 분당 10회 |
| `shared/contracts/traffic.ts` | `FacilityType`, `TrafficFacilitiesResponse` |
| `web/src/features/traffic/facilityStyle.ts` | 신규 — 유형별 이름·색(소통 색과 겹치지 않게) |
| `web/src/features/map/leafletMap.ts`, `IncidentMap.tsx` | 시설물 점(캔버스, 구간 선 위·사건 점 아래), 팝업 "유형 · 설치 위치 · 모델" |
| `web/src/features/traffic/TrafficDashboard.tsx` | "교통시설물" 카드(도로 소통 아래): 유형별 개수 버튼(기본 모두 꺼짐, 0개 유형은 비활성), 처리 현황, 실패 시 다시 시도, 일부 유형 실패 안내 |
| `web/src/services/trafficApi.ts` | `fetchTrafficFacilities` |
| `.env.example` | `JEJU_ITS_FACILITY_API_KEY`(선택) 이름 |
| 테스트 | `tests/unit/trafficFacilities.test.ts`(5건), `TrafficDashboard.test.tsx`(+2건), `tests/e2e/traffic.spec.ts`(+1건) |

PRD는 변경하지 않았다.

## 3. 화면
- 교통 현황 → 도로 소통 아래 **교통시설물** 카드: VMS·CCTV·웹카메라·영상VDS·AVI·신호제어기·RWIS 개수. 기본은 모두 꺼짐(승인 1. (a)), 누르면 지도에 그 유형의 점이 켜진다. 점을 누르면 "CCTV · 이호테우해변입구교차로 · 모델 TCS-3500".
- "CCTV 영상은 제공하지 않습니다"를 카드에 적었다(API가 위치 정보만 제공).
- 캡처: `reports/screenshots/TASK-013-01-facilities.png`(모의 데이터).

## 4. 테스트·빌드
| 명령 | 결과 |
|---|---|
| `npm run check:release` | 통과 — 단위 **259건**, 비밀정보 의심 문자열 없음, 취약점 0건 |
| `npm run test:e2e` | **38건** 통과 |

## 5. 비용·보안
- 비용 0원(제주 ITS 무료). 시설물은 하루 1번 정도 7건 호출(CDN 7일 보관이라 보통 더 적음).
- 키는 서버에서만 사용, 응답·로그에 키 없음.

## 6. 남은 이슈
1. 실데이터 화면 미확인: Preview/Production에서 7개 유형 실제 개수(웹카메라·영상VDS·AVI·신호제어기·RWIS)를 처음 받는다. 신호제어기 등이 많으면 휴대폰에서 점이 겹칠 수 있다.
2. 시설물 목록·검색(이름으로 찾기)은 없다. 필요하면 다음 요청으로.
3. CCTV 영상은 API에 없다.
