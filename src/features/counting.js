import path from 'node:path';

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } from 'discord.js';
import { DATA_DIR } from '../shared/paths.js';

import { atomicWriteJson, readJsonWithRecovery } from '../runtime/atomicJsonStore.js';
import { resolveOutsideImageLite } from '../runtime/localImageStore.js';
import { savePersistentEmbedDesign, serializeMessageAttachment } from '../runtime/persistentEmbedService.js';
import { quietLog, QUIET_LOG_SCOPE } from '../runtime/quietLog.js';

// =============================================================================
// Zähl-Kanal (counting)
// -----------------------------------------------------------------------------
// Professionelles Zählspiel für einen konfigurierten Textkanal:
//   - Nur exakte Ganzzahlen zählen; die nächste erwartete Zahl ist count + 1.
//   - Anti-Cheat: Bots/Webhooks ignorieren, bearbeitete Nachrichten zählen nie,
//     keine zwei Züge derselben Person in Folge, ausgeschlossene Rollen, Cap.
//   - Falsche Zahl (oder doppelter Zug) => ❌, Zähler fällt auf resetValue zurück,
//     optional wird die falsche Nachricht gelöscht. Korrekt => ✅.
//   - Meilensteine (konfigurierbare Werte) lösen eine Erwähnung aus.
//   - Pro Nutzer: richtige/falsche Züge, aktuelle Serie, Best-Serie.
//   - Optionales Live-Status-Panel (gedrosselt aktualisiert) in einem eigenen Kanal.
//   - Alles wird persistent gespeichert und übersteht Bot-Neustarts.
//
// Konfiguration (je Guild, über das Dashboard):
//   counting.enabled               – Modul an/aus
//   counting.channelId             – Zähl-Kanal
//   counting.resetValue            – Stand nach einem Fehlversuch (Standard 0)
//   counting.deleteWrongMessages   – falsche Nachrichten löschen
//   counting.preventSelfCount      – keine zwei Züge derselben Person in Folge
//   counting.selfCountIsFail       – doppelter Zug zählt als Fehlversuch (Reset)
//   counting.excludedRoleIds       – Rollen, die nicht zählen dürfen
//   counting.maxCount              – Sicherheits-Cap (Werte darüber = Fehlversuch)
//   counting.milestones            – Zahlen, bei denen gefeiert wird
//   counting.milestoneMessage      – Text mit {user} und {count}
//   counting.successReaction       – Reaktion bei richtig (Standard ✅)
//   counting.failReaction          – Reaktion bei falsch (Standard ❌)
//   counting.statusChannelId       – optionaler Kanal für das Live-Status-Panel
//   counting.statusPanelEnabled    – Status-Panel an/aus
//   counting.panelDesign           – Studio-Design für das Panel (Embed Studio)
// =============================================================================

const DATA_ROOT = DATA_DIR;
const STATE_FILE = path.join(DATA_ROOT, 'counting-state.json');
const DATA_VERSION = 2;

const MAX_SAFE_PARSE_DIGITS = 15;
const SAVE_DEBOUNCE_MS = 800;
const PANEL_REPAIR_MS = 10 * 60_000;      // Panel prüft sich alle 10 Minuten selbst
const PANEL_MIN_UPDATE_MS = 2_000;        // Panel wird höchstens alle 2 s aktualisiert (schnelle Live-Anzeige)
const MILESTONE_COOLDOWN_MS = 60_000;     // gleicher Meilenstein max. 1× pro Minute

// Server-Trophäen-Emojis (wie Aktivitäts-Liga): Die Top-Serien im Panel nutzen
// die hochgeladenen Trophäen statt Unicode-Medals – mit Fallback auf 🥇🥈🥉,
// falls der Server die Emojis nicht (mehr) hat.
const TROPHY_EMOJIS = {
  1: { name: 'trophy1', id: '1533907289604493502', fallback: '🥇' },
  2: { name: 'trophy2', id: '1533907288379625673', fallback: '🥈' },
  3: { name: 'trophy3', id: '1533907290753732608', fallback: '🥉' }
};

// Custom-IDs der Panel-Buttons („Regeln“ / „Mein Rang“).
const BUTTON_RULES_ID = 'fh_counting:rules';
const BUTTON_RANK_ID = 'fh_counting:rank';

const emptyStore = () => ({ version: DATA_VERSION, guilds: {} });

let store = null;
let loadPromise = null;
let saveTimer = null;
let saveQueue = Promise.resolve();
const panelTimers = new Map();            // guildId -> Repair-Intervall
const milestoneCooldowns = new Map();     // guildId -> { value, at }
const panelUpdatedAt = new Map();         // guildId -> letzte Aktualisierung
const panelMessageCache = new Map();      // guildId -> Panel-Message-Objekt (kein erneuter Fetch pro Update)
const lockTimers = new Map();             // guildId:userId -> Timer bis zur Sperr-Freigabe
const guildConfigs = new Map();           // guildId -> zuletzt bekannte Config (für DM-Embeds)
const reactionQueues = new Map();         // channelId -> garantierte FIFO fuer Erfolgs-/Fehlerreaktionen
const cleanupWindows = new Map();         // channelId -> einmal hydratisiertes lokales Nachrichtenfenster
const cleanupJobs = new Map();            // channelId -> serialisierter/coalescter Cleanup-Lauf
const panelRefreshJobs = new Map();        // guildId -> Single-Flight plus nachlaufendes letztes Panel-Update
const reactionRuntime = {
  enqueued: 0,
  delivered: 0,
  failed: 0,
  retried: 0,
  deduplicated: 0
};
const cleanupRuntime = {
  requested: 0,
  runs: 0,
  coalesced: 0,
  fetches: 0,
  deleted: 0,
  deferredForReaction: 0
};
const panelRuntime = {
  requested: 0,
  synced: 0,
  coalesced: 0
};
// Zähler seit dem letzten Aufräumen je Guild: Das Rolling-Window läuft NUR
// wenn es fällig ist (nach `keep` neuen Nachrichten), nicht bei JEDER
// Nachricht – sonst erzeugt jeder Zug messages.fetch + bulkDelete und die
// Reaktion hängt hinter den Rate-Limits.
const cleanupCountdown = new Map();       // guildId -> Nachrichten seit letztem Aufräumen

const reactionChannelKey = (messageOrChannelId) => String(
  typeof messageOrChannelId === 'object'
    ? (messageOrChannelId?.channelId || messageOrChannelId?.channel?.id || '')
    : (messageOrChannelId || '')
);

const reactionQueueFor = (channelId) => {
  const key = reactionChannelKey(channelId);
  if (!key) return null;
  if (!reactionQueues.has(key)) {
    reactionQueues.set(key, {
      channelId: key,
      pending: [],
      head: 0,
      pendingIds: new Set(),
      seenIds: new Set(),
      seenOrder: [],
      worker: null
    });
  }
  return reactionQueues.get(key);
};

const reactionQueuePendingCount = (queue) => Math.max(0, Number(queue?.pending?.length || 0) - Number(queue?.head || 0));

const rememberReactionMessage = (queue, messageId) => {
  queue.seenIds.add(messageId);
  queue.seenOrder.push(messageId);
  // Deduplizierung braucht nur ein begrenztes Fenster. Offene IDs werden nie
  // entfernt; abgeschlossene sehr alte IDs duerfen spaeter auslaufen.
  while (queue.seenOrder.length > 2_000) {
    const oldest = queue.seenOrder.shift();
    if (!queue.pendingIds.has(oldest)) queue.seenIds.delete(oldest);
  }
};

const terminalReactionError = (error) => {
  const code = Number(error?.code || error?.rawError?.code || 0);
  const status = Number(error?.status || error?.httpStatus || 0);
  return [10008, 10014, 50001, 50013].includes(code) || [400, 401, 403, 404].includes(status);
};

const reactionRetryDelayMs = (error, attempt) => {
  const retryAfter = Number(error?.retryAfter || error?.rawError?.retry_after || 0);
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(5_000, Math.ceil(retryAfter > 1000 ? retryAfter : retryAfter * 1000));
  return Math.min(2_000, 100 * (2 ** Math.max(0, attempt - 1)));
};

const drainCountingReactionQueue = (queue) => {
  if (!queue || queue.worker) return queue?.worker || Promise.resolve();
  queue.worker = (async () => {
    while (reactionQueuePendingCount(queue) > 0) {
      const entry = queue.pending[queue.head];
      let delivered = false;
      let lastError = null;
      while (!delivered && entry.attempts < 3) {
        entry.attempts += 1;
        try {
          await entry.message.react(entry.reaction);
          delivered = true;
          reactionRuntime.delivered += 1;
        } catch (error) {
          lastError = error;
          if (terminalReactionError(error) || entry.attempts >= 3) break;
          reactionRuntime.retried += 1;
          await new Promise((resolve) => setTimeout(resolve, reactionRetryDelayMs(error, entry.attempts)));
        }
      }
      if (!delivered) {
        reactionRuntime.failed += 1;
        quietLog(
          QUIET_LOG_SCOPE.counting,
          lastError,
          `Reaction fehlgeschlagen: Nachricht ${entry.messageId}, Emoji ${entry.reaction}`
        );
      }
      queue.head += 1;
      queue.pendingIds.delete(entry.messageId);
      entry.resolve({ delivered, error: lastError });
      scheduleDeferredCountingCleanup(queue.channelId);
    }
    queue.pending = [];
    queue.head = 0;
  })().finally(() => {
    queue.worker = null;
    if (reactionQueuePendingCount(queue) > 0) drainCountingReactionQueue(queue);
  });
  return queue.worker;
};

// Jede bewertete Counting-Nachricht wird pro Kanal genau einmal eingereiht.
// Der Aufrufer wartet nicht auf Discord; innerhalb des Kanals bleibt die
// Reihenfolge trotzdem strikt erhalten.
const enqueueCountingReaction = (message, reaction) => {
  const channelId = reactionChannelKey(message);
  const messageId = String(message?.id || '');
  const normalizedReaction = String(reaction || '').trim();
  if (!channelId || !messageId || !normalizedReaction || typeof message?.react !== 'function') return false;
  const queue = reactionQueueFor(channelId);
  if (queue.seenIds.has(messageId)) {
    reactionRuntime.deduplicated += 1;
    return false;
  }
  rememberReactionMessage(queue, messageId);
  let resolveCompletion;
  const completion = new Promise((resolve) => { resolveCompletion = resolve; });
  queue.pendingIds.add(messageId);
  queue.pending.push({
    message,
    messageId,
    reaction: normalizedReaction,
    enqueuedAt: Date.now(),
    attempts: 0,
    resolve: resolveCompletion
  });
  reactionRuntime.enqueued += 1;
  drainCountingReactionQueue(queue);
  return completion;
};

const waitForCountingReactionIdle = async (channelId = '') => {
  const selected = channelId
    ? [reactionQueues.get(reactionChannelKey(channelId))].filter(Boolean)
    : [...reactionQueues.values()];
  for (const queue of selected) {
    while (queue.worker || reactionQueuePendingCount(queue) > 0) {
      if (!queue.worker) drainCountingReactionQueue(queue);
      await queue.worker;
    }
  }
};

const pendingReactionIdsForChannel = (channelId) => reactionQueues.get(reactionChannelKey(channelId))?.pendingIds || new Set();

const cleanupWindowFor = (channelId) => {
  const key = reactionChannelKey(channelId);
  if (!key) return null;
  if (!cleanupWindows.has(key)) cleanupWindows.set(key, { channelId: key, hydrated: false, messages: new Map() });
  return cleanupWindows.get(key);
};

const observeCountingMessage = (message) => {
  const channelId = reactionChannelKey(message);
  const messageId = String(message?.id || '');
  if (!channelId || !messageId) return false;
  cleanupWindowFor(channelId).messages.set(messageId, message);
  return true;
};

const forgetCountingMessages = (channelId, messageIds = []) => {
  const window = cleanupWindows.get(reactionChannelKey(channelId));
  if (!window) return;
  for (const messageId of messageIds) window.messages.delete(String(messageId || ''));
};

const getCountingRuntimeSnapshot = () => {
  const queues = [...reactionQueues.values()];
  let pending = 0;
  let oldestAt = Infinity;
  let activeChannels = 0;
  for (const queue of queues) {
    const count = reactionQueuePendingCount(queue);
    pending += count;
    if (count || queue.worker) activeChannels += 1;
    if (count) oldestAt = Math.min(oldestAt, Number(queue.pending[queue.head]?.enqueuedAt || Infinity));
  }
  return {
    reactions: {
      ...reactionRuntime,
      channels: activeChannels,
      pending,
      oldestPendingMs: Number.isFinite(oldestAt) ? Math.max(0, Date.now() - oldestAt) : 0
    },
    cleanup: {
      ...cleanupRuntime,
      activeChannels: [...cleanupJobs.values()].filter((job) => job.worker).length,
      hydratedChannels: [...cleanupWindows.values()].filter((window) => window.hydrated).length
    },
    panel: {
      ...panelRuntime,
      activeGuilds: [...panelRefreshJobs.values()].filter((job) => job.worker || job.timer).length
    }
  };
};

