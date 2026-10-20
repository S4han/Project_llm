# TASK-014-RESULT.md — CCTV 영상 링크 연결 결과 보고

- 보고일: 2026-10-20 / 실행 주체: Claude
- 근거: 사용자 "CCTV정보를 클릭하면 CCTV영상을 보여 주고 싶은데.. 방법 없을까?" → 방법 ①~③ 제시 → 사용자 "CCTV 영상 API 목록에 없어, 링크로 연결해줘"(방법 ③)
- 상태: **결과 검토**

## 변경
| 파일 | 변경 |
|---|---|
| `web/src/features/map/leafletMap.ts` | `popupContent`(팝업을 DOM으로, 원천 글자는 textContent), `JEJU_ITS_SITE`. CCTV·웹카메라 팝업에 "제주 ITS 교통정보센터에서 영상 보기 ↗"(새 창, `noopener noreferrer`) |
| `web/src/index.css` | 팝업 링크 터치 크기(높이 44px) |
| `web/src/features/traffic/TrafficDashboard.tsx` | 교통시설물 카드 안내 문구 변경 |
| `tests/unit/popup.test.ts` | 신규 2건(HTML 해석 안 함, 링크 속성) |

## 판단·한계
- 제주 ITS Open API에 CCTV 영상(스트리밍) API가 없다(사용자 확인). 그래서 앱 안 재생은 하지 않고 공식 사이트로 연결한다.
- 링크는 제주 ITS 교통정보센터 **첫 화면**이다. CCTV 화면이나 카메라별 주소를 알면 바로 그 화면으로 연결할 수 있다(남은 이슈).
- 공식 사이트 화면 내부의 영상 주소를 가져다 재생하지 않는다(이용약관·영상 개인정보).
- 보안 개선: 지도 팝업 3종(사건·구간·시설물)이 제주 ITS·브이월드 원천 글자를 HTML로 넣던 구조를 글자 전용으로 바꿨다.

## 테스트
- `npm run check:release` 통과(단위 **261건**, 비밀정보 없음, 취약점 0), e2e **38건** 통과.
- 시설물 점은 캔버스로 그려 e2e에서 점 클릭은 하지 않았고, 팝업 내용은 단위 테스트로 확인했다.

## 남은 이슈
1. 링크가 사이트 첫 화면이다. 제주 ITS의 CCTV 화면 주소(예: 카메라 목록 페이지)를 알려주면 그 주소로 바꾼다.
