'use strict';
/**
 * 초경량 파일 기반 JSON 데이터 스토어.
 * 외부 DB 의존성 없이 동작하도록 설계 (Render 무료 플랜의 디스크에 저장).
 * 동시 쓰기가 많지 않은 소규모 내부 도구에 적합.
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

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

function persist() {
  save();
}

module.exports = { getDB, persist, load, DATA_DIR, DB_FILE };
