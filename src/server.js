'use strict';
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Router, extendResponse } = require('./lib/router');
const { render } = require('./lib/template');
const recommend = require('./services/recommend');
const toolsService = require('./services/tools');
const ci = require('./services/ci');
const { isAdmin, setAdminCookie, clearAdminCookie, requireAdmin } = require('./middleware/auth');
const { getDB } = require('./db/store');
const { seed } = require('./db/seed');

// 최초 배포 시 data/db.json이 없거나 비어있으면 자동으로 시드 데이터를 채운다.
(function ensureSeeded() {
  const db = getDB();
  if (!db.stages || db.stages.length === 0) {
    console.log('[bootstrap] 초기 데이터가 없어 시드 데이터를 생성합니다.');
    seed();
  }
})();

// --- 아주 단순한 .env 로더 (외부 dotenv 패키지 없이) ---
(function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
})();

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin1234';

const router = new Router();

// ---------- 정적 파일 서빙 ----------
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function tryServeStatic(req, res) {
  if (req.method !== 'GET') return false;
  const urlPath = req.url.split('?')[0];
  if (!urlPath.startsWith('/static/')) return false;
  const relative = urlPath.replace('/static/', '');
  const filePath = path.join(PUBLIC_DIR, relative);
  if (!filePath.startsWith(PUBLIC_DIR)) return false; // path traversal 방지
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return false;
  const ext = path.extname(filePath);
  res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
  fs.createReadStream(filePath).pipe(res);
  return true;
}

// ---------- 공개 라우트 ----------
router.get('/', (req, res) => {
  const stages = recommend.getStages();
  res.render('home', { title: 'TestOps Advisor', stages, isAdmin: isAdmin(req) });
});

router.get('/stages/:stageId', (req, res) => {
  const stage = recommend.getStageById(req.params.stageId);
  if (!stage) {
    res.statusCode = 404;
    return res.render('404', { title: '페이지 없음' });
  }
  const category = req.query.category || null;
  const tools = recommend.recommendForStage(stage.id, { limit: 50, category });
  const stages = recommend.getStages();
  res.render('stage', {
    title: `${stage.name} - 추천`,
    stage, stages, tools, category,
    isAdmin: isAdmin(req),
  });
});

router.post('/feedback', (req, res) => {
  const { toolId, stageId, vote } = req.body;
  try {
    recommend.recordFeedback({ toolId, stageId, vote });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ---------- 관리자 라우트 ----------
router.get('/admin/login', (req, res) => {
  if (isAdmin(req)) return res.redirect('/admin');
  res.render('admin/login', { title: '관리자 로그인', error: null });
});

router.post('/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    setAdminCookie(res);
    return res.redirect('/admin');
  }
  res.render('admin/login', { title: '관리자 로그인', error: '비밀번호가 올바르지 않습니다.' });
});

router.post('/admin/logout', (req, res) => {
  clearAdminCookie(res);
  res.redirect('/admin/login');
});

router.get('/admin', (req, res) => {
  requireAdmin(req, res, () => {
    const stages = recommend.getStages();
    const tools = recommend.allToolsWithScore();
    const stats = recommend.feedbackStats();
    res.render('admin/dashboard', { title: '관리자 대시보드', stages, tools, stats });
  });
});

router.post('/admin/tools', (req, res) => {
  requireAdmin(req, res, () => {
    const { stageId, name, category, description, url } = req.body;
    try {
      toolsService.createTool({ stageId, name, category, description, url });
      res.redirect('/admin');
    } catch (err) {
      res.status(400).send(err.message);
    }
  });
});

router.post('/admin/tools/:id/update', (req, res) => {
  requireAdmin(req, res, () => {
    const { name, category, description, url, stageId, weight } = req.body;
    try {
      toolsService.updateTool(req.params.id, {
        name, category, description, url, stageId,
        weight: weight ? parseFloat(weight) : undefined,
      });
      res.redirect('/admin');
    } catch (err) {
      res.status(400).send(err.message);
    }
  });
});

router.post('/admin/tools/:id/delete', (req, res) => {
  requireAdmin(req, res, () => {
    toolsService.deleteTool(req.params.id);
    res.redirect('/admin');
  });
});

// ---------- CI 파이프라인 연동 (관리자 대시보드 "테스트 실행" 버튼) ----------
router.get('/admin/ci/status', (req, res) => {
  requireAdmin(req, res, async () => {
    try {
      if (!ci.isConfigured()) {
        return res.json({ configured: false });
      }
      const run = await ci.getLatestRun();
      if (!run) return res.json({ configured: true, run: null });
      const jobs = await ci.getRunJobs(run.id);
      res.json({
        configured: true,
        run: {
          id: run.id,
          status: run.status,       // queued | in_progress | completed
          conclusion: run.conclusion, // success | failure | null
          htmlUrl: run.html_url,
          createdAt: run.created_at,
          updatedAt: run.updated_at,
        },
        jobs: jobs.map(j => ({
          name: j.name,
          status: j.status,
          conclusion: j.conclusion,
          startedAt: j.started_at,
          completedAt: j.completed_at,
        })),
      });
    } catch (err) {
      res.status(500).json({ configured: true, error: err.message });
    }
  });
});

router.post('/admin/ci/trigger', (req, res) => {
  requireAdmin(req, res, async () => {
    try {
      if (!ci.isConfigured()) {
        return res.status(400).json({ ok: false, error: 'GITHUB_TOKEN / GITHUB_REPO 환경변수가 설정되지 않았습니다.' });
      }
      await ci.triggerWorkflow();
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });
});

// ---------- 헬스체크 (Render 등 배포 플랫폼용) ----------
router.get('/healthz', (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// ---------- HTTP 서버 ----------
const server = http.createServer(async (req, res) => {
  extendResponse(res, (resObj, viewName, data) => {
    try {
      const html = render(viewName, data || {});
      resObj.setHeader('Content-Type', 'text/html; charset=utf-8');
      resObj.end(html);
    } catch (err) {
      console.error('[render error]', err);
      resObj.statusCode = 500;
      resObj.end('Render Error: ' + err.message);
    }
  });

  if (tryServeStatic(req, res)) return;

  const matched = await router.handle(req, res);
  if (!matched) {
    res.statusCode = 404;
    try {
      res.render('404', { title: '페이지 없음' });
    } catch (e) {
      res.end('404 Not Found');
    }
  }
});

// 0.0.0.0에 명시적으로 바인딩한다. 호스트를 지정하지 않으면 Node 버전/환경에 따라
// IPv6(::)에만 바인딩되어 127.0.0.1(IPv4)로 접속하는 CI 헬스체크(wait-on 등)가
// 연결에 실패하는 경우가 있다 (예: GitHub Actions 러너에서 관측됨).
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[testops-advisor] 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
});

module.exports = server;
