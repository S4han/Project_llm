# 제주 AI 교통 경로 추천 웹서비스

- 상태: **개발 준비 문서 초안 v0.1**. 애플리케이션 소스는 아직 생성하지 않았다.
- 요구사항: `PRD.md` (구글 드라이브 확정 PRD v1.0의 동일 사본)
- Codex 시작: `START_HERE.md`
- 설계: `IMPLEMENTATION_PLAN.md`
- 작업: `tasks/TASK-001.md`부터 순차 수행

## 제안 개발 환경 (확정 전)
Node.js LTS, npm, TypeScript, React/Vite, Cloudflare Workers, Vitest/Playwright. 정확한 버전은 TASK-001 공급자 검증 및 TASK-002 환경 확정 시 기록한다.

## 설치·실행·테스트
**아직 실행 명령 없음.** TASK-002에서 실제 스캐폴드를 생성하고 검증한 뒤 `npm install`, `npm run dev`, `npm test`, `npm run build` 등 실제 제공되는 스크립트를 기재한다. 명령을 실행 가능하다고 미리 단정하지 않는다.

## 환경 변수
API 키/토큰, 공급자 설정, 서버 측 쿼터·차단 설정은 TASK-001/003에서 확정. `.env.example`에는 이름과 설명만 기록하고 실제 비밀정보는 넣지 않는다.

## 운영 정책
월 운영비 0원 우선. 무료 호출/청구 차단 검증 전 실제 유료 API 연동·배포 금지. AI 실패/무료 한도 소진 시 규칙 기반 설명, 출처 표시. 외부 내비에는 목적지만 전달.
