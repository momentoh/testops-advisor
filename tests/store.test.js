'use strict';
/**
 * store.js의 Postgres(DATABASE_URL) 연동 로직을 검증한다.
 * - 실제 pg 패키지나 네트워크 연결 없이, jest.mock으로 db/pg.js를 대체해
 *   initAsync()/persist()가 pg 모듈과 올바르게 상호작용하는지만 검증한다.
 * - DATABASE_URL 미설정 시 기존 파일 기반 동작이 그대로 유지되는지도 함께 검증한다.
 */
const fs = require('fs');
const path = require('path');

const TEST_DB_PATH = path.join(__dirname, '..', 'data', 'store-unit-db.json');

describe('store.js (DATABASE_URL 미설정 - 기존 파일 기반 동작 유지)', () => {
  beforeEach(() => {
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
    jest.resetModules();
    delete process.env.DATABASE_URL;
    process.env.TESTOPS_DB_PATH = TEST_DB_PATH;
  });

  afterAll(() => {
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  });

  test('initAsync는 DATABASE_URL이 없으면 기존 load()와 동일하게 파일 기반으로 초기화한다', async () => {
    const store = require('../src/db/store');
    const db = await store.initAsync();
    expect(db).toHaveProperty('stages');
    expect(db).toHaveProperty('reqReviews');
    expect(fs.existsSync(TEST_DB_PATH)).toBe(true);
  });

  test('persist()는 DATABASE_URL이 없으면 pg.saveState를 호출하지 않는다', () => {
    jest.doMock('../src/db/pg', () => ({
      isConfigured: jest.fn(() => false),
      loadState: jest.fn(),
      saveState: jest.fn(),
    }));
    const store = require('../src/db/store');
    const pgMock = require('../src/db/pg');

    const db = store.getDB();
    db.reqReviews.push({ id: 'x' });
    store.persist();

    expect(pgMock.saveState).not.toHaveBeenCalled();

    const saved = JSON.parse(fs.readFileSync(TEST_DB_PATH, 'utf-8'));
    expect(saved.reqReviews).toEqual([{ id: 'x' }]);
  });
});

