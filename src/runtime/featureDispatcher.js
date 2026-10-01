const defaultTimeout = (featureId, hook) => {
  if (hook === 'onClientReady') return 300_000;
  return 45_000;
};

const contextMeta = (featureId, hook, context = {}) => ({
  featureId,
  hook,
  guildId: context?.guild?.id || context?.message?.guildId || context?.interaction?.guildId || '',
  channelId: context?.message?.channelId
    || context?.interaction?.channelId
    || context?.thread?.id
    || context?.newThread?.id
    || context?.oldState?.channelId
    || context?.newState?.channelId
    || '',
  command: context?.interaction?.commandName || ''
});

// Pro Hook statt pro Feature serialisieren: Eine langlaufende Operation eines
// Hooks (z.B. onClientReady beim Start, ein API-Call in onAnyInteraction) darf
// die Interaktions-Antworten desselben Features nicht blockieren – sonst
// verpasst die nächste Interaktion das 3-Sekunden-Antwortfenster von Discord.
// Innerhalb desselben Hooks bleibt die Reihenfolge erhalten (State-Sicherheit).
const queueKeyFor = (featureId, hook, context = {}) => {
  const guildId = context?.guild?.id
    || context?.message?.guildId
    || context?.interaction?.guildId
    || context?.thread?.guildId
    || context?.newThread?.guildId
    || context?.oldState?.guild?.id
    || context?.newState?.guild?.id
    || '';
  return `${featureId}:${hook}:${guildId || 'global'}`;
};

export function createFeatureDispatcher({
  features = [],
  runOperation,
  recordError = () => {},
  timeoutFor = defaultTimeout
} = {}) {
  if (typeof runOperation !== 'function') throw new TypeError('runOperation ist für den Feature-Dispatcher erforderlich.');
  const queues = new Map();
  const stats = new Map();

  const stateFor = (featureId) => {
    if (!stats.has(featureId)) stats.set(featureId, {
      featureId,
      queued: 0,
      running: 0,
      completed: 0,
      failed: 0,
      lastHook: '',
      lastStartedAt: null,
      lastFinishedAt: null,
      lastDurationMs: 0,
      lastError: null
    });
    return stats.get(featureId);
  };

  const schedule = (feature, hook, context) => {
    const featureId = String(feature?.id || 'unknown');
    const handler = feature?.[hook];
    if (typeof handler !== 'function') return null;
    const queueKey = queueKeyFor(featureId, hook, context);
    const state = stateFor(featureId);
    state.queued += 1;
    const previous = queues.get(queueKey) || Promise.resolve();
    const operation = previous.catch(() => {}).then(async () => {
      state.queued = Math.max(0, state.queued - 1);
      state.running += 1;
      state.lastHook = hook;
      state.lastStartedAt = new Date().toISOString();
      state.lastError = null;
      const startedAt = Date.now();
      try {
        const value = await runOperation(
          `${featureId}.${hook}`,
          contextMeta(featureId, hook, context),
          ({ signal } = {}) => handler({ ...context, abortSignal: signal || null }),
          { timeoutMs: timeoutFor(featureId, hook) }
        );
        state.completed += 1;
        return value;
      } catch (error) {
        state.failed += 1;
        state.lastError = String(error?.message || error || 'Unbekannter Modulfehler').slice(0, 300);
        recordError(`${featureId}.${hook}`, error, contextMeta(featureId, hook, context));
        throw error;
      } finally {
        state.running = Math.max(0, state.running - 1);
        state.lastFinishedAt = new Date().toISOString();
        state.lastDurationMs = Date.now() - startedAt;
      }
    });
    queues.set(queueKey, operation);
    operation.finally(() => {
      if (queues.get(queueKey) === operation) queues.delete(queueKey);
    }).catch(() => {});
    return operation;
  };

  return {
    async dispatch(hook, context) {
      const scheduled = features.map((feature) => schedule(feature, hook, context)).filter(Boolean);
      if (!scheduled.length) return { hook, scheduled: 0, completed: 0, failed: 0 };
      const results = await Promise.allSettled(scheduled);
      return {
        hook,
        scheduled: results.length,
        completed: results.filter((result) => result.status === 'fulfilled').length,
        failed: results.filter((result) => result.status === 'rejected').length
      };
    },
    getSnapshot() {
      return {
        measuredAt: new Date().toISOString(),
        activeFeatures: queues.size,
        queuedHandlers: [...stats.values()].reduce((sum, state) => sum + state.queued, 0),
        runningHandlers: [...stats.values()].reduce((sum, state) => sum + state.running, 0),
        features: [...stats.values()].map((state) => ({ ...state }))
      };
    }
  };
}
