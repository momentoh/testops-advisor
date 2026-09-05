'use strict';
/**
 * 매우 단순한 관리자 인증 (세션 DB 없이 서명된 쿠키 사용).
 * 운영 배포 시 반드시 환경변수 ADMIN_PASSWORD / SESSION_SECRET 를 강력한 값으로 설정할 것.
 */
const crypto = require('crypto');

const COOKIE_NAME = 'testops_admin';
const SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';

function sign(value) {
  const h = crypto.createHmac('sha256', SECRET).update(value).digest('hex');
  return `${value}.${h}`;
}

function verify(signed) {
  if (!signed) return null;
  const idx = signed.lastIndexOf('.');
  if (idx === -1) return null;
  const value = signed.slice(0, idx);
  const sig = signed.slice(idx + 1);
  const expected = crypto.createHmac('sha256', SECRET).update(value).digest('hex');
  if (sig.length !== expected.length) return null;
  const ok = crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  return ok ? value : null;
}

function isAdmin(req) {
  const token = req.cookies ? req.cookies[COOKIE_NAME] : null;
  return verify(token) === 'ok';
}

function setAdminCookie(res) {
  res.setCookie(COOKIE_NAME, sign('ok'), { maxAge: 60 * 60 * 8 });
}

function clearAdminCookie(res) {
  res.setCookie(COOKIE_NAME, '', { maxAge: 0 });
}

function requireAdmin(req, res, next) {
  if (isAdmin(req)) return next();
  return res.redirect('/admin/login');
}

module.exports = { isAdmin, setAdminCookie, clearAdminCookie, requireAdmin };
