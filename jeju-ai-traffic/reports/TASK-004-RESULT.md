# TASK-004-RESULT.md — 출발지·목적지 검색 결과 보고

- 보고일: 2026-10-19 / 실행 주체: Claude
- 승인 근거: 사용자 "계획 승인: TASK-004 1. 승인 2. 승인 3. 승인 4. 승인 5. (a)" (2026-10-19). `DECISIONS.md` 참조
- 수행 범위: `GET /api/places`, 장소 공급자(모의·카카오 로컬 어댑터), 제주 범위·좌표 규칙, 출발지·목적지 화면, Vitest·Playwright 테스트, 모바일 화면 캡처. **실제 외부 호출·키 사용·배포는 하지 않았다.**
- 상태: **결과 검토** (사용자 `완료 승인: TASK-004` 대기)

## 1. 변경 파일
| 파일 | 변경 |
|---|---|
| `shared/contracts/place.ts` | 신규 — `Place`, `PlaceSearchResponse`, 검색어 최대 길이 50 |
| `shared/contracts/common.ts` | 수정 — `ProviderId`에 `kakaoLocal` 추가 |
| `shared/rules/geo.ts` | 신규 — 제주 범위, 좌표 유효성, 제주 주소, 거리, `checkTrip`(출발지·목적지 검사) |
| `api/places.ts`, `api/_lib/places.ts` | 신규 — `GET /api/places` 처리, 공급자 선택 |
| `api/_lib/policies/rateLimit.ts` | 신규 — IP별 분당 20회 |
| `api/_lib/policies/quota.ts` | 수정 — `kakaoLocal` 일일 3,000건 |
| `api/_lib/providers/kakaoLocal.ts` | 신규 — 카카오 로컬 키워드 검색 어댑터·정규화 |
| `api/_lib/providers/mockPlaces.ts` | 신규 — 모의 장소 6곳(공공 장소, 근사 좌표) |
| `api/_lib/providers/types.ts` | 수정 — `PlaceProvider` 인터페이스 |
| `web/src/features/trip/{TripForm,OriginPicker,PlaceSearch}.tsx`, `types.ts`, `format.ts` | 신규 — 출발지·목적지 화면 |
| `web/src/services/{placesApi,geolocation}.ts` | 신규 — API 호출, 위치 요청 |
| `web/src/App.tsx`, `web/src/index.css` | 수정 — 화면 연결, 한국어 줄바꿈(`keep-all`) |
| `vite.config.ts` | 수정 — 개발 서버 전용 `/api` 미들웨어(빌드에 미포함) |
| `playwright.config.ts`, `tests/e2e/search.spec.ts` | 신규 — 브라우저 흐름 7건 |
| `tests/unit/{geo,rateLimit,kakaoLocal,placesHandler,geolocation,TripForm}.test.*` | 신규 — 34건 |
| `tests/unit/{quota,App}.test.*` | 수정 — 예산·화면 변경 반영 |
| `tests/fixtures/kakaoLocal.ts` | 신규 — 합성 데이터(실제 응답 원문 아님) |
| `reports/screenshots/TASK-004-0[1-7]-*.png` | 신규 — 모바일 화면 캡처 7장 |
| `package.json`, `package-lock.json` | 수정 — `@playwright/test` 1.56.1, `test:e2e` 스크립트 |
| `tsconfig.json`, `eslint.config.js`, `.gitignore` | 수정 — Playwright 파일·결과 폴더 |
| `.env.example` | 수정 — `PLACES_PROVIDER` 이름 추가 |
| `README.md`, `IMPLEMENTATION_PLAN.md`(v0.5) | 수정 |
| `TASK_STATUS.md`, `DECISIONS.md` | 수정 — 계획 승인·결과 검토 전환 기록 |

PRD는 변경하지 않았다.

