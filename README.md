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

### 웹사이트 종합 검사 (프론트 홈페이지 URL 입력 폼)

홈페이지(`/`)에 "웹사이트 종합 검사" 폼이 있어, 누구나 임의의 웹사이트 URL을 입력해 검사를 요청할 수 있습니다. 제출하면 `.github/workflows/site-audit.yml`이 `workflow_dispatch`로 트리거되어 아래 3가지를 순서대로 점검합니다.

1. **기능 검증 (Playwright)** — `e2e/site-audit.spec.js`. 접속성(HTTP 상태), 페이지 로드 시 콘솔 에러, 페이지 내 깨진 링크(최대 20개 샘플), 기본 접근성(`<title>` 존재, `alt` 속성 누락 이미지 수), 페이지 로드 시간을 점검합니다.
2. **성능 검증 (k6)** — `perf/site-audit-load-test.js`. 동시 사용자 3명, 10초 부하로 응답 실패율과 응답 속도(p95 3초 이내)를 측정합니다.
3. **API/HTTP 응답 검증** — `scripts/http-check.js`. 입력한 URL 자체의 HTTP 상태 코드, 응답 시간, Content-Type, 주요 보안 헤더 유무를 확인합니다.

결과는 관리자 대시보드의 "웹사이트 검사 결과" 섹션에서 가장 최근 요청 1건에 대해 각 단계의 통과/실패와 소요 시간을 실시간으로 확인할 수 있으며, 콘솔 에러 목록·깨진 링크 목록 등 상세 로그는 "GitHub Actions에서 자세히 보기" 링크를 통해 확인합니다.

이 기능은 위의 GitHub 연동 환경변수(`GITHUB_TOKEN`, `GITHUB_REPO`)를 그대로 사용합니다. 남용 방지를 위해 동일 서버에서 검사 요청은 최소 1분 간격으로 제한됩니다.

### 단계별 상세 결과 보기 (테스트케이스 / 성능 지표 드릴다운)

CI/CD 파이프라인과 웹사이트 검사 결과 테이블 모두에서, 완료된 단계의 **상태 값(✅ 통과 / ❌ 실패)을 클릭**하면 해당 단계의 GitHub Actions 잡 로그를 실시간으로 가져와 아래 정보를 펼쳐서 보여줍니다.

- **생성된 테스트케이스 목록**: Jest·Playwright·k6에서 실행된 개별 테스트 항목과 각각의 통과/실패 여부
- **성능/지표 결과**: k6의 응답 시간(p95)·실패율 등 수치 지표, HTTP 검증의 상태 코드·응답 시간·보안 헤더 값, npm audit의 취약점 요약
- **원본 로그(마지막 200줄)**: 위 정보로 충분하지 않을 때 참고할 수 있는 펼치기 형태의 원본 로그

내부적으로는 GitHub Actions의 잡 로그 다운로드 API(`/actions/jobs/{job_id}/logs`, 302 리다이렉트를 따라가 실제 로그를 가져옴)를 호출한 뒤, 잡 이름에 포함된 키워드(Jest/Playwright/k6/audit/HTTP)로 알맞은 파서를 선택해 텍스트를 구조화합니다(`src/services/logParser.js`). 한 번 불러온 상세 결과는 페이지를 새로고침하기 전까지 브라우저에 캐시되어 재클릭 시 다시 요청하지 않습니다.

## 명세기반 블랙박스 테스트케이스 자동 생성 (AI 연동)

홈페이지에 "명세기반 블랙박스 테스트케이스 자동 생성" 업로드 폼이 있어, 요구사항/기능 명세 문서(엑셀 `.xlsx`, 워드 `.docx`, PDF, 텍스트 `.txt`/`.csv`/`.md`)를 업로드하면 AI가 문서 내용을 분석해 아래 국제 표준을 적용한 테스트케이스를 자동으로 생성합니다.

