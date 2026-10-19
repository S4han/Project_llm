# TASK-003-RESULT.md — 데이터 계약·호출 제한 결과 보고

- 보고일: 2026-10-19 / 실행 주체: Claude
- 승인 근거: 사용자 "계획 승인: TASK-003 1. (a) 2. 승인 3. 승인 4. 승인" (2026-10-19). `DECISIONS.md` 참조
- 수행 범위: 공통 계약 타입, 공급자 인터페이스·모의 공급자, 호출 관문(사용량 한도·429 차단·KST 초기화), 오류↔HTTP 대응, 계약 테스트. **엔드포인트 추가·실제 외부 호출·키 사용·배포는 하지 않았다.**
- 상태: **결과 검토** (사용자 `완료 승인: TASK-003` 대기)

## 1. 변경 파일
| 파일 | 변경 |
|---|---|
| `shared/contracts/common.ts` | 신규 — `IsoDateTime`, `ProviderId`, `ERROR_CODES`·`ErrorCode`, `ApiError`, `Freshness{observedAt, stale}` |
| `shared/contracts/route.ts` | 신규 — `Coordinate`, `RouteOption`, `RouteCompareRequest/Response` |
| `shared/contracts/traffic.ts` | 신규 — `TrafficStatus`(smooth/slow/congested/unknown), `TrafficIncident` |
| `shared/contracts/explanation.ts` | 신규 — `Explanation{text, source: ai\|rules, evidence, generatedAt}` |
| `api/_lib/errors.ts` | 신규 — `HTTP_STATUS` 대응표, `AppError`, `ProviderError`, `toErrorResponse` |
| `api/_lib/policies/kstDay.ts` | 신규 — KST 날짜 키, 다음 KST 0시 |
| `api/_lib/policies/quota.ts` | 신규 — `DEFAULT_BUDGETS`, `QuotaStore` 인터페이스, `MemoryQuotaStore`, `QuotaGuard`, 공용 `quotaGuard` |
| `api/_lib/policies/guardedCall.ts` | 신규 — 외부 호출 관문 |
| `api/_lib/policies/ttlCache.ts` | 신규 — 60초 캐시(동시 요청 공유, 실패 미저장) |
| `api/_lib/providers/types.ts` | 신규 — `RouteProvider`, `TrafficProvider`, `ExplanationProvider` 인터페이스 |
| `api/_lib/providers/mock.ts` | 신규 — 모의 공급자 3종(정상/429/장애, 호출 횟수 기록) |
| `api/_lib/explanations/explain.ts` | 신규 — 규칙 기반 설명, AI 대체 계약 |
| `tests/fixtures/routes.ts` | 신규 — 합성 모의 데이터(실제 응답 원문 아님) |
| `tests/unit/{kstDay,quota,guardedCall,ttlCache,errors,explain}.test.ts` | 신규 — 계약 테스트 34건 |
| `eslint.config.js` | 수정 — `_`로 시작하는 미사용 인자 허용(모의 공급자 시그니처) |
| `README.md`, `IMPLEMENTATION_PLAN.md`(v0.4 5절) | 수정 — 폴더 구조, 외부 호출 규칙, 확정된 계약 |
| `TASK_STATUS.md`, `DECISIONS.md` | 수정 — 계획 승인·결과 검토 전환 기록 |

PRD는 변경하지 않았다.

## 2. 구현 요약
- **먼저 예약하고 그다음 호출:** `guardedCall`은 `QuotaGuard.reserve`로 사용량을 먼저 늘린 뒤 외부 호출을 실행한다. 거절되면 호출 함수가 실행되지 않는다. 실패한 호출도 사용량에서 되돌리지 않는다(보수적 계산).
- **원자성:** `MemoryQuotaStore.reserve`는 확인과 증가 사이에 `await`가 없어 한 인스턴스 안에서는 동시 요청에도 한도를 넘지 않는다. 확인 사이에 `await`를 넣은 변형으로 바꾸면 동시 요청 테스트가 실패하는 것을 직접 확인했다(테스트가 실제로 결함을 잡는다는 검증).
- **예산:** 카카오 8,000 / 재평가 컷오프 6,000, 제주 ITS 2,000, AI 0. `cost`로 한 조회의 다회 호출(카카오 약 3회)을 한 번에 예약한다. 남은 한도보다 큰 요청은 사용량을 늘리지 않고 거절한다.
- **공급자 429:** `ProviderError("rate_limited")` → 다음 KST 0시까지 차단 → `QUOTA_BLOCKED`(`retryAfter`). 장애(`unavailable`)와 예상하지 못한 오류는 `PROVIDER_UNAVAILABLE`이며 차단하지 않는다.
- **오류 응답:** `{error:{code, message, retryAfter?}}`, `Cache-Control: no-store`, `QUOTA_BLOCKED`는 `Retry-After`(초) 헤더. 알 수 없는 오류는 내부 메시지를 숨기고 503.
- **설명:** 규칙 기반 설명은 입력된 예상시간과 확인된 사건 수만 사용한다. 추천 경로가 더 느린 입력이 와도 사실대로 쓴다. AI는 ① 공급자 없음 ② 한도 차단(기본 0건) ③ 실패·429 ④ 검증 실패 중 하나라도 해당하면 규칙 설명으로 대체한다. **검증 함수 기본값은 '모두 거부'** 라서 TASK-007에서 검증 규칙을 만들기 전에는 AI 문장이 쓰이지 않는다.

