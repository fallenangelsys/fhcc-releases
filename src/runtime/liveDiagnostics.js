import os from 'node:os';
import process from 'node:process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { getServerIndexSnapshot } from '../serverIndexStore.js';
import { getBoostSystemIndexStatus } from '../features/boostSystemIndex.js';

const activeOperations = new Map();
const recentOperations = [];
const recentFailures = [];
const MAX_RECENT_OPERATIONS = 80;
const MAX_RECENT_FAILURES = 120;
const counters = { started: 0, completed: 0, failed: 0, overdue: 0 };
const sessionCounters = { started: 0, completed: 0, failed: 0, overdue: 0 };

// Interaktions-Timing-Telemetrie: Wie schnell wurde eine Interaktion bestätigt
// (Discords 3-Sekunden-Frist) und wie lange lief der Handler? Langsame oder
// verspätete Fälle werden einzeln festgehalten, damit Blockaden sichtbar
// werden, bevor Nutzer „Fallen-Heaven hat nicht rechtzeitig reagiert“ melden.
const INTERACTION_LATE_ACK_MS = 2_800; // nahe an Discords 3-Sekunden-Frist
const INTERACTION_SLOW_HANDLER_MS = 2_500;
const MAX_INTERACTION_TIMING_RECENT = 20;
const interactionTiming = {
  started: 0,
  acked: 0,
  unacked: 0,
  lateAcks: 0,
  slowHandlers: 0,
  lastLateAck: null,
  lastSlowHandler: null,
  recent: []
};

// Rate-Limit-Telemetrie (RESTEvents.RateLimited): Erfasst, WELCHER Endpoint
// wie oft von Discords Rate-Limit gebremst wurde und wie lange gewartet wurde.
// Rate-Limits werden korrekt abgewartet (discord.js REST-Retry), aber ohne
// Telemetrie bleibt unsichtbar, WO der Request-Spam entsteht (Punkt 82).
const MAX_RATE_LIMIT_RECENT = 12;
const rateLimits = {
  total: 0,
  global: 0,
  byRoute: new Map(),
  last: null,
  recent: []
};

export const recordRateLimit = (info = {}) => {
  const timeout = Number(info.timeout || info.retryAfter || 0);
  const isGlobal = Boolean(info.global);
  const method = String(info.method || '').toUpperCase() || 'GET';
  const route = String(info.route || info.path || 'unbekannt').slice(0, 120);
  const path = String(info.path || '').slice(0, 160);
  rateLimits.total += 1;
  if (isGlobal) rateLimits.global += 1;
  const entry = rateLimits.byRoute.get(route) || { route, count: 0, totalWaitMs: 0, lastWaitMs: 0, lastAt: null };
  entry.count += 1;
  entry.totalWaitMs += timeout;
  entry.lastWaitMs = timeout;
  entry.lastAt = new Date().toISOString();
  rateLimits.byRoute.set(route, entry);
  rateLimits.last = {
    at: new Date().toISOString(),
    method, route, path,
    timeoutMs: Math.round(timeout),
    global: isGlobal
  };
  rateLimits.recent.unshift(rateLimits.last);
  rateLimits.recent.splice(MAX_RATE_LIMIT_RECENT);
  return rateLimits;
};

export const getRateLimitSnapshot = () => ({
  total: rateLimits.total,
  global: rateLimits.global,
  last: rateLimits.last,
  recent: rateLimits.recent.slice(0, MAX_RATE_LIMIT_RECENT),
  byRoute: [...rateLimits.byRoute.values()]
    .sort((left, right) => right.count - left.count)
    .slice(0, 10)
});

