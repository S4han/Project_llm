# TASK_STATUS.md — 현재 작업 상태

> 이 파일은 `AGENTS.md` 규칙 1에 따라 매 응답 전에 확인하는 **현재 TASK의 단일 기준**이다.
> 상태는 사용자 승인 근거가 있을 때만 갱신하며, 승인 문구와 날짜는 `DECISIONS.md`에 기록한다.
> **기준 저장소:** GitHub `s4han/project_llm`의 `jeju-ai-traffic/` (2026-10-19부터). 구글 드라이브 `jeju-ai-traffic` 폴더는 이전 시점 보관본이다.

## 현재 작업
| 항목 | 값 |
|---|---|
| 현재 TASK | **TASK-027** — 관광지 카드 → 주변 주차장 지도 표시 |
| 상태 | **결과 검토** (완료 승인 대기, `main` 미반영) |
| 실행 주체 | Claude (사용자 지정, 2026-10-18) |
| 승인 범위 | 1.(a) 관광지 카드의 "주변 주차장 1km" 칸을 버튼으로 2.(a) 관광지 페이지 안에서 그 관광지·반경 1km 원·주차장만 지도에, 목록(가까운 순)·범례·P 무료만·관광지 목록으로 3.(a) 주소 /map/tour?parking=관광지 번호 (`DECISIONS.md` 2026-10-22) |
| 차단 요인 | 없음 |
| 결과 보고서 | `reports/TASK-027-RESULT.md` |
| 다음 행동 | 사용자 Preview 확인 → `완료 승인: TASK-027` / `main 반영` |
| 최종 갱신 | 2026-10-22 |

## 상태 정의
| 상태 | 의미 | 다음 상태로 바뀌는 조건 |
|---|---|---|
| 미착수 | 아직 순서가 오지 않음 | 이전 TASK `완료 승인` 시 `대기` |
| 대기 | 계획 요청을 기다림 | `시작`/`다음` → 계획 제시 후 `계획 검토` |
| 계획 검토 | 계획 제시됨, 사용자 승인 대기 | `계획 승인: TASK-XXX` → `진행 중` |
| 진행 중 | 승인된 범위 내에서 실행 중 | 실행 종료 + 결과 보고서 작성 → `결과 검토` |
| 결과 검토 | 결과 보고됨, 사용자 승인 대기 | `완료 승인: TASK-XXX` → `완료` |
| 완료 | 사용자가 결과 승인 | — |
| 보류 | 사용자가 `보류`/`반려` 지시 | 사용자가 수정 계획 승인 |

## 전체 TASK 현황
| TASK | 단계 | 상태 | 결과 보고서 |
|---|---|---|---|
| TASK-001 | P0 기술 타당성 | **완료** (2026-10-19) | `reports/TASK-001-RESULT.md` |
| TASK-002 | 기반 | **완료** (2026-10-19) | `reports/TASK-002-RESULT.md` |
| TASK-003 | 계약/비용 | **완료** (2026-10-19) | `reports/TASK-003-RESULT.md` |
| TASK-004 | 검색 | **완료** (2026-10-19) | `reports/TASK-004-RESULT.md` |
| TASK-005 | 경로 추천 | **완료** (2026-10-19) | `reports/TASK-005-RESULT.md` |
| TASK-006 | 지도/교통 | **완료** (2026-10-19) | `reports/TASK-006-RESULT.md` |
| TASK-007 | 설명 | **완료** (2026-10-19) | `reports/TASK-007-RESULT.md` |
| TASK-008 | 외부 내비 | **완료** (2026-10-19) | `reports/TASK-008-RESULT.md` |
| TASK-009 | 재평가 | **완료** (2026-10-19) | `reports/TASK-009-RESULT.md` |
| TASK-010 | 변경 안내 | **완료** (2026-10-19) | `reports/TASK-010-RESULT.md` |
| TASK-011 | 품질/출시 | **완료** (2026-10-20) | `reports/TASK-011-RESULT.md` |
| TASK-012 | ITS 대시보드 (MVP 이후 추가) | **완료** (2026-10-20) | `reports/TASK-012-RESULT.md` |
| TASK-013 | 교통시설물 표시 (MVP 이후 추가) | **완료** (2026-10-20) | `reports/TASK-013-RESULT.md` |
| TASK-014 | CCTV 영상 링크 (MVP 이후 추가) | **완료** (2026-10-20) | `reports/TASK-014-RESULT.md` |
| TASK-015 | 실시간 정체구간 목록 (MVP 이후 추가) | **완료** (2026-10-20) | `reports/TASK-015-RESULT.md` |
| TASK-016 | 주정차 단속 CCTV 표시 (MVP 이후 추가) | **완료** (2026-10-20) | `reports/TASK-016-RESULT.md` |
| TASK-017 | 주차장 위치 (MVP 이후 추가, 범위 변경: 표준데이터) | **완료** (2026-10-21) | `reports/TASK-017-RESULT.md` |
| TASK-018 | 주유소 위치·가격 (MVP 이후 추가, 범위 변경: 제주 ITS·LPG 분리) | **완료** (2026-10-21) | `reports/TASK-018-RESULT.md` |
| TASK-019 | 전기차 충전소 검색 (MVP 이후 추가) | **완료** (2026-10-21) | `reports/TASK-019-RESULT.md` |
| TASK-020 | 지도 선명도 (MVP 이후 추가) | **완료** (2026-10-21) | `reports/TASK-020-RESULT.md` |
| TASK-021 | 주유소 가격 표시 겹침 정리 (MVP 이후 추가) | **완료** (2026-10-21) | `reports/TASK-021-RESULT.md` |
| TASK-022 | 주차장 유료·무료 구분 (MVP 이후 추가) | **완료** (2026-10-21) | `reports/TASK-022-RESULT.md` |
| TASK-023 | 지도를 내 위치 기준으로 열기 (MVP 이후 추가) | **완료** (2026-10-21) | `reports/TASK-023-RESULT.md` |
| TASK-024 | 주차장 표시 겹침 정리 (MVP 이후 추가) | **완료** (2026-10-21) | `reports/TASK-024-RESULT.md` |
| TASK-025 | 화면 재구성 (MVP 이후 추가) | **완료** (2026-10-22) | `reports/TASK-025-RESULT.md` |
| TASK-026 | 제주 관광지 정보 (MVP 이후 추가) | **완료** (2026-10-22) | `reports/TASK-026-RESULT.md` |
| TASK-027 | 관광지 주변 주차장 지도 표시 (MVP 이후 추가) | **결과 검토** | `reports/TASK-027-RESULT.md` |
