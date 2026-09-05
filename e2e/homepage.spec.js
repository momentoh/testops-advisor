'use strict';
/**
 * Playwright E2E 테스트
 * 대상: 통합/E2E 테스트 단계 1순위 도구인 Playwright 를 이용한 실제 브라우저 검증.
 * CI에서 서버를 기동한 뒤 http://localhost:3000 을 대상으로 실행한다 (playwright.config.js 참고).
 */
const { test, expect } = require('@playwright/test');

test.describe('홈페이지', () => {
  test('7단계 목록이 모두 노출된다', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('body')).toContainText('요구사항 분석');
    await expect(page.locator('body')).toContainText('테스트 계획');
    await expect(page.locator('body')).toContainText('배포');
  });
});

test.describe('단계별 추천 페이지', () => {
  test('단위 테스트 단계 진입 시 추천 도구 목록이 보인다', async ({ page }) => {
    await page.goto('/stages/unit-testing');
    await expect(page.locator('body')).toContainText('Jest');
  });

  test('존재하지 않는 단계는 404를 반환한다', async ({ page }) => {
    const response = await page.goto('/stages/no-such-stage');
    expect(response.status()).toBe(404);
  });
});

test.describe('피드백 API', () => {
  test('헬스체크 엔드포인트가 정상 응답한다', async ({ request }) => {
    const res = await request.get('/healthz');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});

test.describe('관리자 인증', () => {
  test('로그인 없이 /admin 접근 시 로그인 페이지로 리다이렉트된다', async ({ page }) => {
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/admin\/login/);
  });
});