const resetCountingRuntimeForTests = () => {
  for (const job of cleanupJobs.values()) clearTimeout(job.retryTimer);
  for (const job of panelRefreshJobs.values()) clearTimeout(job.timer);
  reactionQueues.clear();
  cleanupWindows.clear();
  cleanupJobs.clear();
  panelRefreshJobs.clear();
  panelUpdatedAt.clear();
  cleanupCountdown.clear();
  for (const key of Object.keys(reactionRuntime)) reactionRuntime[key] = 0;
  for (const key of Object.keys(cleanupRuntime)) cleanupRuntime[key] = 0;
  for (const key of Object.keys(panelRuntime)) panelRuntime[key] = 0;
};

// Zuletzt bekannte Counting-Config eines Servers (für DM-Embeds, die unabhängig
// vom aktuellen Message-Context gesendet werden – z. B. Freigabe-DM nach
// Ablauf der Sperre). Wird bei onClientReady/onConfigUpdate aktualisiert.
const configFor = (guildId) => {
  const cfg = guildConfigs.get(String(guildId || ''));
  return cfg ? settings(cfg) : null;
};

/* ----------------------------- Persistenz -------------------------------- */

const ensureLoaded = async () => {
  if (store) return store;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const loaded = await readJsonWithRecovery(STATE_FILE, { fallback: emptyStore() });
    const parsed = loaded && typeof loaded === 'object' && loaded.value && typeof loaded.value === 'object'
      ? loaded.value
      : (loaded && typeof loaded === 'object' ? loaded : {});
    const { value: _leakValue, source: _leakSource, recovered: _leakRecovered, failures: _leakFailures, ...clean } = parsed;
    store = {
      ...emptyStore(),
      ...clean,
      guilds: (clean?.guilds && typeof clean.guilds === 'object' && !Array.isArray(clean.guilds)) ? clean.guilds : {}
    };
    return store;
  })();
  return loadPromise;
};

const persist = async () => {
  if (!store) return;
  const snapshot = store;
  saveQueue = saveQueue.then(async () => {
    try {
      await atomicWriteJson(STATE_FILE, snapshot, { pretty: true });
    } catch (error) {
      console.error('[counting] State konnte nicht gespeichert werden:', error?.message || error);
    }
  });
  return saveQueue;
};

const scheduleSave = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void persist().catch((error) => {
      quietLog(QUIET_LOG_SCOPE.counting, error, `persist fehlgeschlagen`);
    });
  }, SAVE_DEBOUNCE_MS);
};

const guildState = async (guildId) => {
  await ensureLoaded();
  const key = String(guildId);
  store.guilds[key] ||= {
    count: 0,
    lastUserId: '',
    lastAt: 0,
    fails: 0,
    lastFailAt: 0,
    lastFailUserId: '',
    users: {},
    strikes: {},
    locks: {},
    panel: { channelId: '', messageId: '' }
  };
  const state = store.guilds[key];
  state.count = Math.max(0, Math.floor(Number(state.count) || 0));
  state.users ||= {};
  state.strikes ||= {};
  state.locks ||= {};
  return state;
};

/* ------------------------------- Konfiguration --------------------------- */

// Rollen-IDs als reines String-Array normalisieren (idempotent: Array, Set,
// String oder undefined – nie ein Set nach außen). Der Studio-Sync läuft die
// Config mehrfach durch settings(); ein Array kann dabei weder crashen
// („(x || []).map“) noch verloren gehen. Für die Zug-Entscheidung wird intern
// ein Set gebaut.
const asRoleIdList = (value) => [...new Set(
  (Array.isArray(value) ? value : value instanceof Set ? [...value] : [])
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
)];

const settings = (cfg) => ({
  enabled: cfg?.counting?.enabled === true,
  channelId: String(cfg?.counting?.channelId || '').trim(),
  resetValue: Math.max(0, Math.floor(Number(cfg?.counting?.resetValue) || 0)),
  deleteWrongMessages: cfg?.counting?.deleteWrongMessages !== false,
  preventSelfCount: cfg?.counting?.preventSelfCount !== false,
  selfCountIsFail: cfg?.counting?.selfCountIsFail !== false,
  excludedRoleIds: asRoleIdList(cfg?.counting?.excludedRoleIds),
  maxCount: Math.max(10, Math.floor(Number(cfg?.counting?.maxCount) || 1_000_000_000)),
  milestones: (Array.isArray(cfg?.counting?.milestones) ? cfg.counting.milestones : [])
    .map((value) => Math.floor(Number(value)))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((left, right) => left - right),
  milestoneMessage: String(cfg?.counting?.milestoneMessage || '').trim(),
  successReaction: String(cfg?.counting?.successReaction || '✅').trim() || '✅',
  failReaction: String(cfg?.counting?.failReaction || '❌').trim() || '❌',
  statusChannelId: String(cfg?.counting?.statusChannelId || '').trim(),
  statusPanelEnabled: cfg?.counting?.statusPanelEnabled !== false,
  rulesButtonLabel: String(cfg?.counting?.rulesButtonLabel ?? '📖 Regeln').slice(0, 80),
  rankButtonLabel: String(cfg?.counting?.rankButtonLabel ?? '🏅 Mein Rang').slice(0, 80),
  panelDesign: normalizeCountingPanelDesign(cfg?.counting?.panelDesign),
  lossMessagesEnabled: cfg?.counting?.lossMessagesEnabled !== false,
  lossMessages: (Array.isArray(cfg?.counting?.lossMessages) && cfg.counting.lossMessages.length
    ? cfg.counting.lossMessages
    : defaultLossMessages())
    .map((line) => String(line || '').trim().slice(0, 500))
    .filter(Boolean),
  clearChannelOnFail: cfg?.counting?.clearChannelOnFail !== false,
  clearChannelDelaySeconds: Math.max(0, Math.min(300, Math.floor(Number(cfg?.counting?.clearChannelDelaySeconds) || 10))),
  // Wie viele der neuesten Zähl-Nachrichten nach dem Aufräumen stehen bleiben
  // (Level-Up-Muster). 0 = alles außer Panel/Pins löschen.
  clearChannelKeepMessages: Number.isFinite(Number(cfg?.counting?.clearChannelKeepMessages))
    ? Math.max(0, Math.min(100, Math.floor(Number(cfg?.counting?.clearChannelKeepMessages))))
    : 5,
  // Verwarnungssystem: Wer wirklich unpassende Zahlen schreibt (Fehlversuch),
  // bekommt 1 Verwarnung. Bei strikesToLock Verwarnungen folgt eine
  // Chat-Sperre für strikeLockHours. Die Sperren werden persistent gespeichert
  // (überleben Neustart/Offline) und event-basiert freigegeben – wie die
  // Call-Sperren der öffentlichen Call-Moderation.
  strikesEnabled: cfg?.counting?.strikesEnabled !== false,
  strikesToLock: Math.max(1, Math.min(20, Math.floor(Number(cfg?.counting?.strikesToLock) || 3))),
  strikeLockHours: Math.max(1, Math.min(720, Math.floor(Number(cfg?.counting?.strikeLockHours) || 24))),
  strikeLockMessage: String(cfg?.counting?.strikeLockMessage || '').trim(),
  // Toleranz: Ein knapp daneben liegender Zug (z. B. erwartet 4, gesendet 5)
  // ist ein normaler Fehler und verwarnt NICHT. Erst Abweichungen über dieser
  // Schwelle gelten als „wirklich unpassende Zahl“ (Standard 1 → ±1 daneben ok).
  strikeTolerance: Math.max(0, Math.min(1000000, Math.floor(Number(cfg?.counting?.strikeTolerance) || 1))),
  // Editierbare DM-Embeds für Sperre (strikeLock) und Freigabe (strikeRelease).
  dmDesigns: normalizeCountingDesigns(cfg?.counting?.dmDesigns)
});

/* -------------------------- Verlierer-Nachrichten ------------------------ */

// Eingebaute Pool mit 100 Variationen – ein zufälliger Satz erscheint bei
// jedem Fehlversuch. {user} / {mention} wird durch die echte @Erwähnung ersetzt,
// {count} durch die falsch gesendete Zahl. Eigene Sätze (counting.lossMessages)
// ersetzen die Pool komplett.
const defaultLossMessages = () => [
  '💥 Verloren! {user} hat die Serie beendet. Wir starten bei 0.',
  '📉 Aus! {user} hat falsch gezählt. Neustart!',
  '❌ Und weg! {user} war zu schnell. Ab jetzt zählen wir wieder von 0.',
  '😵 {user} hat\'s verbockt. Neue Runde!',
  '🚫 Falsch! {user} beendet die Runde. Frischer Start bei 0 – als Nächstes kommt {next}.',
  '💀 Die Serie ist vorbei – {user} hat verloren! Neustart!',
  '🎲 Pech gehabt, {user}! Neue Runde, neues Glück.',
  '🔥 Und aus! Die Serie ist beendet – danke, {user}.',
  '🙃 {user} hat die Zahl nicht getroffen. Wir starten neu.',
  '⏳ Vorbei! {user} hat verloren. Zähler steht wieder auf 0.',
  '😬 Autsch, {user}. Das war nichts. Neustart!',
  '🥲 {user} hat verloren – die nächste Zahl ist wieder 1.',
  '⚡ Zu schnell, {user}! Wir fangen bei 0 an.',
  '💢 Falsche Zahl von {user}! Runde beendet.',
  '🎯 Daneben! {user} verliert. Neustart!',
  '🧨 Bumm! {user} hat die Serie gesprengt.',
  '🛑 Stopp! {user} hat verloren. Neuer Versuch!',
  '📛 {user} hat sich verzählt. Ab jetzt zählen wir neu.',
  '🌀 Und wieder von vorn – {user} hat\'s vermasselt.',
  '🤯 Die Serie ist futsch! {user} war dran.',
  '❌ Falsch! {user} hat die Runde beendet. Neustart!',
  '😅 Fast! Aber {user} hat verloren. Wir starten neu.',
  '💥 Voll daneben! {user} verliert. Zähler auf 0!',
  '🎭 Schade, {user}! Die nächste Zahl ist wieder 1.',
  '📉 Runter auf 0! {user} hat verloren.',
  '🚀 Neustart! {user} hat die Serie gestoppt.',
  '😵‍💫 {user} hat verloren – das war die falsche Zahl.',
  '⛔ Falsch! Die Runde ist vorbei, {user}.',
  '🍀 Glück gehabt? Nein! {user} hat verloren. Neustart!',
  '🎪 Vorhang zu! {user} hat die Show beendet.',
  '🥊 K.o.! {user} hat verloren. Wir starten bei 0.',
  '📢 Achtung: {user} hat verloren! Neue Runde!',
  '🤦 {user} hat sich vertippt. Zähler zurück auf 0.',
  '😱 Die Serie ist beendet – {user} hat falsch gezählt!',
  '🎰 Leider verloren! {user}, nächster Versuch.',
  '❌ Und nochmal: Neustart, weil {user} verloren hat.',
  '🌪️ Alles durcheinander! {user} hat verloren.',
  '⏰ Auszeit! {user} hat die Zahl verpasst. Neustart!',
  '💔 Serie beendet! {user} hat\'s beendet.',
  '🔄 Reset! {user} hat verloren. Frischer Start!',
  '😖 Pech! {user} hat verloren. Zähler auf 0!',
  '🎈 Und platt! {user} hat verloren. Neustart!',
  '🥴 {user} hat\'s vermasselt. Wir zählen neu.',
  '🚦 Rote Karte! {user} hat verloren.',
  '🕹️ Game Over für {user}! Neustart!',
  '❌ Das war\'s! {user} hat verloren. Neue Runde!',
  '💥 Falsch getippt! {user} startet die Runde neu.',
  '🎯 Leider daneben! {user} verliert.',
  '😵 Verloren! {user} hat die Serie beendet.',
  '🔄 Alles auf Anfang – {user} hat verloren!',
  '📉 Absturz! {user} hat falsch gezählt.',
  '🧨 Zündstoff! {user} hat verloren. Neustart!',
  '🛑 Halt! Falsche Zahl von {user}. Runde vorbei – als Nächstes kommt {next}.',
  '🎲 Neue Runde! {user} hat verloren.',
  '😅 Knapp daneben, {user}! Neustart!',
  '💢 Falsch! {user} verliert. Zähler auf 0!',
  '🌀 Und zack – {user} hat verloren. Wir starten neu.',
  '🎭 Vorhang zu für {user}! Neustart!',
  '🥲 Schade, {user}! Aber du bekommst eine neue Chance!',
  '⛔ Ende! {user} hat verloren. Frischer Start!',
  '🤯 Voll vorbei! {user} hat verloren.',
  '🚀 Countdown neu! {user} hat verloren.',
  '❌ Nochmal versuchen! {user} hat verloren.',
  '💥 Die Serie ist tot – {user} war\'s.',
  '📛 Autsch, {user}! Wir starten bei 0.',
  '😬 Das tut weh, {user}! Neustart!',
  '🎪 Bühne frei für die nächste Runde – {user} hat verloren!',
  '🕹️ Verloren! {user} muss neu starten.',
  '⏳ Nicht dein Tag, {user}! Neustart!',
  '🚦 Stopp! {user} hat verloren. Neue Runde!',
  '🥊 Knockout! {user} liegt am Boden. Zähler: 0.',
  '📢 Game over! {user} hat verloren.',
  '❌ Die Zahl war\'s nicht, {user}. Neustart!',
  '😵‍💫 Und aus die Maus – {user} hat verloren!',
  '🎯 Ziel verfehlt! {user} startet neu.',
  '🔄 Reset durch {user}! Neue Runde!',
  '💔 Herzschmerz: {user} hat verloren.',
  '⛔ Nope! {user} hat verloren. Zähler zurück.',
  '🎲 Neuer Wurf! {user} hat verloren.',
  '😅 Fast geschafft – aber {user} hat verloren!',
  '🚀 Frischer Start! {user} hat die Runde beendet.',
  '❌ Falsch! {user} war dran. Wir zählen neu.',
  '💢 Verloren! {user} muss von vorn anfangen.',
  '🌀 Neue Runde, neues Glück – {user} hat verloren!',
  '🥴 {user} hat sich verzählt. Zähler auf 0!',
  '🛑 Game Over! {user} hat verloren.',
  '🔥 Die Serie brennt nicht mehr – {user} hat verloren.',
  '📉 Tiefschlag! {user} hat falsch gezählt.',
  '😱 Nein! {user} hat verloren. Neustart!',
  '🎭 Pech gehabt! {user} startet bei 0.',
  '⏰ Too late? Nein, einfach falsch, {user}! Neustart!',
  '💥 Bumm! {user} hat verloren. Runde beendet!',
  '❌ Schade! {user} hat die Serie gestoppt.',
  '🚧 Sackgasse! {user} hat verloren.',
  '🔄 Und wieder 0 – {user} hat verloren!',
  '😖 Autsch, {user}! Die Runde ist vorbei.',
  '🕹️ Weiter geht\'s! {user} hat verloren.',
  '📢 Achtung, Reset! {user} hat verloren.',
  '🥊 Und aus! {user} hat verloren. Neustart!',
  '❌ Verloren! {user} startet neu – viel Glück!'
];

