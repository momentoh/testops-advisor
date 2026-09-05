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
- 기능: 도구 추가/삭제, 전체 추천 점수/가중치 확인, 단계별·전체 피드백 통계, 최근 피드백 로그

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
```
