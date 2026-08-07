import {
  KNOWLEDGE_STATUS,
  createKnowledgeResult,
  emptyKnowledgeResult,
  unavailableKnowledgeResult
} from './contracts.js';

const withTimeout = async (operation, timeoutMs, provider) => {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`${provider} hat das Zeitlimit überschritten.`);
      error.name = 'AbortError';
      controller.abort(error);
      reject(error);
    }, timeoutMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([operation(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
};

const normalizeProviderValue = ({ definition, value, durationMs }) => {
  if (value && typeof value === 'object' && value.provider && value.status) {
    return createKnowledgeResult({ ...value, durationMs });
  }
  const context = String(value || '').trim();
  if (!context) return emptyKnowledgeResult({ provider: definition.id, domain: definition.domain, durationMs });
  return createKnowledgeResult({
    provider: definition.id,
    domain: definition.domain,
    authority: definition.authority,
    visibility: definition.visibility,
    completeness: definition.completeness || 'complete',
    context,
    durationMs
  });
};

export class KnowledgeProviderRegistry {
  #providers = new Map();

  register(definition) {
    const id = String(definition?.id || '').trim();
    if (!id || typeof definition?.load !== 'function') throw new TypeError('Ein Knowledge-Provider benötigt ID und load().');
    if (this.#providers.has(id)) throw new Error(`Knowledge-Provider doppelt registriert: ${id}`);
    this.#providers.set(id, Object.freeze({
      domain: 'general',
      authority: 'supplemental',
      visibility: 'public',
      timeoutMs: 8_000,
      enabled: true,
      ...definition,
      id
    }));
    return this;
  }

  list() {
    return [...this.#providers.values()].map(({ load, ...definition }) => ({ ...definition }));
  }

  async execute({ providerIds = [], context = {}, requestId = '', onResult = null } = {}) {
    const selected = providerIds.length
      ? providerIds.map((id) => this.#providers.get(String(id))).filter(Boolean)
      : [...this.#providers.values()];
    const results = await Promise.all(selected.map(async (definition) => {
      if (definition.enabled === false || (typeof definition.enabled === 'function' && !definition.enabled(context))) {
        return emptyKnowledgeResult({ provider: definition.id, domain: definition.domain });
      }
      const startedAt = Date.now();
      let result;
      try {
        const value = await withTimeout(
          (signal) => definition.load({ ...context, signal, requestId }),
          Math.max(250, Number(definition.timeoutMs) || 8_000),
          definition.id
        );
        result = normalizeProviderValue({ definition, value, durationMs: Date.now() - startedAt });
      } catch (error) {
        result = unavailableKnowledgeResult({
          provider: definition.id,
          domain: definition.domain,
          error: error?.message || error,
          durationMs: Date.now() - startedAt
        });
      }
      onResult?.(result);
      return result;
    }));
    return {
      requestId,
      results,
      available: results.filter((result) => result.status === KNOWLEDGE_STATUS.OK),
      unavailable: results.filter((result) => result.status === KNOWLEDGE_STATUS.UNAVAILABLE),
      conflicts: results.flatMap((result) => result.conflicts || [])
    };
  }
}

export const createKnowledgeProviderRegistry = (definitions = []) => {
  const registry = new KnowledgeProviderRegistry();
  for (const definition of definitions) registry.register(definition);
  return registry;
};