## 3. 실행한 테스트·빌드와 결과 (2026-10-19)
| 명령 | 결과 |
|---|---|
| `npm run lint` | **통과** |
| `npm run typecheck` | **통과** |
| `npm test` | **통과** — 테스트 파일 8개, 테스트 **38건**(TASK-002 4건 + 신규 34건) |
| `npm run build` | **통과** (웹 번들 변화 없음, API 코드는 웹 번들에 포함되지 않음) |

주요 테스트:
- 한도 경계: 7,999 + 1 통과 → 다음 호출 `QUOTA_BLOCKED`, `retryAfter` = 다음 KST 0시
- **한도 도달 시 외부 호출 0회** (모의 공급자 `calls === 0`)
- **동시 요청 10건, 남은 예산 1건분 → 외부 호출 정확히 1회**
- 재평가 컷오프: 6,000에서 재평가 차단, 직접 조회는 8,000까지 허용
- 공급자 429 → KST 23:59:59까지 호출 0회, 0시에 재개
- KST 0시 초기화(UTC 14:59 / 15:00 경계)
- 오류 코드 5종 ↔ HTTP 상태, 응답 본문 코드 일치
- ITS 캐시: 동시 5건 → 로드 1회, 60초 경계, 실패 미저장
- AI 대체: 기본 예산에서 AI 호출 0회, 실패·429·검증 실패 시 `rules`, 검증 통과 시에만 `ai`
- 원천 시각: 경로 결과와 설명 근거에 `observedAt` 유지

## 4. 수용 기준
| 기준 (TASK-003) | 결과 | 근거 |
|---|---|---|
| 한도 도달 시 외부 호출 0회 | 통과 | guardedCall·quota 테스트 |
| 일관된 상태 코드 | 통과 | errors 테스트(대응표 = `ERROR_CODES` 전체) |
| 원천 시각 확인 | 통과(계약) | `RouteOption`·`TrafficIncident`·`Freshness`에 필수 필드, 근거 문자열에 기준 시각 포함 |
| 동시 요청·쿼터 경계·AI 대체 계약 테스트 | 통과 | 위 3절 |

| PRD | 결과 | 근거 |
|---|---|---|
| COST-002 내부 사용량 제한 | 통과(인스턴스 단위) | 한도 도달 시 외부 호출 차단. 전체 인스턴스 합계는 근사치(아래 6절) |
| COST-003 재평가 호출 제한 | 통과(관문) | 재평가 컷오프 6,000. 재평가 기능 자체는 TASK-009 |
| COST-004 AI 호출 제한 | 통과 | AI 0건 차단, 규칙 설명 대체 |
| COST-005 사용자 고지 | 부분 | 차단 사유 메시지·`retryAfter` 제공. 화면 표시·마지막 성공 시각은 TASK-004·009 |
| COST-006 과금 방지 검증 | 변경 없음 | 공급자 측 청구 조건은 TASK-001 결과 유지. 이번에 새로 검증하지 않음 |
| AC-006-04·05·06·07 | 통과(계약) | AI 실패·한도 시 규칙 설명, `source` 구분. 화면 표시는 TASK-007 |
| AC-003-04 조회 실패 안내 | 부분 | `PROVIDER_UNAVAILABLE` 503 계약. 화면·재시도는 TASK-005 |
| AC-009-08·09 | 부분 | 재평가 차단 사유·재개 시각 제공. 화면은 TASK-009 |

## 5. 비용·보안 영향
- 비용: **0원.** 외부 API 호출·배포 없음.
- 보안: 키 미사용. 오류 응답에 내부 오류 메시지를 싣지 않는다. 모의 데이터는 공공 장소 좌표만 사용(개인 위치 아님).

## 6. 남은 이슈
1. **카운터는 인스턴스별:** Vercel이 함수 인스턴스를 여러 개 띄우면 내부 한도가 인스턴스마다 따로 적용되어 전체 사용량이 8,000을 넘을 수 있다. 이때 과금 차단은 카카오 측 일일 한도(초과 시 429, TASK-001 발췌 근거)에 의존하며, 429를 받으면 해당 인스턴스는 0시까지 호출을 멈춘다. 운영 중 정확한 합계가 필요해지면 `QuotaStore`를 공유 저장소로 바꾼다(별도 승인).
2. **카카오 일일 한도 초기화 시각**(KST 0시 가정)은 미확인.
3. **제주 ITS 공식 호출 한도**는 미확인 — 내부 2,000건은 보수적 가정.
4. 오래된 데이터 판단 임계값(`stale`)은 PRD NFR-007상 미결정. 계약 필드만 두었다.
5. 알 수 없는 내부 오류도 `PROVIDER_UNAVAILABLE`(503)로 응답한다. 승인된 오류 코드 5종 밖의 코드를 만들지 않기 위한 선택이다.

## 7. PRD와의 차이
없음. 계획 대비 추가 사항: ITS 60초 캐시를 별도 모듈(`ttlCache.ts`)로 분리했다(승인된 예산 항목의 구현).

## 8. 다음 단계 진행 가능 여부
TASK-004(검색)를 진행할 기반은 갖췄다. 사용자의 `완료 승인: TASK-003`이 필요하며, 승인 후에도 TASK-004는 `다음` 메시지 전까지 시작하지 않는다.
