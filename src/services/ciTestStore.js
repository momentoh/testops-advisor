'use strict';
/**
 * 프론트 홈페이지의 "CI/CD 자동 테스트 실행 요청" 폼 처리 이력 관리.
 *
 * 기존에는 관리자 대시보드의 "▶ 테스트 실행" 버튼으로 관리자가 직접 즉시 실행했지만,
 * 이제는 누구나 프론트에서 대상 URL/요청사항을 입력해 실행을 "요청"할 수 있고,
 * 실제 GitHub Actions 파이프라인(단위테스트 -> E2E -> 성능 -> 보안점검) 실행은
 * 관리자가 내용을 확인하고 승인해야만 시작된다.
 */
const crypto = require('crypto');
const { getDB, persist } = require('../db/store');

const MIN_INTERVAL_MS = 30 * 1000; // 남용 방지를 위한 최소 재요청 간격

function getLast() {
  const db = getDB();
  if (!db.ciTests || db.ciTests.length === 0) return null;
  return db.ciTests[db.ciTests.length - 1];
}

function getAll() {
  const db = getDB();
  return (db.ciTests || []).slice().reverse(); // 최신순
}

function getById(id) {
  const db = getDB();
  return (db.ciTests || []).find((c) => c.id === id) || null;
}

function checkRateLimit() {
  const last = getLast();
  if (last && Date.now() - new Date(last.requestedAt).getTime() < MIN_INTERVAL_MS) {
    const waitSec = Math.ceil((MIN_INTERVAL_MS - (Date.now() - new Date(last.requestedAt).getTime())) / 1000);
    throw new Error(`너무 잦은 요청입니다. ${waitSec}초 후 다시 시도해 주세요.`);
  }
}

/** 새 실행 요청을 "승인 대기" 상태로 기록한다. 이 시점에는 GitHub Actions를 트리거하지 않는다. */
function createPendingApproval({ targetUrl, requirements }) {
  const db = getDB();
  const entry = {
    id: crypto.randomUUID(),
    targetUrl: targetUrl || '',
    requirements: requirements || '',
    status: 'pending_approval', // pending_approval | rejected | running | done | error
    requestedAt: new Date().toISOString(),
    approvedAt: null,
    rejectedAt: null,
    completedAt: null,
    runId: null,
    runHtmlUrl: null,
    error: null,
  };
  db.ciTests.push(entry);
  if (db.ciTests.length > 30) db.ciTests = db.ciTests.slice(-30); // 이력 최근 30건만 유지
  persist();
  return entry;
}

/** 관리자가 승인하면 "실행 중" 상태로 전환하고, 실제 GitHub Actions 실행(run)의 ID를 연결한다. */
function markApprovedRunning(id, { runId, runHtmlUrl }) {
  const db = getDB();
  const entry = db.ciTests.find((c) => c.id === id);
  if (!entry) return null;
  entry.status = 'running';
  entry.approvedAt = new Date().toISOString();
  entry.runId = runId || null;
  entry.runHtmlUrl = runHtmlUrl || null;
  persist();
  return entry;
}

/** 관리자가 반려하면 GitHub Actions 실행 없이 종료한다. */
function markRejected(id, reason) {
  const db = getDB();
  const entry = db.ciTests.find((c) => c.id === id);
  if (!entry) return null;
  entry.status = 'rejected';
  entry.rejectedAt = new Date().toISOString();
  entry.error = reason || null;
  persist();
  return entry;
}

function markDone(id, conclusion) {
  const db = getDB();
  const entry = db.ciTests.find((c) => c.id === id);
  if (!entry) return;
  entry.status = conclusion === 'success' ? 'done' : 'error';
  entry.completedAt = new Date().toISOString();
  persist();
}

function markError(id, message) {
  const db = getDB();
  const entry = db.ciTests.find((c) => c.id === id);
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
  createPendingApproval,
  markApprovedRunning,
  markRejected,
  markDone,
  markError,
  MIN_INTERVAL_MS,
};
