'use strict';
/**
 * 초기 시드 데이터: 7단계 SDLC 테스트 프로세스 + 단계별 자동화 에이전트/MCP 목록
 * 실행: node src/db/seed.js  (또는 npm run seed)
 * 이미 데이터가 있으면 stages/tools 만 갱신하고 feedback/admins 는 보존한다.
 */
const crypto = require('crypto');
const { getDB, persist } = require('./store');

const STAGES = [
  {
    id: 'requirements',
    order: 1,
    name: '요구사항 분석',
    nameEn: 'Requirements Analysis',
    description: '테스트 대상 시스템의 기능/비기능 요구사항을 수집하고, 테스트 범위와 우선순위를 정의하는 단계',
  },
  {
    id: 'test-planning',
    order: 2,
    name: '테스트 계획',
    nameEn: 'Test Planning',
    description: '테스트 전략, 일정, 리소스, 리스크, 종료 기준(Exit Criteria)을 수립하는 단계',
  },
  {
    id: 'test-case-design',
    order: 3,
    name: '테스트 케이스 설계',
    nameEn: 'Test Case Design',
    description: '요구사항을 기반으로 테스트 시나리오/케이스를 작성하고 테스트 데이터를 설계하는 단계',
  },
  {
    id: 'unit-testing',
    order: 4,
    name: '단위 테스트',
    nameEn: 'Unit Testing',
    description: '함수/모듈 단위의 로직을 검증하는 자동화된 단위 테스트를 작성·실행하는 단계',
  },
  {
    id: 'integration-e2e',
    order: 5,
    name: '통합/E2E 테스트',
    nameEn: 'Integration & E2E Testing',
    description: '모듈 간 연동 및 실제 사용자 시나리오 전체 흐름을 검증하는 단계',
  },
  {
    id: 'performance-security',
    order: 6,
    name: '성능/보안 테스트',
    nameEn: 'Performance & Security Testing',
    description: '부하/스트레스 테스트와 취약점 스캔 등 비기능 품질을 검증하는 단계',
  },
  {
    id: 'deployment-monitoring',
    order: 7,
    name: '배포/모니터링',
    nameEn: 'Deployment & Monitoring',
    description: 'CI/CD 파이프라인을 통한 배포와 배포 후 운영 모니터링·회귀 감지를 수행하는 단계',
  },
];

