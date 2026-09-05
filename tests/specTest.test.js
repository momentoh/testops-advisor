'use strict';
/**
 * 명세기반 블랙박스 테스트케이스 생성 기능의 순수 로직(네트워크/파일 I/O 없는 부분)을 검증한다.
 * - router.js의 multipart/form-data 파서
 * - specTestStore.js의 이력 관리/남용 방지 로직
 * Claude API 호출(specTestGen.generateTestCases)과 실제 문서 파싱(docParser)은
 * 외부 API·바이너리 파일 의존성이 있어 이 단위 테스트 범위에서는 제외한다.
 */
const fs = require('fs');
const path = require('path');

const TEST_DB_PATH = path.join(__dirname, '..', 'data', 'spec-test-unit-db.json');
process.env.TESTOPS_DB_PATH = TEST_DB_PATH;

describe('multipart/form-data 파서', () => {
  // router.js는 parseMultipart를 export하지 않으므로, 라우터 handle()을 통해 간접적으로 검증한다.
  const { Router, extendResponse } = require('../src/lib/router');
  const http = require('http');

  function buildMultipartBody(boundary, fields, file) {
    const parts = [];
    for (const [name, value] of Object.entries(fields)) {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
    }
    if (file) {
      parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\nContent-Type: ${file.mimeType}\r\n\r\n`
      ));
      parts.push(Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data));
      parts.push(Buffer.from('\r\n'));
    }
    parts.push(Buffer.from(`--${boundary}--\r\n`));
    return Buffer.concat(parts);
  }

  test('텍스트 필드와 파일 파트를 올바르게 분리해 파싱한다', (done) => {
    const router = new Router();
    router.post('/upload-test', (req, res) => {
      res.end(JSON.stringify({
        fields: req.body,
        file: req.files.document ? {
          filename: req.files.document.filename,
          mimeType: req.files.document.mimeType,
          text: req.files.document.data.toString('utf-8'),
        } : null,
      }));
    });

    const server = http.createServer(async (req, res) => {
      extendResponse(res, () => {});
      await router.handle(req, res);
    });

    server.listen(0, () => {
      const port = server.address().port;
      const boundary = '----jestTestBoundary123';
      const body = buildMultipartBody(
        boundary,
        { note: 'hello world' },
        { field: 'document', filename: 'spec.txt', mimeType: 'text/plain', data: '요구사항: 로그인 기능이 있어야 한다.' }
      );

      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/upload-test',
          method: 'POST',
          headers: {
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': body.length,
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            const parsed = JSON.parse(data);
            expect(parsed.fields.note).toBe('hello world');
            expect(parsed.file.filename).toBe('spec.txt');
            expect(parsed.file.mimeType).toBe('text/plain');
            expect(parsed.file.text).toBe('요구사항: 로그인 기능이 있어야 한다.');
            server.close(() => done());
          });
        }
      );
      req.end(body);
    });
  });
});

describe('specTestStore (이력 관리 및 남용 방지)', () => {
  const specTestStore = require('../src/services/specTestStore');

  beforeEach(() => {
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
    // store.js는 모듈 캐시에 DB를 들고 있으므로 매 테스트마다 새로 불러온다.
    jest.resetModules();
  });

  afterAll(() => {
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  });

  test('요청을 processing 상태로 생성하고 done으로 갱신할 수 있다', () => {
    const store = require('../src/services/specTestStore');
    const entry = store.createPending({ filename: 'req.docx', format: 'word' });
    expect(entry.status).toBe('processing');

    store.markDone(entry.id, {
      summary: '로그인 기능 요구사항 문서',
      testCases: [{ id: 'TC-001', title: '유효한 아이디/비밀번호 로그인' }],
    });

    const updated = store.getById(entry.id);
    expect(updated.status).toBe('done');
    expect(updated.testCases).toHaveLength(1);
    expect(updated.summary).toBe('로그인 기능 요구사항 문서');
  });

  test('요청을 error 상태로 갱신할 수 있다', () => {
    const store = require('../src/services/specTestStore');
    const entry = store.createPending({ filename: 'broken.pdf', format: 'pdf' });
    store.markError(entry.id, 'Claude API 오류 (500): 서버 내부 오류');

    const updated = store.getById(entry.id);
    expect(updated.status).toBe('error');
    expect(updated.error).toContain('500');
  });

  test('최소 재요청 간격 이내에는 checkRateLimit이 예외를 던진다', () => {
    const store = require('../src/services/specTestStore');
    store.createPending({ filename: 'a.txt', format: 'text' });
    expect(() => store.checkRateLimit()).toThrow(/너무 잦은 요청/);
  });
});
