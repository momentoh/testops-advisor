'use strict';
/**
 * "요구사양서 리뷰" 기능의 순수 로직(네트워크/파일 I/O 없는 부분)을 검증한다.
 * - reqReviewStore.js의 승인 대기/승인/반려/완료 상태 전이 및 남용 방지 로직
 * Claude API 호출(reqReviewGen.reviewRequirements)과 실제 문서 파싱(docParser)은
 * 외부 API·바이너리 파일 의존성이 있어 이 단위 테스트 범위에서는 제외한다.
 * (구조는 명세기반 테스트케이스 생성 기능의 tests/specTest.test.js와 동일한 패턴)
 */
const fs = require('fs');
const path = require('path');

const TEST_DB_PATH = path.join(__dirname, '..', 'data', 'req-review-unit-db.json');
process.env.TESTOPS_DB_PATH = TEST_DB_PATH;

describe('reqReviewStore (요구사양서 리뷰 이력 관리)', () => {
  beforeEach(() => {
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
    // store.js는 모듈 캐시에 DB를 들고 있으므로 매 테스트마다 새로 불러온다.
    jest.resetModules();
  });

  afterAll(() => {
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  });

  test('업로드 시 승인 대기 상태로 생성되고, 승인 후 처리 중 -> 완료로 전이된다', () => {
    const store = require('../src/services/reqReviewStore');
    const entry = store.createPendingApproval({ filename: 'srs.docx', format: 'word', previewText: '1. 시스템은...' });
    expect(entry.status).toBe('pending_approval');
    expect(entry.previewText).toBe('1. 시스템은...');

    store.setFullText(entry.id, '전체 원문');
    expect(store.getById(entry.id).fullText).toBe('전체 원문');
    // 공개용 조회에는 원문 텍스트가 노출되지 않는다.
    expect(store.getByIdPublic(entry.id).fullText).toBeUndefined();

    store.markApprovedProcessing(entry.id);
    expect(store.getById(entry.id).status).toBe('processing');

    store.markDone(entry.id, {
      summary: '로그인 기능 위주의 요구사항 문서',
      overallScore: '중',
      standardScores: [{ standard: 'ISO/IEC/IEEE 29148', score: '중', comment: '검증가능성이 부족함' }],
      findings: [
        {
          id: 'F-001',
          standard: 'IEEE 830',
          category: '모호한 표현',
          severity: '높음',
          location: '2절',
          issue: '"빨라야 한다"는 정량적 기준이 없음',
          recommendation: '응답시간 3초 이내와 같은 수치를 명시할 것',
        },
      ],
      missingQualityCharacteristics: ['보안성'],
      strengths: ['목차 구성이 명확함'],
    });

    const updated = store.getById(entry.id);
    expect(updated.status).toBe('done');
    expect(updated.overallScore).toBe('중');
    expect(updated.standardScores).toHaveLength(1);
    expect(updated.findings).toHaveLength(1);
    expect(updated.missingQualityCharacteristics).toEqual(['보안성']);
    // 리뷰 완료 후에는 원문 텍스트를 더 이상 보관하지 않는다.
    expect(updated.fullText).toBeNull();
  });

  test('관리자가 반려하면 원문 없이 반려 상태로 남고 Claude API를 호출하지 않는다', () => {
    const store = require('../src/services/reqReviewStore');
    const entry = store.createPendingApproval({ filename: 'skip.txt', format: 'text', previewText: '미리보기' });
    store.setFullText(entry.id, '전체 원문');

    store.markRejected(entry.id, '관리자가 반려했습니다.');

    const updated = store.getById(entry.id);
    expect(updated.status).toBe('rejected');
    expect(updated.error).toBe('관리자가 반려했습니다.');
    expect(updated.fullText).toBeNull();
  });

  test('요청을 error 상태로 갱신할 수 있다', () => {
    const store = require('../src/services/reqReviewStore');
    const entry = store.createPendingApproval({ filename: 'broken.pdf', format: 'pdf' });
    store.markError(entry.id, 'Claude API 오류 (500): 서버 내부 오류');

    const updated = store.getById(entry.id);
    expect(updated.status).toBe('error');
    expect(updated.error).toContain('500');
  });

  test('최소 재요청 간격 이내에는 checkRateLimit이 예외를 던진다', () => {
    const store = require('../src/services/reqReviewStore');
    store.createPendingApproval({ filename: 'a.txt', format: 'text' });
    expect(() => store.checkRateLimit()).toThrow(/너무 잦은 요청/);
  });
});