export const recordInteractionTiming = ({ type = 'other', customId = '', ackLatencyMs = null, handlerMs = 0 } = {}) => {
  interactionTiming.started += 1;
  // Nur ein ECHTER Ack-Zeitpunkt zählt als bestätigt: null/undefined bedeutet
  // „kein Ack“, und Number(null) === 0 darf NICHT als 0-ms-Ack durchrutschen.
  if (ackLatencyMs !== null && ackLatencyMs !== undefined && ackLatencyMs !== '' && Number.isFinite(Number(ackLatencyMs))) {
    interactionTiming.acked += 1;
    if (Number(ackLatencyMs) > INTERACTION_LATE_ACK_MS) {
      interactionTiming.lateAcks += 1;
      interactionTiming.lastLateAck = {
        at: new Date().toISOString(),
        type,
        customId: String(customId || '').slice(0, 80),
        ackLatencyMs: Math.round(Number(ackLatencyMs))
      };
    }
  } else {
    interactionTiming.unacked += 1;
  }
  if (Number(handlerMs) > INTERACTION_SLOW_HANDLER_MS) {
    interactionTiming.slowHandlers += 1;
    interactionTiming.lastSlowHandler = {
      at: new Date().toISOString(),
      type,
      customId: String(customId || '').slice(0, 80),
      handlerMs: Math.round(Number(handlerMs))
    };
  }
  interactionTiming.recent.unshift({
    at: new Date().toISOString(),
    type,
    customId: String(customId || '').slice(0, 80),
    ackLatencyMs: (ackLatencyMs !== null && ackLatencyMs !== undefined && ackLatencyMs !== '' && Number.isFinite(Number(ackLatencyMs))) ? Math.round(Number(ackLatencyMs)) : null,
    handlerMs: Math.round(Number(handlerMs) || 0)
  });
  interactionTiming.recent.splice(MAX_INTERACTION_TIMING_RECENT);
  return interactionTiming;
};
const diagnosticsDataDir = path.resolve(String(process.env.FALLEN_HEAVEN_DATA_DIR || '').trim() || path.join(process.cwd(), 'data'));
const diagnosticsHistoryFile = path.join(diagnosticsDataDir, 'diagnostic-history.json');
const diagnosticsTemporaryFile = diagnosticsHistoryFile + '.tmp';
let diagnosticsPersistTimer = null;

const redactDiagnosticText = (value) => String(value || '')
  .replace(/\b(?:mfa\.)?[A-Za-z0-9_-]{15,30}\.[A-Za-z0-9_-]{5,8}\.[A-Za-z0-9_-]{20,50}\b/g, '[DISCORD-TOKEN GESCHÜTZT]')
  .replace(/\b(?:sk|key|token|secret)[-_]?[A-Za-z0-9_-]{20,}\b/gi, '[SECRET GESCHÜTZT]')
  .slice(0, 500);

const normalizeFailure = (entry = {}) => {
  const fallbackTime = new Date().toISOString();
  const firstOccurredAt = entry.firstOccurredAt || entry.startedAt || entry.finishedAt || fallbackTime;
  const lastOccurredAt = entry.lastOccurredAt || entry.finishedAt || entry.startedAt || fallbackTime;
  return {
    ...entry,
    id: String(entry.id || `failure-${Date.now().toString(36)}`),
    name: String(entry.name || 'Runtime-Fehler').slice(0, 160),
    status: 'failed',
    startedAt: entry.startedAt || firstOccurredAt,
    finishedAt: entry.finishedAt || lastOccurredAt,
    firstOccurredAt,
    lastOccurredAt,
    occurrences: Math.max(1, Number(entry.occurrences || 1)),
    meta: entry.meta && typeof entry.meta === 'object' ? entry.meta : {},
    error: redactDiagnosticText(entry.error || 'Unbekannter Fehler')
  };
};

const failureKey = (entry = {}) => [
  String(entry.name || ''),
  String(entry.error || ''),
  String(entry.meta?.featureId || ''),
  String(entry.meta?.hook || ''),
  String(entry.meta?.guildId || ''),
  String(entry.meta?.event || '')
].join('|');

const rememberFailure = (entry) => {
  const normalized = normalizeFailure(entry);
  const key = failureKey(normalized);
  const existingIndex = recentFailures.findIndex((candidate) => failureKey(candidate) === key);
  if (existingIndex >= 0) {
    const existing = recentFailures.splice(existingIndex, 1)[0];
    recentFailures.unshift({
      ...existing,
      ...normalized,
      id: existing.id,
      firstOccurredAt: existing.firstOccurredAt || normalized.firstOccurredAt,
      lastOccurredAt: normalized.lastOccurredAt,
      occurrences: Number(existing.occurrences || 1) + Number(normalized.occurrences || 1)
    });
  } else {
    recentFailures.unshift(normalized);
  }
  recentFailures.splice(MAX_RECENT_FAILURES);
};

