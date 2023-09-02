const fs = require('fs-extra');
const path = require('path');
const DATA_PATH = path.join(__dirname, '../data/data.json');


let structuredKB = null;

async function loadKnowledgeBase() {
  if (structuredKB) return structuredKB;
  const raw = await fs.readFile(DATA_PATH, 'utf8');
  structuredKB = JSON.parse(raw);
  return structuredKB;
}

async function searchKB(query) {
  const kb = await loadKnowledgeBase();
  query = query.toLowerCase();
  // Simple semantic search: match question or answer text
  const results = kb.filter(item =>
    item.question.toLowerCase().includes(query) ||
    item.answer.toLowerCase().includes(query)
  );
  // Sort by best match (question first)
  return results.sort((a, b) => {
    const aScore = a.question.toLowerCase().includes(query) ? 2 : a.answer.toLowerCase().includes(query) ? 1 : 0;
    const bScore = b.question.toLowerCase().includes(query) ? 2 : b.answer.toLowerCase().includes(query) ? 1 : 0;
    return bScore - aScore;
  });
}

module.exports = { loadKnowledgeBase, searchKB };
