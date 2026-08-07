import { KNOWLEDGE_STATUS, createKnowledgeResult } from './contracts.js';

const AUTHORITY_WEIGHT = Object.freeze({ authoritative: 4, live: 3, verified: 2, supplemental: 1 });

export const resolveKnowledgeConsistency = (results = []) => {
  const factGroups = new Map();
  for (const result of results) {
    for (const fact of result?.facts || []) {
      const key = `${String(fact.key || '')}:${String(fact.subjectId || '')}`;
      if (!factGroups.has(key)) factGroups.set(key, []);
      factGroups.get(key).push({ ...fact, provider: result.provider, authority: result.authority, observedAt: fact.observedAt || result.observedAt });
    }
  }
  const facts = [];
  const conflicts = [];
  for (const [key, candidates] of factGroups) {
    candidates.sort((left, right) => (
      (AUTHORITY_WEIGHT[right.authority] || 0) - (AUTHORITY_WEIGHT[left.authority] || 0)
      || Date.parse(right.observedAt || 0) - Date.parse(left.observedAt || 0)
    ));
    const winner = candidates[0];
    const different = candidates.filter((candidate) => JSON.stringify(candidate.value) !== JSON.stringify(winner.value));
    if (different.length) conflicts.push({ key, selected: winner, alternatives: different });
    facts.push(winner);
  }
  return createKnowledgeResult({
    provider: 'consistency-resolver',
    domain: 'resolved',
    authority: 'authoritative',
    status: conflicts.length ? KNOWLEDGE_STATUS.CONFLICT : KNOWLEDGE_STATUS.OK,
    facts,
    conflicts,
    completeness: results.some((result) => result.completeness === 'partial') ? 'partial' : 'complete'
  });
};

export const composeKnowledgeContext = (results = [], characterBudget = 7_000) => {
  const usable = results.filter((result) => result.status === KNOWLEDGE_STATUS.OK && result.context);
  const failures = results.filter((result) => result.status === KNOWLEDGE_STATUS.UNAVAILABLE);
  const sections = [];
  let used = 0;
  for (const result of usable.sort((left, right) => (AUTHORITY_WEIGHT[right.authority] || 0) - (AUTHORITY_WEIGHT[left.authority] || 0))) {
    const header = `[Quelle: ${result.provider} · Stand: ${result.observedAt} · ${result.completeness}]`;
    const block = `${header}\n${result.context}`;
    if (sections.length && used + block.length + 2 > characterBudget) continue;
    sections.push(block);
    used += block.length + 2;
  }
  if (failures.length) {
    const notice = `NICHT VERFÜGBARE DATENQUELLEN: ${failures.map((item) => item.provider).join(', ')}. Fehlende Werte nicht erraten.`;
    if (used + notice.length + 2 <= characterBudget) sections.push(notice);
  }
  return sections.join('\n\n');
};

