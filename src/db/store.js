'use strict';
/**
 * 초경량 파일 기반 JSON 데이터 스토어.
 * 기본적으로 외부 DB 의존성 없이 파일에 저장한다 (Render 무료 플랜의 컨테이너 디스크).
 *
 * DATABASE_URL 환경변수가 설정된 경우(예: Supabase 등 무료 Postgres) pg.js를 통해
 * 영구 저장소에도 함께 저장한다. Render 무료 플랜은 재배포/재시작 시 컨테이너 디스크가
 * 초기화되어 파일 기반 DB만으로는 이력이 사라지므로, 서버 부팅 시 initAsync()로
 * Postgres에 저장된 최신 데이터를 먼저 불러와 파일에 복원한 뒤 기존 로직을 그대로 사용한다.
 * (기존 getDB()/persist()는 동기 함수이며, 이 시그니처를 바꾸면 59곳 이상의 호출부를
 * 모두 수정해야 하므로, 대신 "부팅 시 1회 비동기 로드 + 저장 시 비동기 반영" 방식을 취한다.)
 */
const fs = require('fs');
const path = require('path');
const pg = require('./pg');

// 테스트 환경에서는 TESTOPS_DB_PATH로 별도의 임시 DB 파일을 지정해
// 운영 데이터(data/db.json)를 건드리지 않고 격리된 상태로 검증할 수 있다.
const DB_FILE = process.env.TESTOPS_DB_PATH
  ? path.resolve(process.env.TESTOPS_DB_PATH)
  : path.join(__dirname, '..', '..', 'data', 'db.json');
const DATA_DIR = path.dirname(DB_FILE);

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function defaultData() {
  return {
    stages: [],       // 7단계 SDLC 테스트 프로세스
    tools: [],         // 자동화 에이전트 / MCP 목록
    feedback: [],       // 사용자 피드백 로그 (학습 데이터)
    admins: [],         // 관리자 계정 (해시 저장)
    siteAudits: [],     // 프론트 "웹사이트 검사" 폼으로 제출된 URL 감사 요청 이력
    specTests: [],       // 명세 문서 업로드로 생성된 명세기반 블랙박스 테스트케이스 이력
    ciTests: [],         // 프론트 "CI/CD 자동 테스트 실행 요청" 폼으로 제출된 승인 대기/실행 이력
    reqReviews: [],      // 요구사양서 업로드로 생성된 요구사항 리뷰(29148/830/25030/25010/12207) 이력
  };
}

let cache = null;

function load() {
  ensureDataDir();
  if (!fs.existsSync(DB_FILE)) {
    cache = defaultData();
    save();
    return cache;
  }
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    cache = JSON.parse(raw);
    // 스키마 보정 (신규 필드 누락 방지)
    const def = defaultData();
    for (const key of Object.keys(def)) {
      if (!Array.isArray(cache[key])) cache[key] = def[key];
    }
    return cache;
  } catch (err) {
    console.error('[store] DB 파일 로드 실패, 기본값으로 초기화:', err.message);
    cache = defaultData();
    save();
    return cache;
  }
}

function save() {
  ensureDataDir();
  const tmpFile = DB_FILE + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(cache, null, 2), 'utf-8');
  fs.renameSync(tmpFile, DB_FILE);
}

function getDB() {
  if (!cache) load();
  return cache;
}

/**
 * 파일에 즉시 저장(기존 동작 그대로 유지)한 뒤, DATABASE_URL이 설정된 경우
 * Postgres에도 비동기로 반영한다. Postgres 저장은 fire-and-forget이며 실패해도
 * persist() 호출자에게 예외를 전파하지 않는다 (파일 저장은 이미 완료되어 있으므로
 * 서비스 동작에는 영향이 없고, 다음 persist() 호출 때 최신 상태로 다시 시도된다).
 */
function persist() {
  save();
  if (pg.isConfigured()) {
    pg.saveState(cache).catch((err) => {
      console.error('[store] Postgres 반영 중 예기치 못한 오류:', err.message);
    });
  }
}

/**
 * 서버 부팅 시 1회 호출한다. DATABASE_URL이 설정되어 있고 Postgres에 저장된 데이터가
 * 있으면 그것을 최신 상태로 간주해 파일에 덮어써서 메모리 캐시를 채운다.
 * (Render 재배포로 파일 기반 DB가 초기화된 경우, 이 시점에 Postgres의 이력이 복원된다.)
 * Postgres 미설정이거나 저장된 데이터가 없으면 기존처럼 파일 기반 load()만 수행한다.
 */
async function initAsync() {
  if (pg.isConfigured()) {
    const remote = await pg.loadState();
    if (remote) {
      // 스키마 보정 (신규 필드 누락 방지) 후 파일에도 반영해 캐시와 파일을 동기화한다.
      const def = defaultData();
      for (const key of Object.keys(def)) {
        if (!Array.isArray(remote[key])) remote[key] = def[key];
      }
      cache = remote;
      save();
      console.log('[store] Postgres(DATABASE_URL)에서 최신 데이터를 불러와 복원했습니다.');
      return cache;
    }
    console.log('[store] Postgres에 저장된 데이터가 없어 파일 기반 데이터로 시작합니다 (이후 자동으로 Postgres에도 저장됩니다).');
  }
  return load();
}

module.exports = { getDB, persist, load, initAsync, DATA_DIR, DB_FILE };
