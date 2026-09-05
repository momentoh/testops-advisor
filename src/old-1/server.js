'use strict';
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Router, extendResponse } = require('./lib/router');
const { render } = require('./lib/template');
const recommend = require('./services/recommend');
const toolsService = require('./services/tools');
const ci = require('./services/ci');
const siteAudit = require('./services/siteAudit');
const { parseJobLog } = require('./services/logParser');
const docParser = require('./services/docParser');
const specTestGen = require('./services/specTestGen');
const specTestStore = require('./services/specTestStore');
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
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
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
          id: j.id,
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

router.get('/admin/ci/job/:jobId/detail', (req, res) => {
  requireAdmin(req, res, async () => {
    try {
      const jobs = await (async () => {
        const run = await ci.getLatestRun();
        return run ? ci.getRunJobs(run.id) : [];
      })();
      const job = jobs.find(j => String(j.id) === req.params.jobId);
      const logText = await ci.getJobLogs(req.params.jobId);
      const parsed = parseJobLog(job ? job.name : '', logText);
      res.json({ ok: true, ...parsed });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
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

// ---------- 웹사이트 검사 (프론트 홈페이지 URL 입력 폼) ----------
// 누구나 URL을 제출해 검사를 요청할 수 있다 (로그인 불필요). 결과 조회는 관리자 전용.
router.post('/site-audit', (req, res) => {
  (async () => {
    try {
      const { url } = req.body;
      const entry = await siteAudit.requestAudit(url);
      res.json({ ok: true, requestedAt: entry.requestedAt });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  })();
});

router.get('/admin/site-audit/status', (req, res) => {
  requireAdmin(req, res, async () => {
    try {
      const last = siteAudit.getLastAudit();
      if (!ci.isConfigured()) return res.json({ configured: false, last });
      if (!last) return res.json({ configured: true, last: null, run: null });

      const run = await ci.getLatestRun(siteAudit.SITE_AUDIT_WORKFLOW);
      if (!run) return res.json({ configured: true, last, run: null });
      const jobs = await ci.getRunJobs(run.id);
      res.json({
        configured: true,
        last,
        run: {
          id: run.id,
          status: run.status,
          conclusion: run.conclusion,
          htmlUrl: run.html_url,
          createdAt: run.created_at,
          updatedAt: run.updated_at,
        },
        jobs: jobs.map(j => ({
          id: j.id,
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

router.get('/admin/site-audit/job/:jobId/detail', (req, res) => {
  requireAdmin(req, res, async () => {
    try {
      const run = await ci.getLatestRun(siteAudit.SITE_AUDIT_WORKFLOW);
      const jobs = run ? await ci.getRunJobs(run.id) : [];
      const job = jobs.find(j => String(j.id) === req.params.jobId);
      const logText = await ci.getJobLogs(req.params.jobId);
      const parsed = parseJobLog(job ? job.name : '', logText);
      res.json({ ok: true, ...parsed });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });
});

// ---------- 명세기반 블랙박스 테스트케이스 생성 (프론트 문서 업로드 폼) ----------
// 엑셀/워드/PDF/텍스트 명세 문서를 업로드하면 ISO/IEC 25010(품질특성) · 25023(품질측정) ·
// 29119(테스트 설계기법) 표준을 적용해 Claude API로 테스트케이스를 생성한다.
// Claude API 호출은 토큰(비용)을 소모하므로, 업로드는 로그인 없이 가능하되
// 실제 생성은 관리자가 문서 내용을 확인하고 승인해야만 실행된다 (승인 전까지 API 미호출).
router.get('/spec-test/status', (req, res) => {
  if (!isAdmin(req)) {
    res.statusCode = 401;
    return res.json({ ok: false, error: '관리자 로그인이 필요합니다.' });
  }
  res.json({ configured: specTestGen.isConfigured(), items: specTestStore.getAllPublic() });
});

router.post('/spec-test/upload', (req, res) => {
  (async () => {
    try {
      if (!specTestGen.isConfigured()) {
        return res.status(400).json({
          ok: false,
          error: 'ANTHROPIC_API_KEY 환경변수가 설정되지 않아 테스트케이스 생성 기능을 사용할 수 없습니다.',
        });
      }
      const file = req.files && req.files.document;
      if (!file || !file.data || file.data.length === 0) {
        return res.status(400).json({ ok: false, error: '업로드된 파일이 없습니다.' });
      }
      // 업로드 자체는 로그인 없이 누구나 가능하며, 실제 생성(토큰 소모)은 관리자 승인이 필요하다.
      if (file.data.length > specTestStore.MAX_FILE_BYTES) {
        return res.status(400).json({ ok: false, error: '파일 크기가 너무 큽니다 (최대 10MB).' });
      }

      specTestStore.checkRateLimit();

      const { text, format, truncated } = await docParser.extractText(file.data, file.filename);
      const preview = docParser.makePreview(text);
      const entry = specTestStore.createPendingApproval({ filename: file.filename, format, previewText: preview });
      // 승인 전까지 실제 생성에 쓸 원문 텍스트를 DB에 임시 보관한다 (승인/거부 시 정리됨).
      specTestStore.setFullText(entry.id, text);
      res.json({ ok: true, id: entry.id, truncated, pendingApproval: true });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  })();
});

router.get('/spec-test/:id', (req, res) => {
  if (!isAdmin(req)) {
    res.statusCode = 401;
    return res.json({ ok: false, error: '관리자 로그인이 필요합니다.' });
  }
  const entry = specTestStore.getByIdPublic(req.params.id);
  if (!entry) {
    res.statusCode = 404;
    return res.json({ ok: false, error: '해당 요청을 찾을 수 없습니다.' });
  }
  res.json({ ok: true, item: entry });
});

// 관리자 승인: 이 시점부터 실제로 Claude API를 호출해 토큰을 소모하며 테스트케이스를 생성한다.
router.post('/admin/spec-test/:id/approve', (req, res) => {
  requireAdmin(req, res, () => {
    const entry = specTestStore.getById(req.params.id);
    if (!entry) {
      res.statusCode = 404;
      return res.json({ ok: false, error: '해당 요청을 찾을 수 없습니다.' });
    }
    if (entry.status !== 'pending_approval') {
      return res.status(400).json({ ok: false, error: '승인 대기 상태의 요청이 아닙니다.' });
    }
    const fullText = entry.fullText;
    const format = entry.format;
    specTestStore.markApprovedProcessing(entry.id);
    res.json({ ok: true });

    // 생성 자체는 시간이 걸릴 수 있으므로 응답 후 백그라운드에서 처리하고 상태를 갱신한다.
    specTestGen
      .generateTestCases(fullText, format)
      .then((result) => specTestStore.markDone(entry.id, result))
      .catch((err) => specTestStore.markError(entry.id, err.message));
  });
});

// 관리자 반려: Claude API를 호출하지 않으므로 토큰이 소모되지 않는다.
router.post('/admin/spec-test/:id/reject', (req, res) => {
  requireAdmin(req, res, () => {
    const entry = specTestStore.getById(req.params.id);
    if (!entry) {
      res.statusCode = 404;
      return res.json({ ok: false, error: '해당 요청을 찾을 수 없습니다.' });
    }
    if (entry.status !== 'pending_approval') {
      return res.status(400).json({ ok: false, error: '승인 대기 상태의 요청이 아닙니다.' });
    }
    const reason = (req.body && req.body.reason) || '관리자가 반려했습니다.';
    specTestStore.markRejected(entry.id, reason);
    res.json({ ok: true });
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
