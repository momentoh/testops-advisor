'use strict';
/**
 * 업로드된 명세 문서(엑셀/워드/PDF/텍스트)에서 순수 텍스트를 추출한다.
 * 명세기반 블랙박스 테스트케이스 생성(specTestGen.js)의 입력을 준비하는 역할.
 *
 * 지원 형식:
 *  - .xlsx, .xls  -> xlsx (SheetJS) 라이브러리로 모든 시트를 CSV 유사 텍스트로 변환
 *  - .docx        -> mammoth 라이브러리로 순수 텍스트 추출 (구 .doc 형식은 미지원)
 *  - .pdf         -> pdf-parse 라이브러리로 텍스트 추출
 *  - .txt, .csv, .md -> 그대로 UTF-8 텍스트로 취급
 *
 * 추출된 텍스트가 너무 길면 Claude API 호출 시 비용/토큰 한도 문제가 생기므로
 * MAX_CHARS로 잘라낸다 (한글 기준 약 4만자 ≈ 프롬프트에 포함해도 무리 없는 수준).
 */
const path = require('path');

const MAX_CHARS = 40000;

function truncate(text) {
  if (!text) return '';
  const trimmed = text.trim();
  if (trimmed.length <= MAX_CHARS) return trimmed;
  return trimmed.slice(0, MAX_CHARS) + '\n\n...(내용이 길어 이후 부분은 생략되었습니다)...';
}

async function parseXlsx(buffer) {
  const XLSX = require('xlsx');
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const parts = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet);
    if (csv && csv.trim()) {
      parts.push(`[시트: ${sheetName}]\n${csv.trim()}`);
    }
  }
  return parts.join('\n\n');
}

async function parseDocx(buffer) {
  const mammoth = require('mammoth');
  const result = await mammoth.extractRawText({ buffer });
  return result.value || '';
}

async function parsePdf(buffer) {
  const pdfParse = require('pdf-parse');
  const result = await pdfParse(buffer);
  return result.text || '';
}

/**
 * 파일 버퍼와 원본 파일명을 받아 텍스트를 추출한다.
 * 반환: { text, format, truncated }
 */
async function extractText(buffer, filename) {
  const ext = path.extname(filename || '').toLowerCase();
  let raw = '';
  let format = ext.replace('.', '') || 'unknown';

  if (ext === '.xlsx' || ext === '.xls') {
    raw = await parseXlsx(buffer);
    format = 'excel';
  } else if (ext === '.docx') {
    raw = await parseDocx(buffer);
    format = 'word';
  } else if (ext === '.pdf') {
    raw = await parsePdf(buffer);
    format = 'pdf';
  } else if (ext === '.txt' || ext === '.csv' || ext === '.md') {
    raw = buffer.toString('utf-8');
    format = 'text';
  } else {
    throw new Error(`지원하지 않는 파일 형식입니다: ${ext || '(확장자 없음)'}. 지원 형식: .xlsx, .docx, .pdf, .txt, .csv, .md`);
  }

  const truncatedFlag = raw.trim().length > MAX_CHARS;
  return { text: truncate(raw), format, truncated: truncatedFlag };
}

const PREVIEW_CHARS = 500;

/** 관리자 승인 화면에 보여줄 문서 앞부분 미리보기 텍스트를 만든다. */
function makePreview(text) {
  if (!text) return '';
  const trimmed = text.trim();
  if (trimmed.length <= PREVIEW_CHARS) return trimmed;
  return trimmed.slice(0, PREVIEW_CHARS) + '...';
}

module.exports = { extractText, MAX_CHARS, makePreview };
