'use strict';
const crypto = require('crypto');
const { getDB, persist } = require('../db/store');

function createTool({ stageId, name, category, description, url }) {
  const db = getDB();
  if (!stageId || !name) throw new Error('stageId와 name은 필수입니다.');
  const tool = {
    id: crypto.randomUUID(),
    stageId,
    name,
    category: category || 'agent',
    description: description || '',
    url: url || '',
    weight: 1.0,
    upvotes: 0,
    downvotes: 0,
    createdAt: new Date().toISOString(),
  };
  db.tools.push(tool);
  persist();
  return tool;
}

function updateTool(id, patch) {
  const db = getDB();
  const tool = db.tools.find(t => t.id === id);
  if (!tool) throw new Error('존재하지 않는 도구입니다.');
  const allowed = ['name', 'category', 'description', 'url', 'stageId', 'weight'];
  for (const key of allowed) {
    if (patch[key] !== undefined && patch[key] !== '') tool[key] = patch[key];
  }
  persist();
  return tool;
}

function deleteTool(id) {
  const db = getDB();
  const before = db.tools.length;
  db.tools = db.tools.filter(t => t.id !== id);
  persist();
  return before !== db.tools.length;
}

module.exports = { createTool, updateTool, deleteTool };
