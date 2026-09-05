'use strict';
/**
 * 범용 웹사이트 점검 스펙 (Playwright).
 * 대상 URL은 TARGET_URL 환경변수로 주입된다 (관리자 대시보드의 "웹사이트 검사" 폼 -> CI 트리거).
 *
 * 점검 항목:
 *  - 접속성: 페이지가 실제로 로드되는지, HTTP 상태 코드
 *  - 콘솔 에러: 페이지 로드 중 발생한 JS 콘솔 에러 유무
 *  - 깨진 링크: 페이지 내 <a href> 중 접속 실패(4xx/5xx)하는 링크 목록
 *  - 기본 접근성: <title> 존재 여부, <img> alt 속성 누락 개수
 *  - 성능: 페이지 로드 소요 시간(ms)
 */
const { test, expect } = require('@playwright/test');

const TARGET_URL = process.env.TARGET_URL;

test.describe('웹사이트 종합 점검', () => {
  test.skip(!TARGET_URL, 'TARGET_URL 환경변수가 설정되지 않아 건너뜁니다.');

  test('접속성 · 콘솔 에러 · 접근성 · 성능 점검', async ({ page, request }) => {
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    const start = Date.now();
    const response = await page.goto(TARGET_URL, { waitUntil: 'load', timeout: 30000 });
    const loadTimeMs = Date.now() - start;

    // 접속성
    expect(response, '페이지 응답이 없습니다 (접속 실패)').not.toBeNull();
    const status = response.status();
    console.log(`[점검결과] 접속 상태코드: ${status}`);
    console.log(`[점검결과] 페이지 로드 시간: ${loadTimeMs}ms`);

    // 기본 접근성: title
    const title = await page.title();
    console.log(`[점검결과] 페이지 제목: ${title || '(없음)'}`);

    // 기본 접근성: alt 누락 이미지 수
    const imgsMissingAlt = await page.locator('img:not([alt])').count();
    console.log(`[점검결과] alt 속성 누락 이미지 수: ${imgsMissingAlt}`);

    // 콘솔 에러
    console.log(`[점검결과] 콘솔 에러 수: ${consoleErrors.length}`);
    if (consoleErrors.length > 0) {
      console.log(`[점검결과] 콘솔 에러 샘플: ${consoleErrors.slice(0, 5).join(' | ')}`);
    }

    // 깨진 링크 검사 (페이지 내 최대 20개 링크만 샘플 점검, 시간 제한 고려)
    const hrefs = await page.locator('a[href]').evaluateAll((links) =>
      links
        .map((a) => a.href)
        .filter((h) => h.startsWith('http'))
    );
    const uniqueHrefs = [...new Set(hrefs)].slice(0, 20);
    let brokenLinks = 0;
    const brokenList = [];
    for (const href of uniqueHrefs) {
      try {
        const res = await request.head(href, { timeout: 8000, failOnStatusCode: false });
        if (res.status() >= 400) {
          brokenLinks++;
          brokenList.push(`${href} (${res.status()})`);
        }
      } catch (e) {
        brokenLinks++;
        brokenList.push(`${href} (접속 실패)`);
      }
    }
    console.log(`[점검결과] 검사한 링크 수: ${uniqueHrefs.length}`);
    console.log(`[점검결과] 깨진 링크 수: ${brokenLinks}`);
    if (brokenList.length > 0) {
      console.log(`[점검결과] 깨진 링크 목록: ${brokenList.join(' | ')}`);
    }

    // 이 스펙은 "점검 보고서 생성"이 목적이므로, 접속 자체가 실패한 경우만 테스트 실패로 처리한다.
    expect(status, `사이트 접속 실패 (상태코드 ${status})`).toBeLessThan(500);
  });
});