/* ------------------- Editierbare DM-Designs (Studio) --------------------- */
// Sperr-DM (strikeLock) und Freigabe-DM (strikeRelease) sind über das
// Dashboard-Embed-Studio editierbar – identisches Muster wie die DM-Embeds
// der öffentlichen Call-Moderation (Sektionen „dm“ / „release“). NIE roher
// Text; alles läuft als Embed mit Platzhaltern.
const DEFAULT_COUNTING_DESIGNS = {
  strikeLock: {
    title: '🚫 Zähl-Kanal-Sperre',
    description: '**{targetMention}**, du hast {limit} Verwarnungen gesammelt und bist für **{hours} Std.** vom Zähl-Kanal gesperrt.\n\nFalls du denkst, dass das ein Fehler ist, wende dich an das Team.',
    color: '#ed4245',
    authorName: '{server}',
    authorIconUrl: '',
    footerText: 'FALLEN HEAVEN · ZÄHL-KANAL',
    timestamp: true
  },
  strikeRelease: {
    title: '✅ Deine Zähl-Kanal-Sperre ist vorbei',
    description: '**{targetMention}**, deine Chat-Sperre im Zähl-Kanal ist abgelaufen – du kannst wieder zählen!',
    color: '#57f287',
    authorName: '{server}',
    authorIconUrl: '',
    footerText: 'FALLEN HEAVEN · ZÄHL-KANAL',
    timestamp: true
  }
};

const COUNTING_DESIGN_SECTIONS = Object.keys(DEFAULT_COUNTING_DESIGNS);

const normalizeCountingDesignSection = (section, value) => {
  const fallback = DEFAULT_COUNTING_DESIGNS[section] || {};
  const embed = value && typeof value === 'object' ? value : {};
  return {
    title: String(embed.title !== undefined ? embed.title : fallback.title).slice(0, 256),
    url: String(embed.url || '').slice(0, 2048),
    description: String(embed.description !== undefined ? embed.description : fallback.description).slice(0, 4096),
    color: String(embed.color || fallback.color || '').slice(0, 16),
    authorName: String(embed.authorName !== undefined ? embed.authorName : fallback.authorName).slice(0, 256),
    authorIconUrl: String(embed.authorIconUrl || '').slice(0, 2048),
    thumbnailUrl: String(embed.thumbnailUrl || '').slice(0, 2048),
    imageUrl: String(embed.imageUrl || '').slice(0, 2048),
    footerText: String(embed.footerText !== undefined ? embed.footerText : fallback.footerText).slice(0, 2048),
    footerIconUrl: String(embed.footerIconUrl || '').slice(0, 2048),
    timestamp: embed.timestamp !== false
  };
};

const normalizeCountingDesigns = (design) => {
  const source = design && typeof design === 'object' && !Array.isArray(design) ? design : {};
  return Object.fromEntries(COUNTING_DESIGN_SECTIONS.map((section) => [section, normalizeCountingDesignSection(section, source[section])]));
};

// Kontext für die DM-Embeds.
const countingDmContext = ({ guild, userId, limit, hours }) => {
  const member = guild?.members?.cache?.get?.(String(userId || ''));
  const name = member?.displayName || member?.user?.username || 'Unbekannt';
  return {
    server: guild?.name || 'FALLEN HEAVEN',
    target: name,
    targetMention: `<@${userId}>`,
    limit: String(limit || 3),
    hours: String(hours || 24)
  };
};

const renderCountingDmText = (template, context, max = 4096) => String(template || '')
  .replaceAll('{server}', context.server)
  .replaceAll('{target}', context.target)
  .replaceAll('{targetMention}', context.targetMention)
  .replaceAll('{limit}', context.limit)
  .replaceAll('{hours}', context.hours)
  .slice(0, Math.max(1, max));

// Baut ein DM-Embed aus der editierbaren Sektion (strikeLock / strikeRelease).
const buildCountingDmEmbed = (guild, section, context, conf) => {
  const design = normalizeCountingDesignSection(section, conf?.dmDesigns?.[section]);
  const embed = new EmbedBuilder().setColor(parseHexColor(design.color || '#6ee7ff'));
  const title = renderCountingDmText(design.title, context, 256);
  if (title) embed.setTitle(title);
  if (design.url) embed.setURL(renderCountingDmText(design.url, context, 512));
  const description = renderCountingDmText(design.description, context, 4096);
  if (description) embed.setDescription(description);
  if (design.authorName) {
    embed.setAuthor({ name: renderCountingDmText(design.authorName, context, 256), iconURL: design.authorIconUrl || undefined });
  }
  if (design.thumbnailUrl) embed.setThumbnail(design.thumbnailUrl);
  if (design.imageUrl) embed.setImage(design.imageUrl);
  if (design.footerText) {
    embed.setFooter({ text: renderCountingDmText(design.footerText, context, 2048), iconURL: design.footerIconUrl || undefined });
  }
  if (design.timestamp) embed.setTimestamp();
  return embed;
};

/* --------------------------- Panel-Design (Studio) ----------------------- */

const defaultCountingPanelDesign = () => ({
  content: '',
  outsideImageUrl: '',
  outsideImageAttachment: null,
  embed: {
    title: '🔢 Aktueller Stand',
    url: '',
    description: '',
    color: '#6ee7ff',
    authorName: 'FALLEN HEAVEN · ZÄHL-KANAL',
    authorIconUrl: '',
    thumbnailUrl: '',
    imageUrl: '',
    footerText: 'Nur die nächste Zahl zählt – viel Erfolg!',
    footerIconUrl: '',
    timestamp: true,
    fields: []
  }
});

const safePanelText = (value, fallback = '', max = 4096) => String(value ?? fallback).slice(0, max);
const expandedCountingTopLine = (position) => `{topMarker${position}} {top${position}} – **{topValue${position}}**`;
const migrateCountingTopValue = (input) => {
  let result = String(input || '').replaceAll('{top}', [1, 2, 3].map(expandedCountingTopLine).join('\n'));
  for (let position = 1; position <= 3; position += 1) {
    result = result.replaceAll(`{topBlock${position}}`, expandedCountingTopLine(position));
  }
  return result.replace(/\n{2,}/g, '\n');
};

const normalizeCountingPanelDesign = (value = {}) => {
  const fallback = defaultCountingPanelDesign();
  const embed = value?.embed && typeof value.embed === 'object' ? value.embed : {};
  return {
    content: safePanelText(value?.content, fallback.content, 2000),
    outsideImageUrl: /^https?:\/\//i.test(String(value?.outsideImageUrl || '')) ? String(value.outsideImageUrl) : '',
    outsideImageAttachment: value?.outsideImageAttachment && typeof value.outsideImageAttachment === 'object'
      ? {
        id: String(value.outsideImageAttachment.id || ''),
        url: String(value.outsideImageAttachment.url || ''),
        name: String(value.outsideImageAttachment.name || 'fallen-heaven-counting.png'),
        size: Math.max(0, Number(value.outsideImageAttachment.size || 0)),
        ...(value.outsideImageAttachment.anchored === true
          ? { anchored: true, channelId: String(value.outsideImageAttachment.channelId || ''), messageId: String(value.outsideImageAttachment.messageId || '') }
          : {}),
        ...(value.outsideImageAttachment.localAsset === true ? { localAsset: true, mime: String(value.outsideImageAttachment.mime || '') } : {})
      }
      : null,
    embed: {
      title: safePanelText(embed.title, fallback.embed.title, 256),
      url: /^https?:\/\//i.test(String(embed.url || '')) ? String(embed.url) : '',
      description: safePanelText(embed.description, fallback.embed.description, 4096),
      color: String(embed.color || fallback.embed.color).slice(0, 16),
      authorName: safePanelText(embed.authorName, fallback.embed.authorName, 256),
      authorIconUrl: /^https?:\/\//i.test(String(embed.authorIconUrl || '')) ? String(embed.authorIconUrl) : '',
      thumbnailUrl: /^https?:\/\//i.test(String(embed.thumbnailUrl || '')) ? String(embed.thumbnailUrl) : '',
      imageUrl: /^https?:\/\//i.test(String(embed.imageUrl || '')) ? String(embed.imageUrl) : '',
      footerText: safePanelText(embed.footerText, fallback.embed.footerText, 2048),
      footerIconUrl: /^https?:\/\//i.test(String(embed.footerIconUrl || '')) ? String(embed.footerIconUrl) : '',
      timestamp: embed.timestamp !== false,
      fields: (Array.isArray(embed.fields) ? embed.fields : []).slice(0, 21).map((field) => ({
        name: safePanelText(field?.name, '', 256),
        value: safePanelText(migrateCountingTopValue(field?.value), '', 1024),
        inline: field?.inline === true
      })).filter((field) => field.name || field.value)
    }
  };
};

const parseHexColor = (value) => {
  const parsed = Number.parseInt(String(value || '#6ee7ff').replace('#', ''), 16);
  return Number.isFinite(parsed) ? parsed : 0x6ee7ff;
};

const countingChannel = (guild, conf) => {
  if (!conf.channelId) return null;
  return guild?.channels?.cache?.get(conf.channelId) || null;
};

/* ------------------------------ Reine Kernlogik -------------------------- */

// Extrahiert eine Ganzzahl aus dem Nachrichteninhalt. Nur reine Zahlen
// (ohne Komma, Punkt, Währungssymbole, Text) sind gültig – wie bei Countr.
const parseCount = (content) => {
  if (typeof content !== 'string') return null;
  const match = /^\s*(\d{1,15})\s*$/.exec(content);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isSafeInteger(value) || value < 0) return null;
  return value;
};

// Entscheidet ohne Nebenwirkungen, wie eine Nachricht zu bewerten ist.
// Rückgabe: { kind: 'success'|'fail'|'ignored', reason, value?, expected?, self? }
const evaluateCount = ({ state, conf, authorId, content, isBot = false, isWebhook = false, memberRoles = [], now = Date.now() }) => {
  if (isBot || isWebhook) return { kind: 'ignored', reason: 'bot' };
  const excludedIds = new Set(Array.isArray(conf?.excludedRoleIds) ? conf.excludedRoleIds : []);
  if (excludedIds.size && memberRoles.some((roleId) => excludedIds.has(String(roleId)))) {
    return { kind: 'ignored', reason: 'excluded-role' };
  }
  const value = parseCount(content);
  if (value === null) return { kind: 'ignored', reason: 'not-a-number' };
  if (value > conf.maxCount) return { kind: 'fail', reason: 'above-max', value };
  const expected = Math.max(0, Number(state.count || 0)) + 1;
  const sameUser = String(authorId || '') === String(state.lastUserId || '');
  if (value === expected) {
    if (conf.preventSelfCount && sameUser) {
      return conf.selfCountIsFail
        ? { kind: 'fail', reason: 'self-count', value, expected }
        : { kind: 'ignored', reason: 'self-count' };
    }
    return { kind: 'success', value, expected, self: sameUser };
  }
  return { kind: 'fail', reason: 'wrong-number', value, expected };
};

// Wendet das Ergebnis auf den State an (reine Mutation, für Tests nutzbar).
// Rückgabe: { milestone: boolean, changed: boolean }
const applyCountResult = (state, conf, result, authorId, now = Date.now()) => {
  if (result?.kind !== 'success' && result?.kind !== 'fail') return { milestone: false, changed: false };
  const userKey = String(authorId || '');
  if (!userKey) return { milestone: false, changed: false };
  const user = state.users[userKey] || (state.users[userKey] = { correct: 0, wrong: 0, streak: 0, bestStreak: 0, lastAt: 0 });
  if (result.kind === 'success') {
    state.count = result.value;
    state.lastUserId = userKey;
    state.lastAt = now;
    user.correct += 1;
    user.streak += 1;
    if (user.streak > user.bestStreak) user.bestStreak = user.streak;
    user.lastAt = now;
    const milestone = Array.isArray(conf.milestones) && conf.milestones.includes(result.value);
    return { milestone: Boolean(milestone), changed: true };
  }
  // Fehlversuch: Zähler fällt auf resetValue zurück, Serie der Person ist weg.
  // Wichtig: Der Verursacher bleibt „dran" – dieselbe Person darf auch nach
  // einem Reset nicht zweimal hintereinander agieren (keine Person in Folge).
  state.count = conf.resetValue;
  state.lastUserId = '';
  state.lastAt = now;
  state.fails = (Number(state.fails) || 0) + 1;
  state.lastFailAt = now;
  state.lastFailUserId = userKey;
  user.wrong += 1;
  user.streak = 0;
  user.lastAt = now;
  return { milestone: false, changed: true };
};

