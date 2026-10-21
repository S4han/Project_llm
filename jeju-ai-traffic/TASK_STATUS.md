# TASK_STATUS.md — 현재 작업 상태

> 이 파일은 `AGENTS.md` 규칙 1에 따라 매 응답 전에 확인하는 **현재 TASK의 단일 기준**이다.
> 상태는 사용자 승인 근거가 있을 때만 갱신하며, 승인 문구와 날짜는 `DECISIONS.md`에 기록한다.
> **기준 저장소:** GitHub `s4han/project_llm`의 `jeju-ai-traffic/` (2026-10-19부터). 구글 드라이브 `jeju-ai-traffic` 폴더는 이전 시점 보관본이다.

## 현재 작업
| 항목 | 값 |
|---|---|
| 현재 TASK | **TASK-020** — 지도 선명도(고해상도 바탕지도) |
| 상태 | **결과 검토** (브이월드 기본 바탕지도, 완료 승인 대기) |
| 실행 주체 | Claude (사용자 지정, 2026-10-18) |
| 승인 범위 | (a) 고해상도 바탕지도 교체, 교통 현황·경로 추천 공통, 출처 문구. 범위 변경: CARTO(키 필요) 대신 브이월드 바탕지도(지도용 키 `VITE_VWORLD_MAP_KEY`, 기본(Base), 실패 시 OSM) (`DECISIONS.md` 2026-10-21) |
| 차단 요인 | 없음 |
| 결과 보고서 | `reports/TASK-020-RESULT.md` |
| 다음 행동 | 사용자 Preview 확인 → `완료 승인: TASK-020` / `main 반영` |
| 최종 갱신 | 2026-10-21 |

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
| TASK-020 | 지도 선명도 (MVP 이후 추가) | **결과 검토** | `reports/TASK-020-RESULT.md` |