// 카테고리: agent(자동화 에이전트/프레임워크) | mcp(MCP 서버) | platform(SaaS/플랫폼 도구)
const TOOLS = [
  // 1. 요구사항 분석
  { stageId: 'requirements', name: 'Jira + Confluence', category: 'platform', description: '요구사항 티켓화 및 명세 문서 관리. 요구사항 추적성(RTM) 확보에 사용.', url: 'https://www.atlassian.com/software/jira' },
  { stageId: 'requirements', name: 'Notion MCP', category: 'mcp', description: 'Notion에 정리된 기획/요구사항 문서를 MCP로 연결해 AI가 직접 요구사항을 읽고 요약·정리하도록 지원.', url: 'https://developers.notion.com' },
  { stageId: 'requirements', name: 'Claude(요구사항 명세 리뷰 에이전트)', category: 'agent', description: '자연어 요구사항 문서를 입력하면 모호한 표현, 누락된 예외 케이스, 테스트 불가능한 요구사항을 자동 검출.', url: 'https://claude.ai' },
  { stageId: 'requirements', name: 'Linear MCP', category: 'mcp', description: 'Linear 이슈트래커 연동으로 요구사항-이슈 매핑 자동화.', url: 'https://linear.app' },

  // 2. 테스트 계획
  { stageId: 'test-planning', name: 'TestRail', category: 'platform', description: '테스트 계획서, 마일스톤, 커버리지 리포트를 관리하는 테스트 관리 플랫폼.', url: 'https://www.testrail.com' },
  { stageId: 'test-planning', name: 'Xray for Jira', category: 'platform', description: 'Jira 기반 테스트 계획/실행 관리 플러그인. 요구사항-테스트케이스 추적성 제공.', url: 'https://www.getxray.app' },
  { stageId: 'test-planning', name: 'Claude(리스크 기반 테스트 계획 에이전트)', category: 'agent', description: '기능 명세와 과거 결함 이력을 바탕으로 리스크가 높은 영역을 식별해 테스트 우선순위를 제안.', url: 'https://claude.ai' },
  { stageId: 'test-planning', name: 'Google Sheets MCP', category: 'mcp', description: '테스트 계획/일정표를 스프레드시트로 관리하며 MCP로 AI가 직접 갱신.', url: 'https://developers.google.com/sheets/api' },

  // 3. 테스트 케이스 설계
  { stageId: 'test-case-design', name: 'Playwright Test Generator (Codegen)', category: 'agent', description: '실제 브라우저 조작을 기록해 테스트 스크립트를 자동 생성.', url: 'https://playwright.dev/docs/codegen' },
  { stageId: 'test-case-design', name: 'Claude(테스트 케이스 자동 생성 에이전트)', category: 'agent', description: '요구사항/사용자 스토리를 입력하면 정상/경계값/예외 케이스를 포함한 테스트 케이스 표를 자동 생성.', url: 'https://claude.ai' },
  { stageId: 'test-case-design', name: 'Figma MCP', category: 'mcp', description: '디자인 목업을 분석해 UI 요소 기반 테스트 케이스 및 접근성 체크리스트를 생성.', url: 'https://www.figma.com' },
  { stageId: 'test-case-design', name: 'Gherkin/Cucumber', category: 'agent', description: 'BDD 형식(Given-When-Then)으로 테스트 시나리오를 명세화해 비개발자와 협업 용이.', url: 'https://cucumber.io' },

  // 4. 단위 테스트
  { stageId: 'unit-testing', name: 'Jest', category: 'agent', description: 'JavaScript/TypeScript 단위 테스트 프레임워크. 커버리지 리포트 내장.', url: 'https://jestjs.io' },
  { stageId: 'unit-testing', name: 'pytest', category: 'agent', description: 'Python 단위 테스트 프레임워크. 픽스처와 파라미터화 테스트에 강점.', url: 'https://docs.pytest.org' },
  { stageId: 'unit-testing', name: 'GitHub Actions MCP', category: 'mcp', description: 'CI에서 단위테스트를 자동 실행하고 결과를 MCP로 조회해 AI가 실패 원인을 분석.', url: 'https://docs.github.com/actions' },
  { stageId: 'unit-testing', name: 'Claude(단위 테스트 자동 작성 에이전트)', category: 'agent', description: '함수/클래스 코드를 분석해 누락된 엣지 케이스를 포함한 단위 테스트 코드를 자동 생성.', url: 'https://claude.ai' },

  // 5. 통합/E2E 테스트
  { stageId: 'integration-e2e', name: 'Playwright', category: 'agent', description: '크로스 브라우저 E2E 테스트 자동화 프레임워크. 병렬 실행과 트레이스 뷰어 제공.', url: 'https://playwright.dev' },
  { stageId: 'integration-e2e', name: 'Cypress', category: 'agent', description: '프론트엔드 E2E/컴포넌트 테스트 도구. 실시간 리로드와 타임트래블 디버깅 지원.', url: 'https://www.cypress.io' },
  { stageId: 'integration-e2e', name: 'Claude in Chrome (브라우저 자동화 MCP)', category: 'mcp', description: 'AI 에이전트가 실제 브라우저를 조작하며 사용자 시나리오 기반 E2E 테스트를 수행·검증.', url: 'https://claude.ai' },
  { stageId: 'integration-e2e', name: 'Postman/Newman', category: 'platform', description: 'API 통합 테스트 작성 및 CI 파이프라인 내 자동 실행(Newman CLI).', url: 'https://www.postman.com' },

  // 6. 성능/보안 테스트
  { stageId: 'performance-security', name: 'k6', category: 'agent', description: '코드 기반 부하/성능 테스트 도구. CI 연동 및 클라우드 대시보드 제공.', url: 'https://k6.io' },
  { stageId: 'performance-security', name: 'OWASP ZAP', category: 'agent', description: '오픈소스 웹 애플리케이션 보안 취약점 스캐너. CI 파이프라인에 통합 가능.', url: 'https://www.zaproxy.org' },
  { stageId: 'performance-security', name: 'Snyk MCP', category: 'mcp', description: '의존성 취약점 및 코드 보안 이슈를 MCP로 조회해 AI가 우선순위와 패치 방법을 제안.', url: 'https://snyk.io' },
  { stageId: 'performance-security', name: 'Lighthouse CI', category: 'agent', description: '웹 성능/접근성/SEO 지표를 자동 측정하고 회귀를 감지.', url: 'https://github.com/GoogleChrome/lighthouse-ci' },

  // 7. 배포/모니터링
  { stageId: 'deployment-monitoring', name: 'GitHub Actions', category: 'platform', description: 'Git 저장소 기반 CI/CD 파이프라인 자동화.', url: 'https://github.com/features/actions' },
  { stageId: 'deployment-monitoring', name: 'Render/Vercel 배포 자동화', category: 'platform', description: 'Git push 트리거 기반 자동 빌드·배포. 롤백 및 프리뷰 환경 제공.', url: 'https://render.com' },
  { stageId: 'deployment-monitoring', name: 'Sentry MCP', category: 'mcp', description: '배포 후 발생하는 런타임 오류를 MCP로 조회해 AI가 원인 분석과 수정안을 제안.', url: 'https://sentry.io' },
  { stageId: 'deployment-monitoring', name: 'Datadog/Grafana', category: 'platform', description: '인프라·애플리케이션 지표 모니터링 및 이상 탐지 알림.', url: 'https://www.datadoghq.com' },
];

function seed() {
  const db = getDB();

  db.stages = STAGES;

  // 기존 tools 의 id/weight/feedback 카운트는 보존하면서 신규 항목만 추가
  const existingByKey = new Map(db.tools.map(t => [`${t.stageId}::${t.name}`, t]));
  const merged = [];
  for (const t of TOOLS) {
    const key = `${t.stageId}::${t.name}`;
    const existing = existingByKey.get(key);
    if (existing) {
      merged.push({ ...existing, ...t, id: existing.id, weight: existing.weight, upvotes: existing.upvotes, downvotes: existing.downvotes });
      existingByKey.delete(key);
    } else {
      merged.push({
        id: crypto.randomUUID(),
        ...t,
        weight: 1.0,
        upvotes: 0,
        downvotes: 0,
        createdAt: new Date().toISOString(),
      });
    }
  }
  // 시드에 없지만 관리자가 수동 추가한 도구는 유지
  for (const remaining of existingByKey.values()) {
    merged.push(remaining);
  }

  db.tools = merged;
  persist();
  console.log(`[seed] stages: ${db.stages.length}개, tools: ${db.tools.length}개 저장 완료`);
}

if (require.main === module) {
  seed();
}

module.exports = { seed, STAGES, TOOLS };
