# TASK-020-RESULT.md — 지도 선명도 결과 보고

- 보고일: 2026-10-21 / 실행 주체: Claude
- 승인 근거: 사용자 "계획 승인: TASK-020 (a)" (2026-10-21)
- 상태: **결과 검토** (완료 승인 대기, `main` 미반영)

## 1. 원인
- 바탕지도로 쓰던 OpenStreetMap 기본 타일은 256×256 픽셀(한 배 해상도)이다.
- 휴대폰 화면은 픽셀이 2~3배 촘촘해서 그림을 늘려 보여 주므로 흐리게 보였다(사용자 휴대폰 캡처).
- 도로 소통 선·가격 표시는 화면이 직접 그리므로 선명했다.

## 2. 변경 파일
| 파일 | 변경 |
|---|---|
| `web/src/features/map/leafletMap.ts` | 바탕지도를 CARTO Voyager(`{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png`, 하위 주소 a~d, 최대 확대 19)로 교체. 고해상도 화면에서는 Leaflet이 `{r}`을 `@2x`로 바꿔 두 배 해상도 그림을 받는다. 지도 안 출처에 © CARTO 추가 |
| `web/src/App.tsx`, `web/src/features/traffic/TrafficDashboard.tsx` | 하단 출처 "지도 © OpenStreetMap 기여자 © CARTO" |
| `tests/e2e/*.spec.ts` | 바탕 그림 차단 대상에 CARTO 추가, 고해상도(2배) 화면에서 @2x 요청·출처 확인 테스트 신규 |
| `tests/unit/App.test.tsx` | 하단 출처에 CARTO 확인 |
| `TASK_STATUS.md`, `tasks/TASK-020.md`, `DECISIONS.md` | 수정 |

## 3. 구현 요약
- 교통 현황과 경로 추천 화면이 같은 지도 부품을 쓰므로 둘 다 바뀐다.
- 같은 OpenStreetMap 자료라 지명은 OSM 원래 이름(한국어)이다. 연한 색 스타일이라 도로 소통 색과 가격 표시가 더 잘 보인다.
- 키가 필요 없다. CARTO 기본 지도는 비상업 사용이 무료이고, 출처 표시(© CARTO, © OpenStreetMap) 조건이다. 지도 안과 하단에 표시했다.
- 바탕 그림을 못 불러올 때 나오는 안내("지도 배경을 불러오지 못했습니다 …")는 그대로다.

## 4. 테스트·빌드
| 명령 | 결과 |
|---|---|
| `npm run check:release` | 통과 — 단위 **304건**, lint·typecheck·build, 비밀정보 의심 없음, 취약점 0건 |
| `npx playwright test` | **48건** 통과 |

신규 e2e: 픽셀 2배 화면에서 지도가 요청하는 그림 주소가 모두 `https://[a-d].basemaps.cartocdn.com/rastertiles/voyager/z/x/y@2x.png` 형식이다. 지도 출처와 하단 출처에 CARTO가 있다.

## 5. 확인하지 못한 것
- 작업 환경에서는 CARTO 그림 주소가 막혀 있어(프록시 403), **실제 선명도와 모양은 확인하지 못했다.** Preview에서 확인이 필요하다.
- 캡처: 바탕 그림이 막힌 환경이라 비교 캡처는 의미가 없어 만들지 않았다.

## 6. 비용·위험
- 비용은 0원이다(키 없음).
- CARTO 무료 기본 지도는 비상업 조건이다. 상업적으로 쓰게 되면 CARTO 이용 조건을 다시 봐야 한다. 지금은 비상업 운영 전제다(TASK-011 고지와 같음).
- 고해상도 그림은 크기가 커서 데이터 사용량이 늘 수 있다(타일당 약 2~4배).

## 7. 확인 요청
- Preview를 휴대폰으로 열어 지도 글자·도로가 선명한지, 색이 보기 좋은지 봐 주세요.
- 괜찮으면 `완료 승인: TASK-020`, Production 반영은 `main 반영`으로 지시해 주세요.
