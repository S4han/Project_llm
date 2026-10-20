# OPERATIONS.md — 운영 안내 (TASK-011)

이 문서는 공개 서비스를 운영할 때 보는 절차서다. 키 값은 어디에도 적지 않는다(이름만).

## 1. 배포 구조
- 호스팅: Vercel Hobby 프로젝트 `jeju-its-probe`(팀 `splendid3`), Root Directory `jeju-ai-traffic`, 함수 리전 `icn1`(서울, `vercel.json`).
- 자동 배포(사용자 결정 TASK-006 (a)): 작업 브랜치 푸시 → Preview, `main` 반영 → **Production**. 즉 `main`에 합치는 것이 출시다.
- 정적 화면은 `dist/`, API는 `api/*.ts`(Vercel Functions).

## 2. 환경 변수와 공급자
Vercel → 프로젝트 → Settings → Environment Variables. Production·Preview 모두 등록되어 있다. 바꾼 뒤에는 **새 배포**가 있어야 반영된다(기존 배포는 이전 값 유지).

| 변수 | 용도 | 없으면 |
|---|---|---|
| `KAKAO_REST_API_KEY` | 카카오 길찾기·로컬 검색 (Sensitive) | 모의 데이터 |
| `ROUTES_PROVIDER=kakao` | 경로 실호출 켜기 | 모의 경로 |
| `PLACES_PROVIDER=kakao` | 장소 검색 실호출 켜기 | 모의 장소 |
| `JEJU_ITS_API_KEY` | 제주 ITS (Sensitive, 국외 IP 차단 → icn1에서만 동작) | 모의 사건 |
| `TRAFFIC_PROVIDER=jejuIts` | 교통 사건 실호출 켜기 | 모의 사건 |
| `AI_PROVIDER=cloudflare` | AI 설명 켜기 | 규칙 기반 설명만 |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_AI_TOKEN` | Workers AI (토큰은 Workers AI 권한만, Sensitive) | 규칙 기반 설명만 |
| `JEJU_ITS_TRAFFIC_API_KEY` | 제주 ITS 실시간 교통정보(구간 속도) 전용 키 (Sensitive, TASK-012) | `/traffic` 구간 속도 모의 |
| `JEJU_ITS_FACILITY_API_KEY` (선택) | 제주 ITS 교통시설물정보 전용 키. 없으면 `JEJU_ITS_TRAFFIC_API_KEY` 사용(TASK-013) | 시설물 모의 |
| `VWORLD_API_KEY` | 브이월드 2D 데이터 API 키 (Sensitive, 서비스 주소 `https://jeju-its-probe.vercel.app` 등록, TASK-012). `VWORLD_DOMAIN`으로 등록 주소 변경 가능 | `/traffic` 구간 모양 모의 |
| `CF_AI_MODEL` (선택) | 모델 이름 | 기본 `@cf/meta/llama-3.3-70b-instruct-fp8-fast` |

**긴급 차단**: 공급자 변수(`ROUTES_PROVIDER` 등)를 지우거나 다른 값으로 바꾸고 재배포하면 해당 공급자 호출이 0이 된다(경로·장소는 모의 데이터로 바뀌므로 공개 서비스에서는 사실상 점검 상태가 된다). AI는 `AI_PROVIDER`만 지우면 규칙 설명으로 계속 동작한다.

## 3. 한도와 차단
| 공급자 | 공급자 무료 한도(TASK-001) | 초과 시 공급자 동작 | 내부 일일 한도(`api/_lib/policies/quota.ts`) |
|---|---|---|---|
| 카카오모빌리티 길찾기 | 일 10,000건 | 429 차단(비즈월렛 미연결 시) | 8,000건, 6,000건부터 자동 재평가 차단 |
| 카카오 로컬 검색 | 앱 1개 무료 쿼터 | 429 차단(비즈월렛 미연결 시) | 3,000건 |
| 제주 ITS | 공개 기준 없음 | — | 6,000건 (경로 조회·`/traffic` 사건·구간 속도 공통, 함수별로 따로 셈) |
| 브이월드 데이터 API | 키별 일일 한도(브이월드 콘솔에서 확인) | 오류로 차단 | 400건 (구간 모양·지점 이름 1회 생성에 약 66건 = 교통링크 38쪽 + 교통노드 28쪽, 결과는 CDN 30일 보관. 지점 이름을 못 받으면 1시간 뒤 다시 생성) |
| Cloudflare Workers AI | 일 10,000 Neurons (UTC 0시) | Free 플랜은 오류로 차단 | 200건 (1건 약 14 Neurons) |

