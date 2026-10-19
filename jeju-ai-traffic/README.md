# 제주 AI 교통 경로 추천 웹서비스

- 상태: **TASK-003 데이터 계약·호출 제한** (2026-10-19). 화면·엔드포인트 기능은 TASK-004 이후.
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
| Vitest / jsdom / Testing Library | 5.0.5 / 29.1.1 / 16.3.3 |
| ESLint / typescript-eslint | 10.13.0 / 8.71.2 |

호스팅: Vercel Hobby 단일 프로젝트(웹 정적 + Functions), 리전 `icn1` 고정(`vercel.json`). Playwright는 TASK-004 이후 도입.

## 폴더 구조
```text
web/            React 앱 (Vite root, index.html, src/)
api/            Vercel Functions — 파일 하나가 엔드포인트 (api/health.ts → GET /api/health)
api/_lib/       함수 공용 코드 (밑줄 폴더는 Vercel이 엔드포인트로 배포하지 않음)
  errors.ts       오류 코드 ↔ HTTP 상태, 공통 오류 응답
  policies/       사용량 한도(quota), 외부 호출 관문(guardedCall), KST 날짜, 짧은 캐시
  providers/      공급자 인터페이스(types)와 모의 공급자(mock)
  explanations/   설명 생성(규칙 기반 + AI 대체 계약)
shared/         웹·API 공용 계약 타입 (shared/contracts/: common, route, traffic, explanation, health)
tests/unit/     Vitest 단위·계약 테스트
tests/fixtures/ 합성 모의 데이터 (실제 응답 원문 아님)
```

## 설치·실행·테스트 (모두 `jeju-ai-traffic/`에서 실행, 2026-10-19 실측 통과)
| 명령 | 내용 |
|---|---|
| `npm install` | 의존성 설치 |
| `npm run dev` | 웹 개발 서버 (http://localhost:5173). **`/api/*`는 제공하지 않는다** — 함수는 단위 테스트로 검증하고, 로컬 함수 실행(`vercel dev`)은 Vercel 로그인이 필요해 쓰지 않았다 |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest 1회 실행 |
| `npm run build` | 웹 빌드 → `dist/` |
| `npm run check` | lint → typecheck → test → build 순서로 모두 실행 |

### API
- `GET /api/health` → `{ "status": "ok", "service": "jeju-ai-traffic", "region": "icn1", "checkedAt": "<ISO>" }`, `Cache-Control: no-store`. 외부 호출·키 사용 없음. 로컬에서는 `region`이 `local`.

### 외부 호출 규칙 (TASK-003)
- 모든 외부 호출은 `guardedCall(quotaGuard, 공급자, 호출, { cost, purpose })`을 거친다. 사용량을 먼저 예약하고, 거절되면 호출하지 않는다.
- 내부 일일 한도(KST 0시 초기화): 카카오 8,000건(사용 6,000건 이상이면 `purpose: "reevaluation"` 차단), 제주 ITS 2,000건(+ 60초 캐시 `TtlCache`), AI 0건(차단).
- 공급자가 429를 주면 다음 KST 0시까지 그 공급자를 차단한다.
- 카운터는 서버 메모리라 인스턴스마다 따로 센다(합계는 근사치). 최종 과금 차단은 공급자 측 한도(카카오 429)에 의존한다.
- 오류 응답: `{ "error": { "code", "message", "retryAfter?" } }`. `INVALID_INPUT` 400, `LOCATION_UNAVAILABLE` 422, `QUOTA_BLOCKED` 429(+`Retry-After`), `PROVIDER_UNAVAILABLE` 503, `STALE_DATA`는 200 + `stale: true`.

## 환경 변수
`.env.example`에 키 이름만 있다(`KAKAO_REST_API_KEY`, `JEJU_ITS_API_KEY`). 실제 값은 Vercel 환경 변수(Sensitive)로만 등록한다. 현재 코드는 어떤 키도 읽지 않는다(실제 공급자 어댑터는 TASK-005·006).

## 운영 정책
월 운영비 0원 우선. 무료 호출/청구 차단 검증 전 실제 유료 API 연동·배포 금지. AI 실패/무료 한도 소진 시 규칙 기반 설명, 출처 표시. 외부 내비에는 목적지만 전달.
