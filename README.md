# TestOps Advisor

SDLC(소프트웨어 개발 생명주기) **7단계 테스트 프로세스**별로 적합한 **자동화 에이전트 · MCP · 플랫폼 도구**를 추천하는 웹 애플리케이션입니다. 사용자가 추천 결과에 "도움됨/별로" 피드백을 남기면 그 데이터가 누적되어, 시간이 지날수록 추천 정확도가 스스로 개선됩니다.

## 핵심 특징

- **7단계 프로세스**: 요구사항분석 → 테스트계획 → 테스트케이스설계 → 단위테스트 → 통합/E2E테스트 → 성능/보안테스트 → 배포/모니터링
- **피드백 기반 지속 학습**: LLM 재학습이 아니라, 도구별 가중치(weight)를 온라인으로 갱신하는 경량 학습 방식(Wilson score 기반 신뢰도 + 가중치 곱)을 사용합니다. 비용이 들지 않고, 피드백이 쌓일수록 추천 순위가 점진적으로 개선됩니다.
- **관리자 웹 UI**: 도구 추가/삭제, 전체 추천 점수 확인, 단계별 피드백 통계, 최근 피드백 로그 확인
- **외부 의존성 없음**: Node.js 내장 모듈(`http`, `fs`)만으로 동작하는 경량 프레임워크를 자체 구현했습니다(`src/lib/router.js`, `src/lib/template.js`). `npm install` 없이 바로 실행 가능하며, 배포 환경에 따라 자유롭게 확장할 수 있습니다.
- **파일 기반 DB**: `data/db.json`에 JSON으로 저장됩니다. 별도 데이터베이스 서버가 필요 없어 무료 클라우드 배포에 적합합니다(단, 무료 플랜은 재배포 시 디스크가 초기화될 수 있으니 아래 "데이터 영속성" 참고).

## 로컬 실행 방법

```bash
git clone <이 저장소 URL>
cd testops-advisor
cp .env.example .env    # 필요 시 ADMIN_PASSWORD, SESSION_SECRET 수정
npm run seed             # 최초 1회: 7단계 + 초기 도구 목록 생성
npm start                 # http://localhost:3000
```

의존성이 전혀 없으므로 `npm install`은 생략해도 됩니다. (package.json의 dependencies가 비어 있습니다.)

## 관리자 페이지

- 접속: `/admin/login`
- 기본 비밀번호: `.env`의 `ADMIN_PASSWORD` (기본값 `admin1234`, **반드시 배포 전 변경**)
- 기능: 도구 추가/삭제, 전체 추천 점수/가중치 확인, 단계별·전체 피드백 통계, 최근 피드백 로그, CI 파이프라인 실행/결과 조회

### CI 파이프라인을 웹페이지에서 실행하기

관리자 대시보드 상단의 **"▶ 테스트 실행"** 버튼을 누르면 GitHub Actions의 CI 파이프라인(`.github/workflows/ci.yml`)이 실제로 트리거되고, 완료될 때까지 4초 간격으로 상태를 자동 조회해 각 단계(단위테스트/E2E/성능/보안)의 통과·실패 여부와 소요 시간을 화면에 표시합니다.

이 기능을 쓰려면 배포 환경(Render 등)에 아래 환경변수를 추가해야 합니다.

| 환경변수 | 설명 | 예시 |
|---|---|---|
| `GITHUB_TOKEN` | `repo`, `workflow` 스코프를 가진 GitHub Personal Access Token | `ghp_...` |
| `GITHUB_REPO` | `소유자/저장소` 형식 | `momentoh/testops-advisor` |
| `GITHUB_WORKFLOW_FILE` | (선택) 워크플로우 파일명, 기본값 `ci.yml` | `ci.yml` |
| `GITHUB_BRANCH` | (선택) 대상 브랜치, 기본값 `main` | `main` |

환경변수가 설정되지 않은 경우 버튼을 눌러도 "GitHub 연동이 설정되지 않았습니다" 안내만 표시되고 기존 기능에는 영향이 없습니다.

## 추천 로직 설명

각 도구의 최종 점수는 다음과 같이 계산됩니다.

```
score = confidence(upvotes, downvotes) × weight
```

