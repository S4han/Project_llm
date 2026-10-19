# 제주 AI 교통 경로 추천 웹서비스

- 상태: **TASK-006 지도·교통정보 표시** (2026-10-19). 설명은 TASK-007 이후. 장소·경로·교통 사건은 기본으로 모의 데이터를 쓴다.
- 요구사항: `PRD.md` (구글 드라이브 확정 PRD v1.0의 동일 사본)
- Codex 시작: `START_HERE.md`
- 설계: `IMPLEMENTATION_PLAN.md`
- 작업: `tasks/TASK-001.md`부터 순차 수행

## 개발 환경 (TASK-002 실측, 2026-10-19)
| 항목 | 버전 |
|---|---|
| Node.js / npm | v22.22.0 / 10.9.4 (`engines.node >= 22`) |
| TypeScript | 6.0.3 (7.x는 typescript-eslint 8.71 미지원으로 제외) |
| React / Vite / Tailwind CSS | 19.3.1 / 8.3.4 / 4.3.3 (`@tailwindcss/vite`) |
| Leaflet | 1.9.4 (지도, OpenStreetMap 타일) |
| Vitest / jsdom / Testing Library | 5.0.5 / 29.1.1 / 16.3.3 |
| Playwright | 1.56.1 (작업 환경에 설치된 Chromium 1194와 맞춤) |
| ESLint / typescript-eslint | 10.13.0 / 8.71.2 |

호스팅: Vercel Hobby 단일 프로젝트(웹 정적 + Functions), 리전 `icn1` 고정(`vercel.json`).

## 폴더 구조
```text
web/            React 앱 (Vite root, index.html, src/)
  src/features/trip/  출발지·목적지 선택 화면
  src/features/routes/ 경로 비교 결과·지도(RouteMap)·혼잡 표시
  src/services/       API 호출(placesApi, routesApi), 위치(geolocation)
api/            Vercel Functions — 파일 하나가 엔드포인트 (api/health.ts, api/places.ts, api/routes/compare.ts)
api/_lib/       함수 공용 코드 (밑줄 폴더는 Vercel이 엔드포인트로 배포하지 않음)
  errors.ts       오류 코드 ↔ HTTP 상태, 공통 오류 응답
  places.ts       장소 검색 처리(입력 검사·빈도 제한·사용량·제주 필터)
  routes.ts       경로 비교 처리(입력 검사·빈도 제한·사용량·다회 호출·중복 합치기·최단 추천)
  policies/       사용량 한도(quota), 외부 호출 관문(guardedCall), KST 날짜, 짧은 캐시, IP별 빈도 제한(rateLimit)
  providers/      공급자 인터페이스(types), 모의 공급자(mock, mockPlaces, mockRoutes, mockTraffic), 카카오 로컬·모빌리티·제주 ITS 어댑터(kakaoLocal, kakaoMobility, jejuIts)
  explanations/   설명 생성(규칙 기반 + AI 대체 계약)
shared/         웹·API 공용 (contracts/: common, route, traffic, explanation, place, health / rules/geo: 제주 범위·좌표 검사, rules/route: 경로 구성·중복·최단·동률, rules/traffic: 혼잡 코드·비율, 사건 매칭(200m), 최신성(10분))
tests/unit/     Vitest 단위·계약·화면 테스트
tests/e2e/      Playwright 브라우저 흐름 테스트(모바일 390×844)
tests/fixtures/ 합성 모의 데이터 (실제 응답 원문 아님)
```

