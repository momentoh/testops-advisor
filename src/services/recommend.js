'use strict';
/**
 * 추천 로직 + 피드백 기반 가중치 학습
 *
 * 학습 방식(사용자 선택: "사용자 피드백 축적형"):
 *  - LLM 재학습이 아니라, 도구별 weight(가중치)를 DB에 누적된 피드백으로 조정하는 방식.
 *  - 좋아요(up) 1건 = weight += LEARNING_RATE * (1 - weight/MAX_WEIGHT) 형태로 점증
 *  - 싫어요(down) 1건 = weight -= LEARNING_RATE * weight 형태로 감쇠
 *  - 베이지안 평균(Wilson score 유사)으로 "신뢰도 있는 추천 점수"를 별도 계산해 정렬에 사용
 *    -> 피드백이 거의 없는 신규 도구가 소수의 좋아요만으로 1위를 독식하지 않도록 방지
 */
const { getDB, persist } = require('./../db/store');

const LEARNING_RATE = 0.15;
const MIN_WEIGHT = 0.05;
const MAX_WEIGHT = 3.0;

function getStages() {
  const db = getDB();
  return [...db.stages].sort((a, b) => a.order - b.order);
}

function getStageById(stageId) {
  return getStages().find(s => s.id === stageId) || null;
}

/**
 * 신뢰도 점수 계산 (Wilson score lower bound 근사)
 * up, down: 누적 피드백 수. weight: 수동/학습 가중치 배수.
 */
function confidenceScore(upvotes, downvotes) {
  const n = upvotes + downvotes;
  if (n === 0) return 0.5; // 피드백 없으면 중립값
  const p = upvotes / n;
  const z = 1.96; // 95% 신뢰수준
  const denominator = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
  return (centre - margin) / denominator;
}

/**
 * 최종 추천 점수 = 신뢰도 점수(0~1) * 가중치(weight) 를 정규화
 */
function computeScore(tool) {
  const conf = confidenceScore(tool.upvotes || 0, tool.downvotes || 0);
  const weight = typeof tool.weight === 'number' ? tool.weight : 1.0;
  return conf * weight;
}

function recommendForStage(stageId, { limit = 10, category = null } = {}) {
  const db = getDB();
  let tools = db.tools.filter(t => t.stageId === stageId);
  if (category) tools = tools.filter(t => t.category === category);

  const scored = tools.map(t => ({
    ...t,
    score: computeScore(t),
    confidence: confidenceScore(t.upvotes || 0, t.downvotes || 0),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

function allToolsWithScore() {
  const db = getDB();
  return db.tools
    .map(t => ({ ...t, score: computeScore(t), confidence: confidenceScore(t.upvotes || 0, t.downvotes || 0) }))
    .sort((a, b) => b.score - a.score);
}

function getToolById(toolId) {
  const db = getDB();
  return db.tools.find(t => t.id === toolId) || null;
}

/**
 * 피드백 기록 + 가중치 즉시 업데이트 (온라인 학습)
 * vote: 'up' | 'down'
 */
function recordFeedback({ toolId, stageId, vote, comment = '', userLabel = 'anonymous' }) {
  const db = getDB();
  const tool = db.tools.find(t => t.id === toolId);
  if (!tool) throw new Error('존재하지 않는 도구입니다.');

  if (vote === 'up') {
    tool.upvotes = (tool.upvotes || 0) + 1;
    tool.weight = Math.min(MAX_WEIGHT, (tool.weight || 1.0) + LEARNING_RATE * (1 - (tool.weight || 1.0) / MAX_WEIGHT));
  } else if (vote === 'down') {
    tool.downvotes = (tool.downvotes || 0) + 1;
    tool.weight = Math.max(MIN_WEIGHT, (tool.weight || 1.0) - LEARNING_RATE * (tool.weight || 1.0));
  } else {
    throw new Error('vote 값은 up 또는 down 이어야 합니다.');
  }

  const entry = {
    id: require('crypto').randomUUID(),
    toolId,
    stageId: stageId || tool.stageId,
    vote,
    comment,
    userLabel,
    createdAt: new Date().toISOString(),
    weightAfter: tool.weight,
  };
  db.feedback.push(entry);
  persist();
  return { tool, entry };
}

function feedbackStats() {
  const db = getDB();
  const totalFeedback = db.feedback.length;
  const up = db.feedback.filter(f => f.vote === 'up').length;
  const down = db.feedback.filter(f => f.vote === 'down').length;

  const perStage = getStages().map(stage => {
    const stageFeedback = db.feedback.filter(f => f.stageId === stage.id);
    return {
      stageId: stage.id,
      stageName: stage.name,
      total: stageFeedback.length,
      up: stageFeedback.filter(f => f.vote === 'up').length,
      down: stageFeedback.filter(f => f.vote === 'down').length,
    };
  });

  const recentFeedback = [...db.feedback]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 20)
    .map(f => {
      const tool = getToolById(f.toolId);
      return { ...f, toolName: tool ? tool.name : '(삭제된 도구)' };
    });

  return { totalFeedback, up, down, perStage, recentFeedback };
}

module.exports = {
  getStages,
  getStageById,
  recommendForStage,
  allToolsWithScore,
  getToolById,
  recordFeedback,
  feedbackStats,
  confidenceScore,
  computeScore,
};