const milestoneEligible = (guildId, value, now = Date.now()) => {
  const key = String(guildId);
  const entry = milestoneCooldowns.get(key);
  if (entry && entry.value === value && now - entry.at < MILESTONE_COOLDOWN_MS) return false;
  milestoneCooldowns.set(key, { value, at: now });
  return true;
};

const renderMilestoneMessage = (template, userId, value, next = 1) => String(template || '')
  .replaceAll('{user}', `<@${userId}>`)
  .replaceAll('{mention}', `<@${userId}>`)
  .replaceAll('{count}', String(value))
  .replaceAll('{next}', String(next));

/* ------------------------------- Nachricht verarbeiten ------------------- */

// Rolling-Window-Fälligkeit: Nach `keep` neuen Nachrichten seit dem letzten
// Aufräumen wird gelöscht (keep=5 → jeder 6. Zug räumt die älteste weg).
// keep=0 (alles außer Panel weg) → jeder 2. Zug.
const cleanupDue = (since, keep) => since >= Math.max(2, Math.floor(Number(keep) || 0) + 1);

const processCountMessage = async ({ message, cfg }) => {
  const conf = settings(cfg);
  if (!conf.enabled || !message?.guildId) return;
  if (String(message.channelId || message.channel?.id || '') !== conf.channelId) return;
  if (!message.author?.bot && conf.clearChannelOnFail) observeCountingMessage(message);

  const state = await guildState(message.guildId);
  // Gesperrte User dürfen nicht zählen: Nachricht still entfernen (wenn
  // Löschen aktiv) und ignorieren – die Sperre ist die Konsequenz.
  if (isUserCountingLocked(state, message.author?.id)) {
    if (conf.deleteWrongMessages && message.deletable) {
      void message.delete().catch((error) => {
        quietLog(QUIET_LOG_SCOPE.counting, error, `message.delete fehlgeschlagen: Kanal ${message.channel?.id}`);
      });
    }
    return;
  }
  const roles = message.member?.roles?.cache?.map((role) => role.id) || [];
  const result = evaluateCount({
    state,
    conf,
    authorId: message.author?.id,
    content: message.content,
    isBot: Boolean(message.author?.bot),
    isWebhook: Boolean(message.webhookId),
    memberRoles: roles,
    now: Number(message.createdTimestamp || Date.now())
  });

  if (result.kind === 'ignored') return;

  const outcome = applyCountResult(state, conf, result, message.author?.id, Number(message.createdTimestamp || Date.now()));
  if (outcome.changed) scheduleSave();

  if (result.kind === 'success') {
    // Reaktion ZUERST – sie ist das sichtbare „der Bot hat es gesehen“ und
    // darf nie hinter dem Rolling-Window oder Panel-Update warten.
    const reaction = conf.successReaction;
    if (reaction) {
      enqueueCountingReaction(message, reaction);
    }
    // Rolling-Window beim Zählen: Es bleiben immer nur die neuesten N
    // Nachrichten (einstellbar, Standard 5). Das Aufräumen läuft NUR wenn es
    // wirklich fällig ist – vorher kein messages.fetch/bulkDelete pro Zug
    // (das kostete Rate-Limits und verzögerte die Reaktion).
    if (conf.clearChannelOnFail) {
      const guildKey = String(message.guildId || '');
      const since = (cleanupCountdown.get(guildKey) || 0) + 1;
      if (cleanupDue(since, conf.clearChannelKeepMessages)) {
        cleanupCountdown.set(guildKey, 0);
        void requestCountingCleanup({ guild: message.guild, state, channel: message.channel, keep: conf.clearChannelKeepMessages }).catch((error) => {
          quietLog(QUIET_LOG_SCOPE.counting, error, `clearCountingChannel fehlgeschlagen`);
        });
      } else {
        cleanupCountdown.set(guildKey, since);
      }
    }
    // Panel sofort aktualisieren – nicht auf Reaction oder Meilenstein warten.
    refreshStatusPanel({ guild: message.guild, cfg, force: false }).catch((error) => {
      quietLog(QUIET_LOG_SCOPE.counting, error, `refreshStatusPanel fehlgeschlagen`);
    });
    if (outcome.milestone) {
      const value = result.value;
      const channel = message.channel;
      if (channel?.send && milestoneEligible(message.guildId, value)) {
        const template = conf.milestoneMessage || '🎉 **Meilenstein erreicht!** {user} hat bis **{count}** gezählt!';
        void channel.send({ content: renderMilestoneMessage(template, message.author.id, value) }).then((sent) => {
          if (sent) observeCountingMessage(sent);
        }).catch((error) => {
          quietLog(QUIET_LOG_SCOPE.counting, error, `Milestone-Embed senden fehlgeschlagen`);
        });
      }
    }
    return;
  }

  // Fehlversuch – alles non-blocking, damit der Kanal sofort reagiert:
  // Reaction + Löschen + Verlierer-Nachricht + Panel laufen parallel.
  // Verwarnung (Strike) nur bei ECHTEN falschen Zahlen (wrong-number /
  // above-max) UND deutlicher Abweichung – ein knapp daneben liegender Zug
  // (z. B. erwartet 4, gesendet 5) ist tolerabel und verwarnt NICHT. Ein
  // Doppelzug (self-count) verwarnt ebenfalls nicht.
  const egregious = shouldStrikeForResult(result, conf);
  if (conf.strikesEnabled && (result.reason === 'wrong-number' || result.reason === 'above-max') && egregious) {
    void applyStrike({
      guild: message.guild,
      cfg: conf,
      userId: message.author?.id,
      channel: message.channel,
      value: result.value || 0
    }).catch(() => null);
  }
  const reaction = conf.failReaction;
  let reactionCompletion = null;
  if (reaction) {
    reactionCompletion = enqueueCountingReaction(message, reaction);
  }
  if (conf.deleteWrongMessages && message.deletable) {
    if (reactionCompletion && typeof reactionCompletion.finally === 'function') {
      void reactionCompletion.finally(() => message.delete().catch(() => null));
    } else {
      void message.delete().catch(() => null);
    }
  }
  // Panel sofort aktualisieren – nicht auf Verlierer-Nachricht oder Aufräumen warten.
  refreshStatusPanel({ guild: message.guild, cfg, force: false }).catch(() => null);
  // Fehlversuch-Flow („die verkackte Nachricht und alles davor bis zum Embed
  // weg, damit die neue Runde clean beginnt“):
  //   1. Verlierer-Nachricht SOFORT senden – so sieht jeder sofort „Verloren!“
  //      (mit der nächsten Zahl), ohne auf das Aufräumen zu warten.
  //   2. Danach aufräumen: falsche Nachricht + alles ältere wird gelöscht,
  //      nur Panel-Embed, Pins und die frische Verlierer-Nachricht bleiben.
  //   3. Nach clearChannelDelaySeconds (Standard 10 s) wird auch die
  //      Verlierer-Nachricht entfernt – so beginnt die nächste Runde wirklich
  //      sauber. Neue richtige Züge in der Zwischenzeit werden dabei NIEMALS
  //      gelöscht (die Verlierer-Nachricht wird einzeln per ID entfernt).
  if (conf.lossMessagesEnabled && conf.lossMessages.length && message.channel?.send) {
    const template = conf.lossMessages[Math.floor(Math.random() * conf.lossMessages.length)];
    // Nächste Zahl immer mit ausgeben – sonst tippen Leute nach „Start bei 0“
    // fälschlich die 0. Wer {next} schon im Text hat, bekommt keinen Zusatz.
    const nextNumber = conf.resetValue + 1;
    let text = renderMilestoneMessage(template, message.author.id, result.value || 0, nextNumber);
    if (!/{next}/.test(template)) {
      text = `${text}\n\n**Nächste Zahl: ${nextNumber}**`;
    }
    void (async () => {
      const loss = await message.channel.send({ content: text, allowedMentions: { parse: ['users'] } }).catch((error) => {
        quietLog(QUIET_LOG_SCOPE.counting, error, `Verlierer-Nachricht senden fehlgeschlagen`);
        return null;
      });
      if (loss) observeCountingMessage(loss);
      if (conf.clearChannelOnFail) {
        cleanupCountdown.set(String(message.guildId || ''), 0);
        try {
          await requestCountingCleanup({
            guild: message.guild,
            state,
            channel: message.channel,
            keep: 0,
            preserveIds: loss?.id ? [loss.id] : []
          });
        } catch {
          // Aufräumen darf den Verlierer-Flow nie abbrechen.
        }
      }
      if (loss?.id) {
        scheduleLossMessageRemoval({
          channel: message.channel,
          messageId: loss.id,
          delayMs: conf.clearChannelDelaySeconds * 1000,
          cfg
        });
      }
    })();
  } else if (conf.clearChannelOnFail) {
    // Keine Verlierer-Nachricht aktiv → nur das Embed (und Pins) behalten.
    cleanupCountdown.set(String(message.guildId || ''), 0);
    void requestCountingCleanup({ guild: message.guild, state, channel: message.channel, keep: 0 }).catch((error) => {
      quietLog(QUIET_LOG_SCOPE.counting, error, `clearCountingChannel (Reset) fehlgeschlagen`);
    });
  }
};

/* --------------------------- Chat-Aufräumung ----------------------------- */

// Entfernt die Verlierer-Nachricht nach der einstellbaren Anzeigedauer
// (clearChannelDelaySeconds, Standard 10 s). Nur die Verlierer-Nachricht
// selbst wird gelöscht – neue richtige Züge bleiben stehen und werden vom
// Rolling-Window verwaltet. Läuft asynchron und bricht nie.
const scheduleLossMessageRemoval = ({ channel, messageId, delayMs, cfg }) => {
  if (!messageId || !Number.isFinite(delayMs)) return;
  const remove = () => {
    const conf = settings(cfg);
    if (!conf.enabled || !channel?.id || String(channel.id) !== conf.channelId) return;
    void channel.messages.fetch(messageId)
      .then((entry) => entry.delete().then(() => {
        forgetCountingMessages(channel.id, [messageId]);
      }).catch(() => null))
      .catch(() => null);
  };
  if (delayMs <= 0) {
    remove();
    return;
  }
  const timer = setTimeout(remove, delayMs);
  timer.unref?.();
};

// Hält den Zähl-Kanal schlank: Es bleiben immer nur die neuesten `keep`
// Nachrichten stehen (Rolling-Window), alles Ältere wird gelöscht. Das
// Panel-Embed und angepinnte Nachrichten bleiben IMMER erhalten – egal was.
// `preserveIds` schützt zusätzliche Nachrichten (z. B. die frische
// Verlierer-Nachricht beim Fehlversuch). Batches von 10 (Rate-Limit-safe),
// bei fehlender Berechtigung Einzel-Löschungen.
const clearCountingChannel = async ({ guild, state, channel, keep = 5, preserveIds = [] }) => {
  if (!channel?.isTextBased?.() || channel.isThread?.()) return { deleted: 0, deferredPending: 0 };
  const panelId = String(state?.panel?.messageId || '');
  const keepCount = Math.max(0, Math.min(100, Math.floor(Number(keep) || 0)));
  const protectedIds = new Set([...preserveIds].map(String));
  const pendingReactionIds = pendingReactionIdsForChannel(channel.id);
  const window = cleanupWindowFor(channel.id);
  let messages = window?.messages || null;
  if (!window || !window.hydrated) {
    const fetched = await channel.messages.fetch({ limit: 100 }).catch((error) => {
      quietLog(QUIET_LOG_SCOPE.counting, error, `messages.fetch (Bulk-Delete) fehlgeschlagen: Kanal ${channel.id}`);
      return null;
    });
    cleanupRuntime.fetches += 1;
    if (!fetched) return { deleted: 0, deferredPending: 0 };
    if (window) {
      for (const [id, entry] of fetched) window.messages.set(String(id), entry);
      window.hydrated = true;
      messages = window.messages;
    } else {
      messages = fetched;
    }
  }
  if (!messages?.size) return { deleted: 0, deferredPending: 0 };
  const allCandidates = [...messages.values()]
    .filter((entry) => String(entry.id) !== panelId && !entry.pinned && !protectedIds.has(String(entry.id)) && entry.deletable)
    .sort((left, right) => Number(left.createdTimestamp || 0) - Number(right.createdTimestamp || 0));
  const excess = allCandidates.length - keepCount;
  if (excess <= 0) return { deleted: 0, deferredPending: 0 };
  // Die neuesten `keep` bestimmen sich ueber alle sichtbaren Nachrichten.
  // Innerhalb des eigentlich zu loeschenden Praefix bleiben nur Eintraege mit
  // noch wartender Reaction vorlaeufig stehen; sie werden im naechsten
  // zusammengefassten Cleanup nach erfolgreicher Auslieferung entfernt.
  const deletePrefix = allCandidates.slice(0, excess);
  const deferredPending = deletePrefix.filter((entry) => pendingReactionIds.has(String(entry.id))).length;
  const toDelete = deletePrefix
    .filter((entry) => !pendingReactionIds.has(String(entry.id)));
  let deleted = 0;
  for (let index = 0; index < toDelete.length; index += 10) {
    const batch = toDelete.slice(index, index + 10);
    try {
      const bulkResult = await channel.bulkDelete(batch, true);
      const bulkIds = bulkResult?.keys
        ? new Set([...bulkResult.keys()].map(String))
        : new Set(batch.map((entry) => String(entry.id)));
      deleted += bulkIds.size;
      forgetCountingMessages(channel.id, bulkIds);
      // `filterOld=true` laesst Nachrichten ueber 14 Tagen aus dem Bulk-Call
      // heraus. Diese Eintraege einzeln loeschen, statt sie nur lokal als
      // entfernt zu markieren und dauerhaft im Kanal stehen zu lassen.
      const skipped = batch.filter((entry) => !bulkIds.has(String(entry.id)));
      if (skipped.length) {
        const skippedResults = await Promise.allSettled(skipped.map((entry) => entry.delete()));
        skippedResults.forEach((result, resultIndex) => {
          const entry = skipped[resultIndex];
          if (result.status === 'fulfilled') {
            deleted += 1;
            forgetCountingMessages(channel.id, [entry.id]);
          } else {
            quietLog(QUIET_LOG_SCOPE.counting, result.reason, `alte entry.delete fehlgeschlagen: ${entry.id}`);
          }
        });
      }
    } catch {
      const results = await Promise.allSettled(batch.map((entry) => entry.delete()));
      results.forEach((result, resultIndex) => {
        const entry = batch[resultIndex];
        if (result.status === 'fulfilled') {
          deleted += 1;
          forgetCountingMessages(channel.id, [entry.id]);
        } else {
          quietLog(QUIET_LOG_SCOPE.counting, result.reason, `entry.delete fehlgeschlagen: ${entry.id}`);
        }
      });
    }
  }
  cleanupRuntime.deleted += deleted;
  cleanupRuntime.deferredForReaction += deferredPending;
  return { deleted, deferredPending };
};

