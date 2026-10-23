# TASK-033-RESULT.md — 카카오맵으로 지도 전환 결과 보고

- 보고일: 2026-10-23 / 실행 주체: Claude
- 승인 근거: 사용자 "계획 승인: TASK-033 1. (a) 2. (a) 3. (a) 4. (a) 5. (a)" (2026-10-23, `DECISIONS.md`)
- 상태: **결과 검토** (사용자 `완료 승인: TASK-033` 대기). main 미반영
- 시험 호출: 없음. 서버 함수 변경 없음. 카카오 SDK는 이 작업 환경에서 받을 수 없어(도메인 등록·키 없음) **실제 카카오 지도 화면은 아직 확인하지 못함** → 사용자 Preview 확인 필요

## 1. 변경 파일
| 파일 | 변경 |
|---|---|
| `web/src/features/map/kakaoSdk.ts` (신규) | SDK 받기(`autoload=false` → `kakao.maps.load`), 한 번만, 8초 안 준비 안 되면 null, 쓰는 부분만 적은 형식 |
| `web/src/features/map/kakaoMap.ts` (신규) | 엔진 고르기(`useKakaoMaps`), 확대 수준↔레벨, 범위 맞추기, 카드(`KakaoPopup`), 캔버스 층(점·도로 선, 화면 안만), DOM 표시(사건·내 위치·가격 표시) |
| `web/src/features/map/useKakaoMap.ts`, `KakaoControls.tsx` (신규) | 지도 만들기·바탕 그림 시간 초과 시 대체, 확대/축소·일반/위성 버튼 |
| `web/src/features/traffic/IncidentMap.tsx` | 카카오/Leaflet 고르는 겉 컴포넌트(같은 props) |
| `web/src/features/traffic/KakaoIncidentMap.tsx` (신규) | 교통·관광 지도 카카오 판 |
| `web/src/features/traffic/LeafletIncidentMap.tsx` (이름 변경), `incidentMapProps.ts` (신규) | 기존 Leaflet 지도 그대로, props 분리 |
| `web/src/features/routes/RouteMap.tsx`, `KakaoRouteMap.tsx` (신규), `LeafletRouteMap.tsx` (이름 변경) | 경로 지도 같은 방식 |
| `web/src/features/map/leafletMap.ts` | 가격 표시 DOM 만들기(`gasPinElement`)를 꺼내 카카오와 같이 씀 |
| `web/src/index.css` | 카드 CSS를 카카오 카드에도 적용, 카카오 카드 둘레·점 표시 |
| `web/src/App.tsx`, `StartPage.tsx`, `SearchPage.tsx`, `TrafficDashboard.tsx` | 출처 "지도 © 카카오(쓸 수 없을 때 브이월드·OSM)" |
| `.env.example`, `README.md` | `VITE_KAKAO_MAP_KEY` 이름·설명(값 없음), 구조·외부 전송 설명 |
| `tests/unit/fakeKakao.ts`, `tests/unit/kakaoMap.test.tsx` (신규) | 가짜 카카오 SDK로 14개 시험 |
| `TASK_STATUS.md`, `tasks/TASK-033.md`, `DECISIONS.md` | 상태 |

## 2. 구현 요약
- **1.(a) 모든 지도**: 관광지 검색(`/search`), 교통 현황 지도 페이지(`/map/…`), 경로 추천(`/route`)이 같은 겉 컴포넌트를 거쳐 카카오 지도로 그립니다. props·화면 맞추기 규칙(제주 전체·반경·검색 결과·목록에서 고른 곳 우선)은 그대로입니다.
- **2.(a) 자동 대체**: 다음이면 지금 지도(Leaflet·브이월드)로 그립니다.
  - 키가 없을 때
  - SDK를 8초 안에 못 받을 때(도메인 미등록·네트워크)
  - 지도를 만들지 못할 때
  - 바탕 그림이 12초 안에 한 번도 다 그려지지 않을 때(한도 초과 등). 한 번 바뀌면 그 화면에서는 다시 시도하지 않습니다.
- **3.(a) 점이 많은 지도**:
  - 관광지·CCTV 등 작은 점은 캔버스에 화면 안(반 화면 여유)만 그립니다.
  - 주유소·주차장 가격 표시는 화면 안에 든 것만 만듭니다.
  - 관광지 이름은 확대 15 이상에서 화면 안 250곳까지 붙습니다.
  - 점을 누르면 같은 카드가 열립니다(손가락 여유 6px).
