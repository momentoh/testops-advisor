'use strict';
/**
 * "CI/CD 자동 테스트 실행 요청" 기능의 순수 로직(네트워크 I/O 없는 부분)을 검증한다.
 * - ciTestStore.js의 승인 대기/승인/반려/완료 상태 전이 및 남용 방지 로직
 * 실제 GitHub Actions 트리거/조회(ci.js)는 외부 API 의존성이 있어 이 단위 테스트 범위에서는 제외한다.
 */
const fs = require('fs');
const path = require('path');

const TEST_DB_PATH = path.join(__dirname, '..', 'data', 'ci-test-unit-db.json');
process.env.TESTOPS_DB_PATH = TEST_DB_PATH;

describe('ciTestStore (실행 요청 승인/반려 관리)', () => {
  beforeEach(() => {
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
    // store.js는 모듈 캐시에 DB를 들고 있으므로 매 테스트마다 새로 불러온다.
    jest.resetModules();
  });

  afterAll(() => {
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  });

  test('요청 생성 시 승인 대기 상태이며, 승인 후 실행 중 -> 완료(success)로 전이된다', () => {
    const store = require('../src/services/ciTestStore');
    const entry = store.createPendingApproval({ targetUrl: 'https://example.com', requirements: '로그인 폼 검사' });
    expect(entry.status).toBe('pending_approval');
    expect(entry.targetUrl).toBe('https://example.com');
    expect(entry.requirements).toBe('로그인 폼 검사');

    store.markApprovedRunning(entry.id, { runId: 111, runHtmlUrl: 'https://github.com/x/actions/runs/111' });
    const running = store.getById(entry.id);
    expect(running.status).toBe('running');
    expect(running.runId).toBe(111);
    expect(running.approvedAt).not.toBeNull();

    store.markDone(entry.id, 'success');
    const done = store.getById(entry.id);
    expect(done.status).toBe('done');
    expect(done.completedAt).not.toBeNull();
  });

  test('승인 후 GitHub Actions 결론이 실패(failure)이면 error 상태로 남는다', () => {
    const store = require('../src/services/ciTestStore');
    const entry = store.createPendingApproval({ targetUrl: '', requirements: '보안 점검' });
    store.markApprovedRunning(entry.id, { runId: 222, runHtmlUrl: null });
    store.markDone(entry.id, 'failure');

    const updated = store.getById(entry.id);
    expect(updated.status).toBe('error');
  });

  test('관리자가 반려하면 GitHub Actions 실행 없이 반려 상태로 남는다', () => {
    const store = require('../src/services/ciTestStore');
    const entry = store.createPendingApproval({ targetUrl: 'https://example.com', requirements: '반려 테스트' });
    store.markRejected(entry.id, '관리자가 반려했습니다.');

    const updated = store.getById(entry.id);
    expect(updated.status).toBe('rejected');
    expect(updated.error).toBe('관리자가 반려했습니다.');
    expect(updated.runId).toBeNull();
  });

  test('markError를 호출하면 error 상태와 메시지가 기록된다', () => {
    const store = require('../src/services/ciTestStore');
    const entry = store.createPendingApproval({ targetUrl: '', requirements: '오류 테스트' });
    store.markApprovedRunning(entry.id, { runId: 333, runHtmlUrl: null });
    store.markError(entry.id, 'GitHub API 오류 (500): 서버 내부 오류');

    const updated = store.getById(entry.id);
    expect(updated.status).toBe('error');
    expect(updated.error).toContain('500');
  });

  test('최소 재요청 간격 이내에는 checkRateLimit이 예외를 던진다', () => {
    const store = require('../src/services/ciTestStore');
    store.createPendingApproval({ targetUrl: '', requirements: 'a' });
    expect(() => store.checkRateLimit()).toThrow(/너무 잦은 요청/);
  });
});