const readDiagnosticHistoryFile = () => {
  for (const file of [diagnosticsHistoryFile, diagnosticsTemporaryFile]) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {}
  }
  return null;
};

const restoreDiagnosticHistory = () => {
  const parsed = readDiagnosticHistoryFile();
  if (parsed) {
    const restoredOperations = (Array.isArray(parsed?.recentOperations) ? parsed.recentOperations : []).slice(0, MAX_RECENT_OPERATIONS);
    recentOperations.push(...restoredOperations);
    const restoredFailures = Array.isArray(parsed?.recentFailures)
      ? parsed.recentFailures
      : restoredOperations.filter((entry) => entry?.status === 'failed' || entry?.error);
    restoredFailures.slice(0, MAX_RECENT_FAILURES).reverse().forEach(rememberFailure);
    if (parsed?.counters && typeof parsed.counters === 'object') {
      counters.started = Math.max(0, Number(parsed.counters.started || 0));
      counters.completed = Math.max(0, Number(parsed.counters.completed || 0));
      counters.failed = Math.max(0, Number(parsed.counters.failed || 0));
      counters.overdue = Math.max(0, Number(parsed.counters.overdue || 0));
    }
    const storedFailureOccurrences = recentFailures.reduce((sum, entry) => sum + Number(entry.occurrences || 1), 0);
    counters.failed = Math.max(counters.failed, storedFailureOccurrences);
  }
};

const buildDiagnosticPayload = () => JSON.stringify({
  version: 2,
  savedAt: new Date().toISOString(),
  counters,
  recentOperations: recentOperations.slice(0, MAX_RECENT_OPERATIONS),
  recentFailures: recentFailures.slice(0, MAX_RECENT_FAILURES)
}, null, 2);

// Synchroner Schreibpfad NUR für den Prozess-Exit (dort ist async nicht mehr
// möglich). Im normalen Lauf wird asynchron geschrieben – ein synchrones
// writeFileSync/renameSync auf einer langsamen Freigabe würde sonst den
// gesamten Event-Loop blockieren und damit auch die sofortige
// Interaktions-Bestätigung („Fallen-Heaven hat nicht rechtzeitig reagiert“)
// verzögern.
const writeDiagnosticHistorySync = () => {
  try {
    fs.mkdirSync(diagnosticsDataDir, { recursive: true });
    const payload = buildDiagnosticPayload();
    fs.writeFileSync(diagnosticsTemporaryFile, payload, 'utf8');
    try {
      fs.renameSync(diagnosticsTemporaryFile, diagnosticsHistoryFile);
    } catch {
      fs.writeFileSync(diagnosticsHistoryFile, payload, 'utf8');
      try { fs.unlinkSync(diagnosticsTemporaryFile); } catch {}
    }
    return true;
  } catch (error) {
    console.error('[diagnostics] Fehlerspeicher konnte nicht geschrieben werden:', error?.message || error);
    return false;
  }
};

let diagnosticsWritePromise = null;
const writeDiagnosticHistory = async () => {
  if (diagnosticsWritePromise) return diagnosticsWritePromise;
  diagnosticsWritePromise = (async () => {
    try {
      await fsp.mkdir(diagnosticsDataDir, { recursive: true });
      const payload = buildDiagnosticPayload();
      await fsp.writeFile(diagnosticsTemporaryFile, payload, 'utf8');
      try {
        await fsp.rename(diagnosticsTemporaryFile, diagnosticsHistoryFile);
      } catch {
        await fsp.writeFile(diagnosticsHistoryFile, payload, 'utf8');
        await fsp.rm(diagnosticsTemporaryFile, { force: true }).catch(() => {});
      }
      return true;
    } catch (error) {
      console.error('[diagnostics] Fehlerspeicher konnte nicht geschrieben werden:', error?.message || error);
      return false;
    } finally {
      diagnosticsWritePromise = null;
    }
  })();
  return diagnosticsWritePromise;
};

