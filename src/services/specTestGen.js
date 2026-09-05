'use strict';
/**
 * 명세기반(Specification-based) 블랙박스 테스트케이스 자동 생성 서비스.
 *
 * 사용자가 업로드한 명세 문서(엑셀/워드/PDF/텍스트)에서 추출한 텍스트를 Claude API에 전달해,
 * 아래 3개 국제 표준을 준수하는 테스트케이스를 생성한다.
 *
 *  - ISO/IEC 25010 (SQuaRE 품질모델): 기능적합성, 성능효율성, 호환성, 사용성, 신뢰성,
 *    보안성, 유지보수성, 이식성 8대 품질특성을 기준으로 테스트 관점을 분류
 *  - ISO/IEC 25023 (품질측정): 각 품질특성별로 측정 가능한 지표(Quality Measure)를 정의해
 *    테스트케이스의 "기대 결과"를 정량적으로 서술하도록 유도
 *  - ISO/IEC/IEEE 29119 (소프트웨어 테스팅): Part 4의 명세기반 테스트 설계기법
 *    (동등분할 Equivalence Partitioning, 경계값분석 Boundary Value Analysis,
 *     결정테이블 Decision Table, 상태전이 State Transition 등)을 적용해 테스트케이스를 도출
 *
 * 필요한 환경변수:
 *  - ANTHROPIC_API_KEY: Anthropic API 키 (console.anthropic.com에서 발급)
 *  - ANTHROPIC_MODEL: (선택) 사용할 모델명, 기본값 claude-sonnet-4-5
 */
const https = require('https');

const API_HOST = 'api.anthropic.com';
const API_KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
const ANTHROPIC_VERSION = '2023-06-01';

function isConfigured() {
  return Boolean(API_KEY);
}

const SYSTEM_PROMPT = `당신은 ISO/IEC 25010, ISO/IEC 25023, ISO/IEC/IEEE 29119 표준에 정통한 소프트웨어 품질보증(QA) 전문가입니다.
사용자가 제공하는 요구사항/기능 명세 문서를 분석해, 아래 규칙에 따라 "명세기반(Specification-based) 블랙박스 테스트케이스"를 생성하세요.

[적용 표준]
1. ISO/IEC 25010 (제품 품질 모델): 각 테스트케이스는 아래 8개 품질특성 중 하나 이상에 매핑되어야 합니다.
   - 기능적합성(Functional Suitability): 완전성, 정확성, 적절성
   - 성능효율성(Performance Efficiency): 시간반응성, 자원활용성, 용량
   - 호환성(Compatibility): 공존성, 상호운용성
   - 사용성(Usability): 인지적 적절성, 학습성, 운용성, 접근성
   - 신뢰성(Reliability): 성숙성, 가용성, 장애허용성, 회복성
   - 보안성(Security): 기밀성, 무결성, 부인방지성, 책임성, 인증성
   - 유지보수성(Maintainability): 모듈성, 재사용성, 분석성, 수정성, 시험성
   - 이식성(Portability): 적응성, 설치성, 대체성

2. ISO/IEC 25023 (품질 측정): 각 테스트케이스의 "기대 결과"는 가능한 한 정량적 측정지표로 서술하세요.
   (예: "응답 시간 3초 이내", "동시 사용자 100명 처리", "오류 발생률 0.1% 미만" 등)

3. ISO/IEC/IEEE 29119-4 (테스트 설계 기법): 각 테스트케이스는 아래 기법 중 하나를 명시적으로 적용해 도출하세요.
   - 동등분할(Equivalence Partitioning): 입력값을 유효/무효 클래스로 나누어 대표값 선정
   - 경계값분석(Boundary Value Analysis): 입력 범위의 경계(최솟값, 최댓값, 경계±1) 검증
   - 결정테이블(Decision Table): 여러 조건의 조합에 따른 결과를 표로 정리
   - 상태전이(State Transition): 시스템 상태 변화와 전이 조건 검증
   - 유스케이스(Use Case Testing): 사용자 시나리오 흐름 기반 검증

[출력 형식]
반드시 아래 JSON 형식으로만 응답하세요. 다른 설명 텍스트는 포함하지 마세요.

{
  "summary": "문서에서 파악한 핵심 요구사항을 2~3문장으로 요약",
  "testCases": [
    {
      "id": "TC-001",
      "title": "테스트케이스 제목",
      "requirement": "이 테스트케이스가 검증하는 원문 요구사항(문서에서 인용 또는 요약)",
      "iso25010": "매핑되는 품질특성 (예: 기능적합성 - 정확성)",
      "designTechnique": "적용한 29119 설계기법 (예: 경계값분석)",
      "preconditions": "사전조건",
      "steps": ["절차 1", "절차 2", "..."],
      "testData": "사용할 테스트 데이터 (동등분할/경계값의 경우 구체적 값 명시)",
      "expectedResult": "기대 결과 (25023 기준 가능한 한 정량적으로)",
      "priority": "높음 | 중간 | 낮음"
    }
  ]
}

문서 내용이 불충분하거나 모호한 경우, 합리적으로 추정 가능한 범위 내에서 테스트케이스를 생성하고
requirement 필드에 "(명세 문서에 명시되지 않아 일반적 기준으로 추정)"라고 표기하세요.
테스트케이스는 문서의 요구사항 개수와 복잡도에 비례해 최소 5개에서 최대 20개까지 생성하세요.`;

function callClaude(userText, fileFormat) {
  return new Promise((resolve, reject) => {
    if (!isConfigured()) {
      return reject(new Error('ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.'));
    }

    const userMessage = `아래는 업로드된 명세 문서(${fileFormat} 형식)에서 추출한 내용입니다. 이 내용을 분석해 명세기반 블랙박스 테스트케이스를 생성해 주세요.\n\n---\n${userText}\n---`;

    const payload = JSON.stringify({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    const req = https.request(
      {
        hostname: API_HOST,
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY,
          'anthropic-version': ANTHROPIC_VERSION,
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          let parsed = null;
          try {
            parsed = data ? JSON.parse(data) : null;
          } catch (e) {
            return reject(new Error('Claude API 응답을 파싱할 수 없습니다: ' + data.slice(0, 300)));
          }
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            const msg = (parsed && parsed.error && parsed.error.message) || data || res.statusMessage;
            reject(new Error(`Claude API 오류 (${res.statusCode}): ${msg}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/** Claude 응답 텍스트에서 JSON 블록만 추출한다 (코드펜스가 섞여 나오는 경우 대비). */
function extractJson(text) {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenceMatch ? fenceMatch[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('응답에서 JSON 형식을 찾을 수 없습니다.');
  return JSON.parse(candidate.slice(start, end + 1));
}

/**
 * 명세 문서 텍스트로부터 테스트케이스를 생성한다.
 * 반환: { summary, testCases: [...] }
 */
async function generateTestCases(specText, fileFormat) {
  if (!specText || !specText.trim()) {
    throw new Error('문서에서 추출된 텍스트가 없습니다.');
  }
  const response = await callClaude(specText, fileFormat);
  const textBlock = (response.content || []).find((b) => b.type === 'text');
  if (!textBlock) throw new Error('Claude 응답에 텍스트 콘텐츠가 없습니다.');
  const result = extractJson(textBlock.text);
  if (!Array.isArray(result.testCases)) {
    throw new Error('생성된 결과에 testCases 배열이 없습니다.');
  }
  return result;
}

module.exports = { isConfigured, generateTestCases, MODEL };
