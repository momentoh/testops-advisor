'use strict';
/**
 * GitHub Actions CI 파이프라인 연동 서비스.
 * 관리자 대시보드의 "테스트 실행" 버튼에서 사용:
 *  1) workflow_dispatch로 .github/workflows/ci.yml 실행을 트리거
 *  2) 방금 트리거된 실행(run)을 찾아 상태를 폴링하며 각 잡(job)의 통과/실패를 조회
 *
 * 필요한 환경변수:
 *  - GITHUB_TOKEN: repo, workflow 스코프를 가진 Personal Access Token
 *  - GITHUB_REPO: "owner/repo" 형식 (예: momentoh/testops-advisor)
 *  - GITHUB_WORKFLOW_FILE: 워크플로우 파일명 (기본값 ci.yml)
 */
const https = require('https');

const API_HOST = 'api.github.com';
const TOKEN = process.env.GITHUB_TOKEN || '';
const REPO = process.env.GITHUB_REPO || '';
const WORKFLOW_FILE = process.env.GITHUB_WORKFLOW_FILE || 'ci.yml';
const BRANCH = process.env.GITHUB_BRANCH || 'main';

function isConfigured() {
  return Boolean(TOKEN && REPO);
}

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request(
      {
        hostname: API_HOST,
        path,
        method,
        headers: {
          'User-Agent': 'testops-advisor',
          Authorization: `Bearer ${TOKEN}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          let parsed = null;
          try {
            parsed = data ? JSON.parse(data) : null;
          } catch (e) {
            // 일부 응답(204 No Content)은 본문이 없음
          }
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ status: res.statusCode, headers: res.headers, body: parsed });
          } else {
            reject(new Error(`GitHub API 오류 (${res.statusCode}): ${data || res.statusMessage}`));
          }
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** workflow_dispatch로 새 실행을 트리거한다. */
async function triggerWorkflow() {
  if (!isConfigured()) throw new Error('GITHUB_TOKEN / GITHUB_REPO 환경변수가 설정되지 않았습니다.');
  await request('POST', `/repos/${REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`, {
    ref: BRANCH,
  });
}

/** 가장 최근 workflow run 하나를 조회한다. */
async function getLatestRun() {
  if (!isConfigured()) throw new Error('GITHUB_TOKEN / GITHUB_REPO 환경변수가 설정되지 않았습니다.');
  const res = await request(
    'GET',
    `/repos/${REPO}/actions/workflows/${WORKFLOW_FILE}/runs?branch=${BRANCH}&per_page=1`
  );
  const run = res.body && res.body.workflow_runs && res.body.workflow_runs[0];
  return run || null;
}

/** 특정 run의 잡(job) 목록과 각 상태를 조회한다. */
async function getRunJobs(runId) {
  const res = await request('GET', `/repos/${REPO}/actions/runs/${runId}/jobs`);
  return (res.body && res.body.jobs) || [];
}

/** 특정 run의 요약 정보(상태/결론/소요시간)를 반환한다. */
async function getRunSummary(runId) {
  const res = await request('GET', `/repos/${REPO}/actions/runs/${runId}`);
  return res.body;
}

module.exports = {
  isConfigured,
  triggerWorkflow,
  getLatestRun,
  getRunJobs,
  getRunSummary,
  REPO,
  WORKFLOW_FILE,
  BRANCH,
};