const mergeCleanupArgs = (previous, next) => {
  if (!previous) return { ...next, preserveIds: [...(next?.preserveIds || [])] };
  return {
    ...previous,
    ...next,
    keep: Math.min(Number(previous.keep ?? 100), Number(next.keep ?? 100)),
    preserveIds: [...new Set([...(previous.preserveIds || []), ...(next.preserveIds || [])].map(String))]
  };
};

const cleanupJobFor = (channelId) => {
  const key = reactionChannelKey(channelId);
  if (!key) return null;
  if (!cleanupJobs.has(key)) cleanupJobs.set(key, {
    channelId: key,
    worker: null,
    pending: false,
    latestArgs: null,
    deferredArgs: null,
    retryTimer: null
  });
  return cleanupJobs.get(key);
};

const runCountingCleanupJob = (job) => {
  if (!job || job.worker) return job?.worker || Promise.resolve();
  job.worker = (async () => {
    while (job.pending) {
      job.pending = false;
      const args = job.latestArgs;
      job.latestArgs = null;
      cleanupRuntime.runs += 1;
      const result = await clearCountingChannel(args);
      job.deferredArgs = result?.deferredPending > 0
        ? mergeCleanupArgs(job.deferredArgs, args)
        : null;
    }
  })().finally(() => {
    job.worker = null;
    if (job.pending) runCountingCleanupJob(job);
  });
  return job.worker;
};

const requestCountingCleanup = (args) => {
  const job = cleanupJobFor(args?.channel?.id);
  if (!job) return Promise.resolve({ deleted: 0, deferredPending: 0 });
  cleanupRuntime.requested += 1;
  if (job.worker || job.pending) cleanupRuntime.coalesced += 1;
  job.latestArgs = mergeCleanupArgs(job.latestArgs, args);
  job.pending = true;
  return runCountingCleanupJob(job);
};

const scheduleDeferredCountingCleanup = (channelId) => {
  const job = cleanupJobs.get(reactionChannelKey(channelId));
  if (!job?.deferredArgs || job.retryTimer) return;
  job.retryTimer = setTimeout(() => {
    job.retryTimer = null;
    const args = job.deferredArgs;
    job.deferredArgs = null;
    void requestCountingCleanup(args).catch((error) => {
      quietLog(QUIET_LOG_SCOPE.counting, error, `verzoegertes Cleanup fehlgeschlagen: Kanal ${channelId}`);
    });
  }, 150);
  if (job.retryTimer.unref) job.retryTimer.unref();
};

const waitForCountingCleanupIdle = async (channelId = '') => {
  const selected = channelId
    ? [cleanupJobs.get(reactionChannelKey(channelId))].filter(Boolean)
    : [...cleanupJobs.values()];
  for (const job of selected) {
    while (job.worker || job.pending) {
      if (!job.worker && job.pending) runCountingCleanupJob(job);
      await job.worker;
    }
  }
};

/* ------------------- Verwarnungen & Chat-Sperre (Strikes) ----------------- */
// Wer wirklich unpassende Zahlen schreibt (Fehlversuch), bekommt 1 Verwarnung.
// Nach strikesToLock Verwarnungen folgt eine Chat-Sperre für strikeLockHours.
// Die Sperren werden persistent in der State-Datei gespeichert (at/until) und
// überleben Neustart/Offline – wie die Call-Sperren der öffentlichen
// Call-Moderation. Freigabe ist event-basiert (Timer beim Sperren + Restore
// beim Start), kein Polling. Der Strike-Zähler pro User bleibt erhalten, damit
// nach der Freigabe die bisherigen Verwarnungen nicht verloren gehen.

const strikeKey = (guildId, userId) => `${String(guildId || '')}:${String(userId || '')}`;

// Toleranzschwelle für eine Verwarnung: Ein knapp daneben liegender Zug
// (Abweichung ≤ strikeTolerance) ist ein normaler Fehler und verwarnt NICHT.
// Erst deutlichere Abweichungen oder Werte über dem Cap gelten als
// „wirklich unpassende Zahl“. Doppelzüge verwarnt der Aufrufer ohnehin nie.
const shouldStrikeForResult = (result, conf) => {
  if (!result || (result.reason !== 'wrong-number' && result.reason !== 'above-max')) return false;
  if (result.reason === 'above-max') return true;
  const expectedValue = Number(result.expected ?? Number(conf?.resetValue || 0) + 1);
  const deviation = Math.abs(Number(result.value || 0) - expectedValue);
  const tolerance = Math.max(0, Number(conf?.strikeTolerance) || 1);
  return deviation > tolerance;
};

const getStrikeCount = (state, userId) => {
  const entry = state.strikes?.[String(userId || '')];
  return Math.max(0, Math.floor(Number(entry?.count) || 0));
};

const setStrikeCount = (state, userId, count) => {
  state.strikes ||= {};
  const key = String(userId || '');
  if (count <= 0) {
    delete state.strikes[key];
    return;
  }
  const previous = state.strikes[key] || {};
  state.strikes[key] = { count, firstAt: previous.firstAt || Date.now(), lastAt: Date.now() };
};

const isUserCountingLocked = (state, userId, now = Date.now()) => {
  const lock = state.locks?.[String(userId || '')];
  return Boolean(lock && Number(lock.until || 0) > now);
};

// Entfernt/stellt den Kanal-Zugriff für die Sperrzeit her: Während der Sperre
// hat der User KEINEN Zugriff auf den Zähl-Kanal (ViewChannel + SendMessages
// aus). Beim Freigeben werden die Overwrites entfernt. Exakt das Muster der
// Call-Sperren der öffentlichen Call-Moderation.
const setCountingLockOverwrite = async (guild, userId, channelId, locked) => {
  const channel = guild?.channels?.cache?.get(String(channelId))
    || (guild?.channels?.fetch ? await guild.channels.fetch(String(channelId)).catch((error) => {
      quietLog(QUIET_LOG_SCOPE.counting, error, `channels.fetch fehlgeschlagen: ${channelId}`);
      return null;
    }) : null);
  if (!channel || typeof channel.permissionOverwrites?.edit !== 'function') return false;
  await channel.permissionOverwrites.edit(String(userId), {
    ViewChannel: locked ? false : null,
    SendMessages: locked ? false : null
  }).catch(() => null);
  return true;
};

// Sperrt einen User für die Zähl-Kanal-Sperre (strikeLockHours): Entzieht den
// Kanal-Zugriff, persistiert mit at/until + channelId und armiert den
// Live-Timer. Übersteht Neustarts/Offline.
const activateCountingLock = async ({ guild, state, userId, lockMs, channelId }) => {
  const resolvedState = state || await guildState(guild?.id);
  const now = Date.now();
  const until = now + Math.max(60_000, Number(lockMs || 0));
  resolvedState.locks ||= {};
  resolvedState.locks[String(userId)] = { at: now, until, channelId: String(channelId || '') };
  scheduleSave();
  if (guild && channelId) {
    await setCountingLockOverwrite(guild, userId, channelId, true).catch((error) => {
      quietLog(QUIET_LOG_SCOPE.counting, error, `setCountingLockOverwrite (Lock) fehlgeschlagen: User ${userId}`);
    });
  }
  const key = strikeKey(guild?.id, userId);
  const existingTimer = lockTimers.get(key);
  if (existingTimer) clearTimeout(existingTimer);
  const remainingMs = Math.max(0, until - Date.now());
  const timer = setTimeout(() => {
    lockTimers.delete(key);
    void releaseCountingLock({ guild, state: resolvedState, userId }).catch((error) => {
      quietLog(QUIET_LOG_SCOPE.counting, error, `releaseCountingLock fehlgeschlagen: User ${userId}`);
    });
  }, remainingMs);
  timer.unref?.();
  lockTimers.set(key, timer);
  return { at: now, until, channelId: String(channelId || '') };
};

const releaseCountingLock = async ({ guild, state, userId }) => {
  state.locks ||= {};
  const lock = state.locks[String(userId)];
  if (!lock) return false;
  const expired = Number(lock.until || 0) <= Date.now();
  delete state.locks[String(userId)];
  scheduleSave();
  const key = strikeKey(guild?.id, userId);
  const timer = lockTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    lockTimers.delete(key);
  }
  // Kanal-Zugriff wiederherstellen (Overwrites entfernen).
  if (guild && lock.channelId) {
    await setCountingLockOverwrite(guild, userId, lock.channelId, false).catch((error) => {
      quietLog(QUIET_LOG_SCOPE.counting, error, `setCountingLockOverwrite (Unlock) fehlgeschlagen: User ${userId}`);
    });
  }
  if (expired && guild) {
    // Benachrichtigung, dass die Sperre vorbei ist – als editierbares Embed
    // (Sektion strikeRelease), nie als roher Text.
    const conf = configFor(guild.id) || {};
    const context = countingDmContext({ guild, userId, limit: 3, hours: Math.max(1, Math.round((Number(lock.until || 0) - Number(lock.at || 0)) / 3_600_000)) });
    const embed = buildCountingDmEmbed(guild, 'strikeRelease', context, conf);
    void guild.client.users.fetch(String(userId)).then((user) => user?.send({ embeds: [embed] }).catch((error) => {
      quietLog(QUIET_LOG_SCOPE.counting, error, `DM (Strike-Release) fehlgeschlagen: User ${userId}`);
    })).catch((error) => {
      quietLog(QUIET_LOG_SCOPE.counting, error, `users.fetch (Strike-Release) fehlgeschlagen: ${userId}`);
    });
  }
  return true;
};

// Setzt einen Strike. Ab strikesToLock Strikes wird gesperrt und der Zähler
// zurückgesetzt (die Sperre selbst ist die Konsequenz). Einzelne Verwarnungen
// sind reine Buchhaltung (persistent) – erst die Sperre schränkt ein.
const applyStrike = async ({ guild, cfg, userId, channel, value }) => {
  if (!userId || !guild?.id) return;
  const state = await guildState(guild.id);
  if (isUserCountingLocked(state, userId)) return;
  const count = getStrikeCount(state, userId) + 1;
  const limit = Math.max(1, Number(cfg?.strikesToLock) || 3);
  if (count >= limit) {
    setStrikeCount(state, userId, 0);
    const lockMs = Math.max(60_000, Math.floor(Number(cfg?.strikeLockHours) || 24) * 3_600_000);
    const lock = await activateCountingLock({ guild, state, userId, lockMs, channelId: channel?.id });
    const hours = Math.round(lockMs / 3_600_000);
    // Sperr-DM als editierbares Embed (Sektion strikeLock) – nie roher Text.
    const context = countingDmContext({ guild, userId, limit, hours });
    const embed = buildCountingDmEmbed(guild, 'strikeLock', context, cfg);
    void guild.client.users.fetch(String(userId)).then((user) => user?.send({ embeds: [embed] }).catch((error) => {
      quietLog(QUIET_LOG_SCOPE.counting, error, `DM (Strike-Lock) fehlgeschlagen: User ${userId}`);
    })).catch((error) => {
      quietLog(QUIET_LOG_SCOPE.counting, error, `users.fetch (Strike-Lock) fehlgeschlagen: ${userId}`);
    });
    if (channel?.send) {
      void channel.send({ embeds: [embed] }).catch((error) => {
        quietLog(QUIET_LOG_SCOPE.counting, error, `channel.send (Strike-Lock) fehlgeschlagen: Kanal ${channel.id}`);
      });
    }
    return { locked: true, until: lock.until };
  }
  setStrikeCount(state, userId, count);
  return { locked: false, strikes: count, limit };
};

