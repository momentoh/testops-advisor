'use strict';
// Playwright 설정: CI에서 서버를 자동 기동한 뒤 로컬호스트를 대상으로 E2E 테스트 실행
module.exports = {
  testDir: './e2e',
  timeout: 30000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node src/server.js',
    url: 'http://127.0.0.1:3000/healthz',
    reuseExistingServer: !process.env.CI,
    timeout: 15000,
    env: {
      PORT: '3000',
      TESTOPS_DB_PATH: './data/e2e-test-db.json',
      ADMIN_PASSWORD: 'e2e-test-password',
      SESSION_SECRET: 'e2e-test-secret',
    },
  },
};
