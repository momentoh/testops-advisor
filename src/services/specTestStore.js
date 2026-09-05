'use strict';
/**
 * 명세기반 블랙박스 테스트케이스 생성 요청/결과 이력 관리.
 * 프론트 업로드 폼 -> docParser + specTestGen 처리 결과를 DB에 남겨
 * 홈페이지/관리자 페이지에서 조회할 수 있게 한다.
 */
const crypto = require('crypto');
const { getDB, persist } = require('../db/store');

const MIN_INTERVAL_MS = 30 * 1000; // 남용 방지를 위한 최소 재요청 간격 (30초, Claude API 호출 비용 고려)
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 업로드 파일 최대 10MB

function getLast() {
  const db = getDB();
  if (!db.specTests || db.specTests.length === 0) return null;
  return db.specTests[db.specTests.length - 1];
}

function getAll() {
  const db = getDB();
  return (db.specTests || []).slice().reverse(); // 최신순
}

function getById(id) {
  const db = getDB();
  return (db.specTests || []).find((s) => s.id === id) || null;
}

function checkRateLimit() {
  const last = getLast();
  if (last && Date.now() - new Date(last.requestedAt).getTime() < MIN_INTERVAL_MS) {
    const waitSec = Math.ceil((MIN_INTERVAL_MS - (Date.now() - new Date(last.requestedAt).getTime())) / 1000);
    throw new Error(`너무 잦은 요청입니다. ${waitSec}초 후 다시 시도해 주세요.`);
  }
}

/** 새 요청을 "처리 중" 상태로 기록한다. */
function createPending({ filename, format }) {
  const db = getDB();
  const entry = {
    id: crypto.randomUUID(),
    filename,
    format,
    status: 'processing', // processing | done | error
    requestedAt: new Date().toISOString(),
    completedAt: null,
    summary: null,
    testCases: [],
    error: null,
  };
  db.specTests.push(entry);
  if (db.specTests.length > 30) db.specTests = db.specTests.slice(-30); // 이력 최근 30건만 유지
  persist();
  return entry;
}

function markDone(id, { summary, testCases }) {
  const db = getDB();
  const entry = db.specTests.find((s) => s.id === id);
  if (!entry) return;
  entry.status = 'done';
  entry.completedAt = new Date().toISOString();
  entry.summary = summary;
  entry.testCases = testCases;
  persist();
}

function markError(id, message) {
  const db = getDB();
  const entry = db.specTests.find((s) => s.id === id);
  if (!entry) return;
  entry.status = 'error';
  entry.completedAt = new Date().toISOString();
  entry.error = message;
  persist();
}

module.exports = {
  getLast,
  getAll,
  getById,
  checkRateLimit,
  createPending,
  markDone,
  markError,
  MAX_FILE_BYTES,
};
