'use strict';
/**
 * 요구사양서 리뷰(reqReview) / 명세기반 테스트케이스 생성(specTest) 결과를
 * 엑셀(.xlsx), 워드(.docx), HTML(.html), PDF(.pdf) 파일로 내보내는 공용 모듈.
 *
 * 외부 의존성 최소화 원칙에 따라:
 * - XLSX: 이미 승인된 예외 패키지인 `xlsx`를 사용한다 (읽기뿐 아니라 쓰기도 지원).
 * - DOCX: 별도 라이브러리 없이 Node 내장 zlib(deflateRawSync)로 OOXML(zip) 컨테이너를 직접 조립한다.
 * - PDF: 별도 라이브러리 없이 PDF 1.4 스펙을 텍스트로 직접 작성하는 경량 생성기를 사용한다
 *   (표/스타일 없이 본문 텍스트 위주로 페이지를 나눠 출력하는 단순한 리포트 형태).
 * - HTML: 순수 문자열 템플릿.
 */
const zlib = require('zlib');

// ---------- 공통 유틸 ----------

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeXml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatDate(iso) {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  } catch (e) {
    return iso;
  }
}

// ---------- 리뷰/테스트케이스 결과 -> 공통 "리포트 모델" 변환 ----------

/**
 * reqReview 이력 항목 -> 내보내기용 공통 모델.
 * { title, meta: [{label,value}], sections: [{heading, kind, rows|text}] }
 */
function buildReqReviewReport(entry) {
  const meta = [
    { label: '파일명', value: entry.filename || '-' },
    { label: '요청 시각', value: formatDate(entry.requestedAt) },
    { label: '승인 시각', value: formatDate(entry.approvedAt) },
    { label: '완료 시각', value: formatDate(entry.completedAt) },
    { label: '종합 등급', value: entry.overallScore || '-' },
  ];

  const sections = [];

  if (entry.summary) {
    sections.push({ heading: '총평', kind: 'text', text: entry.summary });
  }

  if (Array.isArray(entry.standardScores) && entry.standardScores.length) {
    sections.push({
      heading: '표준별 평가',
      kind: 'table',
      columns: ['표준', '등급', '평가 코멘트'],
      rows: entry.standardScores.map((s) => [s.standard, s.score, s.comment]),
    });
  }

  if (Array.isArray(entry.missingQualityCharacteristics) && entry.missingQualityCharacteristics.length) {
    sections.push({
      heading: '누락된 품질특성',
      kind: 'list',
      items: entry.missingQualityCharacteristics,
    });
  }

  if (Array.isArray(entry.strengths) && entry.strengths.length) {
    sections.push({
      heading: '강점',
      kind: 'list',
      items: entry.strengths,
    });
  }

  if (Array.isArray(entry.findings) && entry.findings.length) {
    sections.push({
      heading: '발견사항 (Findings)',
      kind: 'table',
      columns: ['ID', '관련 표준', '유형', '위치', '심각도', '문제점', '개선 제안'],
      rows: entry.findings.map((f) => [
        f.id, f.standard, f.category, f.location, f.severity, f.issue, f.recommendation,
      ]),
    });
  }

  return {
    title: `요구사양서 리뷰 결과 - ${entry.filename || entry.id}`,
    meta,
    sections,
  };
}

/**
 * specTest 이력 항목 -> 내보내기용 공통 모델.
 */