const persistDiagnosticHistory = ({ immediate = false } = {}) => {
  if (diagnosticsPersistTimer) {
    clearTimeout(diagnosticsPersistTimer);
    diagnosticsPersistTimer = null;
  }
  if (immediate) {
    void writeDiagnosticHistory();
    return true;
  }
  diagnosticsPersistTimer = setTimeout(() => {
    void writeDiagnosticHistory();
  }, 250);
  diagnosticsPersistTimer.unref?.();
  return true;
};

restoreDiagnosticHistory();
process.once('exit', writeDiagnosticHistorySync);
const eventLoop = monitorEventLoopDelay({ resolution: 20 });
eventLoop.enable();

let operationSequence = 0;
let previousCpu = process.cpuUsage();
let previousCpuAt = process.hrtime.bigint();
let indexCache = { at: 0, guildKey: '', value: [] };
let indexRefreshPromise = null;
let indexRefreshError = null;
const INDEX_HEALTH_CACHE_MS = 30_000;
const INDEX_INITIAL_WAIT_MS = 700;

const clamp = (value, minimum = 0, maximum = 100) => Math.max(minimum, Math.min(maximum, Number(value || 0)));
const validTime = (value) => {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
};
const cleanMeta = (meta = {}) => Object.fromEntries(Object.entries(meta)
  .filter(([, value]) => value !== undefined && value !== null && value !== '')
  .map(([key, value]) => [key, typeof value === 'string' ? value.slice(0, 160) : value]));

const cpuPercent = () => {
  const now = process.hrtime.bigint();
  const usage = process.cpuUsage(previousCpu);
  const elapsedMicros = Number(now - previousCpuAt) / 1000;
  previousCpu = process.cpuUsage();
  previousCpuAt = now;
  if (elapsedMicros <= 0) return 0;
  return Math.max(0, Math.min(100, ((usage.user + usage.system) / elapsedMicros) * 100));
};

const finishOperation = (id, status, error = null) => {
  const operation = activeOperations.get(id);
  if (!operation) return;
  activeOperations.delete(id);
  clearTimeout(operation.overdueTimer);
  const finishedAt = Date.now();
  const record = {
    id, name: operation.name, status,
    startedAt: new Date(operation.startedAt).toISOString(),
    finishedAt: new Date(finishedAt).toISOString(),
    durationMs: finishedAt - operation.startedAt,
    timeoutMs: operation.timeoutMs,
    overdue: Boolean(operation.overdue),
    meta: operation.meta,
    error: error ? redactDiagnosticText(error?.message || error) : null
  };
  recentOperations.unshift(record);
  recentOperations.splice(MAX_RECENT_OPERATIONS);
  if (status === 'failed') {
    counters.failed += 1;
    sessionCounters.failed += 1;
    rememberFailure(record);
  } else {
    counters.completed += 1;
    sessionCounters.completed += 1;
  }
  persistDiagnosticHistory({ immediate: status === 'failed' });
};

