# 배포 가이드 (GitHub + Render.com)

이 문서는 개발 지식이 없어도 그대로 따라할 수 있도록 클릭 단위로 작성했습니다.

## 1단계. GitHub에 저장소 올리기

1. https://github.com 에 로그인 후 우측 상단 **+** → **New repository** 클릭
2. Repository name에 `testops-advisor` 입력, Public 또는 Private 선택 후 **Create repository**
3. 아래 명령어를 이 프로젝트 폴더(`testops-advisor`)에서 실행합니다. `<your-username>`과 `<repo-url>`은 방금 만든 저장소 주소로 교체하세요.

```bash
git remote add origin https://github.com/<your-username>/testops-advisor.git
git branch -M main
git push -u origin main
```

4. 이후 코드를 수정할 때마다 아래 3줄이면 GitHub와 Render 양쪽 모두 최신 상태로 반영됩니다(Render는 GitHub push를 감지해 자동 재배포합니다).

```bash
git add -A
git commit -m "설명"
git push
```

## 2단계. Render.com 가입 및 서비스 생성

1. https://render.com 에서 GitHub 계정으로 가입/로그인
2. 대시보드에서 **New +** → **Web Service** 클릭
3. 방금 만든 `testops-advisor` GitHub 저장소를 선택하고 **Connect**
4. 아래와 같이 설정합니다.
   - **Name**: `testops-advisor` (원하는 이름으로 변경 가능. 이 이름이 URL에 포함됩니다: `https://testops-advisor.onrender.com`)
   - **Region**: Singapore (한국에서 가장 가까움)
   - **Branch**: `main`
   - **Runtime**: Node
   - **Build Command**: `npm run seed`
   - **Start Command**: `npm start`
   - **Instance Type**: Free
5. **Advanced** 섹션에서 환경변수(Environment Variables) 추가:
   - `ADMIN_PASSWORD` = 원하는 강력한 비밀번호 (예: `MyStr0ng!Pass2026`)
   - `SESSION_SECRET` = 임의의 긴 랜덤 문자열 (예: `openssl rand -hex 32` 명령 결과 또는 아무 긴 문자열)
   - `NODE_ENV` = `production`
6. **Create Web Service** 클릭 → 자동으로 빌드 및 배포가 시작됩니다 (2~5분 소요)
7. 배포가 끝나면 화면 상단에 `https://testops-advisor.onrender.com` 같은 주소가 표시됩니다. 이 주소로 접속하면 서비스가 열립니다.

> `render.yaml` 파일이 저장소에 포함되어 있으므로, **Blueprint** 방식(Render 대시보드 → New + → Blueprint → 저장소 선택)으로 위 설정을 자동으로 채울 수도 있습니다. 이 경우에도 `ADMIN_PASSWORD`는 직접 입력해야 합니다.

## 3단계. 배포 확인

1. 발급된 URL로 접속해 7단계 화면이 뜨는지 확인
2. `https://<your-app>.onrender.com/admin/login` 접속 후, 2단계에서 설정한 `ADMIN_PASSWORD`로 로그인되는지 확인
3. `https://<your-app>.onrender.com/healthz` 접속 시 `{"ok":true,...}` 응답이 오는지 확인

## 무료 플랜 관련 참고사항

- **슬립 모드**: Render 무료 플랜은 15분간 요청이 없으면 서버가 잠들고, 다음 요청 시 재시작에 30초~1분 정도 걸립니다. 실제 운영에 부담이 되면 유료 플랜(월 7달러대)으로 전환하면 상시 구동됩니다.
- **데이터 초기화 주의**: 무료 플랜은 영구 디스크가 아니므로, 코드를 재배포(git push)하거나 서버가 재시작되면 그동안 쌓인 피드백/가중치 데이터(`data/db.json`)가 초기 시드 상태로 되돌아갈 수 있습니다. 학습 데이터를 계속 유지하고 싶다면:
  - Render 대시보드 → 서비스 → **Disks** 탭에서 Persistent Disk를 추가(유료)하고 마운트 경로를 `/opt/render/project/src/data`로 지정하거나,
  - 추후 외부 데이터베이스(PostgreSQL 등)로 전환하는 것을 권장합니다.

## daosh.mycafe24.com과의 관계

기존 daosh.mycafe24.com은 워드프레스(PHP/Apache) 사이트가 이미 운영 중이라 이 Node.js 앱을 같은 곳에 설치할 수 없습니다. 이 앱은 완전히 별도의 Render 주소(`https://testops-advisor.onrender.com` 등)에서 독립적으로 운영됩니다. 필요하다면 워드프레스 메뉴에 이 Render 주소로 연결되는 링크를 추가하는 방식으로 접근성을 높일 수 있습니다.
