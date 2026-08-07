export const KNOWLEDGE_STATUS = Object.freeze({
  OK: 'ok',
  EMPTY: 'empty',
  UNAVAILABLE: 'unavailable',
  FORBIDDEN: 'forbidden',
  CONFLICT: 'conflict'
});

export const KNOWLEDGE_VISIBILITY = Object.freeze({
  PUBLIC: 'public',
  SELF: 'self',
  STAFF: 'staff',
  OWNER: 'owner',
  INTERNAL: 'internal'
});

const safeArray = (value) => Array.isArray(value) ? value : [];

export const createKnowledgeResult = ({
  provider,
  domain = 'general',
  status = KNOWLEDGE_STATUS.OK,
  authority = 'supplemental',
  visibility = KNOWLEDGE_VISIBILITY.PUBLIC,
  observedAt = new Date().toISOString(),
  revision = null,
  completeness = 'complete',
  confidence = 1,
  facts = [],
  evidence = [],
  context = '',
  warnings = [],
  conflicts = [],
  error = null,
  durationMs = 0
} = {}) => Object.freeze({
  provider: String(provider || 'unknown'),
  domain: String(domain || 'general'),
  status,
  authority,
  visibility,
  observedAt,
  revision,
  completeness,
  confidence: Math.min(1, Math.max(0, Number(confidence) || 0)),
  facts: safeArray(facts),
  evidence: safeArray(evidence),
  context: String(context || ''),
  warnings: safeArray(warnings),
  conflicts: safeArray(conflicts),
  error: error ? String(error).slice(0, 500) : null,
  durationMs: Math.max(0, Number(durationMs) || 0)
});

export const unavailableKnowledgeResult = ({ provider, domain, error, durationMs = 0 } = {}) => createKnowledgeResult({
  provider,
  domain,
  status: KNOWLEDGE_STATUS.UNAVAILABLE,
  completeness: 'unavailable',
  confidence: 0,
  error,
  durationMs
});

export const emptyKnowledgeResult = ({ provider, domain, observedAt, durationMs = 0 } = {}) => createKnowledgeResult({
  provider,
  domain,
  status: KNOWLEDGE_STATUS.EMPTY,
  observedAt,
  confidence: 1,
  durationMs
});

