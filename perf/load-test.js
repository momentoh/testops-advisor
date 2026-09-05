// k6 성능 테스트 스크립트
// 대상: 성능/보안 테스트 단계 1순위 도구인 k6 를 이용한 부하 테스트.
// 실행: k6 run perf/load-test.js  (BASE_URL 환경변수로 대상 서버 지정, 기본 http://127.0.0.1:3000)
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:3000';

export const options = {
  scenarios: {
    smoke: {
      executor: 'constant-vus',
      vus: 5,
      duration: '15s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],   // 실패율 1% 미만
    http_req_duration: ['p(95)<500'], // 95%가 500ms 이내 응답
  },
};

export default function () {
  const home = http.get(`${BASE_URL}/`);
  check(home, {
    '홈페이지 200 응답': (r) => r.status === 200,
    '홈페이지에 7단계 텍스트 포함': (r) => r.body.includes('요구사항 분석'),
  });

  const stage = http.get(`${BASE_URL}/stages/unit-testing`);
  check(stage, {
    '단계 페이지 200 응답': (r) => r.status === 200,
  });

  const health = http.get(`${BASE_URL}/healthz`);
  check(health, {
    '헬스체크 200 응답': (r) => r.status === 200,
  });

  sleep(1);
}