- **ISO/IEC 25010** (제품 품질 모델): 각 테스트케이스를 기능적합성·성능효율성·호환성·사용성·신뢰성·보안성·유지보수성·이식성 8대 품질특성 중 하나 이상에 매핑
- **ISO/IEC 25023** (품질 측정): 테스트케이스의 기대 결과를 "응답 시간 3초 이내"처럼 가능한 한 정량적 지표로 서술
- **ISO/IEC/IEEE 29119-4** (테스트 설계 기법): 동등분할(Equivalence Partitioning), 경계값분석(Boundary Value Analysis), 결정테이블(Decision Table), 상태전이(State Transition), 유스케이스 테스트 중 적합한 기법을 명시적으로 적용해 테스트케이스 도출

생성된 각 테스트케이스에는 ID, 제목, 원문 요구사항, ISO 25010 매핑, 29119 설계기법, 사전조건, 절차, 테스트 데이터, 기대 결과, 우선순위가 포함되며, 업로드한 페이지에서 바로 표 형태로 확인할 수 있습니다.

### 사용 방법

1. 배포 환경(Render 등)에 `ANTHROPIC_API_KEY` 환경변수를 추가합니다. (console.anthropic.com 에서 발급)
2. 홈페이지에서 문서를 업로드하고 "테스트케이스 생성" 버튼을 누릅니다.
3. AI 분석에는 문서 길이에 따라 수십 초~1~2분 정도 소요되며, 완료되면 자동으로 결과가 표시됩니다.

문서가 너무 길 경우(약 4만자 초과) 앞부분만 사용해 생성하며, 이 경우 화면에 안내 문구가 표시됩니다. 남용 방지를 위해 요청 간 최소 30초 간격 제한이 있습니다.

이 기능은 `xlsx`(엑셀 파싱), `mammoth`(워드 파싱), `pdf-parse`(PDF 파싱) 3개 라이브러리에 의존합니다. 프로젝트의 "외부 의존성 없음" 원칙에 대한 예외로, 문서 파싱은 바이너리/XML 포맷을 직접 구현하기 어려워 검증된 경량 라이브러리를 사용했습니다. `npm install`로 설치한 뒤 사용하세요.

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

Render 무료 플랜은 **영구 디스크(Persistent Disk)가 아닌 컨테이너 파일시스템**을 사용하므로, 재배포하거나 컨테이너가 재시작되면 `data/db.json`(피드백/가중치 학습 데이터, 요구사양서 리뷰·명세기반 테스트케이스·CI 실행·웹사이트 검사 이력 등)이 초기화될 수 있습니다.

이를 방지하기 위해 **외부 Postgres(예: Supabase, Neon 등 무료 티어) 연동을 지원**합니다:

- Render 환경변수에 `DATABASE_URL`(Postgres 연결 문자열)을 설정하면, 서버 부팅 시 Postgres에 저장된 최신 데이터를 먼저 복원한 뒤 시작합니다. 이후 데이터가 변경될 때마다 파일(`data/db.json`)뿐 아니라 Postgres에도 함께 저장되어, 재배포로 컨테이너 디스크가 초기화되어도 이력이 보존됩니다.
- `DATABASE_URL`을 설정하지 않으면 기존처럼 파일 기반으로만 동작합니다 (로컬 개발 환경에서는 설정하지 않는 것을 권장).
- Supabase 기준 연결 문자열은 "Connect to your project" 화면에서 **Transaction pooler**(포트 6543) 방식을 사용하는 것을 권장합니다. 서버리스/컨테이너 환경에서 Direct connection(IPv6 기반)보다 안정적으로 연결됩니다.
- Postgres 저장은 파일 저장 뒤에 비동기로 반영되며, 저장에 실패해도 서비스 자체는 파일 기반으로 계속 동작합니다(가용성 우선 설계). 다만 이 특성상 파일 저장 직후~다음 저장 사이의 아주 짧은 시간 동안 서버가 강제 종료되면 그 사이의 변경분은 Postgres에 반영되지 않을 수 있습니다.
- 구현은 `src/db/pg.js`(Postgres 연동)와 `src/db/store.js`의 `initAsync()`/`persist()`에 있으며, 기존 `getDB()`/`persist()` 동기 인터페이스를 그대로 유지해 다른 서비스 코드는 전혀 수정하지 않았습니다.

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
