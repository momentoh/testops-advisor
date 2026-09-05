'use strict';
/**
 * 초경량 라우터 (Express 미사용, 순수 http 모듈 기반).
 * - GET/POST 라우트 등록
 * - :param 형태의 동적 경로 매칭
 * - application/x-www-form-urlencoded, application/json 바디 파싱
 * - 쿠키 파싱
 */
const { URL } = require('url');
const querystring = require('querystring');

function parseCookies(req) {
  const header = req.headers.cookie;
  const cookies = {};
  if (!header) return cookies;
  header.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const k = pair.slice(0, idx).trim();
    const v = decodeURIComponent(pair.slice(idx + 1).trim());
    cookies[k] = v;
  });
  return cookies;
}

function matchPath(pattern, pathname) {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = pathname.split('/').filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;
  const params = {};
  for (let i = 0; i < patternParts.length; i++) {
    const pp = patternParts[i];
    const ap = decodeURIComponent(pathParts[i]);
    if (pp.startsWith(':')) {
      params[pp.slice(1)] = ap;
    } else if (pp !== ap) {
      return null;
    }
  }
  return params;
}

class Router {
  constructor() {
    this.routes = []; // { method, pattern, handler }
  }

  get(pattern, handler) {
    this.routes.push({ method: 'GET', pattern, handler });
  }

  post(pattern, handler) {
    this.routes.push({ method: 'POST', pattern, handler });
  }

  async handle(req, res) {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;
    req.query = Object.fromEntries(parsedUrl.searchParams.entries());
    req.cookies = parseCookies(req);

    // 바디 파싱 (POST)
    if (req.method === 'POST') {
      req.body = await parseBody(req);
    } else {
      req.body = {};
    }

    // HEAD 요청은 GET 라우트로 처리하되, 본문은 보내지 않는다 (HTTP 표준 동작).
    // 외부 헬스체크/링크 검사 도구(예: Playwright request.head())가 HEAD를 사용하는 경우가 많아
    // GET 전용 라우터라도 HEAD를 지원하지 않으면 정상 페이지가 전부 404로 오탐된다.
    const isHeadRequest = req.method === 'HEAD';
    const effectiveMethod = isHeadRequest ? 'GET' : req.method;

    for (const route of this.routes) {
      if (route.method !== effectiveMethod) continue;
      const params = matchPath(route.pattern, pathname);
      if (params) {
        req.params = params;
        if (isHeadRequest) {
          const originalEnd = res.end.bind(res);
          res.end = (...args) => originalEnd();
        }
        try {
          await route.handler(req, res);
        } catch (err) {
          console.error('[router] handler error:', err);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.end('Internal Server Error: ' + err.message);
          }
        }
        return true;
      }
    }
    return false;
  }
}

function parseBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      const contentType = req.headers['content-type'] || '';
      try {
        if (contentType.includes('application/json')) {
          resolve(data ? JSON.parse(data) : {});
        } else if (contentType.includes('application/x-www-form-urlencoded')) {
          resolve(querystring.parse(data));
        } else {
          resolve({});
        }
      } catch (e) {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

// res 헬퍼 확장
function extendResponse(res, renderFn) {
  res.status = function (code) { res.statusCode = code; return res; };
  res.json = function (obj) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj));
  };
  res.redirect = function (location) {
    res.statusCode = 302;
    res.setHeader('Location', location);
    res.end();
  };
  res.send = function (body) {
    if (typeof body === 'object') return res.json(body);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(String(body));
  };
  res.render = function (viewName, data) {
    renderFn(res, viewName, data);
  };
  res.setCookie = function (name, value, opts = {}) {
    const parts = [`${name}=${encodeURIComponent(value)}`];
    parts.push(`Path=${opts.path || '/'}`);
    if (opts.httpOnly !== false) parts.push('HttpOnly');
    if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
    parts.push(`SameSite=${opts.sameSite || 'Lax'}`);
    const existing = res.getHeader('Set-Cookie');
    const cookieStr = parts.join('; ');
    if (existing) {
      res.setHeader('Set-Cookie', Array.isArray(existing) ? [...existing, cookieStr] : [existing, cookieStr]);
    } else {
      res.setHeader('Set-Cookie', cookieStr);
    }
  };
  return res;
}

module.exports = { Router, extendResponse, parseCookies };
