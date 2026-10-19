# 제주 AI 교통 경로 추천 웹서비스

- 상태: **TASK-002 기반 스캐폴드 생성** (2026-10-19). 기능 구현은 TASK-003 이후.
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
shared/         웹·API 공용 계약 타입 (shared/contracts/)
tests/unit/     Vitest 단위 테스트
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

## 환경 변수
`.env.example`에 키 이름만 있다(`KAKAO_REST_API_KEY`, `JEJU_ITS_API_KEY`). 실제 값은 Vercel 환경 변수(Sensitive)로만 등록한다. TASK-002 코드는 어떤 키도 읽지 않는다. 서버 측 쿼터·차단 설정은 TASK-003에서 확정.

## 운영 정책
월 운영비 0원 우선. 무료 호출/청구 차단 검증 전 실제 유료 API 연동·배포 금지. AI 실패/무료 한도 소진 시 규칙 기반 설명, 출처 표시. 외부 내비에는 목적지만 전달.
