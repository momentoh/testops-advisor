'use strict';
/**
 * Postgres(예: Supabase 무료 티어) 연동 모듈.
 *
 * 설계 방침:
 * - 기존 코드(59곳 이상)가 store.js의 getDB()/persist()를 "동기 함수"로 호출하고 있어,
 *   이 인터페이스를 그대로 유지한 채 내부 구현만 Postgres 연동으로 바꾼다.
 * - Postgres에는 기존 JSON 구조(stages/tools/feedback/admins/siteAudits/specTests/ciTests/reqReviews)를
 *   그대로 JSONB 한 컬럼(app_state.data)에 저장한다. 관계형으로 완전히 정규화하지 않는 이유는
 *   59곳의 호출부(서비스 모듈들)를 전혀 수정하지 않고도 영구 저장소 연동이 가능하도록 하기 위함이다.
 * - 서버 부팅 시 Postgres에서 1회 로드해 메모리 캐시에 채우고, 이후 persist() 호출 시마다
 *   (1) 기존과 동일하게 파일에도 즉시 저장하고, (2) 백그라운드로 Postgres에도 비동기 반영한다.
 *   Postgres 저장이 실패해도 서비스 자체는 파일 기반으로 계속 동작한다(가용성 우선).
 * - DATABASE_URL 환경변수가 없으면 이 모듈은 비활성 상태로 남고, store.js는 기존처럼
 *   파일 기반으로만 동작한다(로컬 개발 편의성 유지).
 */
let pool = null;
let pgAvailable = false;

// process.env.DATABASE_URL을 모듈 로드 시점에 한 번만 캡처하지 않고 매번 직접 읽는다.
// (테스트에서 jest.resetModules()로 모듈을 다시 불러올 때마다 그 시점의 환경변수 값을
// 정확히 반영해야 하며, 실제 운영 환경에서는 부팅 이후 값이 바뀌지 않으므로 동작에
// 차이가 없다.)
function isConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

function getPool() {
  if (pool) return pool;
  // pg 패키지는 DATABASE_URL이 설정된 경우에만 필요하므로 지연 로딩한다.
  // (제로 디펜던시 원칙의 예외로 새로 추가된 유일한 런타임 의존성)
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // Supabase 등 관리형 Postgres는 SSL이 필요하며, 대부분 자체 서명 체인을 사용하므로
    // rejectUnauthorized를 false로 둔다 (연결 문자열 자체가 이미 비밀번호로 보호됨).
    ssl: { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
  pool.on('error', (err) => {
    console.error('[pg] 유휴 커넥션 오류(무시하고 계속 진행):', err.message);
  });
  return pool;
}

async function ensureSchema() {
  const p = getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

/**
 * Postgres에서 전체 앱 상태(JSON)를 읽어온다. 행이 없으면 null을 반환한다.
 */
async function loadState() {
  if (!isConfigured()) return null;
  try {
    await ensureSchema();
    const p = getPool();
    const result = await p.query('SELECT data FROM app_state WHERE id = $1', ['main']);
    if (result.rows.length === 0) return null;
    pgAvailable = true;
    return result.rows[0].data;
  } catch (err) {
    console.error('[pg] 초기 로드 실패, 파일 기반 DB로 계속 진행합니다:', err.message);
    pgAvailable = false;
    return null;
  }
}

/**
 * Postgres에 전체 앱 상태(JSON)를 저장(upsert)한다. 실패해도 예외를 던지지 않고 로그만 남긴다
 * (파일 기반 저장은 이미 완료된 상태이므로 서비스 가용성에는 영향이 없어야 한다).
 */
async function saveState(data) {
  if (!isConfigured()) return;
  try {
    await ensureSchema();
    const p = getPool();
    await p.query(
      `INSERT INTO app_state (id, data, updated_at) VALUES ('main', $1, now())
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
      [JSON.stringify(data)]
    );
    pgAvailable = true;
  } catch (err) {
    console.error('[pg] 저장 실패 (파일 기반 DB는 정상 저장됨, 다음 저장 시 재시도됩니다):', err.message);
    pgAvailable = false;
  }
}

function isAvailable() {
  return pgAvailable;
}

module.exports = { isConfigured, loadState, saveState, isAvailable };