## 2. 구현 요약
- **`GET /api/places`:** 검색어 검사(1~50자) → IP별 빈도 제한 → `guardedCall`로 `kakaoLocal` 사용량 예약 → 공급자 → 제주 범위·주소 재확인 후 응답. 오류는 TASK-003 공통 형식.
- **공급자 선택:** `PLACES_PROVIDER=kakao`와 `KAKAO_REST_API_KEY`가 **둘 다** 있을 때만 실제 카카오를 호출한다. 지금은 어느 환경에도 설정하지 않았으므로 항상 모의 공급자로 동작한다. 모의 결과에는 화면에 '모의 데이터' 표시가 붙는다.
- **카카오 어댑터:** `rect=126,33,127,34`(제주 범위), `KakaoAK` 인증, 5초 시간 제한. 429 → 차단(TASK-003 규칙), 그 밖의 실패 → `PROVIDER_UNAVAILABLE`. 제주 밖 주소·무효 좌표·범위 밖 좌표는 버린다. 응답 형식은 카카오 문서 기준 합성 데이터로만 검증했다.
- **화면:** 출발지는 '현재 위치 사용'(10초 제한, 고정밀) 또는 '직접 검색'. 권한 거부·제주 밖·위치 기능 없음은 곧바로 직접 검색 칸을 연다. 정확도 부족(200m 초과)·시간 초과·확인 불가는 '현재 위치 다시 확인' 버튼과 직접 검색을 함께 준다. 검색은 버튼·엔터로만. 출발지·목적지가 모두 유효하고 30m보다 떨어져 있을 때만 '경로 조회'가 켜진다. 버튼을 누르면 "경로 비교는 다음 단계에서 제공됩니다"를 보여 준다(TASK-005에서 연결).
- **위치 정보:** 좌표는 화면 상태(메모리)에만 있고 저장·전송하지 않는다. 화면에는 좌표 대신 "현재 위치 (오차 약 ±N m)"만 표시한다.
- **개발 서버:** `npm run dev`에서 `/api/health`, `/api/places`가 실제 핸들러(모의 공급자)로 동작하도록 개발 전용 미들웨어를 추가했다. 빌드 결과에는 들어가지 않는다(웹 번들에서 서버 코드·키 이름이 없는 것을 확인).

## 3. 실행한 테스트·빌드와 결과 (2026-10-19)
| 명령 | 결과 |
|---|---|
| `npm run lint` | **통과** |
| `npm run typecheck` | **통과** |
| `npm test` | **통과** — 테스트 파일 14개, **72건**(기존 38 + 신규 34) |
| `npm run build` | **통과** |
| `npm run test:e2e` | **통과** — Playwright **7건**(Chromium, 모바일 390×844, 터치, ko-KR, Asia/Seoul) |
| 개발 서버 수동 확인 | `/api/health` 200, `/api/places?q=성산` 200(모의 1건), `q=` 400 `INVALID_INPUT` |
| 웹 번들 검사 | `dist/`에 `dapi.kakao`·`KAKAO_REST_API_KEY`·`KakaoAK`·모의 데이터 없음 |

Playwright 흐름: 권한 허용 → 현재 위치 → 목적지 선택 → 조회 활성 / 권한 거부 → 직접 검색 → 조회 활성 / 제주 밖 위치 / 정확도 부족(850m) / 결과 없음·조회 제한 / 출발지=목적지 차단 / 가로 스크롤 없음.

## 4. 모바일 화면 확인 (계획 5번 (a))
`reports/screenshots/`에 390×844(2배율) 캡처 7장이 있다. GitHub에서 열어 볼 수 있다.

| 파일 | 장면 |
|---|---|
| `TASK-004-01-initial.png` | 첫 화면 |
| `TASK-004-02-results.png` | 현재 위치 설정 후 목적지 검색 결과 |
| `TASK-004-03-ready.png` | 출발지·목적지 선택 완료, 경로 조회 활성 |
| `TASK-004-04-denied.png` | 위치 권한 거부 안내 + 출발지 직접 검색 |
| `TASK-004-05-inaccurate.png` | 정확도 부족 안내 + 다시 확인 |
| `TASK-004-06-empty.png` | 제주 검색 결과 없음 |
| `TASK-004-07-quota.png` | 조회 한도 도달 + 다시 사용 가능 시각 |