// Start-Restore: lädt alle gespeicherten Sperren, gibt abgelaufene sofort
// frei und armiert für laufende den Timer neu (weiterzählen über Neustart).
const restoreCountingLocks = async (guild) => {
  const state = await guildState(guild.id);
  const locks = state.locks || {};
  const now = Date.now();
  for (const [userId, lock] of Object.entries(locks)) {
    if (!lock || typeof lock !== 'object') continue;
    if (Number(lock.until || 0) <= now) {
      await releaseCountingLock({ guild, state, userId }).catch(() => null);
      continue;
    }
    // Läuft noch → Kanal-Zugriff erneut entziehen (sicher gegen fehlgeschlagene
    // Overwrites vor dem Neustart) und Live-Timer mit Restzeit neu armen.
    if (lock.channelId) {
      await setCountingLockOverwrite(guild, userId, lock.channelId, true).catch(() => null);
    }
    const key = strikeKey(guild.id, userId);
    const existingTimer = lockTimers.get(key);
    if (existingTimer) clearTimeout(existingTimer);
    const remainingMs = Math.max(0, Number(lock.until || 0) - now);
    const timer = setTimeout(() => {
      lockTimers.delete(key);
      void releaseCountingLock({ guild, state, userId }).catch(() => null);
    }, remainingMs);
    timer.unref?.();
    lockTimers.set(key, timer);
  }
};

/* ------------------------------- Status-Panel ---------------------------- */

// Erkennt, ob eine Nachricht zu unserem Zähl-Panel gehört (Fingerabdruck über
// das Embed: Titel/Autor enthalten „ZÄHL“ oder „Aktueller Stand“).
const isCountingPanelMessage = (message) => {
  if (!message || message.author?.id !== message.guild?.members?.me?.id) return false;
  const embed = message.embeds?.[0];
  if (!embed) return false;
  const title = String(embed.title || '').trim();
  const author = String(embed.author?.name || '').trim();
  const upper = (title + ' ' + author).toUpperCase();
  return Boolean(title && (upper.includes('ZÄHL') || upper.includes('COUNTING') || upper.includes('AKTUELLER STAND')));
};

// Server-Trophäe für einen Platz auflösen (wie Aktivitäts-Liga): trophy1/2/3
// mit Fallback auf 🥇🥈🥉, falls der Server die Emojis nicht hat.
const countingTrophyEmoji = (guild, place) => {
  const definition = TROPHY_EMOJIS[Number(place)];
  if (!definition) return '';
  const emoji = guild?.emojis?.cache?.get?.(definition.id)
    || guild?.emojis?.cache?.find?.((entry) => entry?.name === definition.name);
  if (emoji?.id) return `<${emoji.animated ? 'a' : ''}:${emoji.name || definition.name}:${emoji.id}>`;
  return definition.id ? `<:${definition.name}:${definition.id}>` : definition.fallback;
};

// Dense-Ranking nach Best-Serie (gleicher Wert = gleicher Platz, wie bei der
// Aktivitäts-Liga): Bei Gleichstand teilen sich mehrere User denselben Platz
// (1, 1, 3) statt 1, 2, 3. Sekundär sortiert nach korrekten Zügen.
const rankCountingUsers = (state) => {
  const rows = Object.entries(state.users || {})
    .map(([userId, row]) => ({ userId, ...row }))
    .filter((entry) => Number(entry.bestStreak) > 0 || Number(entry.correct) > 0)
    .sort((left, right) => Number(right.bestStreak) - Number(left.bestStreak) || Number(right.correct) - Number(left.correct));
  let rank = 0;
  let previousValue = null;
  for (const entry of rows) {
    const value = Number(entry.bestStreak);
    if (previousValue === null || value !== previousValue) rank = rank + 1;
    previousValue = value;
    entry.rank = rank;
  }
  return rows;
};

const formatRankingLine = (guild, entry) => {
  const medal = entry.rank <= 3 ? countingTrophyEmoji(guild, entry.rank) : '';
  const marker = medal || `**${entry.rank}.**`;
  return `${marker} <@${entry.userId}> – Best-Serie **${entry.bestStreak}** (${entry.correct.toLocaleString('de-DE')} richtig)`;
};

// Kontext für alle Platzhalter des Panel-Designs. Die Einzel-Platzhalter
// {top1}/{topValue1}/{topMarker1} bis Platz 3 erlauben eigenen Text um jeden
// dynamischen Wert; {top}/{topBlockX} bleiben nur als Legacy-Kompatibilität.
const buildCountingPanelContext = (guild, state) => {
  const ranked = rankCountingUsers(state);
  const top = ranked.slice(0, 3);
  const topText = top.length
    ? top.map((entry) => formatRankingLine(guild, entry)).join('\n')
    : '*Noch keine Züge.*';
  const positionContext = {};
  for (let position = 1; position <= 3; position += 1) {
    const entry = top[position - 1];
    const marker = entry && entry.rank <= 3 ? countingTrophyEmoji(guild, entry.rank) : '';
    const mention = entry ? `<@${entry.userId}>` : '';
    const value = entry ? `Best-Serie ${Number(entry.bestStreak || 0)} (${Number(entry.correct || 0).toLocaleString('de-DE')} richtig)` : '';
    positionContext[`top${position}`] = mention;
    positionContext[`topValue${position}`] = value;
    positionContext[`topMarker${position}`] = marker;
    positionContext[`topBlock${position}`] = entry ? `${marker} ${mention} – **${value}**` : '';
  }
  const lastMember = state.lastUserId ? guild?.members?.cache?.get?.(String(state.lastUserId)) : null;
  return {
    server: guild?.name || 'FALLEN HEAVEN',
    count: Math.max(0, Number(state.count) || 0),
    next: Math.max(0, Number(state.count) || 0) + 1,
    lastCounter: state.lastUserId ? `<@${state.lastUserId}>` : '*–*',
    lastCounterName: lastMember ? (lastMember.displayName || lastMember.user?.username || 'Unbekannt') : '*–*',
    fails: Math.max(0, Number(state.fails) || 0),
    lastFail: state.lastFailUserId ? `<@${state.lastFailUserId}>` : '',
    top: topText,
    ...positionContext
  };
};

const renderCountingPanelText = (template, context, max = 4096) => {
  let result = String(template || '');
  for (const [key, value] of Object.entries(context || {})) {
    const token = `{${key}}`;
    if (value !== null && value !== undefined && result.includes(token)) result = result.split(token).join(String(value));
  }
  return result.slice(0, Math.max(1, max));
};

const defaultCountingPanelFields = (context) => [
  { name: 'Zählerstand', value: `**${context.count.toLocaleString('de-DE')}**\nNächste Zahl: **${context.next.toLocaleString('de-DE')}**`, inline: true },
  { name: 'Letzter Zähler', value: context.lastCounter, inline: true },
  { name: 'Fehlversuche', value: `**${context.fails.toLocaleString('de-DE')}**${context.lastFail ? `\nzuletzt ${context.lastFail}` : ''}`, inline: true },
  { name: '🏅 Beste Serien', value: '{topMarker1} {top1} – **{topValue1}**\n{topMarker2} {top2} – **{topValue2}**\n{topMarker3} {top3} – **{topValue3}**', inline: false }
];

// Baut das Panel-Embed aus dem Studio-Design (mit Platzhaltern) – ohne eigene
// Felder im Design werden die Standard-Felder automatisch ergänzt.
const buildCountingPanelEmbed = (guild, state, conf) => {
  const design = normalizeCountingPanelDesign(conf?.panelDesign);
  const context = buildCountingPanelContext(guild, state);
  const embed = new EmbedBuilder().setColor(parseHexColor(design.embed.color));
  const title = renderCountingPanelText(design.embed.title, context, 256);
  if (title) embed.setTitle(title);
  if (design.embed.url) embed.setURL(renderCountingPanelText(design.embed.url, context, 512));
  const description = renderCountingPanelText(design.embed.description, context, 4096);
  if (description) embed.setDescription(description);
  if (design.embed.authorName) embed.setAuthor({
    name: renderCountingPanelText(design.embed.authorName, context, 256),
    iconURL: design.embed.authorIconUrl || undefined
  });
  if (design.embed.thumbnailUrl) embed.setThumbnail(design.embed.thumbnailUrl);
  if (design.embed.imageUrl) embed.setImage(design.embed.imageUrl);
  if (design.embed.footerText) embed.setFooter({
    text: renderCountingPanelText(design.embed.footerText, context, 2048),
    iconURL: design.embed.footerIconUrl || undefined
  });
  if (design.embed.timestamp) embed.setTimestamp();
  const rawFields = Array.isArray(design.embed.fields) && design.embed.fields.length
    ? design.embed.fields
    : defaultCountingPanelFields(context);
  const fields = rawFields.map((field) => ({
    name: renderCountingPanelText(field?.name, context, 256) || '\u200b',
    value: renderCountingPanelText(field?.value, context, 1024) || '\u200b',
    inline: Boolean(field?.inline)
  }));
  if (fields.length) embed.addFields(fields);
  return embed;
};

// Baut das komplette Nachrichten-Payload (Content + Außenbild + Embed).
// Das Außenbild ist NIE kritisch: schlägt die Auflösung fehl (z. B. lokale
// Datei gelöscht) oder ist es per skipOutsideImage deaktiviert, wird das Panel
// trotzdem gebaut – ein eingefrorenes Panel darf es nicht geben.
const buildCountingPanelPayload = async (guild, state, conf, options = {}) => {
  const design = normalizeCountingPanelDesign(conf?.panelDesign);
  const savedAttachment = design.outsideImageAttachment;
  let outside = { files: null, attachments: null };
  if (options?.skipOutsideImage !== true) {
    try {
      outside = await resolveOutsideImageLite({
        outsideFile: options?.outsideFile || null,
        outsideImageName: String(options?.outsideImageName || 'fallen-heaven-counting.png'),
        defaultImageName: 'fallen-heaven-counting.png',
        savedAttachment: savedAttachment && savedAttachment.anchored !== true ? savedAttachment : null,
        preserveAttachment: options?.allowAttachmentReference === true && Boolean(savedAttachment?.id),
        removeOutsideImage: options?.removeOutsideImage === true
      });
    } catch (error) {
      outside = { files: null, attachments: null };
      console.warn(`[counting] Außenbild-Auflösung fehlgeschlagen – Panel ohne Bild: ${error?.message || error}`);
    }
  }
  const context = buildCountingPanelContext(guild, state);
  const content = renderCountingPanelText(design.content, context, 2000);
  const payload = { embeds: [buildCountingPanelEmbed(guild, state, conf)], allowedMentions: { parse: [] } };
  if (content) payload.content = content;
  if (outside.files) payload.files = outside.files;
  if (outside.attachments) payload.attachments = outside.attachments;
  // Panel-Buttons: „Regeln“ und „Mein Rang“ (Rang auch außerhalb der Top 3).
  const safeLabel = (value, fallback) => String(value ?? fallback).slice(0, 80) || fallback;
  payload.components = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(BUTTON_RULES_ID).setLabel(safeLabel(conf?.rulesButtonLabel, '📖 Regeln')).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(BUTTON_RANK_ID).setLabel(safeLabel(conf?.rankButtonLabel, '🏅 Mein Rang')).setStyle(ButtonStyle.Primary)
    )
  ];
  return payload;
};

const panelChannel = (guild, conf) => {
  if (!conf.statusPanelEnabled || !conf.statusChannelId) return null;
  return guild?.channels?.cache?.get(conf.statusChannelId) || null;
};

