# TASK-002-RESULT.md — 프로젝트 기반 구축 결과 보고

- 보고일: 2026-10-19 / 실행 주체: Claude
- 승인 근거: 사용자 "계획 승인: TASK-002 1. 승인 2. 승인 3. 승인 4. (a)" (2026-10-19). 차단 요인(npm 레지스트리 접속 불가)이 풀린 새 세션에서 사용자 "진행해" (2026-10-19). `DECISIONS.md` 참조
- 수행 범위: `jeju-ai-traffic/` 안에 웹·API·shared·tests 최소 기반, lint/typecheck/test/build, `/api/health`. **외부 API 호출·키 사용·배포는 하지 않았다.**
- 상태: **결과 검토** (사용자 `완료 승인: TASK-002` 대기)

## 1. 변경 파일
| 파일 | 변경 |
|---|---|
| `package.json`, `package-lock.json` | 신규 — 스크립트(dev/build/preview/lint/typecheck/test/check), 의존성 버전 고정(`--save-exact`) |
| `tsconfig.json` | 신규 — strict, `noUncheckedIndexedAccess`, `noEmit`(타입 검사 전용) |
| `vite.config.ts` | 신규 — Vite root `web/`, 출력 `dist/`, React·Tailwind 플러그인 |
| `vitest.config.ts` | 신규 — `tests/**/*.test.{ts,tsx}`, 기본 node 환경(컴포넌트 테스트는 파일별 jsdom) |
| `eslint.config.js` | 신규 — ESLint flat config, typescript-eslint, react-hooks, react-refresh |
| `vercel.json` | 신규 — framework vite, `buildCommand`, `outputDirectory: dist`, **`regions: ["icn1"]`** |
| `.env.example` | 신규 — 키 이름만(`KAKAO_REST_API_KEY`, `JEJU_ITS_API_KEY`), 값 없음 |
| `.gitignore` | 수정 — 기존 `.env` 규칙 유지, `node_modules/`·`dist/`·`.vercel/`·`*.log` 추가 |
| `web/index.html`, `web/src/{main.tsx,App.tsx,index.css}` | 신규 — 모바일 우선 기본 화면("서비스 준비 중") |
| `api/health.ts`, `api/_lib/health.ts` | 신규 — `GET /api/health` (외부 호출 없음) |
| `shared/contracts/health.ts` | 신규 — `HealthResponse` 계약 타입 |
| `tests/unit/health.test.ts`, `tests/unit/App.test.tsx` | 신규 — 단위 테스트 4건 |
| `README.md` | 수정 — 실측 버전·폴더 구조·실행 명령·API·환경 변수 |
| `IMPLEMENTATION_PLAN.md` | 수정(v0.3) — 4절 파일 구조를 실제 생성분으로 확정, 테스트 명령 위치 |
| `TASK_STATUS.md`, `DECISIONS.md` | 수정 — `결과 검토` 전환 기록 |

PRD는 변경하지 않았다.

## 2. 구현 요약
- **단일 npm 패키지**(`jeju-ai-traffic/` = Vercel Root Directory). 웹·API·shared가 하나의 `tsconfig`로 함께 타입 검사된다.
- **웹:** React 19 + Vite 8 + Tailwind CSS 4. 기능 없이 제목과 "서비스 준비 중"만 표시.
- **API:** Vercel Functions 웹 표준 핸들러(`export function GET(): Response`). `api/health.ts`가 엔드포인트, 로직은 `api/_lib/`(밑줄 폴더는 Vercel이 엔드포인트로 배포하지 않음 — Vercel 문서 기준, 배포로 확인하지는 않음). ESM이므로 상대 import에 `.js` 확장자를 붙였다.
- **`/api/health` 응답:** `{status:"ok", service:"jeju-ai-traffic", region, checkedAt}`, `Cache-Control: no-store`. `region`은 `VERCEL_REGION`(없으면 `local`). 그 외 환경 변수는 읽지 않는다.
- **계획 대비 변경:** IMPLEMENTATION_PLAN 4절 제안 `api/src/{routes,...}`는 Vercel 파일 기반 라우팅에서 하위 파일이 모두 엔드포인트가 되므로 `api/<엔드포인트>.ts` + `api/_lib/`로 바꿨다. 승인 범위(폴더 4종) 안의 배치 조정이다.
- **버전 선택:** TypeScript 최신 7.0.2는 typescript-eslint 8.71.2의 지원 범위(`<6.1.0`) 밖이라 **6.0.3**으로 고정했다. `@types/node`는 실행 환경에 맞춰 22.x로 고정했다.

