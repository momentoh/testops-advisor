'use strict';
/**
 * 요구사양서(SRS) 리뷰 요청/결과 이력 관리.
 * 프론트 업로드 폼 -> docParser + reqReviewGen 처리 결과를 DB에 남겨
 * 관리자 페이지에서 조회할 수 있게 한다.
 * (구조는 명세기반 테스트케이스 생성 기능의 specTestStore.js와 동일한 패턴)
 */
const crypto = require('crypto');
const { getDB, persist } = require('../db/store');

const MIN_INTERVAL_MS = 30 * 1000; // 남용 방지를 위한 최소 재요청 간격 (30초, Claude API 호출 비용 고려)
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 업로드 파일 최대 10MB

function getLast() {
  const db = getDB();
  if (!db.reqReviews || db.reqReviews.length === 0) return null;
  return db.reqReviews[db.reqReviews.length - 1];
}

function getAll() {
  const db = getDB();
  return (db.reqReviews || []).slice().reverse(); // 최신순
}

function getById(id) {
  const db = getDB();
  return (db.reqReviews || []).find((s) => s.id === id) || null;
}

function checkRateLimit() {
  const last = getLast();
  if (last && Date.now() - new Date(last.requestedAt).getTime() < MIN_INTERVAL_MS) {
    const waitSec = Math.ceil((MIN_INTERVAL_MS - (Date.now() - new Date(last.requestedAt).getTime())) / 1000);
    throw new Error(`너무 잦은 요청입니다. ${waitSec}초 후 다시 시도해 주세요.`);
  }
}

/**
 * 새 요청을 "승인 대기" 상태로 기록한다. Claude API 호출은 토큰(비용)을 소모하므로,
 * 관리자가 내용을 확인하고 승인하기 전까지는 실제 리뷰를 실행하지 않는다.
 */
function createPendingApproval({ filename, format, previewText }) {
  const db = getDB();
  const entry = {
    id: crypto.randomUUID(),
    filename,
    format,
    previewText: previewText || '',
    fullText: null, // 승인 시 실제 리뷰에 사용할 원문 텍스트 (승인 전까지만 임시 보관)
    status: 'pending_approval', // pending_approval | rejected | processing | done | error
    requestedAt: new Date().toISOString(),
    approvedAt: null,
    rejectedAt: null,
    completedAt: null,
    summary: null,
    overallScore: null,
    standardScores: [],
    findings: [],
    missingQualityCharacteristics: [],
    strengths: [],
    error: null,
  };
  db.reqReviews.push(entry);
  if (db.reqReviews.length > 30) db.reqReviews = db.reqReviews.slice(-30); // 이력 최근 30건만 유지
  persist();
  return entry;
}

/** 승인 전까지 실제 리뷰에 사용할 원문 텍스트를 저장한다. */
function setFullText(id, fullText) {
  const db = getDB();
  const entry = db.reqReviews.find((s) => s.id === id);
  if (!entry) return;
  entry.fullText = fullText;
  persist();
}

/** 관리자가 승인 시 "처리 중" 상태로 전환한다 (이때부터 실제 Claude API 호출이 시작됨). */
function markApprovedProcessing(id) {
  const db = getDB();
  const entry = db.reqReviews.find((s) => s.id === id);
  if (!entry) return null;
  entry.status = 'processing';
  entry.approvedAt = new Date().toISOString();
  persist();
  return entry;
}

/** 관리자가 반려 시 "반려" 상태로 전환한다 (Claude API 호출 없이 종료, 토큰 미소모). */
function markRejected(id, reason) {
  const db = getDB();
  const entry = db.reqReviews.find((s) => s.id === id);
  if (!entry) return null;
  entry.status = 'rejected';
  entry.rejectedAt = new Date().toISOString();
  entry.error = reason || null;
  entry.fullText = null;
  persist();
  return entry;
}

function markDone(id, result) {
  const db = getDB();
  const entry = db.reqReviews.find((s) => s.id === id);
  if (!entry) return;
  entry.status = 'done';
  entry.completedAt = new Date().toISOString();
  entry.summary = result.summary || null;
  entry.overallScore = result.overallScore || null;
  entry.standardScores = result.standardScores || [];
  entry.findings = result.findings || [];
  entry.missingQualityCharacteristics = result.missingQualityCharacteristics || [];
  entry.strengths = result.strengths || [];
  entry.fullText = null; // 리뷰 완료 후에는 원문 보관 불필요
  persist();
}

function markError(id, message) {
  const db = getDB();
  const entry = db.reqReviews.find((s) => s.id === id);
  if (!entry) return;
  entry.status = 'error';
  entry.completedAt = new Date().toISOString();
  entry.error = message;
  entry.fullText = null;
  persist();
}

/** 목록/상세 조회 시 원문 전체 텍스트(fullText)는 응답에서 제외한다 (불필요한 대용량 전송 방지). */
function toPublicShape(entry) {
  if (!entry) return entry;
  const { fullText, ...rest } = entry;
  return rest;
}

function getAllPublic() {
  return getAll().map(toPublicShape);
}

function getByIdPublic(id) {
  return toPublicShape(getById(id));
}

module.exports = {
  getLast,
  getAll,
  getById,
  getAllPublic,
  getByIdPublic,
  checkRateLimit,
  createPendingApproval,
  setFullText,
  markApprovedProcessing,
  markRejected,
  markDone,
  markError,
  MAX_FILE_BYTES,
};
