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
            // 일부 응답(204 No Content, 또는 plain text 로그)은 JSON이 아님
          }
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ status: res.statusCode, headers: res.headers, body: parsed, text: data });
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

/**
 * GitHub API가 반환하는 리다이렉트(302)를 따라가며 요청한다.
 * 잡 로그 다운로드 엔드포인트는 실제 로그가 있는 blob storage URL로 리다이렉트되기 때문에 필요.
 */
function requestFollowRedirect(method, path, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    function go(currentPath, isAbsolute, redirectsLeft) {
      let options;
      if (isAbsolute) {
        const u = new URL(currentPath);
        options = {
          hostname: u.hostname,
          port: u.port || 443,
          path: u.pathname + u.search,
        };
      } else {
        options = { hostname: API_HOST, path: currentPath };
      }
      const req = https.request(
        {
          ...options,
          method,
          headers: isAbsolute
            ? {} // 리다이렉트된 blob storage URL에는 GitHub 인증 헤더를 보내지 않음
            : {
                'User-Agent': 'testops-advisor',
                Authorization: `Bearer ${TOKEN}`,
                Accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
              },
        },
        (res) => {
          if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
            res.resume();
            return go(res.headers.location, true, redirectsLeft - 1);
          }
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve({ status: res.statusCode, text: data });
            } else {
              reject(new Error(`GitHub API 오류 (${res.statusCode}): ${data || res.statusMessage}`));
            }
          });
        }
      );
      req.on('error', reject);
      req.end();
    }
    go(path, false, maxRedirects);
  });
}

/**
 * workflow_dispatch로 새 실행을 트리거한다.
 * workflowFile을 지정하지 않으면 기본 CI 파이프라인(WORKFLOW_FILE)을 사용한다.
 * inputs은 워크플로우가 정의한 workflow_dispatch.inputs에 대응하는 값들(예: { target_url }).
 */
async function triggerWorkflow(workflowFile = WORKFLOW_FILE, inputs = undefined) {
  if (!isConfigured()) throw new Error('GITHUB_TOKEN / GITHUB_REPO 환경변수가 설정되지 않았습니다.');
  const payload = { ref: BRANCH };
  if (inputs) payload.inputs = inputs;
  await request('POST', `/repos/${REPO}/actions/workflows/${workflowFile}/dispatches`, payload);
}

/** 가장 최근 workflow run 하나를 조회한다. */
async function getLatestRun(workflowFile = WORKFLOW_FILE) {
  if (!isConfigured()) throw new Error('GITHUB_TOKEN / GITHUB_REPO 환경변수가 설정되지 않았습니다.');
  const res = await request(
    'GET',
    `/repos/${REPO}/actions/workflows/${workflowFile}/runs?branch=${BRANCH}&per_page=1`
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

/** 특정 잡(job)의 전체 로그 텍스트를 가져온다. */
async function getJobLogs(jobId) {
  if (!isConfigured()) throw new Error('GITHUB_TOKEN / GITHUB_REPO 환경변수가 설정되지 않았습니다.');
  const res = await requestFollowRedirect('GET', `/repos/${REPO}/actions/jobs/${jobId}/logs`);
  return res.text;
}

module.exports = {
  isConfigured,
  triggerWorkflow,
  getLatestRun,
  getRunJobs,
  getRunSummary,
  getJobLogs,
  REPO,
  WORKFLOW_FILE,
  BRANCH,
};