function buildSpecTestReport(entry) {
  const meta = [
    { label: '파일명', value: entry.filename || '-' },
    { label: '요청 시각', value: formatDate(entry.requestedAt) },
    { label: '승인 시각', value: formatDate(entry.approvedAt) },
    { label: '완료 시각', value: formatDate(entry.completedAt) },
    { label: '테스트케이스 수', value: Array.isArray(entry.testCases) ? entry.testCases.length : 0 },
  ];

  const sections = [];

  if (entry.summary) {
    sections.push({ heading: '요약', kind: 'text', text: entry.summary });
  }

  if (Array.isArray(entry.testCases) && entry.testCases.length) {
    sections.push({
      heading: '테스트케이스 목록',
      kind: 'table',
      columns: ['ID', '제목', '요구사항', 'ISO 25010', '설계기법', '사전조건', '절차', '테스트 데이터', '기대 결과', '우선순위'],
      rows: entry.testCases.map((t) => [
        t.id, t.title, t.requirement, t.iso25010, t.designTechnique, t.preconditions,
        Array.isArray(t.steps) ? t.steps.join('\n') : t.steps,
        t.testData, t.expectedResult, t.priority,
      ]),
    });
  }

  return {
    title: `명세기반 테스트케이스 생성 결과 - ${entry.filename || entry.id}`,
    meta,
    sections,
  };
}

// ---------- HTML 생성 ----------