## 설치·실행·테스트 (모두 `jeju-ai-traffic/`에서 실행, 2026-10-19 실측 통과)
| 명령 | 내용 |
|---|---|
| `npm install` | 의존성 설치 |
| `npm run dev` | 개발 서버 (http://localhost:5173). 개발 전용 미들웨어가 `/api/<이름>`을 `api/<이름>.ts`의 `GET`으로 실행한다(Vercel 로그인 불필요, 장소 검색은 모의 데이터) |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest 1회 실행 |
| `npm run test:e2e` | Playwright 브라우저 테스트(개발 서버 자동 실행). 캡처는 `SCREENSHOTS=TASK-00N npm run test:e2e`처럼 지정한 TASK 것만 `reports/screenshots/`에 저장 |
| `npm run build` | 웹 빌드 → `dist/` |
| `npm run check` | lint → typecheck → test → build 순서로 모두 실행 (e2e는 별도) |

### API
- `GET /api/health` → `{ "status": "ok", "service": "jeju-ai-traffic", "region": "icn1", "checkedAt": "<ISO>" }`, `Cache-Control: no-store`. 외부 호출·키 사용 없음. 로컬에서는 `region`이 `local`.

- `GET /api/places?q=검색어` → `{ "query", "places": [{ id, name, address, roadAddress, location, provider }], "observedAt" }`. 검색어 1~50자. 제주 범위(위도 33.0~34.0, 경도 126.0~127.0) 안이면서 주소가 '제주특별자치도'로 시작하는 결과만 준다. 결과는 저장·캐시하지 않는다.
  - 공급자: 기본은 모의 데이터(`provider: "mock"`, 화면에 '모의 데이터' 표시). `PLACES_PROVIDER=kakao`와 `KAKAO_REST_API_KEY`가 **둘 다** 있을 때만 카카오 로컬 키워드 검색을 호출한다(실호출은 별도 승인 후).

- `POST /api/routes/compare` `{ origin: {lat,lng}, destination: {lat,lng} }` → `{ routes[], recommendedRouteId, tiedRouteIds, observedAt, stale }`.
  - 호출 구성: 카카오 추천(RECOMMEND)·최단거리(DISTANCE) 2회. 한라산 횡단(한쪽 위도 ≥ 33.38, 다른 쪽 ≤ 33.33)이면 1100도로·516도로 경유 2회 추가.
  - 거리 1% 이내 + 시간 2분 이내는 같은 경로로 합친다. 일부 호출이 실패하면 성공분만 준다.
  - 추천: 예상시간(초) 최솟값. 동률이면 거리가 짧은 경로, 거리도 같으면 호출 순서. 동률 경로는 `tiedRouteIds`.
  - 카카오가 경로를 못 찾으면 400 `INVALID_INPUT`(출발지·목적지 주변 도로 없음 안내). 결과는 저장·캐시하지 않는다. IP별 분당 10회.
  - 공급자: 기본 모의(`provider: "mock"`). `ROUTES_PROVIDER=kakao`와 `KAKAO_REST_API_KEY`가 **둘 다** 있을 때만 카카오모빌리티를 호출한다.
  - 구간 혼잡(`segments`): 카카오 `traffic_state`(4 원활, 2·3 서행, 1·6 정체, 0 정보 미확보). 도로 블록 평균값이다.
  - 교통 사건: 제주 ITS 돌발·통제·공사를 60초 캐시로 조회해 경로 200m 이내만 `incidentIds`로 연결한다. 실패·한도면 `incidentsStatus`가 `unavailable`·`quotaBlocked`이고 경로 비교는 그대로 준다.
  - 교통 공급자: 기본 모의. `TRAFFIC_PROVIDER=jejuIts`와 `JEJU_ITS_API_KEY`가 **둘 다** 있을 때만 제주 ITS를 호출한다(국외 IP 차단 → Vercel `icn1`에서만 동작).

### 외부 호출 규칙 (TASK-003)
- 모든 외부 호출은 `guardedCall(quotaGuard, 공급자, 호출, { cost, purpose })`을 거친다. 사용량을 먼저 예약하고, 거절되면 호출하지 않는다.
- 내부 일일 한도(KST 0시 초기화): 카카오 경로 8,000건(사용 6,000건 이상이면 `purpose: "reevaluation"` 차단), 카카오 장소 검색 3,000건, 제주 ITS 2,000건(+ 60초 캐시 `TtlCache`), AI 0건(차단).
- 장소 검색은 IP별 분당 20회 제한(IP는 메모리에만, 로그에 남기지 않음).
- 공급자가 429를 주면 다음 KST 0시까지 그 공급자를 차단한다.
- 카운터는 서버 메모리라 인스턴스마다 따로 센다(합계는 근사치). 최종 과금 차단은 공급자 측 한도(카카오 429)에 의존한다.
- 오류 응답: `{ "error": { "code", "message", "retryAfter?" } }`. `INVALID_INPUT` 400, `LOCATION_UNAVAILABLE` 422, `QUOTA_BLOCKED` 429(+`Retry-After`), `PROVIDER_UNAVAILABLE` 503, `STALE_DATA`는 200 + `stale: true`.

## 환경 변수
`.env.example`에 이름만 있다(`KAKAO_REST_API_KEY`, `PLACES_PROVIDER`, `ROUTES_PROVIDER`, `JEJU_ITS_API_KEY`, `TRAFFIC_PROVIDER`). 실제 값은 Vercel 환경 변수(Sensitive)로만 등록한다. 장소 검색은 `PLACES_PROVIDER=kakao`, 경로 비교는 `ROUTES_PROVIDER=kakao`일 때만 `KAKAO_REST_API_KEY`를, 교통 사건은 `TRAFFIC_PROVIDER=jejuIts`일 때만 `JEJU_ITS_API_KEY`를 읽는다. 그 외 코드는 키를 읽지 않는다.

## 운영 정책
월 운영비 0원 우선. 무료 호출/청구 차단 검증 전 실제 유료 API 연동·배포 금지. AI 실패/무료 한도 소진 시 규칙 기반 설명, 출처 표시. 외부 내비에는 목적지만 전달.

## 배포 (확인된 사실, 2026-10-19)
- Vercel 프로젝트 `jeju-its-probe`(팀 splendid3, Hobby)가 GitHub `S4han/Project_llm`과 연결되어 있고 Root Directory는 `jeju-ai-traffic`이다.
- **푸시하면 자동 배포된다:** 작업 브랜치 → Preview, `main` → Production. Production 주소는 공개된다.
- **Production은 실제 공급자를 쓴다**(2026-10-19 "Production 실호출 승인"): Vercel Production 환경 변수 `ROUTES_PROVIDER=kakao`, `PLACES_PROVIDER=kakao`, `TRAFFIC_PROVIDER=jejuIts`와 키. Preview는 `JEJU_ITS_API_KEY`만 있어 모의 데이터로 동작한다.
- 지도 타일(OpenStreetMap)은 브라우저가 직접 받는다. 출처 표시가 필요하며, 사용자의 IP와 보는 지역이 OSM 서버에 전달된다.

