'use strict';
/**
 * 입력받은 URL 자체의 HTTP 응답(상태코드/응답시간/헤더)을 검증하는 스크립트.
 * CI(site-audit.yml)에서 실행되며, 결과를 콘솔에 사람이 읽을 수 있는 형태로 출력한다.
 * 사용: node scripts/http-check.js <URL>
 */
const https = require('https');
const http = require('http');
const { URL } = require('url');

const target = process.argv[2] || process.env.TARGET_URL;

if (!target) {
  console.error('검사할 URL이 지정되지 않았습니다.');
  process.exit(1);
}

const url = new URL(target);
const client = url.protocol === 'https:' ? https : http;

const start = Date.now();
const req = client.request(
  {
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname + url.search,
    method: 'GET',
    timeout: 15000,
    headers: { 'User-Agent': 'testops-advisor-site-audit' },
  },
  (res) => {
    const elapsed = Date.now() - start;
    let bodyLength = 0;
    res.on('data', (chunk) => (bodyLength += chunk.length));
    res.on('end', () => {
      console.log('[HTTP 검증 결과]');
      console.log(`- URL: ${target}`);
      console.log(`- 상태 코드: ${res.statusCode}`);
      console.log(`- 응답 시간: ${elapsed}ms`);
      console.log(`- Content-Type: ${res.headers['content-type'] || '(없음)'}`);
      console.log(`- 응답 본문 크기: ${bodyLength} bytes`);
      console.log(`- 보안 헤더 (X-Content-Type-Options): ${res.headers['x-content-type-options'] || '(없음)'}`);
      console.log(`- 보안 헤더 (Strict-Transport-Security): ${res.headers['strict-transport-security'] || '(없음)'}`);

      if (res.statusCode >= 500) {
        console.error('서버 오류 응답입니다.');
        process.exit(1);
      }
      process.exit(0);
    });
  }
);

req.on('timeout', () => {
  console.error('요청이 15초 내에 응답하지 않았습니다 (타임아웃).');
  req.destroy();
  process.exit(1);
});

req.on('error', (err) => {
  console.error(`요청 중 오류 발생: ${err.message}`);
  process.exit(1);
});

req.end();