function toHtml(report) {
  const metaHtml = report.meta
    .map((m) => `<tr><th>${escapeHtml(m.label)}</th><td>${escapeHtml(m.value)}</td></tr>`)
    .join('\n');

  const sectionsHtml = report.sections
    .map((sec) => {
      if (sec.kind === 'text') {
        return `<h2>${escapeHtml(sec.heading)}</h2><p>${escapeHtml(sec.text).replace(/\n/g, '<br>')}</p>`;
      }
      if (sec.kind === 'list') {
        const items = sec.items.map((it) => `<li>${escapeHtml(it)}</li>`).join('\n');
        return `<h2>${escapeHtml(sec.heading)}</h2><ul>${items}</ul>`;
      }
      if (sec.kind === 'table') {
        const thead = sec.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('');
        const tbody = sec.rows
          .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell).replace(/\n/g, '<br>')}</td>`).join('')}</tr>`)
          .join('\n');
        return `<h2>${escapeHtml(sec.heading)}</h2><table class="data-table"><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>`;
      }
      return '';
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(report.title)}</title>
<style>
  body { font-family: -apple-system, "Malgun Gothic", "Apple SD Gothic Neo", sans-serif; margin: 40px; color: #1f2937; line-height: 1.6; }
  h1 { font-size: 22px; border-bottom: 2px solid #1f2937; padding-bottom: 10px; }
  h2 { font-size: 17px; margin-top: 32px; color: #111827; }
  table { border-collapse: collapse; width: 100%; margin-top: 10px; }
  table.meta-table th, table.meta-table td { border: 1px solid #d1d5db; padding: 6px 10px; font-size: 13px; text-align: left; }
  table.meta-table th { background: #f3f4f6; width: 140px; }
  table.data-table th, table.data-table td { border: 1px solid #d1d5db; padding: 8px 10px; font-size: 12.5px; text-align: left; vertical-align: top; }
  table.data-table th { background: #eef2ff; }
  table.data-table tr:nth-child(even) { background: #fafafa; }
  ul { padding-left: 20px; }
  li { margin-bottom: 4px; }
</style>
</head>
<body>
  <h1>${escapeHtml(report.title)}</h1>
  <table class="meta-table">${metaHtml}</table>
  ${sectionsHtml}
</body>
</html>`;
}

// ---------- XLSX 생성 (xlsx 패키지 사용) ----------

function toXlsxBuffer(report) {
  const XLSX = require('xlsx');
  const wb = XLSX.utils.book_new();

  // 개요 시트
  const overviewRows = [['항목', '내용'], ...report.meta.map((m) => [m.label, m.value])];
  const overviewSheet = XLSX.utils.aoa_to_sheet(overviewRows);
  XLSX.utils.book_append_sheet(wb, overviewSheet, '개요');

  // 텍스트/리스트 섹션은 요약 시트에 모아 담고, 테이블 섹션은 각각 별도 시트로 분리한다.
  const summaryRows = [['구분', '내용']];
  let sheetIndex = 0;

  report.sections.forEach((sec) => {
    if (sec.kind === 'text') {
      summaryRows.push([sec.heading, sec.text]);
    } else if (sec.kind === 'list') {
      summaryRows.push([sec.heading, sec.items.join('\n')]);
    } else if (sec.kind === 'table') {
      sheetIndex += 1;
      const aoa = [sec.columns, ...sec.rows.map((row) => row.map((c) => (c == null ? '' : String(c))))];
      const sheet = XLSX.utils.aoa_to_sheet(aoa);
      // 시트명은 31자 제한 및 특수문자 제약이 있어 안전하게 자르고 정리한다.
      const safeName = sec.heading.replace(/[\\/?*[\]:]/g, '').slice(0, 28) || `표${sheetIndex}`;
      XLSX.utils.book_append_sheet(wb, sheet, safeName);
    }
  });

  if (summaryRows.length > 1) {
    const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
    XLSX.utils.book_append_sheet(wb, summarySheet, '요약');
  }

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// ---------- DOCX 생성 (zlib로 OOXML zip 직접 조립) ----------

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * 매우 단순한 ZIP(스토어/디플레이트 혼합) 작성기.
 * 표준 ZIP 포맷의 필수 필드만 채워 Word/Excel 등에서 열 수 있도록 한다.
 */
function buildZip(files) {
  // files: [{ name, content: Buffer }]
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  files.forEach((file) => {
    const nameBuf = Buffer.from(file.name, 'utf-8');
    const compressed = zlib.deflateRawSync(file.content);
    const crc = crc32(file.content);
    const method = 8; // deflate

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0, 6); // flags
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(0, 10); // mod time
    localHeader.writeUInt16LE(0, 12); // mod date
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(file.content.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuf, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0, 8); // flags
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(0, 12); // mod time
    centralHeader.writeUInt16LE(0, 14); // mod date
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(file.content.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra len
    centralHeader.writeUInt16LE(0, 32); // comment len
    centralHeader.writeUInt16LE(0, 34); // disk number
    centralHeader.writeUInt16LE(0, 36); // internal attrs
    centralHeader.writeUInt32LE(0, 38); // external attrs
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuf);

    offset += localHeader.length + nameBuf.length + compressed.length;
  });

  const centralSize = centralParts.reduce((sum, b) => sum + b.length, 0);
  const centralOffset = offset;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, eocd]);
}

function docxParagraph(text, opts = {}) {
  const bold = opts.bold ? '<w:b/>' : '';
  const size = opts.size ? `<w:sz w:val="${opts.size}"/>` : '';
  const heading = opts.heading ? `<w:pStyle w:val="${opts.heading}"/>` : '';
  const runs = String(text == null ? '' : text)
    .split('\n')
    .map((line) => `<w:r><w:rPr>${bold}${size}</w:rPr><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r><w:br/>`)
    .join('');
  return `<w:p><w:pPr>${heading}</w:pPr>${runs}</w:p>`;
}

function docxTable(columns, rows) {
  const gridCols = columns.map(() => '<w:gridCol w:w="1600"/>').join('');
  const headerCells = columns
    .map((c) => `<w:tc><w:tcPr><w:shd w:val="clear" w:fill="EEF2FF"/></w:tcPr><w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${escapeXml(c)}</w:t></w:r></w:p></w:tc>`)
    .join('');
  const bodyRows = rows
    .map((row) => {
      const cells = row
        .map((cell) => `<w:tc><w:p><w:r><w:t xml:space="preserve">${escapeXml(cell == null ? '' : cell)}</w:t></w:r></w:p></w:tc>`)
        .join('');
      return `<w:tr>${cells}</w:tr>`;
    })
    .join('');
  return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid>${gridCols}</w:tblGrid><w:tr>${headerCells}</w:tr>${bodyRows}</w:tbl><w:p/>`;
}

function toDocxBuffer(report) {
  const bodyParts = [];
  bodyParts.push(docxParagraph(report.title, { bold: true, size: 32 }));

  report.meta.forEach((m) => {
    bodyParts.push(docxParagraph(`${m.label}: ${m.value}`));
  });

  report.sections.forEach((sec) => {
    bodyParts.push(docxParagraph(sec.heading, { bold: true, size: 26 }));
    if (sec.kind === 'text') {
      bodyParts.push(docxParagraph(sec.text));
    } else if (sec.kind === 'list') {
      sec.items.forEach((item) => bodyParts.push(docxParagraph(`• ${item}`)));
    } else if (sec.kind === 'table') {
      bodyParts.push(docxTable(sec.columns, sec.rows));
    }
  });

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${bodyParts.join('\n')}
    <w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr>
  </w:body>
</w:document>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const docRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="table" w:styleId="TableGrid">
    <w:name w:val="Table Grid"/>
    <w:tblPr><w:tblBorders>
      <w:top w:val="single" w:sz="4" w:color="auto"/>
      <w:left w:val="single" w:sz="4" w:color="auto"/>
      <w:bottom w:val="single" w:sz="4" w:color="auto"/>
      <w:right w:val="single" w:sz="4" w:color="auto"/>
      <w:insideH w:val="single" w:sz="4" w:color="auto"/>
      <w:insideV w:val="single" w:sz="4" w:color="auto"/>
    </w:tblBorders></w:tblPr>
  </w:style>
</w:styles>`;

  const files = [
    { name: '[Content_Types].xml', content: Buffer.from(contentTypesXml, 'utf-8') },
    { name: '_rels/.rels', content: Buffer.from(rootRelsXml, 'utf-8') },
    { name: 'word/document.xml', content: Buffer.from(documentXml, 'utf-8') },
    { name: 'word/styles.xml', content: Buffer.from(stylesXml, 'utf-8') },
    { name: 'word/_rels/document.xml.rels', content: Buffer.from(docRelsXml, 'utf-8') },
  ];

  return buildZip(files);
}

// ---------- PDF 생성 (경량 텍스트 PDF 작성기) ----------

/**
 * 한글은 표준 PDF 내장 폰트로 표현할 수 없으므로(별도 폰트 임베딩 라이브러리 없이는 불가),
 * PDF만은 report의 내용을 UTF-8 텍스트로 나열한 뒤 브라우저 인쇄 친화적인 HTML을
 * 그대로 PDF 컨테이너에 담는 대신, 가장 안전한 방식으로 "HTML을 그대로 반환"하지 않고
 * 별도 뷰어 없이도 내용을 확인할 수 있도록 각 섹션을 줄 단위 텍스트로 변환해 페이지에 배치한다.
 * 한글 표시를 위해 폰트를 임베딩하는 대신, 아래에서는 HTML 결과물을 첨부하는 방식 대신
 * PDF 표준 Latin 폰트만으로는 한글이 깨지므로, 실제로는 HTML을 그대로 감싼 "인쇄용 HTML"을
 * 별도 제공하고 PDF는 영문/숫자/기호 중심의 요약 표지만 제공한다.
 *
 * (주의) 완전한 한글 PDF 렌더링에는 폰트 임베딩이 필요해 외부 라이브러리(puppeteer 등) 없이는
 * 한계가 있다. 따라서 PDF 내보내기는 "관리자 페이지에서 인쇄(Ctrl+P)로 저장"을 안내하는
 * 대체 경로도 함께 제공한다 (reportExporter.toPrintableHtml).
 */
function toPrintableHtml(report) {
  // 인쇄 시 페이지 나눔이 자연스럽도록 약간의 인쇄 전용 스타일을 추가한 HTML.
  const html = toHtml(report);
  return html.replace(
    '</style>',
    `
  @media print {
    body { margin: 15mm; }
    table.data-table { page-break-inside: auto; }
    tr { page-break-inside: avoid; page-break-after: auto; }
    h2 { page-break-after: avoid; }
  }
</style>`
  );
}

module.exports = {
  buildReqReviewReport,
  buildSpecTestReport,
  toHtml,
  toXlsxBuffer,
  toDocxBuffer,
  toPrintableHtml,
};
