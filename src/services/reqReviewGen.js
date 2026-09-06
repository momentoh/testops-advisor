'use strict';
/**
 * 요구사양서(SRS) 리뷰 서비스.
 *
 * 사용자가 업로드한 요구사양서에서 추출한 텍스트를 Claude API에 전달해,
 * 아래 5개 국제/국내 표준을 기준으로 리뷰 결과를 도출한다.
 *
 *  - ISO/IEC/IEEE 29148 (요구공학): 요구사항이 갖춰야 할 특성(완전성, 명확성, 검증가능성,
 *    일관성, 추적가능성, 필요성, 실현가능성 등)을 기준으로 개별 요구사항을 평가
 *  - IEEE 830 (SRS 권고사항, 29148의 전신): 좋은 SRS의 특성(정확성, 모호하지 않음, 완전성,
 *    일관성, 순위/중요도 표시, 검증가능성, 수정용이성, 추적가능성) 관점에서 문서 전체 구조를 점검
 *  - ISO/IEC 25030 (품질요구사항): 비기능 품질요구사항이 ISO/IEC 25010의 8대 품질특성을
 *    충분히 포괄하고 있는지, 측정 가능한 형태로 기술되어 있는지 점검
 *  - ISO/IEC 25010 (SQuaRE 품질모델): 문서에 명시된(또는 누락된) 비기능 요구사항을
 *    8대 품질특성 관점에서 분류하고 공백(gap)을 식별
 *  - ISO/IEC 12207 (SW 생명주기 프로세스): 요구사항이 이후 설계/구현/테스트/인수 단계로
 *    이어지는 데 필요한 프로세스 관점의 누락(이해관계자 식별, 인수기준, 변경관리 등)을 점검
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

const SYSTEM_PROMPT = `당신은 ISO/IEC/IEEE 29148, IEEE 830, ISO/IEC 25030, ISO/IEC 25010, ISO/IEC 12207 표준에 정통한
요구공학(Requirements Engineering) 및 소프트웨어 품질보증(QA) 전문가입니다.
사용자가 제공하는 요구사양서(SRS/요구사항 명세서)를 분석해, 아래 5개 표준을 기준으로 리뷰 결과를 도출하세요.

[적용 표준 및 리뷰 관점]
1. ISO/IEC/IEEE 29148 (요구공학): 개별 요구사항이 아래 특성을 갖추었는지 평가합니다.
   완전성(Complete), 명확성(Unambiguous), 검증가능성(Verifiable), 일관성(Consistent),
   추적가능성(Traceable), 필요성(Necessary), 실현가능성(Feasible), 독립성(Singular, 하나의 요구사항에 하나의 요건만 포함).

2. IEEE 830 (SRS 권고사항, 29148의 전신 표준): 문서 전체 구조 관점에서 아래를 점검합니다.
   정확성(Correct), 모호하지 않음(Unambiguous), 완전성(Complete), 일관성(Consistent),
   중요도/우선순위 표시 여부(Ranked), 검증가능성(Verifiable), 수정용이성(Modifiable), 추적가능성(Traceable).

3. ISO/IEC 25030 (품질요구사항 명세): 비기능(품질) 요구사항이 측정 가능한 지표와 함께
   구체적으로 기술되어 있는지, 품질요구사항이 충분히 다뤄지고 있는지 점검합니다.

4. ISO/IEC 25010 (SQuaRE 제품 품질 모델): 문서에 기술된(또는 누락된) 비기능 요구사항을
   아래 8대 품질특성 관점에서 분류하고, 다뤄지지 않은 품질특성(공백)을 식별합니다.
   기능적합성, 성능효율성, 호환성, 사용성, 신뢰성, 보안성, 유지보수성, 이식성.

5. ISO/IEC 12207 (소프트웨어 생명주기 프로세스): 이 요구사항 문서가 이후 설계·구현·테스트·인수
   단계로 원활히 이어지는 데 필요한 프로세스 요소(이해관계자 식별, 인수기준, 변경관리 절차,
   요구사항 우선순위/버전 관리 등)가 누락되지 않았는지 점검합니다.

[출력 형식]
반드시 아래 JSON 형식으로만 응답하세요. 다른 설명 텍스트는 포함하지 마세요.

{
  "summary": "문서의 목적과 범위, 전반적인 품질 수준을 2~3문장으로 요약",
  "overallScore": "상 | 중 | 하 (문서의 전반적 완성도에 대한 총평 등급)",
  "standardScores": [
    { "standard": "ISO/IEC/IEEE 29148", "score": "상 | 중 | 하", "comment": "이 표준 관점에서의 총평 1~2문장" },
    { "standard": "IEEE 830", "score": "상 | 중 | 하", "comment": "..." },
    { "standard": "ISO/IEC 25030", "score": "상 | 중 | 하", "comment": "..." },
    { "standard": "ISO/IEC 25010", "score": "상 | 중 | 하", "comment": "..." },
    { "standard": "ISO/IEC 12207", "score": "상 | 중 | 하", "comment": "..." }
  ],
  "findings": [
    {
      "id": "F-001",
      "standard": "이 발견사항과 가장 관련 깊은 표준 하나 (예: ISO/IEC/IEEE 29148)",
      "category": "결함 유형 (예: 모호한 표현, 검증 불가능한 요구사항, 품질요구사항 누락, 추적성 부족, 이해관계자 식별 누락 등)",
      "severity": "높음 | 중간 | 낮음",
      "location": "문서 내 해당 위치(조항 번호, 섹션명, 또는 원문 인용) - 특정하기 어려우면 '문서 전반'",
      "issue": "구체적으로 무엇이 문제인지 설명",
      "recommendation": "어떻게 개선해야 하는지 구체적 제안"
    }
  ],
  "missingQualityCharacteristics": ["문서에 전혀 다뤄지지 않은 ISO/IEC 25010 품질특성 목록 (있는 경우만)"],
  "strengths": ["문서에서 잘 작성된 부분 1~3가지"]
}

문서 내용이 짧거나 불충분하더라도 파악 가능한 범위 내에서 최대한 성실하게 리뷰하세요.
findings는 문서의 분량과 완성도에 비례해 최소 3개에서 최대 20개까지 도출하세요.
실제로 발견되지 않은 문제를 억지로 만들어내지 말고, 문서가 우수하다면 findings 개수가 적어도 됩니다.`;

function callClaude(userText, fileFormat) {
  return new Promise((resolve, reject) => {
    if (!isConfigured()) {
      return reject(new Error('ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.'));
    }

    const userMessage = `아래는 업로드된 요구사양서(${fileFormat} 형식)에서 추출한 내용입니다. 이 내용을 분석해 요구사항 리뷰 결과를 생성해 주세요.\n\n---\n${userText}\n---`;

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
 * 요구사양서 텍스트로부터 리뷰 결과를 생성한다.
 * 반환: { summary, overallScore, standardScores: [...], findings: [...], missingQualityCharacteristics: [...], strengths: [...] }
 */
async function reviewRequirements(specText, fileFormat) {
  if (!specText || !specText.trim()) {
    throw new Error('문서에서 추출된 텍스트가 없습니다.');
  }
  const response = await callClaude(specText, fileFormat);
  const textBlock = (response.content || []).find((b) => b.type === 'text');
  if (!textBlock) throw new Error('Claude 응답에 텍스트 콘텐츠가 없습니다.');
  const result = extractJson(textBlock.text);
  if (!Array.isArray(result.findings)) {
    throw new Error('생성된 결과에 findings 배열이 없습니다.');
  }
  return result;
}

module.exports = { isConfigured, reviewRequirements, MODEL };
