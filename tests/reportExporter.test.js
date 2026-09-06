'use strict';
/**
 * reportExporter.js의 리포트 변환/HTML/DOCX 생성 로직을 검증한다.
 * - XLSX 생성(toXlsxBuffer)은 xlsx(SheetJS) 패키지가 필요한데, 이 저장소의 CI 단위테스트
 *   단계(.github/workflows/ci.yml)는 jest만 설치하고 앱의 dependencies(xlsx 등)는 설치하지 않으므로
 *   여기서는 xlsx 모듈이 실제로 존재할 때만(있을 경우) 검증하고, 없으면 건너뛴다.
 *   (문서 파싱을 다루는 docParser/specTestGen/reqReviewGen 관련 테스트도 동일한 이유로
 *   외부 API·바이너리 파일 의존성이 있는 부분은 단위테스트 범위에서 제외해왔다.)
 * - DOCX 생성(toDocxBuffer)은 Node 내장 zlib만 사용하므로 항상 검증한다.
 */
const zlib = require('zlib');
const exporter = require('../src/services/reportExporter');

function sampleReqReviewEntry() {
  return {
    id: 'abcd1234-ef56-7890-abcd-1234567890ab',
    filename: 'srs.txt',
    requestedAt: '2026-01-01T00:00:00.000Z',
    approvedAt: '2026-01-01T00:05:00.000Z',
    completedAt: '2026-01-01T00:06:00.000Z',
    overallScore: '중',
    summary: '로그인 기능 위주의 요구사항 문서입니다.\n두 번째 줄입니다.',
    standardScores: [
      { standard: 'IEEE 830', score: '중', comment: '검증가능성이 부족함' },
    ],
    missingQualityCharacteristics: ['보안성'],
    strengths: ['목차 구성이 명확함'],
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
  };
}

function sampleSpecTestEntry() {
  return {
    id: 'wxyz9876-ab12-3456-wxyz-987654321000',
    filename: 'spec.docx',
    requestedAt: '2026-01-01T00:00:00.000Z',
    approvedAt: '2026-01-01T00:05:00.000Z',
    completedAt: '2026-01-01T00:06:00.000Z',
    summary: '로그인/조회 기능을 다루는 명세입니다.',
    testCases: [
      {
        id: 'TC-001',
        title: '정상 로그인',
        requirement: '아이디/비밀번호로 로그인',
        iso25010: '기능적합성 - 정확성',
        designTechnique: '동등분할',
        preconditions: '가입된 계정 존재',
        steps: ['로그인 페이지 접속', '아이디/비밀번호 입력', '로그인 버튼 클릭'],
        testData: 'id=test, pw=Test1234!',
        expectedResult: '로그인 성공 후 메인 페이지로 이동',
        priority: '높음',
      },
    ],
  };
}

describe('reportExporter (리뷰/테스트케이스 결과 -> 리포트 모델 변환)', () => {
  test('buildReqReviewReport는 표준 점수/발견사항/강점 등을 섹션으로 구성한다', () => {
    const report = exporter.buildReqReviewReport(sampleReqReviewEntry());
    expect(report.title).toContain('srs.txt');
    const headings = report.sections.map((s) => s.heading);
    expect(headings).toEqual(
      expect.arrayContaining(['총평', '표준별 평가', '누락된 품질특성', '강점', '발견사항 (Findings)'])
    );
    const findingsSection = report.sections.find((s) => s.heading === '발견사항 (Findings)');
    expect(findingsSection.kind).toBe('table');
    expect(findingsSection.rows).toHaveLength(1);
    expect(findingsSection.rows[0][0]).toBe('F-001');
  });

  test('buildSpecTestReport는 테스트케이스를 표 섹션으로 구성한다', () => {
    const report = exporter.buildSpecTestReport(sampleSpecTestEntry());
    expect(report.title).toContain('spec.docx');
    const tcSection = report.sections.find((s) => s.heading === '테스트케이스 목록');
    expect(tcSection.kind).toBe('table');
    expect(tcSection.rows[0][0]).toBe('TC-001');
    // steps 배열은 줄바꿈으로 합쳐져야 한다.
    expect(tcSection.rows[0][6]).toBe('로그인 페이지 접속\n아이디/비밀번호 입력\n로그인 버튼 클릭');
  });
});