- **4.(a) 도로 소통 선**: 화면 안에 걸친 구간만 그립니다. 앞 점과 1.5px도 안 떨어진 점은 건너뛰어, 멀리 볼수록 단순해집니다. 같은 색끼리 한 번에 그리고, 선 가까이 누르면 도로 카드가 열립니다.
- **5.(a) 일반/위성**: 오른쪽 위 버튼으로 바꿉니다. 위성은 카카오 스카이뷰에 이름을 겹친 것입니다. 그 아래에 확대/축소 버튼이 있고, 큰 카드가 열려 있으면 감춥니다.
- **카드**: Leaflet 카드와 같은 내용·CSS입니다. 닫기(×)나 지도 빈 곳 누르기로 닫히고, 카드가 지도 밖으로 잘리면 지도를 옮깁니다.

## 3. 수용 기준·확인
| 기준 | 결과 |
|---|---|
| 키 없을 때 지금 지도 그대로 | e2e 64개 통과(키 없이 Leaflet 쪽) |
| SDK 받기·실패·시간 초과 → 대체 | 단위 시험 통과 |
| 카카오 지도에서 점·가격 표시·사건·도로 선 누르면 카드, 빈 곳 누르면 닫힘 | 가짜 SDK 단위 시험 통과 |
| 목록에서 고르면 확대 15 이상·카드 | 가짜 SDK 단위 시험 통과 |
| 반경 원, 일반/위성, 경로 선·대체 경로 누르기 | 가짜 SDK 단위 시험 통과 |
| 바탕 그림 시간 초과 → Leaflet | 가짜 SDK 단위 시험 통과 |
| **실제 카카오 지도에서 상호·글자·조작** | **미확인** — 사용자 Preview 확인 필요 |

- 카카오 API 이름·인자는 공식 문서 사이트에 이 환경에서 접속이 안 돼(DNS 실패), 공개 형식 정의(npm `kakao.maps.d.ts`)와 맞춰 봤습니다. 확인한 것: `setBounds` 여백 인자, `panBy`, `setLevel` animate, `getNode`, `relayout`, `pointFromCoords`·`containerPointFromCoords`, `overlayLayer`, 선 모양 `shortdash`, `MapTypeId.HYBRID`.

## 4. 시험·빌드
- `npm run check`: lint·typecheck 통과, 단위 387개 통과(신규 14), 빌드 통과
- `npx playwright test`: 64개 통과
- `npm run check:secrets`: 비밀정보 의심 문자열 없음
- 빌드 JS 542kB(gzip 164kB)라 500kB 경고가 납니다. 카카오 SDK는 번들에 들어가지 않고 실행 중에 받습니다.

## 5. 비용·보안
- 월 비용 0원: 카카오 지도 무료 사용량 안에서 쓰고, 결제 수단을 등록하지 않으면 한도에서 막힌 뒤 브이월드로 대체됩니다. 사용량은 카카오 개발자 콘솔에서 확인합니다.
- `VITE_KAKAO_MAP_KEY`는 등록 도메인에서만 동작하는 공개 JavaScript 키라 화면 코드에 들어갑니다. 로그·출력·커밋에는 남기지 않았습니다. REST 키(`KAKAO_REST_API_KEY`, 서버 전용)와 다른 키입니다.
- 카카오 지도는 브라우저가 카카오에서 직접 받으므로, 보는 지역과 IP가 카카오에 전달됩니다(README에 적음). 내 위치 좌표는 보내지 않습니다.

## 5-1. 점검 중 바뀐 것
- 처음 등록한 키(Jeju_Ai_prd 앱)는 이 앱에서 카카오맵이 꺼져 있어 지도가 브이월드로 나왔다. 켜려면 월렛(유료) 연결이 필요해 켜지 않았다. 카카오 무료 쿼터는 계정에서 처음 켠 앱(Pat-Map) 하나에만 준다.
- 사용자가 `VITE_KAKAO_MAP_KEY`를 Pat-Map 앱의 JavaScript 키로 바꾸고 도메인 3개를 등록했다(`DECISIONS.md`).
- 원인 확인용으로, 키가 있는데 브이월드로 바뀌면 지도 아래에 까닭 한 줄을 보이게 했다(SDK 받기 실패·준비 응답 없음·지도 만들기 실패·바탕 그림 시간 초과).

## 6. 남은 이슈
- 실제 카카오 지도에서 다음을 확인해야 합니다:
  - 캔버스 점·선의 위치 정확도와 끌기·확대 때 따라오는지
  - 카드 위치
  - 휴대폰 조작
- 끄는 동안에는 이미 그린 화면 안(반 화면 여유)만 보이고, 멈추면 다시 그립니다.