// Kern-Sync: genau EINE Panel-Nachricht – vorhandene wird bearbeitet, bei
// veralteter Referenz wird das sichtbare Bot-Panel adoptiert (Duplikate werden
// entfernt), sonst neu gesendet. Das Panel bleibt dabei gepinnt.
const syncCountingPanel = async ({ guild, state, conf, options = {} }) => {
  const channel = panelChannel(guild, conf);
  if (!channel?.isTextBased?.()) return { action: 'channel-unavailable' };
  // Kanal gewechselt → alte Nachricht im alten Kanal entfernen (best effort).
  if (state.panel?.messageId && state.panel?.channelId && state.panel.channelId !== String(channel.id)) {
    const previousChannel = guild.channels.cache.get(state.panel.channelId);
    if (previousChannel?.isTextBased?.()) {
      await previousChannel.messages.fetch(state.panel.messageId).then((message) => message.delete()).catch((error) => {
        quietLog(QUIET_LOG_SCOPE.counting, error, `Previous-Panel löschen fehlgeschlagen: ${state.panel.messageId}`);
      });
    }
    panelMessageCache.delete(String(guild.id));
    state.panel = { channelId: '', messageId: '' };
  }
  // Ziel-Nachricht ermitteln: gespeicherte Referenz aus dem Cache (kein
  // messages.fetch pro Update!) – sonst das sichtbare Bot-Panel adoptieren
  // (Duplikate werden entfernt). Erst NACH der Ermittlung wird das Payload
  // gebaut, damit der Anhang gegen die ECHTE Nachricht referenziert werden kann.
  let message = null;
  if (state.panel?.messageId && state.panel?.channelId === String(channel.id)) {
    const cached = panelMessageCache.get(String(guild.id));
    message = (cached?.editable && String(cached.id) === String(state.panel.messageId)) ? cached : await channel.messages.fetch(state.panel.messageId).catch((error) => {
      quietLog(QUIET_LOG_SCOPE.counting, error, `Panel messages.fetch fehlgeschlagen: ${state.panel.messageId}`);
      return null;
    });
  }
  if (!message?.editable) {
    const candidates = await channel.messages.fetch({ limit: 25 }).catch((error) => {
      quietLog(QUIET_LOG_SCOPE.counting, error, `messages.fetch (Candidates) fehlgeschlagen: Kanal ${channel.id}`);
      return null;
    });
    const panels = candidates
      ? [...candidates.values()].filter(isCountingPanelMessage).sort((left, right) => right.createdTimestamp - left.createdTimestamp)
      : [];
    for (const duplicate of panels.slice(1)) {
      await duplicate.delete().catch(() => null);
    }
    message = panels[0] || null;
    panelMessageCache.set(String(guild.id), message);
  }
  // Repair-Modus (periodischer Timer): Panel existiert bereits → nichts tun.
  // Kein Payload-Bau, kein Edit, kein REST-Call – nur wenn es fehlt, wird es
  // neu gesendet. Echte Aktualisierungen laufen über die Zähl-Events.
  if (options.repair === true && message?.editable) {
    return { action: 'ok', messageId: String(message.id), message };
  }
  // Außenbild wie bei Levelrollen-Panel: Der gespeicherte Anhang wird beim
  // Bearbeiten per ID referenziert (attachments), wenn die Ziel-Nachricht ihn
  // bereits trägt – kein erneutes Hochladen, kein Bild-Austausch bei jedem
  // Refresh. Nur ein frisches Bild aus dem Studio (outsideFile) wird hochgeladen.
  const savedAttachmentId = String(conf?.panelDesign?.outsideImageAttachment?.id || '');
  const canReferenceAttachment = Boolean(
    (options?.allowAttachmentReference === true || message?.editable)
    && savedAttachmentId
    && typeof message?.attachments?.some === 'function'
    && message.attachments.some((attachment) => String(attachment.id) === savedAttachmentId)
  );
  let payload = null;
  try {
    payload = await buildCountingPanelPayload(guild, state, conf, { ...options, allowAttachmentReference: canReferenceAttachment });
  } catch (error) {
    // Bild-Auflösung gescheitert → Panel trotzdem aktualisieren (ohne Bild),
    // statt einzufrieren. Ein neues Bild im Studio stellt es wieder her.
    console.warn(`[counting] Panel ohne Außenbild (${error?.message || error}) – Panel wird trotzdem aktualisiert.`);
    payload = await buildCountingPanelPayload(guild, state, conf, { ...options, allowAttachmentReference: canReferenceAttachment, skipOutsideImage: true }).catch(() => null);
    if (!payload) return { action: 'failed', lastError: String(error?.message || error).slice(0, 300) };
  }
  if (message?.editable) {
    try {
      await message.edit(payload);
    } catch (error) {
      // Nachricht wurde zwischenzeitlich gelöscht → neu senden; andere Fehler
      // ehrlich melden (kein eingefrorenes Panel durch stille Fehler).
      if (String(error?.message || '').toLowerCase().includes('unknown message')) {
        panelMessageCache.delete(String(guild.id));
        message = await channel.send(payload).catch(() => null);
      } else {
        return { action: 'failed', lastError: `Panel konnte nicht bearbeitet werden: ${String(error?.message || error).slice(0, 200)}` };
      }
    }
  } else {
    message = await channel.send(payload).catch(() => null);
  }
  if (!message) return { action: 'failed', lastError: 'Das Panel konnte nicht gesendet werden.' };
  panelMessageCache.set(String(guild.id), message);
  if (!message.pinned) await message.pin().catch(() => null);
  state.panel = { channelId: String(channel.id), messageId: String(message.id) };
  scheduleSave();
  return { action: 'updated', messageId: String(message.id), message };
};

const performStatusPanelRefresh = async ({ guild, cfg, repair = false }) => {
  const conf = settings(cfg);
  if (!conf.enabled) return null;
  const state = await guildState(guild.id);
  if (!conf.statusPanelEnabled || !conf.statusChannelId) {
    // Panel deaktiviert oder Kanal entfernt → alte Nachricht aufräumen.
    if (state.panel?.messageId) await removeStatusPanel(guild, state);
    return null;
  }
  const channel = panelChannel(guild, conf);
  if (!channel?.isTextBased?.()) return null;
  try {
    const result = await syncCountingPanel({ guild, state, conf, options: { repair } });
    panelRuntime.synced += 1;
    return result?.message || null;
  } catch {
    return null;
  }
};

const panelRefreshJobFor = (guildId) => {
  const key = String(guildId || '');
  if (!panelRefreshJobs.has(key)) panelRefreshJobs.set(key, {
    guildId: key,
    worker: null,
    timer: null,
    pendingArgs: null
  });
  return panelRefreshJobs.get(key);
};

const armTrailingPanelRefresh = (job) => {
  if (!job?.pendingArgs || job.timer || job.worker) return;
  const elapsed = Date.now() - (panelUpdatedAt.get(job.guildId) || 0);
  const force = job.pendingArgs.force === true || job.pendingArgs.repair === true;
  const delay = force ? 0 : Math.max(0, PANEL_MIN_UPDATE_MS - elapsed);
  job.timer = setTimeout(() => {
    job.timer = null;
    const args = job.pendingArgs;
    job.pendingArgs = null;
    void runPanelRefreshJob(job, args);
  }, delay);
  if (job.timer.unref) job.timer.unref();
};

const runPanelRefreshJob = (job, args) => {
  if (job.worker) {
    job.pendingArgs = args;
    panelRuntime.coalesced += 1;
    return job.worker;
  }
  panelUpdatedAt.set(job.guildId, Date.now());
  job.worker = performStatusPanelRefresh(args).finally(() => {
    job.worker = null;
    if (job.pendingArgs) armTrailingPanelRefresh(job);
  });
  return job.worker;
};

const refreshStatusPanel = async ({ guild, cfg, force = false, repair = false }) => {
  if (!guild?.id) return null;
  panelRuntime.requested += 1;
  const job = panelRefreshJobFor(guild.id);
  const args = { guild, cfg, force, repair };

  if (repair && (job.worker || job.timer || job.pendingArgs)) {
    // Ein echter Zaehlerstand wartet bereits. Der periodische Existenzcheck
    // darf ihn nicht durch einen no-op Repair ersetzen.
    return null;
  }

  if (force || repair) {
    clearTimeout(job.timer);
    job.timer = null;
    if (job.worker) {
      job.pendingArgs = args;
      panelRuntime.coalesced += 1;
      await job.worker;
      // Der laufende Sync kann bereits einen normalen Nachlauf geplant haben.
      // Fuer explizite Force-/Repair-Aufrufe wird dieser ersetzt und sofort
      // ausgefuehrt, damit der API-Aufrufer auf das echte Ergebnis wartet.
      clearTimeout(job.timer);
      job.timer = null;
      const pending = job.pendingArgs || args;
      job.pendingArgs = null;
      return runPanelRefreshJob(job, pending);
    }
    job.pendingArgs = null;
    return runPanelRefreshJob(job, args);
  }

  const elapsed = Date.now() - (panelUpdatedAt.get(String(guild.id)) || 0);
  if (!job.worker && !job.timer && elapsed >= PANEL_MIN_UPDATE_MS) {
    return runPanelRefreshJob(job, args);
  }
  job.pendingArgs = args;
  panelRuntime.coalesced += 1;
  if (!job.worker) armTrailingPanelRefresh(job);
  return null;
};

const removeStatusPanel = async (guild, state) => {
  panelMessageCache.delete(String(guild?.id || ''));
  if (!state?.panel?.messageId) return;
  const channel = guild?.channels?.cache?.get(state.panel.channelId);
  if (!channel?.isTextBased?.()) return;
  const message = await channel.messages.fetch(state.panel.messageId).catch(() => null);
  if (message?.author?.id === guild.members.me?.id) {
    await message.delete().catch(() => null);
  }
  state.panel = { channelId: '', messageId: '' };
  scheduleSave();
};

const startPanelRepair = (guild, cfg) => {
  const guildId = String(guild.id);
  clearInterval(panelTimers.get(guildId));
  const timer = setInterval(() => {
    const conf = settings(cfg);
    if (!conf.enabled) return;
    refreshStatusPanel({ guild, cfg, repair: true }).catch(() => null);
  }, PANEL_REPAIR_MS);
  if (timer.unref) timer.unref();
  panelTimers.set(guildId, timer);
};

const stopPanelRepair = (guildId) => {
  clearInterval(panelTimers.get(String(guildId)));
  panelTimers.delete(String(guildId));
};

/* ------------------------------- API fürs Dashboard ---------------------- */

const getCountingStats = async (guildId) => {
  const guild = guildId instanceof Object && guildId?.id ? guildId : null;
  if (!guild) return null;
  const state = await guildState(guild.id);
  const topUsers = Object.entries(state.users || {})
    .map(([userId, row]) => ({
      userId,
      correct: Math.max(0, Math.floor(Number(row.correct) || 0)),
      wrong: Math.max(0, Math.floor(Number(row.wrong) || 0)),
      streak: Math.max(0, Math.floor(Number(row.streak) || 0)),
      bestStreak: Math.max(0, Math.floor(Number(row.bestStreak) || 0)),
      lastAt: Math.max(0, Number(row.lastAt) || 0)
    }))
    .sort((left, right) => right.correct - left.correct || right.bestStreak - left.bestStreak)
    .slice(0, 10);
  return {
    count: Math.max(0, Math.floor(Number(state.count) || 0)),
    next: Math.max(0, Math.floor(Number(state.count) || 0)) + 1,
    lastUserId: String(state.lastUserId || ''),
    lastAt: Math.max(0, Number(state.lastAt) || 0),
    fails: Math.max(0, Math.floor(Number(state.fails) || 0)),
    lastFailUserId: String(state.lastFailUserId || ''),
    lastFailAt: Math.max(0, Number(state.lastFailAt) || 0),
    totalCounters: Object.keys(state.users || {}).length,
    topUsers,
    runtime: getCountingRuntimeSnapshot()
  };
};

// Echter Discord-Avatar (Member/Guild-Avatar bevorzugt, sonst User-Avatar,
// leere Zeichenkette = kein Bild). Gleiches Muster wie activityRace.
const resolveCountingAvatar = (member, options = { size: 64, extension: 'png' }) => {
  const user = member?.user || null;
  if (!user?.id) return '';
  const resolved = member?.displayAvatarURL?.(options) || user?.displayAvatarURL?.(options);
  if (resolved) return String(resolved);
  const guildAvatar = String(member?.avatar || '').trim();
  if (guildAvatar && member?.guild?.id) {
    const extension = String(guildAvatar.startsWith('a_') ? 'gif' : (options.extension || 'png')).replace(/[^a-z0-9]/gi, '').toLowerCase() || 'png';
    const size = Number(options.size || 64);
    const normalizedSize = Number.isFinite(size) && size > 0 ? Math.min(4096, Math.max(16, Math.round(size))) : 64;
    return `https://cdn.discordapp.com/guilds/${String(member.guild.id)}/users/${String(user.id)}/avatars/${guildAvatar}.${extension}?size=${normalizedSize}`;
  }
  if (user.avatar) {
    const extension = String(user.avatar.startsWith('a_') ? 'gif' : (options.extension || 'png')).replace(/[^a-z0-9]/gi, '').toLowerCase() || 'png';
    const size = Number(options.size || 64);
    const normalizedSize = Number.isFinite(size) && size > 0 ? Math.min(4096, Math.max(16, Math.round(size))) : 64;
    return `https://cdn.discordapp.com/avatars/${String(user.id)}/${String(user.avatar)}.${extension}?size=${normalizedSize}`;
  }
  return '';
};

// Liefert alle AKTIV laufenden Chat-Sperren mit Restzeit, Anzeigename und
// Avatar (für das Dashboard: „Gesperrte Spieler“ anzeigen + manuell aufheben).
// Abgelaufene Sperren werden dabei nicht gelistet – sie werden ohnehin
// event-basiert freigegeben.
const getCountingLocks = async (guild) => {
  const resolvedGuild = guild instanceof Object && guild?.id ? guild : null;
  if (!resolvedGuild) return { locks: [] };
  const state = await guildState(resolvedGuild.id);
  const now = Date.now();
  const locks = Object.entries(state.locks || {})
    .filter(([, lock]) => lock && typeof lock === 'object' && Number(lock.until || 0) > now)
    .map(([userId, lock]) => {
      const member = resolvedGuild.members?.cache?.get?.(String(userId));
      return {
        userId,
        name: member?.displayName || member?.user?.username || 'Unbekannt',
        avatarUrl: resolveCountingAvatar(member),
        at: Math.max(0, Number(lock.at || 0)),
        until: Math.max(0, Number(lock.until || 0)),
        remainingMs: Math.max(0, Number(lock.until || 0) - now),
        channelId: String(lock.channelId || '')
      };
    })
    .sort((left, right) => left.remainingMs - right.remainingMs);
  return { locks };
};