export const runTrackedOperation = async (name, meta, task, options = {}) => {
  const id = `${Date.now().toString(36)}-${(++operationSequence).toString(36)}`;
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || 30_000));
  const operation = {
    id, name: String(name || 'Unbenannter Job'), meta: cleanMeta(meta),
    startedAt: Date.now(), timeoutMs, overdue: false, overdueTimer: null,
    progress: 0, stage: 'Wird vorbereitet', detail: ''
  };
  activeOperations.set(id, operation);
  const controller = new AbortController();
  counters.started += 1;
  sessionCounters.started += 1;
  const reportProgress = (update = {}) => {
    const current = activeOperations.get(id);
    if (!current) return;
    if (Number.isFinite(Number(update.progress))) current.progress = clamp(update.progress);
    if (update.stage) {
      current.stage = String(update.stage).slice(0, 120);
      current.meta = { ...current.meta, hook: current.stage };
    }
    if (update.detail) current.detail = String(update.detail).slice(0, 240);
    if (Number.isFinite(Number(update.completedUnits))) current.completedUnits = Math.max(0, Number(update.completedUnits));
    if (Number.isFinite(Number(update.totalUnits))) current.totalUnits = Math.max(0, Number(update.totalUnits));
  };
  const taskPromise = Promise.resolve().then(() => task({ operationId: id, reportProgress, signal: controller.signal }));
  const guardedTask = taskPromise.catch((error) => {
    if (!activeOperations.has(id)) return undefined;
    throw error;
  });
  const timeoutPromise = new Promise((_, reject) => {
    operation.overdueTimer = setTimeout(() => {
      operation.overdue = true;
      counters.overdue += 1;
      sessionCounters.overdue += 1;
      const error = new Error(`Zeitlimit nach ${Math.round(timeoutMs / 1000)} Sekunden erreicht.`);
      error.code = 'OPERATION_TIMEOUT';
      controller.abort(error);
      reject(error);
    }, timeoutMs);
    operation.overdueTimer.unref?.();
  });
  try {
    const value = await Promise.race([guardedTask, timeoutPromise]);
    finishOperation(id, 'completed');
    return value;
  } catch (error) {
    finishOperation(id, 'failed', error);
    throw error;
  } finally {
    clearTimeout(operation.overdueTimer);
  }
};

export const recordDiagnosticError = (name, error, meta = {}) => {
  const now = new Date().toISOString();
  counters.failed += 1;
  sessionCounters.failed += 1;
  const record = { id: `error-${Date.now().toString(36)}`, name: String(name || 'Runtime-Fehler'), status: 'failed', startedAt: now, finishedAt: now, durationMs: 0, timeoutMs: 0, overdue: false, meta: cleanMeta(meta), error: redactDiagnosticText(error?.message || error || 'Unbekannter Fehler') };
  recentOperations.unshift(record);
  recentOperations.splice(MAX_RECENT_OPERATIONS);
  rememberFailure(record);
  persistDiagnosticHistory({ immediate: true });
};

const rebuildIndexHealth = async (client) => {
  const guildIds = [...(client?.guilds?.cache?.keys?.() || [])].map(String).sort();
  const guildKey = guildIds.join(',');
  if (indexCache.guildKey === guildKey && Date.now() - indexCache.at < INDEX_HEALTH_CACHE_MS) return indexCache.value;
  const snapshots = [];
  for (const guildId of guildIds) {
    try {
      const snapshot = await getServerIndexSnapshot(guildId);
      const channelEntries = Object.entries(snapshot.channels || {});
      const channels = channelEntries.map(([channelId, channel]) => ({ channelId, ...channel }));
      const completedChannels = channels.filter((channel) => channel.scanComplete).length;
      const incomplete = channels.filter((channel) => !channel.scanComplete);
      const errors = channels.filter((channel) => channel.lastError);
      const operationalChannels = channels.filter((channel) => channel.scanComplete || Number(channel.count || 0) > 0 || validTime(channel.lastMessageAt)).length;
      const activeBackfills = incomplete.filter((channel) => /running|queued|backfill|scanning|catchup/i.test(String(channel.scanState || '')));
      const oldestTimes = channels.map((channel) => validTime(channel.oldestMessageAt)).filter(Boolean);
      const newestTimes = channels.map((channel) => validTime(channel.lastMessageAt)).filter(Boolean);
      const updatedAtMs = validTime(snapshot.updatedAt);
      const guild = client.guilds.cache.get(guildId);
      const indexedUserCountAvailable = snapshot.userCount !== null
        && snapshot.userCount !== undefined
        && Number.isFinite(Number(snapshot.userCount));
      snapshots.push({
        guildId,
        guildName: guild?.name || guildId,
        engine: snapshot.engine,
        totalMessages: snapshot.totalMessages,
        channelCount: snapshot.channelCount,
        userCount: indexedUserCountAvailable ? Number(snapshot.userCount) : Number(guild?.memberCount || 0),
        userCountSource: indexedUserCountAvailable ? 'server-index' : 'discord-guild',
        eventCount: snapshot.eventCount,
        updatedAt: snapshot.updatedAt,
        lastCheckpointAt: snapshot.updatedAt,
        checkpointAgeMs: updatedAtMs ? Math.max(0, Date.now() - updatedAtMs) : null,
        oldestMessageAt: oldestTimes.length ? new Date(Math.min(...oldestTimes)).toISOString() : null,
        newestMessageAt: newestTimes.length ? new Date(Math.max(...newestTimes)).toISOString() : null,
        completedChannels,
        incompleteChannels: incomplete.length,
        operationalChannels,
        activeBackfills: activeBackfills.length,
        historicalBackfillPending: incomplete.length,
        errorChannels: errors.length,
        coveragePercent: channels.length ? Math.round((operationalChannels / channels.length) * 100) : 0,
        historicalCoveragePercent: channels.length ? Math.round((completedChannels / channels.length) * 100) : 0,
        scanStateCounts: channels.reduce((result, channel) => {
          const state = String(channel.scanState || (channel.scanComplete ? 'complete' : 'pending'));
          result[state] = Number(result[state] || 0) + 1;
          return result;
        }, {}),
        ingestion: { mode: 'event-driven', label: 'Live-Ingestion', nextTrigger: 'Nächste Discord-Nachricht', fixedIntervalMs: null },
        pendingChannels: [...errors, ...activeBackfills.filter((channel) => !channel.lastError)].slice(0, 8).map((channel) => ({ channelId: channel.channelId, name: channel.name || channel.channelId, count: Number(channel.count || 0), scanState: channel.scanState || 'pending', error: channel.lastError || null })),
        migration: snapshot.migration,
        boost: getBoostSystemIndexStatus(guildId)
      });
    } catch (error) {
      snapshots.push({ guildId, guildName: client?.guilds?.cache?.get(guildId)?.name || guildId, error: String(error?.message || error) });
    }
  }
  indexCache = { at: Date.now(), guildKey, value: snapshots };
  indexRefreshError = null;
  return snapshots;
};