describe('store.js (DATABASE_URL 설정 - Postgres 연동, pg.js는 mock으로 대체)', () => {
  beforeEach(() => {
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
    jest.resetModules();
    jest.clearAllMocks();
    process.env.TESTOPS_DB_PATH = TEST_DB_PATH;
    process.env.DATABASE_URL = 'postgresql://fake:fake@localhost:5432/fake';
  });

  afterAll(() => {
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
    delete process.env.DATABASE_URL;
  });

  test('initAsync는 Postgres에 저장된 데이터가 있으면 그것을 캐시/파일에 복원한다', async () => {
    const remoteData = {
      stages: [{ id: 's1' }],
      tools: [],
      feedback: [],
      admins: [],
      siteAudits: [],
      specTests: [],
      ciTests: [],
      reqReviews: [{ id: 'r1', filename: 'restored.txt' }],
    };
    jest.doMock('../src/db/pg', () => ({
      isConfigured: jest.fn(() => true),
      loadState: jest.fn(async () => remoteData),
      saveState: jest.fn(async () => {}),
    }));

    const store = require('../src/db/store');
    const db = await store.initAsync();

    expect(db.reqReviews).toEqual([{ id: 'r1', filename: 'restored.txt' }]);
    // 파일에도 동기화되어야 한다 (재부팅 사이 캐시 일관성 유지 목적).
    const saved = JSON.parse(fs.readFileSync(TEST_DB_PATH, 'utf-8'));
    expect(saved.reqReviews).toEqual([{ id: 'r1', filename: 'restored.txt' }]);
  });

  test('initAsync는 Postgres에 저장된 데이터가 없으면(null) 파일 기반 load()로 폴백한다', async () => {
    jest.doMock('../src/db/pg', () => ({
      isConfigured: jest.fn(() => true),
      loadState: jest.fn(async () => null),
      saveState: jest.fn(async () => {}),
    }));

    const store = require('../src/db/store');
    const db = await store.initAsync();

    expect(db).toHaveProperty('reqReviews', []);
    expect(fs.existsSync(TEST_DB_PATH)).toBe(true);
  });

  test('initAsync가 불완전한 스키마(구버전 데이터)를 복원해도 누락된 배열 필드를 보정한다', async () => {
    jest.doMock('../src/db/pg', () => ({
      isConfigured: jest.fn(() => true),
      // reqReviews, ciTests 필드가 아예 없는 "구버전" 데이터를 흉내낸다.
      loadState: jest.fn(async () => ({ stages: [{ id: 's1' }], tools: [] })),
      saveState: jest.fn(async () => {}),
    }));

    const store = require('../src/db/store');
    const db = await store.initAsync();

    expect(Array.isArray(db.reqReviews)).toBe(true);
    expect(Array.isArray(db.ciTests)).toBe(true);
    expect(db.stages).toEqual([{ id: 's1' }]);
  });

  test('persist()는 파일 저장 후 pg.saveState를 현재 캐시 데이터로 호출한다', async () => {
    const saveState = jest.fn(async () => {});
    jest.doMock('../src/db/pg', () => ({
      isConfigured: jest.fn(() => true),
      loadState: jest.fn(async () => null),
      saveState,
    }));

    const store = require('../src/db/store');
    await store.initAsync();

    const db = store.getDB();
    db.reqReviews.push({ id: 'new-entry' });
    store.persist();

    // saveState는 비동기(fire-and-forget)로 호출되므로 microtask가 flush될 시간을 준다.
    await new Promise((resolve) => setImmediate(resolve));

    expect(saveState).toHaveBeenCalledTimes(1);
    const savedArg = saveState.mock.calls[0][0];
    expect(savedArg.reqReviews).toEqual([{ id: 'new-entry' }]);

    // 파일에도 동일하게 저장되어 있어야 한다 (Postgres 저장 실패와 무관하게 항상 보장).
    const saved = JSON.parse(fs.readFileSync(TEST_DB_PATH, 'utf-8'));
    expect(saved.reqReviews).toEqual([{ id: 'new-entry' }]);
  });

  test('persist() 중 pg.saveState가 실패해도 예외를 던지지 않는다 (파일 저장은 이미 완료됨)', async () => {
    const saveState = jest.fn(async () => {
      throw new Error('네트워크 오류 시뮬레이션');
    });
    jest.doMock('../src/db/pg', () => ({
      isConfigured: jest.fn(() => true),
      loadState: jest.fn(async () => null),
      saveState,
    }));

    const store = require('../src/db/store');
    await store.initAsync();

    const db = store.getDB();
    db.reqReviews.push({ id: 'still-saved-to-file' });

    expect(() => store.persist()).not.toThrow();

    await new Promise((resolve) => setImmediate(resolve));

    const saved = JSON.parse(fs.readFileSync(TEST_DB_PATH, 'utf-8'));
    expect(saved.reqReviews).toEqual([{ id: 'still-saved-to-file' }]);
  });
});

describe('pg.js (DATABASE_URL 미설정 시 pg 패키지를 로드하지 않는다)', () => {
  beforeEach(() => {
    delete process.env.DATABASE_URL;
    jest.resetModules();
    // 위 describe 블록들에서 jest.doMock('../src/db/pg', ...)으로 등록한 모의 모듈은
    // jest.resetModules()로도 해제되지 않고(캐시된 "인스턴스"만 지워질 뿐, 모의 "매핑"은
    // 그대로 남아 다음 require 시 팩토리가 다시 실행된다) 계속 살아남아 실제 pg.js 대신
    // isConfigured: () => true 인 mock이 반환되는 문제가 있었다. 실제 구현 모듈을
    // 사용하도록 명시적으로 모의 등록을 해제한다.
    jest.dontMock('../src/db/pg');
  });

  test('isConfigured()는 false를 반환하고, loadState/saveState는 즉시 안전하게 반환한다', async () => {
    const pg = require('../src/db/pg');
    expect(pg.isConfigured()).toBe(false);
    await expect(pg.loadState()).resolves.toBeNull();
    await expect(pg.saveState({ any: 'data' })).resolves.toBeUndefined();
  });
});