// Hebt eine laufende Chat-Sperre manuell auf (Dashboard): gibt den
// Kanal-Zugriff sofort zurück und entfernt den Lock-Eintrag. Keine
// Freigabe-DM, weil ein Admin aktiv eingegriffen hat (anders als beim
// natürlichen Ablauf der Sperrzeit).
const removeCountingLock = async ({ guild, userId } = {}) => {
  const resolvedGuild = guild instanceof Object && guild?.id ? guild : null;
  if (!resolvedGuild || !userId) return { ok: false, userId: String(userId || '') };
  const state = await guildState(resolvedGuild.id);
  const released = await releaseCountingLock({ guild: resolvedGuild, state, userId });
  return { ok: released, userId: String(userId) };
};

const resetCounting = async ({ guild, cfg = {}, actorId = '' } = {}) => {
  const resolvedGuild = guild instanceof Object && guild?.id ? guild : null;
  if (!resolvedGuild) throw new Error('Server wurde nicht gefunden.');
  const state = await guildState(resolvedGuild.id);
  state.count = 0;
  state.lastUserId = '';
  state.lastAt = 0;
  state.fails = 0;
  state.lastFailAt = 0;
  state.lastFailUserId = '';
  state.users = {};
  // Expliziter Admin-Reset hebt auch alle Chat-Sperren und Verwarnungen auf
  // (inkl. laufender Timer) – sonst gäbe es keinen Weg, eine Sperre manuell
  // aufzuheben. Das widerspricht nicht der Persistenz über Neustarts.
  if (state.locks && typeof state.locks === 'object') {
    for (const userId of Object.keys(state.locks)) {
      const key = strikeKey(resolvedGuild.id, userId);
      const timer = lockTimers.get(key);
      if (timer) {
        clearTimeout(timer);
        lockTimers.delete(key);
      }
    }
    state.locks = {};
  }
  if (state.strikes && typeof state.strikes === 'object') state.strikes = {};
  scheduleSave();
  await removeStatusPanel(resolvedGuild, state).catch(() => null);
  void refreshStatusPanel({ guild: resolvedGuild, cfg, force: true }).catch(() => null);
  return { ok: true, actorId, resetAt: new Date().toISOString() };
};

// Speichert ein Studio-Design für das Zähl-Panel und aktualisiert die
// Live-Nachricht sofort – über den gemeinsamen „Speichern & Kanal aktualisieren“-Helfer
// (identisches Verhalten wie Levelrollen-Panel, Kanal-Info-Embed, Bot-Updates).
// Die dynamischen Werte (Stand, nächste Zahl, letzter Zähler, Fehlversuche, Top)
// bleiben automatisch über die Platzhalter – nur Layout, Texte, Farben, Bilder
// und Felder kommen aus dem Studio.
export const saveCountingPanelDesign = async ({ guild, cfg = {}, template = {} } = {}) => {
  const conf = settings(cfg);
  const channelId = String(template?.channelId || conf?.statusChannelId || '').trim();
  const result = await savePersistentEmbedDesign({
    guild,
    cfg,
    template,
    options: {
      designId: 'counting-panel',
      designName: 'Zähl-Kanal-Panel',
      defaultColor: '#6ee7ff',
      maxFields: 21,
      previousDesign: conf?.panelDesign,
      channelId,
      moduleActive: conf?.enabled === true,
      autoEnable: false,
      defaultImageName: 'fallen-heaven-counting.png',
      buildDesign: ({ embed, preserved, content }) => normalizeCountingPanelDesign({
        content,
        outsideImageUrl: preserved.outsideImageUrl,
        outsideImageAttachment: preserved.outsideImageAttachment,
        embed
      }),
      prepareSyncCfg: ({ cfg: c, design }) => ({
        ...c,
        counting: { ...settings(c), statusChannelId: channelId, panelDesign: design }
      }),
      sync: async ({ guild: g, cfg: c, options: o }) => {
        const nextConf = settings(c);
        const state = await guildState(g.id);
        return syncCountingPanel({ guild: g, state, conf: nextConf, options: o });
      },
      serializeAttachment: serializeMessageAttachment
    }
  });
  return {
    panelDesign: result.design,
    channelId,
    panel: result.status?.messageId
      ? { id: String(result.status.messageId || ''), channelId }
      : null,
    status: result.status
  };
};

// Speichert eine editierbare DM-Design-Sektion (strikeLock / strikeRelease)
// für den Zähl-Kanal – Muster wie savePublicCallVoteDesign.
export const saveCountingDesign = async ({ guild, conf = {}, section = 'strikeLock', template = {} } = {}) => {
  if (!guild) throw new Error('Server wurde nicht gefunden.');
  const sectionId = COUNTING_DESIGN_SECTIONS.includes(String(section)) ? String(section) : 'strikeLock';
  const sources = Array.isArray(template?.embeds) && template.embeds.length ? template.embeds : [template?.embed || template];
  const embed = sources.find((entry) => entry && typeof entry === 'object') || {};
  const normalized = settings(conf);
  const normalizedDesigns = {
    ...normalized.dmDesigns,
    [sectionId]: normalizeCountingDesignSection(sectionId, embed)
  };
  return {
    section: sectionId,
    design: { [sectionId]: normalizedDesigns[sectionId] },
    normalizedDesign: normalizedDesigns
  };
};

/* --------------------------- Panel-Buttons: Regeln & Rang ----------------- */

// Regeln-Ansicht: erklärt kurz, wie der Zähl-Kanal funktioniert.
const buildCountingRulesEmbed = (guild, conf) => {
  const reset = Math.max(0, Number(conf?.resetValue) || 0);
  const lines = [
    '🔢 **So funktioniert der Zähl-Kanal:**',
    '',
    `1️⃣ Sende **genau die nächste Zahl** – aktuell **${reset + 1}**.`,
    '2️⃣ Nur reine Zahlen ohne Text/Symbole zählen.',
    `3️⃣ ${conf?.preventSelfCount ? 'Nicht zweimal hintereinander zählen.' : 'Zählen ist frei möglich.'}`,
    `4️⃣ Bei einem Fehler fällt der Zähler auf **${reset}** zurück und eine neue Runde beginnt.`,
    '5️⃣ Bearbeitete Nachrichten zählen nie.',
    '6️⃣ Meilensteine werden extra gefeiert.',
    ''
  ];
  if (conf?.strikesEnabled) {
    lines.push(`⚠️ **Verwarnungen:** Wer wirklich unpassende Zahlen schreibt, bekommt **1 Verwarnung**. Nach **${Math.max(1, Number(conf?.strikesToLock) || 3)} Verwarnungen** folgt eine **${Math.max(1, Number(conf?.strikeLockHours) || 24)} Std.** Chat-Sperre.`);
    lines.push('');
  }
  lines.push('Viel Erfolg! 🍀');
  return new EmbedBuilder()
    .setColor(parseHexColor(conf?.panelDesign?.embed?.color || '#6ee7ff'))
    .setTitle('📖 Zähl-Kanal – Regeln')
    .setDescription(lines.join('\n'));
};

// „Mein Rang“: zeigt den eigenen Platz (Dense-Ranking) auch außerhalb der
// Top 3 – plus die wichtigsten Kennzahlen des Users.
const buildCountingRankEmbed = (guild, state, userId) => {
  const ranked = rankCountingUsers(state);
  const entry = ranked.find((row) => String(row.userId) === String(userId));
  const member = guild?.members?.cache?.get?.(String(userId));
  const name = member?.displayName || member?.user?.username || 'Du';
  if (!entry) {
    return new EmbedBuilder()
      .setColor(parseHexColor('#6ee7ff'))
      .setTitle('🏅 Dein Rang im Zähl-Kanal')
      .setDescription(`**${name}** hat noch keine Züge. Zähl einfach mit – dein Rang erscheint hier, sobald du die erste richtige Zahl gesendet hast.`);
  }
  const total = ranked.length;
  const medal = entry.rank <= 3 ? countingTrophyEmoji(guild, entry.rank) : '';
  const marker = medal || `**Platz ${entry.rank}**`;
  const fields = [
    { name: 'Rang', value: `${medal || ''} **${entry.rank}.** von ${total} Zählern`, inline: true },
    { name: 'Best-Serie', value: `**${entry.bestStreak}**`, inline: true },
    { name: 'Aktuelle Serie', value: `**${entry.streak}**`, inline: true },
    { name: 'Richtige Züge', value: `**${entry.correct}**`, inline: true },
    { name: 'Fehlversuche', value: `**${entry.wrong}**`, inline: true }
  ];
  return new EmbedBuilder()
    .setColor(parseHexColor('#6ee7ff'))
    .setTitle('🏅 Dein Rang im Zähl-Kanal')
    .setDescription(`${marker} – du bist unter den Top-Zählern.`)
    .addFields(fields);
};

/* ------------------------------- Feature --------------------------------- */

export const feature = {
  id: 'counting',
  name: 'Zähl-Kanal',
  commands: [],
  async onGuildDelete({ guild }) {
    stopPanelRepair(guild?.id);
    if (store?.guilds) delete store.guilds[String(guild?.id || '')];
    if (store) scheduleSave();
  },
  async onClientReady({ guild, cfg }) {
    await ensureLoaded();
    const conf = settings(cfg);
    if (conf.enabled) guildConfigs.set(String(guild.id), cfg);
    if (!conf.enabled) return;
    await guildState(guild.id);
    // Laufende Chat-Sperren nach Neustart wiederherstellen (Restzeit neu armen,
    // abgelaufene sofort freigeben) – event-basiert, kein Polling.
    await restoreCountingLocks(guild).catch(() => null);
    startPanelRepair(guild, cfg);
    await refreshStatusPanel({ guild, cfg, force: true }).catch(() => null);
  },
  async onConfigUpdate({ guild, cfg }) {
    const conf = settings(cfg);
    if (conf.enabled) guildConfigs.set(String(guild.id), cfg);
    if (conf.enabled) {
      await guildState(guild.id);
      startPanelRepair(guild, cfg);
      await refreshStatusPanel({ guild, cfg, force: true }).catch(() => null);
    } else {
      stopPanelRepair(guild?.id);
      const state = await guildState(guild.id);
      await removeStatusPanel(guild, state).catch(() => null);
    }
  },
  async onAnyInteraction({ interaction, cfg, guild }) {
    // Panel-Buttons „Regeln“ / „Mein Rang“ – alles andere weiterreichen.
    if (!interaction?.isButton?.()) return false;
    const customId = String(interaction.customId || '');
    if (customId !== BUTTON_RULES_ID && customId !== BUTTON_RANK_ID) return false;
    const conf = settings(cfg);
    if (!conf.enabled) {
      await interaction.reply({ content: 'Der Zähl-Kanal ist gerade deaktiviert.', flags: MessageFlags.Ephemeral }).catch(() => null);
      return true;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
    try {
      if (customId === BUTTON_RULES_ID) {
        const embed = buildCountingRulesEmbed(guild, conf);
        await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null);
        return true;
      }
      const state = await guildState(guild?.id);
      const embed = buildCountingRankEmbed(guild, state, interaction.user?.id);
      await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null);
      return true;
    } catch {
      return true;
    }
  },
  async onMessageCreate({ message, cfg }) {
    await processCountMessage({ message, cfg });
  },
  async onMessageDelete({ message }) {
    forgetCountingMessages(message?.channelId || message?.channel?.id, [message?.id]);
  },
  async onMessageBulkDelete({ messages, channel }) {
    const ids = messages?.keys ? [...messages.keys()] : [];
    forgetCountingMessages(channel?.id, ids);
  },
  async onMessageUpdate({ message, cfg }) {
    // Bearbeitete Nachrichten zählen NIE – und vorhandene Reaktionen des Bots
    // werden entfernt, damit der Kanal nicht fälschlich „richtig“ anzeigt.
    const conf = settings(cfg);
    if (!conf.enabled || !message?.guildId) return;
    if (String(message.channelId || message.channel?.id || '') !== conf.channelId) return;
    if (message.author?.bot) return;
    try {
      const fresh = message.content === undefined ? await message.fetch().catch(() => message) : message;
      const reactions = fresh?.reactions?.cache;
      if (!reactions || !reactions.size) return;
      const me = message.guild?.members?.me?.id;
      for (const reaction of reactions.values()) {
        if (!me) break;
        await reaction.users.remove(me).catch(() => null);
      }
    } catch {
      // Reaktionen nicht entfernbar – still ignorieren.
    }
  }
};

/* ------------------------------- Exports für Tests ----------------------- */

export {
  activateCountingLock,
  applyCountResult,
  applyStrike,
  buildCountingDmEmbed,
  buildCountingPanelEmbed,
  buildCountingRankEmbed,
  buildCountingRulesEmbed,
  clearCountingChannel,
  enqueueCountingReaction,
  getCountingRuntimeSnapshot,
  countingTrophyEmoji,
  scheduleLossMessageRemoval,
  evaluateCount,
  getCountingLocks,
  getCountingStats,
  getStrikeCount,
  removeCountingLock,
  guildState,
  isUserCountingLocked,
  normalizeCountingDesignSection,
  cleanupDue,
  normalizeCountingPanelDesign,
  observeCountingMessage,
  panelMessageCache,
  parseCount,
  processCountMessage,
  rankCountingUsers,
  refreshStatusPanel,
  releaseCountingLock,
  requestCountingCleanup,
  resetCountingRuntimeForTests,
  renderMilestoneMessage,
  resetCounting,
  restoreCountingLocks,
  settings,
  shouldStrikeForResult,
  syncCountingPanel,
  waitForCountingCleanupIdle,
  waitForCountingReactionIdle
};
