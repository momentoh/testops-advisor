'use strict';
/**
 * Jest 단위 테스트: src/services/recommend.js
 * 대상: 요구사항 분석 단계 1순위 도구인 Jest 를 이용한 단위테스트 자동화 예시.
 *
 * 검증 대상:
 *  - confidenceScore(): Wilson score 하한 계산
 *  - computeScore(): confidence * weight
 *  - recordFeedback(): up/down 시 weight 가 올바른 방향과 범위로 갱신되는지
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

// 테스트 전용 임시 DB 파일을 사용해 실제 운영 데이터(data/db.json)를 건드리지 않는다.
let tmpDir;
let recommend;
let store;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testops-advisor-test-'));
  process.env.TESTOPS_DB_PATH = path.join(tmpDir, 'db.json');

  jest.resetModules();
  store = require('../src/db/store');
  recommend = require('../src/services/recommend');

  const db = store.getDB();
  db.stages = [{ id: 'unit-testing', order: 4, name: '단위 테스트' }];
  db.tools = [
    { id: 'tool-1', stageId: 'unit-testing', name: 'Jest', weight: 1.0, upvotes: 0, downvotes: 0 },
  ];
  db.feedback = [];
  store.persist();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.TESTOPS_DB_PATH;
});

describe('confidenceScore', () => {
  test('피드백이 없으면 중립값 0.5를 반환한다', () => {
    expect(recommend.confidenceScore(0, 0)).toBe(0.5);
  });

  test('업보트만 있으면 다운보트만 있을 때보다 높은 점수를 반환한다', () => {
    const goodScore = recommend.confidenceScore(10, 0);
    const badScore = recommend.confidenceScore(0, 10);
    expect(goodScore).toBeGreaterThan(badScore);
  });

  test('피드백 수가 적으면 100% 업보트여도 신뢰구간 하한 때문에 1.0보다 작다', () => {
    const score = recommend.confidenceScore(1, 0);
    expect(score).toBeLessThan(1.0);
    expect(score).toBeGreaterThan(0);
  });

  test('피드백 수가 많을수록 100% 업보트의 신뢰도가 1.0에 가까워진다', () => {
    const small = recommend.confidenceScore(5, 0);
    const large = recommend.confidenceScore(500, 0);
    expect(large).toBeGreaterThan(small);
  });
});

describe('computeScore', () => {
  test('confidence와 weight를 곱한 값을 반환한다', () => {
    const tool = { upvotes: 10, downvotes: 0, weight: 2.0 };
    const expected = recommend.confidenceScore(10, 0) * 2.0;
    expect(recommend.computeScore(tool)).toBeCloseTo(expected, 10);
  });

  test('weight가 없으면 기본값 1.0으로 계산한다', () => {
    const tool = { upvotes: 0, downvotes: 0 };
    expect(recommend.computeScore(tool)).toBeCloseTo(0.5, 10);
  });
});

describe('recordFeedback', () => {
  test('업보트 시 upvotes가 증가하고 weight가 상승한다', () => {
    const before = recommend.getToolById('tool-1').weight;
    const { tool } = recommend.recordFeedback({ toolId: 'tool-1', stageId: 'unit-testing', vote: 'up' });
    expect(tool.upvotes).toBe(1);
    expect(tool.weight).toBeGreaterThan(before);
  });

  test('다운보트 시 downvotes가 증가하고 weight가 하락한다', () => {
    const before = recommend.getToolById('tool-1').weight;
    const { tool } = recommend.recordFeedback({ toolId: 'tool-1', stageId: 'unit-testing', vote: 'down' });
    expect(tool.downvotes).toBe(1);
    expect(tool.weight).toBeLessThan(before);
  });

  test('weight는 MAX_WEIGHT(3.0)를 초과하지 않는다', () => {
    let tool;
    for (let i = 0; i < 200; i++) {
      ({ tool } = recommend.recordFeedback({ toolId: 'tool-1', stageId: 'unit-testing', vote: 'up' }));
    }
    expect(tool.weight).toBeLessThanOrEqual(3.0);
  });

  test('weight는 MIN_WEIGHT(0.05) 미만으로 내려가지 않는다', () => {
    let tool;
    for (let i = 0; i < 200; i++) {
      ({ tool } = recommend.recordFeedback({ toolId: 'tool-1', stageId: 'unit-testing', vote: 'down' }));
    }
    expect(tool.weight).toBeGreaterThanOrEqual(0.05);
  });

  test('존재하지 않는 toolId는 에러를 던진다', () => {
    expect(() => recommend.recordFeedback({ toolId: 'no-such-id', vote: 'up' })).toThrow();
  });

  test('vote 값이 up/down이 아니면 에러를 던진다', () => {
    expect(() => recommend.recordFeedback({ toolId: 'tool-1', vote: 'invalid' })).toThrow();
  });
});

describe('recommendForStage', () => {
  test('점수 내림차순으로 정렬해서 반환한다', () => {
    const db = store.getDB();
    db.tools.push({ id: 'tool-2', stageId: 'unit-testing', name: 'pytest', weight: 0.5, upvotes: 0, downvotes: 0 });
    store.persist();

    // Wilson score는 피드백 건수가 적으면 신뢰도를 보수적으로 낮게 잡으므로,
    // 업보트 1건만으로는 순위를 뒤집기에 충분하지 않다. 충분한 피드백을 쌓아
    // tool-1이 명확히 더 높은 신뢰도를 갖도록 만든 뒤 정렬을 검증한다.
    for (let i = 0; i < 20; i++) {
      recommend.recordFeedback({ toolId: 'tool-1', stageId: 'unit-testing', vote: 'up' });
    }

    const results = recommend.recommendForStage('unit-testing');
    expect(results[0].id).toBe('tool-1');
    expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
  });

  test('피드백이 거의 없는 도구는 다수의 업보트를 받은 도구보다 낮은 순위를 갖는다', () => {
    const db = store.getDB();
    db.tools.push({ id: 'tool-2', stageId: 'unit-testing', name: 'pytest', weight: 1.0, upvotes: 0, downvotes: 0 });
    store.persist();

    for (let i = 0; i < 10; i++) {
      recommend.recordFeedback({ toolId: 'tool-1', stageId: 'unit-testing', vote: 'up' });
    }

    const results = recommend.recommendForStage('unit-testing');
    const tool1 = results.find(r => r.id === 'tool-1');
    const tool2 = results.find(r => r.id === 'tool-2');
    expect(tool1.confidence).toBeGreaterThan(tool2.confidence);
  });
});