캡처를 보고 고친 점: 한국어가 단어 중간에서 줄바꿈되어 `word-break: keep-all`을 적용했고, 재사용 시각을 "10. 20." 대신 "10월 20일 00:00"으로 바꿨다.

## 5. 수용 기준
| PRD AC | 결과 | 근거 |
|---|---|---|
| AC-001-01 현재 위치 허용 시 출발지 설정 | 통과(모의 위치) | TripForm·e2e 허용 흐름. 실제 기기 GPS는 미검증 |
| AC-001-02 권한 거부해도 수동 입력 | 통과 | TripForm·e2e 거부 흐름 |
| AC-001-03 수동 출발지 기준 조회 | 통과(전달까지) | 선택한 장소가 `onRequestRoute`로 전달됨. 실제 경로 조회는 TASK-005 |
| AC-001-04 무효 출발지면 조회 차단·안내 | 통과 | 제주 밖·무효 좌표·출발지=목적지 → 버튼 비활성 + 안내 |
| AC-002-01 검색어에 대한 장소·주소 결과 | 부분 | 모의 공급자로 통과. 실제 카카오 결과는 미검증. 키워드 검색이 순수 주소 검색어에 결과를 주는지 미확인(아래 7절) |
| AC-002-02 결과 선택 시 목적지 설정 | 통과 | TripForm·e2e |
| AC-002-03 결과 없음 표시 | 통과 | TripForm·e2e |
| AC-002-04 목적지 미선택이면 조회 안 함 | 통과 | 버튼 비활성, '변경' 후 다시 비활성 |
| AC-011-04 권한 거부 시 수동 입력 | 통과 | AC-001-02와 같음 |
| AC-011-05 정확도 부족 시 재확인 안내 | 통과(모의 위치) | 200m 초과 → 안내·다시 확인 |
| COST-005 제한 사유·시각 표시 | 통과(검색) | 조회 한도·빈도 제한 메시지와 재사용 시각 |
| NFR-001 모바일 반응형 | 부분 | 390×844 캡처·가로 스크롤 없음. 실제 기기·지원 브라우저 범위는 미검증 |
| NFR-004 최소 위치정보 | 통과(현 범위) | 좌표 미저장·미전송, 화면에 좌표 미표시 |

## 6. 비용·보안 영향
- 비용: **0원.** 외부 API 호출·배포 없음. npm에서 `@playwright/test` 설치만 함.
- 보안: 키 미사용. IP는 빈도 제한용으로 메모리에만 두고 로그·응답에 남기지 않는다. 오류 응답에 내부 메시지를 싣지 않는다(TASK-003).

## 7. 남은 이슈
1. **카카오 로컬 실호출 미검증.** 실제 호출 전에 사용자 카카오 앱이 카카오맵(로컬) 무료 쿼터를 받는지(계정당 첫 활성화 앱 규칙) 확인해야 한다. 실호출 시험은 별도 승인(결제수단 미연결, 20건 이내).
2. **순수 주소 검색.** 키워드 검색은 장소 이름에 강하고 주소만 입력한 경우 결과가 적을 수 있다. 필요하면 키워드 결과가 0건일 때 주소 검색 API를 한 번 더 호출하는 방식을 검토한다(호출 수 증가 → 별도 결정).
3. **실제 기기 확인 미실시.** iPad·휴대폰 Safari의 위치 권한·정확도 동작은 배포 후 확인 가능(배포는 별도 승인).
4. 빈도 제한·사용량 카운터는 인스턴스별(TASK-003과 같은 한계).
5. 지원 브라우저 범위(NFR-001)는 미결정.

## 8. PRD와의 차이
없음. 출발지=목적지(30m) 차단은 AC-001-04를 확장 적용한 것으로 계획에서 승인받았다.

## 9. 다음 단계 진행 가능 여부
TASK-005(경로 추천)를 진행할 기반은 갖췄다. 다만 TASK-005는 카카오모빌리티 실호출이 핵심이므로, 계획 단계에서 실호출 범위 승인이 필요하다. 사용자의 `완료 승인: TASK-004`가 필요하며, 승인 후에도 TASK-005는 `다음` 메시지 전까지 시작하지 않는다.
