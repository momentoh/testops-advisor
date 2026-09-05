'use strict';
/**
 * 프론트 홈페이지의 "웹사이트 검사" 폼 처리 서비스.
 * 사용자가 입력한 URL을 받아 GitHub Actions의 site-audit.yml(workflow_dispatch)을
 * 트리거하고, 요청 이력을 DB에 남겨 관리자 대시보드에서 최근 1건을 조회할 수 있게 한다.
 */
const crypto = require('crypto');
const { getDB, persist } = require('../db/store');
const ci = require('./ci');

const SITE_AUDIT_WORKFLOW = process.env.SITE_AUDIT_WORKFLOW_FILE || 'site-audit.yml';
const MIN_INTERVAL_MS = 60 * 1000; // 동일 서버에서 남용 방지를 위한 최소 재요청 간격 (1분)

function isValidUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

function getLastAudit() {
  const db = getDB();
  if (!db.siteAudits || db.siteAudits.length === 0) return null;
  return db.siteAudits[db.siteAudits.length - 1];
}

/** URL 검사를 요청한다. 성공 시 이력을 DB에 기록하고 GitHub Actions를 트리거한다. */
async function requestAudit(targetUrl) {
  if (!targetUrl || !isValidUrl(targetUrl)) {
    throw new Error('올바른 URL 형식이 아닙니다. (예: https://example.com)');
  }
  if (!ci.isConfigured()) {
    throw new Error('GITHUB_TOKEN / GITHUB_REPO 환경변수가 설정되지 않아 검사를 실행할 수 없습니다.');
  }

  const last = getLastAudit();
  if (last && Date.now() - new Date(last.requestedAt).getTime() < MIN_INTERVAL_MS) {
    const waitSec = Math.ceil((MIN_INTERVAL_MS - (Date.now() - new Date(last.requestedAt).getTime())) / 1000);
    throw new Error(`너무 잦은 요청입니다. ${waitSec}초 후 다시 시도해 주세요.`);
  }

  await ci.triggerWorkflow(SITE_AUDIT_WORKFLOW, { target_url: targetUrl });

  const db = getDB();
  const entry = {
    id: crypto.randomUUID(),
    targetUrl,
    requestedAt: new Date().toISOString(),
  };
  db.siteAudits.push(entry);
  // 이력이 과도하게 쌓이지 않도록 최근 50건만 유지
  if (db.siteAudits.length > 50) db.siteAudits = db.siteAudits.slice(-50);
  persist();

  return entry;
}

module.exports = {
  requestAudit,
  getLastAudit,
  SITE_AUDIT_WORKFLOW,
  isValidUrl,
};
