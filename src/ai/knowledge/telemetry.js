const traces = new Map();
const MAX_TRACES = 500;

export const createAiTrace = ({ requestId, guildId, channelId, userId } = {}) => {
  const trace = {
    requestId: String(requestId || `AI-${Date.now().toString(36).toUpperCase()}`),
    guildId: String(guildId || ''),
    channelId: String(channelId || ''),
    userId: String(userId || ''),
    startedAt: new Date().toISOString(),
    route: null,
    providers: [],
    conflicts: [],
    stages: [],
    result: null
  };
  traces.set(trace.requestId, trace);
  while (traces.size > MAX_TRACES) traces.delete(traces.keys().next().value);
  return trace;
};

export const recordAiTraceStage = (trace, stage, data = {}) => {
  if (!trace) return;
  trace.stages.push({ stage, at: new Date().toISOString(), ...data });
};

export const finishAiTrace = (trace, result = {}) => {
  if (!trace) return;
  trace.finishedAt = new Date().toISOString();
  trace.durationMs = Date.parse(trace.finishedAt) - Date.parse(trace.startedAt);
  trace.result = { ...result };
};

export const getAiTrace = (requestId) => traces.get(String(requestId || '')) || null;
export const getAiTraceSnapshot = () => [...traces.values()].map((trace) => ({ ...trace }));

