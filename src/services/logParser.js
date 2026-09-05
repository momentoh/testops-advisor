'use strict';
/**
 * GitHub Actions 잡 로그(raw text)에서 사람이 읽을 수 있는 요약 정보를 추출한다.
 * 로그 포맷은 도구별로 다르므로, 잡 이름에 포함된 키워드로 어떤 파서를 쓸지 정한다.
 *
 * 반환 형식: { kind, testCases: [{name, status}], metrics: [{label, value}], raw: string }
 *  - kind: 'jest' | 'playwright' | 'k6' | 'http' | 'audit' | 'unknown'
 *  - testCases: 개별 테스트 항목과 pass/fail (Jest/Playwright에서 추출)
 *  - metrics: 수치 지표 (k6/HTTP 검증에서 추출)
 */

// GitHub Actions 로그는 각 줄 앞에 ISO 타임스탬프가 붙어있다. 파싱 전 제거한다.
function stripTimestamps(text) {
  return text
    .split('\n')
    .map((line) => line.replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s*/, ''))
    .join('\n');
}

/** Jest 출력에서 개별 테스트(✓/✗ 또는 PASS/FAIL 목록)를 추출한다. */
function parseJest(text) {
  const testCases = [];
  const lines = text.split('\n');
  for (const line of lines) {
    // Jest verbose 출력 형태: "  ✓ 테스트 이름 (3 ms)" 또는 "  ✕ 테스트 이름"
    const passMatch = line.match(/^\s*(✓|√)\s+(.+?)(\s+\(\d+\s*ms\))?$/);
    const failMatch = line.match(/^\s*(✕|✗|×)\s+(.+?)(\s+\(\d+\s*ms\))?$/);
    if (passMatch) {
      testCases.push({ name: passMatch[2].trim(), status: 'pass' });
    } else if (failMatch) {
      testCases.push({ name: failMatch[2].trim(), status: 'fail' });
    }
  }
  const summaryMatch = text.match(/Tests:\s+(.+)/);
  const metrics = [];
  if (summaryMatch) metrics.push({ label: '요약', value: summaryMatch[1].trim() });
  return { kind: 'jest', testCases, metrics };
}

/** Playwright 출력에서 개별 테스트(✓/✘ 목록)를 추출한다. */
function parsePlaywright(text) {
  const testCases = [];
  const lines = text.split('\n');
  for (const line of lines) {
    // Playwright list reporter 형태: "  ✓  1 [chromium] › file.spec.js:10:3 › 설명 (120ms)"
    const passMatch = line.match(/^\s*(✓|√)\s+\d+\s+(.+?)(\s+\(\d+(\.\d+)?m?s\))?$/);
    const failMatch = line.match(/^\s*(✘|✗|×)\s+\d+\s+(.+?)(\s+\(\d+(\.\d+)?m?s\))?$/);
    if (passMatch) {
      testCases.push({ name: passMatch[2].trim(), status: 'pass' });
    } else if (failMatch) {
      testCases.push({ name: failMatch[2].trim(), status: 'fail' });
    }
  }

  // site-audit.spec.js가 console.log로 남기는 "[점검결과] ..." 라인을 지표로 추출
  const metrics = [];
  for (const line of lines) {
    const m = line.match(/\[점검결과\]\s*(.+)/);
    if (m) {
      const [label, ...rest] = m[1].split(':');
      metrics.push({ label: label.trim(), value: rest.join(':').trim() || label.trim() });
    }
  }

  const summaryMatch = text.match(/(\d+ passed.*)/i) || text.match(/(\d+ failed.*)/i);
  if (summaryMatch) metrics.unshift({ label: '요약', value: summaryMatch[1].trim() });

  return { kind: 'playwright', testCases, metrics };
}

/** k6 출력에서 threshold 결과와 핵심 지표를 추출한다. */
function parseK6(text) {
  const metrics = [];
  const lines = text.split('\n');
  for (const line of lines) {
    // k6 요약 지표 라인 형태: "     http_req_duration..............: avg=12.3ms p(95)=45ms"
    const m = line.match(/^\s*(✓|✗)?\s*([a-z_{}=.]+?)\.*:\s+(.+)$/i);
    if (m && /http_req|checks|vus|iterations|data_/.test(m[2])) {
      metrics.push({ label: m[2].trim(), value: m[3].trim(), status: m[1] === '✗' ? 'fail' : 'pass' });
    }
  }
  // check() 결과 (테스트케이스처럼 표시)
  const testCases = [];
  for (const line of lines) {
    const checkMatch = line.match(/^\s*(✓|✗)\s+(.+)$/);
    if (checkMatch && !/http_req|checks|vus|iterations|data_/.test(checkMatch[2])) {
      testCases.push({ name: checkMatch[2].trim(), status: checkMatch[1] === '✓' ? 'pass' : 'fail' });
    }
  }
  return { kind: 'k6', testCases, metrics };
}

/** HTTP 검증 스크립트(scripts/http-check.js)의 출력을 지표로 변환한다. */
function parseHttpCheck(text) {
  const metrics = [];
  const lines = text.split('\n');
  for (const line of lines) {
    const m = line.match(/^-\s*(.+?):\s*(.+)$/);
    if (m) metrics.push({ label: m[1].trim(), value: m[2].trim() });
  }
  return { kind: 'http', testCases: [], metrics };
}

/** npm audit 출력에서 취약점 요약을 추출한다. */
function parseAudit(text) {
  const metrics = [];
  if (/found 0 vulnerabilities/i.test(text)) {
    metrics.push({ label: '취약점 요약', value: '발견된 취약점 없음' });
  } else {
    const summaryMatch = text.match(/(\d+ vulnerabilities.*)/i);
    if (summaryMatch) metrics.push({ label: '취약점 요약', value: summaryMatch[1].trim() });
  }
  return { kind: 'audit', testCases: [], metrics };
}

/** 잡 이름과 로그 내용을 보고 적절한 파서를 선택해 실행한다. */
function parseJobLog(jobName, rawText) {
  const text = stripTimestamps(rawText || '');
  const name = (jobName || '').toLowerCase();

  let result;
  if (name.includes('jest') || name.includes('단위')) {
    result = parseJest(text);
  } else if (name.includes('playwright') || name.includes('e2e') || name.includes('기능')) {
    result = parsePlaywright(text);
  } else if (name.includes('k6') || name.includes('성능')) {
    result = parseK6(text);
  } else if (name.includes('audit') || name.includes('보안')) {
    result = parseAudit(text);
  } else if (name.includes('http') || name.includes('api')) {
    result = parseHttpCheck(text);
  } else {
    result = { kind: 'unknown', testCases: [], metrics: [] };
  }

  // 마지막 200줄만 원본으로 보존 (너무 길면 응답이 무거워짐)
  const rawLines = text.split('\n').filter((l) => l.trim() !== '');
  result.raw = rawLines.slice(-200).join('\n');
  return result;
}

module.exports = { parseJobLog };