- `confidence`: Wilson score 신뢰구간 하한을 사용해, 피드백이 적은 신규 도구가 우연한 좋아요 몇 개로 1위를 차지하지 않도록 보정합니다.
- `weight`: 피드백이 쌓일 때마다 점진적으로 조정되는 가중치입니다. 좋아요는 가중치를 서서히 올리고, 싫어요는 서서히 내립니다(학습률 0.15, 범위 0.05~3.0). 로직은 `src/services/recommend.js`에 있습니다.

## 배포 (Render.com 무료 플랜 기준)

자세한 단계는 `DEPLOY.md`를 참고하세요. 요약:

1. 이 저장소를 GitHub에 push
2. Render.com → New → Web Service → 이 저장소 연결
3. Build Command: (비워둠), Start Command: `npm start`
4. 환경변수 `ADMIN_PASSWORD`, `SESSION_SECRET` 설정
5. 배포 완료 후 발급되는 `https://xxx.onrender.com` 주소로 접속

## 데이터 영속성 관련 주의사항

Render 무료 플랜은 **영구 디스크(Persistent Disk)가 아닌 컨테이너 파일시스템**을 사용하므로, 재배포하거나 컨테이너가 재시작되면 `data/db.json`의 피드백/가중치 학습 데이터가 초기화될 수 있습니다.

축적된 학습 데이터를 안전하게 보존하려면:
- Render의 유료 "Persistent Disk" 애드온을 `/opt/render/project/src/data`에 마운트하거나,
- 추후 PostgreSQL 등 외부 DB로 마이그레이션하는 것을 권장합니다. (`src/db/store.js`의 인터페이스만 유지하면 다른 저장소로 교체가 용이하도록 설계했습니다.)

## 디렉터리 구조

```
src/
  db/           JSON 파일 스토어, 시드 데이터
  services/     추천 로직, 피드백 학습 로직, 도구 CRUD
  middleware/   관리자 인증
  lib/          자체 구현 라우터 및 템플릿 엔진 (외부 의존성 없음)
  views/        EJS 문법 서브셋 템플릿
  public/       정적 CSS
  server.js     엔트리포인트
tests/          Jest 단위 테스트
e2e/            Playwright 통합/E2E 테스트
perf/           k6 성능 테스트 스크립트
.github/workflows/  GitHub Actions CI 파이프라인
```

## CI/CD 파이프라인 (7단계 중 1순위 도구 자동화)

7단계 추천 목록 중 실제 코드에 적용 가능한 4개 단계의 1순위 도구를 골라 GitHub Actions로 자동 연동했습니다. `main` 브랜치에 push 하거나 PR을 열면 `.github/workflows/ci.yml`이 아래 순서로 자동 실행됩니다.

1. **단위 테스트 (Jest)** — `tests/recommend.test.js`. 추천 점수 계산(Wilson score confidence), 피드백 기반 가중치 학습(recordFeedback) 로직을 검증합니다.
2. **통합/E2E 테스트 (Playwright)** — `e2e/homepage.spec.js`. 실제 서버를 기동해 홈페이지, 단계별 추천 페이지, 헬스체크, 관리자 인증 리다이렉트를 브라우저 기준으로 검증합니다.
3. **성능 테스트 (k6)** — `perf/load-test.js`. 동시 사용자 5명 기준 15초 부하를 가해 실패율 1% 미만, p95 응답 500ms 이내 기준을 검증합니다.
4. **보안 취약점 점검 (npm audit)** — 의존성 취약점을 점검합니다(높음 등급 이상).
5. 위 테스트를 모두 통과하면 Render.com이 감지한 push를 기반으로 자동 재배포됩니다.

로컬에서 개별 실행하려면(먼저 `npm install`로 devDependencies 설치 필요):

```bash
npm test          # Jest 단위 테스트
npm run test:e2e   # Playwright E2E 테스트 (최초 1회 `npx playwright install` 필요)
npm run test:perf  # k6 성능 테스트 (k6 별도 설치 필요: https://k6.io/docs/get-started/installation/)
```

> 요구사항분석·테스트계획·테스트케이스설계 단계의 1순위 도구(Jira, TestRail, Playwright Codegen)는 티켓/문서 관리형 SaaS 도구라 CI로 자동 실행할 성격이 아니어서 이번 파이프라인 범위에서는 제외했습니다.
