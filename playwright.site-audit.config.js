'use strict';
// 임의 URL 사이트 점검 전용 Playwright 설정.
// 기존 playwright.config.js(자체 서버 webServer 기동 + localhost 대상)와 달리,
// 이 설정은 로컬 서버를 띄우지 않고 TARGET_URL 환경변수로 지정된 외부 사이트를 대상으로 한다.
module.exports = {
  testDir: './e2e',
  testMatch: 'site-audit.spec.js',
  timeout: 60000,
  retries: 0,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
  },
};