## 3. 실행한 테스트·빌드와 결과 (2026-10-19, Node v22.22.0 / npm 10.9.4)
| 명령 | 결과 |
|---|---|
| `npm install` | 성공, 취약점 0건 |
| `npm run lint` | **통과** (오류·경고 0) |
| `npm run typecheck` | **통과** |
| `npm test` | **통과** — 테스트 파일 2개, 테스트 4건 |
| `npm run build` | **통과** — `dist/index.html` 0.41 kB, CSS 5.20 kB, JS 219.89 kB (gzip 68.88 kB) |
| `npm run check` | **통과** (위 4개 연속 실행) |
| `npm run dev` | **기동 확인** — http://localhost:5173 응답, `<title>제주 AI 교통 경로 추천</title>` 수신 |

테스트 4건: `buildHealth` 리전·시각 반환 / 리전 없을 때 `local` / `GET` 200·JSON·no-store / `App` 제목 렌더링.

**미검증:** `/api/health`를 실제 Vercel `icn1`에서 호출하는 것(배포 미승인). 로컬 `vercel dev`(Vercel 로그인 필요)도 실행하지 않았다. 함수는 단위 테스트로 `GET` 핸들러를 직접 호출해 검증했다.

## 4. 수용 기준
| 기준 (TASK-002) | 결과 | 근거 |
|---|---|---|
| 로컬 실행 성공 | 통과 | `npm run dev` 기동·응답 확인 |
| 빌드 성공 | 통과 | `npm run build` |
| 기본 테스트 성공 | 통과 | `npm test` 4/4 |
| 비밀키 미노출 | 통과 | 코드가 키 환경 변수를 읽지 않음. `.env.example` 값 없음. `.env*` gitignore |
| README 실행 명령 실측 기록 | 통과 | `README.md` 설치·실행·테스트 절 |

| PRD | 결과 | 근거 |
|---|---|---|
| NFR-001 모바일 반응형 | 부분(기반만) | viewport 메타·모바일 우선 레이아웃(`max-w-md`). 실제 화면 검증은 TASK-004·011 |
| NFR-003 비밀키 브라우저 미노출 | 구조 확보 | 외부 호출은 `api/`(서버)에서만 하도록 분리. 웹 번들에 키 없음. 실제 키 사용은 TASK-003 이후 |
| NFR-005 장애 시 기본 기능 유지 | 미검증 | 외부 연동 없음. TASK-003 이후 |

## 5. 비용·보안 영향
- 비용: **0원.** 외부 API 호출·배포 없음. npm 레지스트리 다운로드만 사용.
- 보안: 키 미사용·미저장. 의존성 감사 취약점 0건(설치 시점).

## 6. 남은 이슈
1. 실제 배포(Vercel `jeju-its-probe`, Root Directory `jeju-ai-traffic`)와 `icn1`에서의 `/api/health` 확인은 **별도 배포 승인** 필요. Root Directory 변경은 사용자 수행(DECISIONS 2026-10-19 "4. (a)").
2. 로컬에서 웹과 함수를 함께 띄우는 방법(`vercel dev` 또는 Vite 개발 미들웨어)은 필요해지는 TASK(004~005)에서 결정.
3. 지원 브라우저 범위(NFR-001)는 미결정.

## 7. 다음 단계 진행 가능 여부
TASK-003(계약/비용)을 진행할 수 있는 기반은 갖췄다. 사용자의 `완료 승인: TASK-002`가 필요하며, 승인 후에도 TASK-003은 `다음` 메시지 전까지 시작하지 않는다.