- 내부 한도는 **KST 자정**에 초기화되고, 공급자가 429를 주면 그 공급자를 다음 KST 자정까지 막는다.
- 내부 카운터는 함수 인스턴스마다 메모리에 있어 **근사치**다(인스턴스가 여러 개면 합계가 한도를 넘을 수 있다). 최종 방어선은 공급자 측 차단(결제수단·비즈월렛 미연결)이다.
- IP별 빈도 제한: 장소 20회/분, 경로 10회/분, 설명 10회/분.
- 경로 조회 1회는 카카오 추천 1회 호출이다(TASK-011 경로방식 (a)). 내부 한도 8,000건 = 하루 약 8,000번 조회(재평가 포함).

## 4. 사용량 확인
- 카카오: Kakao Developers → 내 애플리케이션 → 앱 → 통계/쿼터(일별 호출량). 비즈월렛이 **연결되지 않았는지** 함께 본다.
- Cloudflare: 대시보드 → AI → Workers AI → 사용량(Neurons). Billing에 결제수단이 없는지 본다.
- Vercel: 프로젝트 → Usage(함수 호출·대역폭), Logs(오류). Hobby 한도를 넘으면 Vercel이 알림을 보낸다.
- 서비스 상태: `/api/health`. 교통 현황: `/traffic`(제주 ITS 조회 상태를 화면에서 바로 확인할 수 있다).
- `/traffic`은 화면이 켜진 사용자마다 1분에 1번 서버를 부르지만, 서버는 제주 ITS 결과를 60초 캐시하므로 함수 인스턴스당 제주 ITS 호출은 1분에 최대 3회(하루 최대 4,320회로 내부 한도 6,000 안)다.

## 5. 되돌리기 (Instant Rollback)
문제가 생긴 Production 배포를 이전 배포로 되돌린다. 코드·환경 변수는 바뀌지 않는다.
1. Vercel → 프로젝트 → **Deployments**.
2. 정상이었던 이전 Production 배포 행의 `⋯` → **Instant Rollback**(또는 배포 화면의 **Promote to Production**).
3. 확인 후 공개 주소에서 `/api/health`와 경로 조회를 확인한다.
4. 원인 수정은 브랜치에서 하고, 다시 `main` 반영 승인을 받아 배포한다.
- Hobby에서는 직전 Production 배포로만 즉시 되돌릴 수 있을 수 있다(Vercel 정책). 이 절차는 문서로만 준비했고 실행해 보지 않았다.

## 6. 장애 대응
| 증상 | 확인 | 조치 |
|---|---|---|
| "오늘 사용할 수 있는 조회 한도에 도달" | 카카오 통계 | 다음 KST 자정까지 대기(자동 복구). 남용이 의심되면 Vercel Firewall에서 IP 차단 |
| 경로 조회 "일시적으로 사용할 수 없음" | Vercel Logs, 카카오 상태 | 키 만료·앱 비활성 확인. 장기화 시 `ROUTES_PROVIDER` 제거 + 안내 |
| 교통 사건 "정보 미확보(조회 실패)" | Vercel Logs | 제주 ITS 장애 또는 리전이 icn1이 아님. 경로 비교는 계속 동작 |
| AI 설명이 항상 "규칙 기반" | Cloudflare 사용량, 토큰 | 한도 소진·토큰 만료. 서비스 영향 없음 |
| 배포 후 화면 오류 | 브라우저 콘솔, Vercel Logs | 5절 되돌리기 |
| 키 유출 의심 | `npm run check:secrets` | 즉시 공급자 콘솔에서 키 재발급 → Vercel 변수 교체 → 재배포 |

## 7. 출시 전 자동 점검
```bash
npm run check:release   # lint + typecheck + 단위 테스트 + 빌드 + 비밀정보 검사 + npm audit
npm run test:e2e        # 브라우저 테스트(모의 공급자)
```
- `check:secrets`는 `dist/`와 이 폴더의 git 이력에서 키 모양 문자열을 찾는다. 값은 출력하지 않는다.

## 8. 고지와 한계
- 화면 하단: 위치 비저장, 예상시간 참고용, 데이터 출처(OpenStreetMap·카카오모빌리티·제주 ITS·Cloudflare Workers AI).
- 재평가 영역: "운전 중에는 화면을 조작하지 마세요."
- 위치정보·약관 관련 **법률 검토는 하지 않았다.** 카카오모빌리티는 상업적 이용 시 사전 제휴가 필요하다(TASK-001 BLK-02). 현재 비상업 운영 전제.
