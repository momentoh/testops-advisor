// 임의 URL 성능 점검용 k6 스크립트.
// 관리자 대시보드의 "웹사이트 검사" 폼에서 입력받은 URL(TARGET_URL 환경변수)을 대상으로
// 짧은 부하를 가해 응답 속도/실패율을 측정한다.
import http from 'k6/http';
import { check, sleep } from 'k6';

const TARGET_URL = __ENV.TARGET_URL;

export const options = {
  scenarios: {
    smoke: {
      executor: 'constant-vus',
      vus: 3,
      duration: '10s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<3000'],
  },
};

export default function () {
  if (!TARGET_URL) {
    throw new Error('TARGET_URL 환경변수가 설정되지 않았습니다.');
  }
  const res = http.get(TARGET_URL);
  check(res, {
    '200번대 응답': (r) => r.status >= 200 && r.status < 400,
    '3초 이내 응답': (r) => r.timings.duration < 3000,
  });
  sleep(1);
}