describe('reportExporter (HTML 출력)', () => {
  test('toHtml은 제목/메타/섹션을 포함한 완전한 HTML 문서를 생성한다', () => {
    const report = exporter.buildReqReviewReport(sampleReqReviewEntry());
    const html = exporter.toHtml(report);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain(report.title);
    expect(html).toContain('발견사항 (Findings)');
    expect(html).toContain('F-001');
  });

  test('HTML 특수문자는 이스케이프되어 마크업이 깨지지 않는다', () => {
    const entry = sampleReqReviewEntry();
    entry.summary = '<script>alert(1)</script> & "quote" \'single\'';
    const report = exporter.buildReqReviewReport(entry);
    const html = exporter.toHtml(report);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('toPrintableHtml은 인쇄용 스타일(@media print)을 포함한다', () => {
    const report = exporter.buildSpecTestReport(sampleSpecTestEntry());
    const html = exporter.toPrintableHtml(report);
    expect(html).toContain('@media print');
    expect(html).toContain(report.title);
  });
});

describe('reportExporter (DOCX 출력 - Node 내장 zlib만 사용)', () => {
  test('toDocxBuffer는 유효한 ZIP(OOXML) 컨테이너를 생성한다', () => {
    const report = exporter.buildReqReviewReport(sampleReqReviewEntry());
    const buf = exporter.toDocxBuffer(report);

    // ZIP local file header 시그니처(PK\x03\x04)로 시작해야 한다.
    expect(buf.slice(0, 4).toString('hex')).toBe('504b0304');
    // End Of Central Directory 레코드 시그니처(PK\x05\x06)가 포함되어야 한다.
    expect(buf.includes(Buffer.from('504b0506', 'hex'))).toBe(true);
  });

  test('DOCX 내부 word/document.xml에 리뷰 내용이 포함되고, deflate로 정상 압축 해제된다', () => {
    const report = exporter.buildReqReviewReport(sampleReqReviewEntry());
    const buf = exporter.toDocxBuffer(report);

    // 아주 단순한 ZIP 파서: local file header들을 순서대로 읽어 각 엔트리를 압축 해제한다.
    let offset = 0;
    const entries = {};
    while (offset < buf.length) {
      const sig = buf.readUInt32LE(offset);
      if (sig === 0x04034b50) {
        const compSize = buf.readUInt32LE(offset + 18);
        const nameLen = buf.readUInt16LE(offset + 26);
        const extraLen = buf.readUInt16LE(offset + 28);
        const nameStart = offset + 30;
        const name = buf.slice(nameStart, nameStart + nameLen).toString('utf-8');
        const dataStart = nameStart + nameLen + extraLen;
        const compressed = buf.slice(dataStart, dataStart + compSize);
        entries[name] = zlib.inflateRawSync(compressed).toString('utf-8');
        offset = dataStart + compSize;
      } else {
        break; // central directory 시작 등: local header 순회 종료
      }
    }

    expect(Object.keys(entries)).toEqual(
      expect.arrayContaining(['[Content_Types].xml', 'word/document.xml', 'word/styles.xml'])
    );
    expect(entries['word/document.xml']).toContain('요구사양서 리뷰 결과');
    expect(entries['word/document.xml']).toContain('F-001');
    expect(entries['word/document.xml']).toContain('IEEE 830');
  });

  test('테이블이 없는 리포트(총평만 있는 경우)도 오류 없이 DOCX를 생성한다', () => {
    const report = { title: '빈 리포트', meta: [{ label: 'x', value: 'y' }], sections: [] };
    const buf = exporter.toDocxBuffer(report);
    expect(buf.slice(0, 4).toString('hex')).toBe('504b0304');
  });
});

describe('reportExporter (XLSX 출력 - xlsx 패키지 필요, 미설치 환경에서는 skip)', () => {
  let xlsxAvailable = true;
  let XLSX;
  try {
    XLSX = require('xlsx');
  } catch (e) {
    xlsxAvailable = false;
  }

  const maybeTest = xlsxAvailable ? test : test.skip;

  maybeTest('toXlsxBuffer는 개요/요약/발견사항 시트를 포함한 워크북 버퍼를 생성한다', () => {
    const report = exporter.buildReqReviewReport(sampleReqReviewEntry());
    const buf = exporter.toXlsxBuffer(report);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);

    const wb = XLSX.read(buf, { type: 'buffer' });
    expect(wb.SheetNames).toEqual(expect.arrayContaining(['개요']));
    // 표 섹션(표준별 평가, 발견사항)은 별도 시트로 분리되어야 한다.
    const hasTableSheet = wb.SheetNames.some((n) => n.includes('발견사항') || n.includes('표준별'));
    expect(hasTableSheet).toBe(true);
  });
});