const loadIndexHealth = async (client) => {
  const guildKey = [...(client?.guilds?.cache?.keys?.() || [])].map(String).sort().join(',');
  const cacheMatches = indexCache.guildKey === guildKey;
  if (cacheMatches && Date.now() - indexCache.at < INDEX_HEALTH_CACHE_MS) return indexCache.value;
  if (!indexRefreshPromise) {
    indexRefreshPromise = rebuildIndexHealth(client)
      .catch((error) => {
        indexRefreshError = redactDiagnosticText(error?.message || error);
        return cacheMatches ? indexCache.value : [];
      })
      .finally(() => { indexRefreshPromise = null; });
  }
  if (cacheMatches && indexCache.value.length) return indexCache.value;
  const quickResult = await Promise.race([
    indexRefreshPromise,
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), INDEX_INITIAL_WAIT_MS);
      timer.unref?.();
    })
  ]);
  return Array.isArray(quickResult) ? quickResult : [];
};

const buildHealth = ({ discord, eventLoopHealth, jobs, indexes, processMetrics, indexTelemetry }) => {
  const discordScore = discord.ready ? clamp(100 - Math.max(0, Number(discord.pingMs || 0) - 120) * 0.18) : 0;
  const runtimeScore = clamp(100
    - Math.max(0, Number(eventLoopHealth.p95DelayMs || 0) - 80) * 0.35
    - Math.max(0, Number(eventLoopHealth.meanDelayMs || 0) - 40) * 0.5
    - Math.max(0, Number(processMetrics.heapUtilizationPercent || 0) - 95) * 2);
  // Historical totals are useful for auditing but must not keep current
  // health degraded forever. Score only failures from this runtime session.
  const jobsScore = clamp(100 - Math.min(70, (Number(jobs.sessionCounters?.failed || 0) * 5) + (Number(jobs.sessionCounters?.overdue || 0) * 12) + (Number(jobs.timedOut || 0) * 15)));
  const indexScores = indexes.map((index) => {
    if (index.error) return 0;
    const errorPenalty = Math.min(35, Number(index.errorChannels || 0) * 8);
    const migrationPenalty = index.migration?.complete === false ? 8 : 0;
    const freshnessPenalty = Number(index.checkpointAgeMs || 0) > 86400000 ? 15 : 0;
    return clamp(65 + (Number(index.coveragePercent || 0) * 0.35) - errorPenalty - migrationPenalty - freshnessPenalty);
  });
  const indexScore = indexTelemetry?.available && indexScores.length
    ? indexScores.reduce((sum, score) => sum + score, 0) / indexScores.length
    : null;
  const weightedComponents = [
    { value: discordScore, weight: 0.24 },
    { value: runtimeScore, weight: 0.22 },
    { value: jobsScore, weight: 0.22 },
    ...(indexScore === null ? [] : [{ value: indexScore, weight: 0.32 }])
  ];
  const totalWeight = weightedComponents.reduce((sum, component) => sum + component.weight, 0) || 1;
  const score = Math.round(weightedComponents.reduce((sum, component) => sum + (component.value * component.weight), 0) / totalWeight);
  const issues = [];
  const recommendations = [];
  if (!discord.ready) issues.push('Discord ist nicht verbunden.');
  if (Number(discord.pingMs || 0) > 250) issues.push(`Discord-Ping ist mit ${Math.round(discord.pingMs)} ms erhöht.`);
  if (!eventLoopHealth.healthy) issues.push(`Der Event-Loop ist wiederholt verzögert (P95 ${Math.round(eventLoopHealth.p95DelayMs || 0)} ms).`);
  if (Number(jobs.timedOut || 0) > 0) issues.push(`${jobs.timedOut} Hintergrundjob(s) haben ihr Zeitlimit überschritten.`);
  const incomplete = indexes.reduce((sum, item) => sum + Number(item.activeBackfills || 0), 0);
  const errors = indexes.reduce((sum, item) => sum + Number(item.errorChannels || 0), 0);
  if (!indexTelemetry?.available) recommendations.push(indexTelemetry?.error
    ? `Der Serverindex konnte zuletzt nicht gelesen werden: ${indexTelemetry.error}`
    : 'Der Serverindex wird im Hintergrund geladen; Prozess- und Discord-Messwerte bleiben live.');
  if (incomplete) recommendations.push(`${incomplete} Kanal-Backfill(s) werden aktuell nachgeladen.`);
  if (errors) issues.push(`${errors} Kanalindex-Fehler benötigen Aufmerksamkeit.`);
  if (!issues.length && !recommendations.length) recommendations.push('Alle überwachten Kernsysteme arbeiten im Normalbereich.');
  return {
    score: clamp(score),
    label: !indexTelemetry?.available
      ? (discord.ready ? 'Kernsysteme online · Serverindex wird geladen' : 'Discord nicht verbunden')
      : score >= 92 ? 'Ausgezeichnet' : score >= 80 ? 'Sehr gut' : score >= 65 ? 'Stabil' : score >= 45 ? 'Beobachten' : 'Kritisch',
    tone: !indexTelemetry?.available && discord.ready ? 'watch' : score >= 80 ? 'good' : score >= 60 ? 'watch' : 'critical',
    components: { discord: Math.round(discordScore), runtime: Math.round(runtimeScore), jobs: Math.round(jobsScore), index: indexScore === null ? null : Math.round(indexScore) },
    issues,
    recommendations
  };
};

