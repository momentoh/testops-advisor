'use strict';
/**
 * 초경량 서버사이드 템플릿 엔진 (EJS 문법 서브셋 구현, 외부 의존성 없음)
 * 지원 문법:
 *   <%= expr %>   : HTML 이스케이프 출력
 *   <%- expr %>   : Raw 출력 (이스케이프 없음)
 *   <% code %>    : JS 코드 실행 (if/for/each 등)
 *   <% include('partials/header', {locals}) %> : 부분 템플릿 삽입
 */
const fs = require('fs');
const path = require('path');

const VIEWS_DIR = path.join(__dirname, '..', 'views');
const cache = new Map();

function escapeHtml(str) {
  if (str === undefined || str === null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function compile(templateStr) {
  let code = 'let __out = [];\n';
  code += 'with (__locals) {\n';

  let cursor = 0;
  const regex = /<%([-=]?)([\s\S]*?)%>/g;
  let match;
  while ((match = regex.exec(templateStr)) !== null) {
    const literal = templateStr.slice(cursor, match.index);
    if (literal) {
      code += `__out.push(${JSON.stringify(literal)});\n`;
    }
    const type = match[1];
    const expr = match[2].trim();
    if (type === '=') {
      code += `__out.push(__escape(${expr}));\n`;
    } else if (type === '-') {
      code += `__out.push((${expr}));\n`;
    } else {
      code += `${expr}\n`;
    }
    cursor = regex.lastIndex;
  }
  const rest = templateStr.slice(cursor);
  if (rest) code += `__out.push(${JSON.stringify(rest)});\n`;
  code += '}\nreturn __out.join("");';
  return code;
}

function loadTemplate(viewPath) {
  if (cache.has(viewPath) && process.env.NODE_ENV === 'production') {
    return cache.get(viewPath);
  }
  const fullPath = viewPath.endsWith('.ejs') ? viewPath : `${viewPath}.ejs`;
  const filePath = path.isAbsolute(fullPath) ? fullPath : path.join(VIEWS_DIR, fullPath);
  const raw = fs.readFileSync(filePath, 'utf-8');
  const code = compile(raw);
  // eslint-disable-next-line no-new-func
  const fn = new Function('__locals', '__escape', 'include', code);
  cache.set(viewPath, fn);
  return fn;
}

function render(viewName, locals = {}) {
  const fn = loadTemplate(viewName);
  const includeFn = (partialName, partialLocals = {}) => {
    return render(partialName, { ...locals, ...partialLocals });
  };
  return fn(locals, escapeHtml, includeFn);
}

module.exports = { render, escapeHtml };
