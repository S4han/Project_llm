# TASK-012-RESULT.md — ITS 실시간 교통 현황 대시보드 결과 보고

- 보고일: 2026-10-20 / 실행 주체: Claude
- 승인 근거: 사용자 "계획 승인: TASK-012 1. (a) 2. (b) 3. (a) 4. 승인" (2026-10-20). `DECISIONS.md` 참조
- 수행 범위: `/traffic` 대시보드, `GET /api/traffic/incidents`, 1분 자동 갱신, 고지, 테스트·캡처. 추가 제주 ITS 확인 호출 없음, 카카오 호출 없음.
- 상태: **결과 검토** (사용자 완료 승인 대기)

## 1. 변경 파일
| 파일 | 변경 |
|---|---|
| `api/_lib/incidents.ts` | 신규 — 제주 ITS 사건 조회(60초 캐시·일일 한도), `GET /api/traffic/incidents` 처리기, IP별 분당 20회 |
| `api/traffic/incidents.ts` | 신규 — Vercel 함수 진입점 |
| `api/_lib/routes.ts` | 사건 조회·공급자 선택을 `incidents.ts`로 옮겨 공유(동작 변화 없음) |
| `shared/contracts/traffic.ts` | `TrafficIncidentsResponse` 추가 |
| `web/src/features/traffic/TrafficDashboard.tsx`, `IncidentMap.tsx` | 신규 — 대시보드 화면, 제주 전체 사건 지도 |
| `web/src/services/trafficApi.ts` | 신규 — 대시보드 API 호출 |
| `web/src/features/map/leafletMap.ts` | 신규 — 지도 생성·사건 점 그리기 공용(경로 지도와 공유) |
| `web/src/features/routes/IncidentFocus.tsx`, `incidents.ts` | 사건 묶음 목록·지점 안내 막대·`useIncidentFocus`를 경로 화면에서 분리해 대시보드와 공유 |
| `web/src/features/routes/RouteMap.tsx`, `RouteResults.tsx` | 공용 부품 사용으로 정리(동작 변화 없음) |
| `web/src/main.tsx`, `web/src/App.tsx`, `vercel.json` | `/traffic` 주소 연결, 경로 화면 "교통 현황 →" 링크 |
| `tests/unit/trafficIncidents.test.ts`, `TrafficDashboard.test.tsx`, `App.test.tsx`, `tests/e2e/traffic.spec.ts` | 신규·수정 |
| `reports/screenshots/TASK-012-01-dashboard.png`, `TASK-012-02-focus.png` | 신규 |
| `README.md`, `docs/OPERATIONS.md`, `tasks/TASK-012.md`, `TASK_STATUS.md`, `DECISIONS.md` | 수정·신규 |

PRD는 변경하지 않았다.

## 2. 구현 요약
- **주소(2. (b))**: `/traffic`. 경로 화면 제목 옆 "교통 현황 →", 대시보드에서 "← 경로 추천". Vercel은 `vercel.json` `rewrites`로 `/traffic`에 같은 `index.html`을 준다.
- **표시(1. (a))**: 제주 전체 돌발·통제·공사(교통기상·VMS 제외).
  - 종류별 건수 버튼(전체·돌발·통제·공사)이 필터를 겸한다.
  - 제주 전체 지도에 사건 점, 아래에 "감지된 사건 N건" 묶음 목록(많은 순).
  - 묶음을 누르면 지점 확대·강조, "다음 지점 ›", "전체 보기"(TASK-011 기능 재사용). 지도 점을 누르면 설명 팝업.
  - 1분 자동 갱신은 사용자가 옮긴 지도 화면을 건드리지 않는다. 종류를 바꾸면 제주 전체로 다시 맞춘다.
- **자동 갱신(3. (a))**: 화면이 켜져 있을 때만 1분마다. 숨김 중에는 부르지 않고, 화면으로 돌아왔을 때 1분이 지났으면 바로 다시 조회. "새로고침" 버튼도 있다.
- **상태 안내**:
  - 갱신 실패: "갱신 실패: <사유> · 마지막 성공 HH:MM"(마지막 결과 유지)
  - 한도: "교통 사건 정보 미확보(오늘 조회 한도 도달, HH:MM 이후 다시 사용 가능)", 건수는 "–"
  - 장애: "교통 사건 정보 미확보(제주 ITS 조회 실패)"
  - 10분 지난 정보: "오래된 정보입니다(N분 전 조회)"
  - 0건: "현재 제주 ITS에 감지된 … 없습니다. 모든 도로의 사건이 제공되지는 않으므로, 도로에 이상이 없다는 뜻은 아닙니다."(AC-011-07과 같은 원칙)
- **고지(4.)**: "운전 중에는 화면을 조작하지 마세요.", "제주 ITS가 감지한 지점 정보이며, 발생 시각·상세와 모든 도로의 상황을 포함하지 않습니다. 이 화면은 위치정보를 사용하지 않습니다.", 출처(OpenStreetMap·제주 ITS).
- **서버**: 경로 조회와 같은 제주 ITS 어댑터·60초 캐시·일일 한도(2,000)를 쓴다. 실패·한도는 200 + `status`, 빈도 제한만 429.

## 3. 실행한 테스트·빌드와 결과
| 명령 | 결과 |
|---|---|
| `npm run check:release` | 통과 — 단위 **233건**(31개 파일), 비밀정보 의심 문자열 없음, 취약점 0건 |
| `npm run test:e2e` | **25건** 통과 (대시보드 3건 추가: 링크 이동·건수·지도·지점 표시·필터, 한도 안내, 1분 자동 갱신) |

신규 단위 테스트: 처리기 6건(전체 사건·no-store, 60초 캐시·사용량 3, 한도 quotaBlocked·재사용 시각·호출 0, 장애 unavailable, 분당 21번째 429, 공급자 선택), 화면 6건(건수·묶음·링크·고지, 필터·0건 안내, 지점 표시, 1분 갱신·숨김 중 멈춤·복귀 시 조회·실패 시 마지막 결과 유지, 한도 안내, 0건 안내).

## 4. 비용·보안
- 추가 비용 0원. 카카오 호출 없음.
- 제주 ITS 호출은 60초 캐시 덕분에 함수 인스턴스당 1분 최대 3회. 계속 열어 두면 하루 최대 4,320회까지 갈 수 있으나 내부 한도 2,000에서 차단된다.
- 키는 서버에서만 쓴다(`check:secrets` 통과). 대시보드는 위치정보를 쓰지 않는다.

## 5. 남은 이슈
1. **실기기·실데이터 미확인**: 모의 사건으로만 확인했다. 새 Preview의 `/traffic`에서 확인이 필요하다.
2. **한도 카운터가 함수별로 따로**: 경로 조회 함수와 대시보드 함수가 각각 메모리 카운터를 써서, 합치면 제주 ITS를 하루 2,000회 넘게 부를 수 있다(각 2,000, 최대 약 4,000). 제주 ITS는 무료이고 공개 한도가 없어 비용 위험은 없지만, 기관 측 제한이 있으면 차단될 수 있다.
3. 제주 ITS는 좌표 한 점만 주므로 지정체구간도 지점만 표시한다.
4. 사건이 많으면 목록이 길어진다(현재 묶음으로 줄였으나 페이지 나누기는 없음).

## 6. 다음 단계
- 사용자 결과 검토 → `완료 승인: TASK-012`.
- 공개 주소 반영은 별도 `main 반영` 지시가 필요하다.