export const getLiveDiagnosticsSnapshot = async ({ client, featureDispatch = null } = {}) => {
  const memory = process.memoryUsage();
  const now = Date.now();
  const active = [...activeOperations.values()].map((operation) => ({
    id: operation.id, name: operation.name, status: operation.overdue ? 'timeout' : 'running',
    startedAt: new Date(operation.startedAt).toISOString(), durationMs: now - operation.startedAt,
    timeoutMs: operation.timeoutMs, overdue: operation.overdue, progress: operation.progress,
    stage: operation.stage, detail: operation.detail, completedUnits: operation.completedUnits,
    totalUnits: operation.totalUnits, meta: operation.meta
  })).sort((a, b) => b.durationMs - a.durationMs);
  const meanDelay = Number.isFinite(eventLoop.mean) ? eventLoop.mean / 1e6 : 0;
  const maxDelay = Number.isFinite(eventLoop.max) ? eventLoop.max / 1e6 : 0;
  const p95Delay = Number.isFinite(eventLoop.percentile(95)) ? eventLoop.percentile(95) / 1e6 : 0;
  eventLoop.reset();
  const processMetrics = { pid: process.pid, uptimeSeconds: Math.round(process.uptime()), cpuPercent: Number(cpuPercent().toFixed(2)), logicalCpuCount: os.cpus().length, rssBytes: memory.rss, heapUsedBytes: memory.heapUsed, heapTotalBytes: memory.heapTotal, heapUtilizationPercent: memory.heapTotal ? Math.round((memory.heapUsed / memory.heapTotal) * 1000) / 10 : 0, externalBytes: memory.external, arrayBuffersBytes: memory.arrayBuffers, activeHandles: typeof process._getActiveHandles === 'function' ? process._getActiveHandles().length : null };
  const eventLoopHealth = { meanDelayMs: Number(meanDelay.toFixed(2)), p95DelayMs: Number(p95Delay.toFixed(2)), maxDelayMs: Number(maxDelay.toFixed(2)), healthy: p95Delay < 180 };
  const discord = { ready: Boolean(client?.isReady?.()), pingMs: Number.isFinite(client?.ws?.ping) ? Math.round(client.ws.ping) : null, guildCount: client?.guilds?.cache?.size || 0, user: client?.user?.tag || null };
  const storedFailureOccurrences = recentFailures.reduce((sum, entry) => sum + Number(entry.occurrences || 1), 0);
  const lastFailureAt = recentFailures[0]?.lastOccurredAt || recentFailures[0]?.finishedAt || null;
  const jobs = {
    counters: { ...counters },
    sessionCounters: { ...sessionCounters },
    active,
    recent: recentOperations.slice(0, 40),
    failures: recentFailures.slice(0, 40),
    featureDispatch,
    failureSummary: {
      totalOccurrences: counters.failed,
      sessionOccurrences: sessionCounters.failed,
      storedOccurrences: storedFailureOccurrences,
      storedGroups: recentFailures.length,
      withoutStoredDetails: Math.max(0, Number(counters.failed || 0) - storedFailureOccurrences),
      lastFailureAt
    },
    running: active.length,
    timedOut: active.filter((job) => job.overdue).length
  };
  const indexes = await loadIndexHealth(client);
  const currentGuildKey = [...(client?.guilds?.cache?.keys?.() || [])].map(String).sort().join(',');
  const indexTelemetry = {
    available: indexCache.guildKey === currentGuildKey && indexCache.at > 0,
    refreshing: Boolean(indexRefreshPromise),
    measuredAt: indexCache.at ? new Date(indexCache.at).toISOString() : null,
    error: indexRefreshError
  };
  const indexedUserCounts = indexes.map((item) => item.userCount).filter((value) => value !== null && value !== undefined);
  return {
    measuredAt: new Date().toISOString(),
    process: processMetrics,
    eventLoop: eventLoopHealth,
    discord,
    jobs,
    index: indexes,
    indexTelemetry,
    interactions: {
      ...interactionTiming,
      lateAckThresholdMs: INTERACTION_LATE_ACK_MS,
      slowHandlerThresholdMs: INTERACTION_SLOW_HANDLER_MS,
      recent: interactionTiming.recent.slice(0, MAX_INTERACTION_TIMING_RECENT)
    },
    rateLimits: getRateLimitSnapshot(),
    health: buildHealth({ discord, eventLoopHealth, jobs, indexes, processMetrics, indexTelemetry }),
    totals: {
      messages: indexes.reduce((sum, item) => sum + Number(item.totalMessages || 0), 0),
      channels: indexes.reduce((sum, item) => sum + Number(item.channelCount || 0), 0),
      users: indexedUserCounts.length ? indexedUserCounts.reduce((sum, value) => sum + Number(value || 0), 0) : null,
      incompleteChannels: indexes.reduce((sum, item) => sum + Number(item.activeBackfills || 0), 0),
      historicalBackfillPending: indexes.reduce((sum, item) => sum + Number(item.historicalBackfillPending || 0), 0),
      errorChannels: indexes.reduce((sum, item) => sum + Number(item.errorChannels || 0), 0)
    }
  };
};
