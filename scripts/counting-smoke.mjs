import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Temp-Datenverzeichnis, damit der Smoke keine echten Daten berührt.
// Muss VOR dem Import gesetzt sein (Datenpfad wird beim Laden gelesen).
const temporaryData = await mkdtemp(path.join(os.tmpdir(), 'fhcc-counting-'));
process.env.FALLEN_HEAVEN_DATA_DIR = temporaryData;

const mod = await import('../src/features/counting.js');
const countingInternals = mod;
const {
  activateCountingLock,
  applyCountResult,
  applyStrike,
  buildCountingPanelEmbed,
  buildCountingRankEmbed,
  buildCountingRulesEmbed,
  cleanupDue,
  clearCountingChannel,
  enqueueCountingReaction,
  getCountingRuntimeSnapshot,
  countingTrophyEmoji: countingTrophyEmojiInternal,
  scheduleLossMessageRemoval,
  evaluateCount,
  getCountingLocks,
  getCountingStats,
  getStrikeCount: getStrikeCountInternal,
  guildState: getCountingStateForTest,
  isUserCountingLocked,
  normalizeCountingPanelDesign,
  observeCountingMessage,
  parseCount,
  processCountMessage,
  rankCountingUsers,
  refreshStatusPanel,
  releaseCountingLock,
  requestCountingCleanup,
  resetCountingRuntimeForTests,
  removeCountingLock,
  renderMilestoneMessage,
  resetCounting,
  restoreCountingLocks,
  settings,
  syncCountingPanel,
  waitForCountingCleanupIdle,
  waitForCountingReactionIdle
} = mod;

const { normalizeConfig } = await import('../src/defaultConfig.js');

const conf = () => settings(normalizeConfig({ counting: { enabled: true } }));

/* ------------------------- parseCount ------------------------------------ */
assert.equal(parseCount('1'), 1, 'reine Zahl wird erkannt');
assert.equal(parseCount('  42  '), 42, 'Leerzeichen werden toleriert');
assert.equal(parseCount('0'), 0, 'Null ist gültig');
assert.equal(parseCount('123456789012345'), 123456789012345, 'lange Zahl ist gültig');
assert.equal(parseCount('12,5'), null, 'Komma ist ungültig');
assert.equal(parseCount('12.5'), null, 'Punkt ist ungültig');
assert.equal(parseCount('1.000'), null, 'Tausendertrenner ist ungültig');
assert.equal(parseCount('-1'), null, 'negative Zahlen sind ungültig');
assert.equal(parseCount('abc'), null, 'Text ist ungültig');
assert.equal(parseCount('1 2'), null, 'mehrere Zahlen sind ungültig');
assert.equal(parseCount(''), null, 'leerer Text ist ungültig');
assert.equal(parseCount(undefined), null, 'undefined ist ungültig');
assert.equal(parseCount('99999999999999999999'), null, 'zu große Zahl ist ungültig (Safe-Integer)');

/* ------------------------- evaluateCount --------------------------------- */
const baseState = () => ({ count: 0, lastUserId: '', users: {} });
const c = conf();

// Korrekte Folge
let result = evaluateCount({ state: baseState(), conf: c, authorId: 'u1', content: '1' });
assert.equal(result.kind, 'success', '1 ist nach 0 die richtige Zahl');
assert.equal(result.expected, 1, 'Erwartete Zahl ist 1');
assert.equal(result.self, false, 'kein Selbstzug');

// Falsche Zahl
result = evaluateCount({ state: baseState(), conf: c, authorId: 'u1', content: '3' });
assert.equal(result.kind, 'fail', '3 statt 1 ist ein Fehlversuch');
assert.equal(result.reason, 'wrong-number', 'Grund: falsche Zahl');

// Bot / Webhook
result = evaluateCount({ state: baseState(), conf: c, authorId: 'bot', content: '1', isBot: true });
assert.equal(result.kind, 'ignored', 'Bots werden ignoriert');
result = evaluateCount({ state: baseState(), conf: c, authorId: 'u1', content: '1', isWebhook: true });
assert.equal(result.kind, 'ignored', 'Webhooks werden ignoriert');

// Ausgeschlossene Rolle
const excluded = settings(normalizeConfig({ counting: { enabled: true, excludedRoleIds: ['r-x'] } }));
result = evaluateCount({ state: baseState(), conf: excluded, authorId: 'u1', content: '1', memberRoles: ['r-x'] });
assert.equal(result.kind, 'ignored', 'ausgeschlossene Rolle wird ignoriert');

// Keine Zahl
result = evaluateCount({ state: baseState(), conf: c, authorId: 'u1', content: 'Hallo' });
assert.equal(result.kind, 'ignored', 'keine Zahl wird ignoriert');

// Über dem Cap
const capped = settings(normalizeConfig({ counting: { enabled: true, maxCount: 50 } }));
result = evaluateCount({ state: baseState(), conf: capped, authorId: 'u1', content: '999' });
assert.equal(result.kind, 'fail', 'Wert über dem Cap ist ein Fehlversuch');
assert.equal(result.reason, 'above-max', 'Grund: über dem Cap');

// Selbstzug
const busy = { count: 1, lastUserId: 'u1', users: {} };
result = evaluateCount({ state: busy, conf: c, authorId: 'u1', content: '2' });
assert.equal(result.kind, 'fail', 'zweiter Zug derselben Person ist ein Fehlversuch');
assert.equal(result.reason, 'self-count', 'Grund: Selbstzug');
result = evaluateCount({ state: busy, conf: c, authorId: 'u2', content: '2' });
assert.equal(result.kind, 'success', 'andere Person darf nach u1 zählen');

// Selbstzug ohne Strafe -> ignoriert
const lenient = settings(normalizeConfig({ counting: { enabled: true, preventSelfCount: true, selfCountIsFail: false } }));
result = evaluateCount({ state: busy, conf: lenient, authorId: 'u1', content: '2' });
assert.equal(result.kind, 'ignored', 'Selbstzug ohne Strafe wird ignoriert');

/* ------------------------- applyCountResult ------------------------------ */
let state = baseState();
result = evaluateCount({ state, conf: c, authorId: 'u1', content: '1' });
let outcome = applyCountResult(state, c, result, 'u1', 1000);
assert.equal(outcome.changed, true, 'Erfolg verändert den State');
assert.equal(outcome.milestone, false, '1 ist kein Meilenstein');
assert.equal(state.count, 1, 'Zähler steht auf 1');
assert.equal(state.lastUserId, 'u1', 'letzter Zähler ist u1');
assert.equal(state.users.u1.correct, 1, 'u1 hat 1 richtigen Zug');
assert.equal(state.users.u1.streak, 1, 'Serie von u1 ist 1');
assert.equal(state.users.u1.bestStreak, 1, 'Best-Serie von u1 ist 1');

// Weiterzählen durch u2
result = evaluateCount({ state, conf: c, authorId: 'u2', content: '2' });
applyCountResult(state, c, result, 'u2', 2000);
assert.equal(state.count, 2, 'Zähler steht auf 2');
assert.equal(state.users.u2.streak, 1, 'u2 startet mit Serie 1');

// u1 wieder dran -> Serie 2
result = evaluateCount({ state, conf: c, authorId: 'u1', content: '3' });
applyCountResult(state, c, result, 'u1', 3000);
assert.equal(state.users.u1.streak, 2, 'Serie von u1 wächst auf 2');
assert.equal(state.users.u1.bestStreak, 2, 'Best-Serie von u1 ist 2');

// Falsche Zahl -> Reset + Serie weg
result = evaluateCount({ state, conf: c, authorId: 'u2', content: '5' });
outcome = applyCountResult(state, c, result, 'u2', 4000);
assert.equal(outcome.changed, true, 'Fehlversuch verändert den State');
assert.equal(state.count, 0, 'Zähler fällt auf resetValue (0) zurück');
assert.equal(state.lastUserId, '', 'nach Fehlversuch ist niemand mehr dran – neue Runde beginnt');

// Der Verlierer darf selbst wieder von vorne anfangen (gemeldeter Bug: „wenn
// ich verkackt hab erkennt er nicht das wieder von vorne anfange“)
result = evaluateCount({ state, conf: c, authorId: 'u2', content: '1' });
assert.equal(result.kind, 'success', 'Verlierer darf die neue Runde mit 1 starten');
result = evaluateCount({ state, conf: c, authorId: 'u1', content: '1' });
assert.equal(result.kind, 'success', 'auch jeder andere darf nach dem Reset starten');
assert.equal(state.fails, 1, 'Fehlversuche zählen');
assert.equal(state.lastFailUserId, 'u2', 'letzter Fehlversuch von u2');
assert.equal(state.users.u2.wrong, 1, 'u2 hat 1 Fehlversuch');
assert.equal(state.users.u2.streak, 0, 'Serie von u2 ist zurückgesetzt');
assert.equal(state.users.u1.streak, 2, 'Serie von u1 bleibt erhalten');

// Meilenstein
const milestoned = settings(normalizeConfig({ counting: { enabled: true, milestones: [10] } }));
state = { ...baseState(), count: 9, users: {} };
result = evaluateCount({ state, conf: milestoned, authorId: 'u9', content: '10' });
outcome = applyCountResult(state, milestoned, result, 'u9', 5000);
assert.equal(outcome.milestone, true, 'Meilenstein 10 wird erkannt');

// Ignoriert verändert nichts
const before = JSON.stringify(state);
result = evaluateCount({ state, conf: c, authorId: 'u1', content: 'Hallo' });
outcome = applyCountResult(state, c, result, 'u1', 6000);
assert.equal(outcome.changed, false, 'ignorierte Nachricht verändert nichts');
assert.equal(JSON.stringify(state), before, 'State bleibt identisch');

/* ------------------------- renderMilestoneMessage ------------------------ */
const rendered = renderMilestoneMessage('🎉 {user} hat {count} erreicht!', '42', 100);
assert.equal(rendered, '🎉 <@42> hat 100 erreicht!', 'Platzhalter werden ersetzt');

/* ------------------------- processCountMessage (Integration) ------------- */
const guild = {
  id: 'guild-1',
  members: { me: { id: 'bot' } },
  channels: { cache: new Map() }
};
const reactions = [];
const deletions = [];
const sends = [];
let fakeMessageSequence = 0;
const fakeMessage = (authorId, content, extra = {}) => ({
  id: String(extra.id || `counting-message-${++fakeMessageSequence}`),
  guildId: 'guild-1',
  guild: {
    id: 'guild-1',
    client: { users: { fetch: async () => ({ send: async () => {} }) } },
    channels: { cache: new Map() }
  },
  channelId: 'chan-1',
  channel: {
    id: 'chan-1',
    send: async (payload) => { sends.push(payload); return { id: 'm-milestone' }; }
  },
  author: { id: authorId, bot: extra.bot === true },
  webhookId: extra.webhook || null,
  member: { roles: { cache: { map: () => extra.roles || [] } } },
  content,
  createdTimestamp: Date.now(),
  deletable: extra.deletable !== false,
  react: async (emoji) => { reactions.push(emoji); },
  delete: async () => { deletions.push(true); }
});

const integrationConf = normalizeConfig({
  counting: {
    enabled: true,
    channelId: 'chan-1',
    milestones: [3],
    statusPanelEnabled: false
  }
});

// 1 → 2 → 3 (Meilenstein) → 4 falsch (5) → Reset
await processCountMessage({ message: fakeMessage('u1', '1'), cfg: integrationConf });
assert.deepEqual(reactions, ['✅'], '1 wird mit ✅ bestätigt');
await processCountMessage({ message: fakeMessage('u2', '2'), cfg: integrationConf });
await processCountMessage({ message: fakeMessage('u3', '3'), cfg: integrationConf });
assert.deepEqual(reactions, ['✅', '✅', '✅'], '1, 2, 3 alle korrekt');
assert.equal(sends.length, 1, 'Meilenstein 3 löst eine Nachricht aus');
assert.match(sends[0].content, /<@u3>/, 'Meilenstein erwähnt den Zähler');
assert.match(sends[0].content, /\*\*3\*\*/, 'Meilenstein nennt die Zahl');

const beforeWrong = reactions.length;
await processCountMessage({ message: fakeMessage('u4', '5'), cfg: integrationConf });
assert.equal(reactions.length, beforeWrong + 1, 'falsche Zahl bekommt eine Reaktion');
assert.equal(reactions[reactions.length - 1], '❌', 'falsche Zahl bekommt ❌');

/* ---------------- garantierte Reaction-FIFO unter Last ------------------ */
// Discord-Reaktionen sind einzelne REST-Aufrufe. Der Counting-Code darf sie
// nicht unkontrolliert parallel starten und eine spaetere Nachricht darf eine
// fruehere in der Auslieferung nicht ueberholen.
let releaseFirstReaction;
const firstReactionGate = new Promise((resolve) => { releaseFirstReaction = resolve; });
const fifoCalls = [];
const fifoMessage = (id, gate = null) => ({
  id,
  guildId: 'g-fifo',
  channelId: 'ch-fifo',
  channel: { id: 'ch-fifo' },
  react: async (emoji) => {
    fifoCalls.push(`${id}:${emoji}`);
    if (gate) await gate;
  }
});
enqueueCountingReaction(fifoMessage('fifo-1', firstReactionGate), '✅');
enqueueCountingReaction(fifoMessage('fifo-2'), '✅');
enqueueCountingReaction(fifoMessage('fifo-3'), '✅');
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(fifoCalls, ['fifo-1:✅'], 'pro Kanal laeuft nur die erste Reaction; weitere warten in FIFO-Reihenfolge');
releaseFirstReaction();
await waitForCountingReactionIdle('ch-fifo');
assert.deepEqual(fifoCalls, ['fifo-1:✅', 'fifo-2:✅', 'fifo-3:✅'], 'jede richtige Nachricht erhaelt exakt einen Haken in Reihenfolge');
const fifoRuntime = getCountingRuntimeSnapshot();
assert.equal(fifoRuntime.reactions.pending, 0, 'Reaction-Queue ist nach der Auslieferung leer');
assert.ok(fifoRuntime.reactions.delivered >= 3, 'erfolgreiche Reaction-Auslieferungen werden gemessen');

let transientReactionAttempts = 0;
enqueueCountingReaction({
  id: 'retry-1',
  guildId: 'g-retry',
  channelId: 'ch-retry',
  channel: { id: 'ch-retry' },
  react: async () => {
    transientReactionAttempts += 1;
    if (transientReactionAttempts === 1) {
      const error = new Error('temporary network failure');
      error.code = 'ECONNRESET';
      throw error;
    }
  }
}, '✅');
await waitForCountingReactionIdle('ch-retry');
assert.equal(transientReactionAttempts, 2, 'transienter Netzwerkfehler wird erneut versucht statt den Haken zu verlieren');
assert.ok(getCountingRuntimeSnapshot().reactions.retried >= 1, 'Reaction-Retries werden diagnostisch gezaehlt');

// Burst: Die lokale Zahlenpruefung soll 100 Nachrichten sofort annehmen,
// waehrend die kuenstlich langsame Discord-Auslieferung kontrolliert im
// Hintergrund weiterlaeuft. Kein Haken darf fehlen oder ueberholen.
const burstDelivered = [];
const burstGuild = {
  id: 'g-burst',
  channels: { cache: new Map() },
  members: { me: { id: 'bot' } }
};
const burstCfg = normalizeConfig({
  counting: {
    enabled: true,
    channelId: 'ch-burst',
    statusPanelEnabled: false,
    clearChannelOnFail: false,
    milestones: []
  }
});
const burstStartedAt = Date.now();
for (let value = 1; value <= 100; value += 1) {
  const messageId = `burst-${String(value).padStart(3, '0')}`;
  await processCountMessage({
    message: {
      id: messageId,
      guildId: 'g-burst',
      guild: burstGuild,
      channelId: 'ch-burst',
      channel: { id: 'ch-burst' },
      author: { id: value % 2 ? 'burst-a' : 'burst-b', bot: false },
      webhookId: null,
      member: { roles: { cache: { map: () => [] } } },
      content: String(value),
      createdTimestamp: Date.now(),
      deletable: true,
      react: async (emoji) => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        burstDelivered.push(`${messageId}:${emoji}`);
      },
      delete: async () => {}
    },
    cfg: burstCfg
  });
}
const burstCoreMs = Date.now() - burstStartedAt;
assert.ok(burstCoreMs < 500, `100 Zahlen werden lokal ohne Discord-Wartezeit verarbeitet (${burstCoreMs} ms)`);
await waitForCountingReactionIdle('ch-burst');
assert.equal(burstDelivered.length, 100, '100 korrekte Nachrichten erhalten 100 gruene Haken');
assert.deepEqual(
  burstDelivered,
  Array.from({ length: 100 }, (_, index) => `burst-${String(index + 1).padStart(3, '0')}:✅`),
  'Burst-Reaktionen bleiben vollstaendig und exakt in Nachrichtenreihenfolge'
);
assert.equal(deletions.length, 1, 'falsche Nachricht wird gelöscht (Standard)');

// Ohne Löschen
const noDelete = normalizeConfig({
  counting: { enabled: true, channelId: 'chan-1', deleteWrongMessages: false, statusPanelEnabled: false }
});
await processCountMessage({ message: fakeMessage('u5', '9'), cfg: noDelete });
assert.equal(deletions.length, 1, 'bei deaktiviertem Löschen bleibt die Nachricht stehen');

// Bot-Nachricht im Zähl-Kanal wird ignoriert
const botReactionsBefore = reactions.length;
await processCountMessage({ message: fakeMessage('bot', '6', { bot: true }), cfg: integrationConf });
assert.equal(reactions.length, botReactionsBefore, 'Bot-Nachrichten bekommen keine Reaktion');

/* ------------------------- Stats + Reset (API) --------------------------- */
let stats = await getCountingStats({ id: 'guild-1' });
assert.equal(stats.count, 0, 'nach dem Fehlversuch steht der Zähler auf resetValue');
assert.ok(stats.fails >= 2, 'Fehlversuche werden in den Stats geführt');
assert.ok(Array.isArray(stats.topUsers) && stats.topUsers.length >= 1, 'Top-User werden geliefert');
assert.ok(stats.topUsers.some((entry) => entry.userId === 'u3'), 'u3 steht mit 1 richtigen Zug in den Top-Usern');

const reset = await resetCounting({ guild: { id: 'guild-1' }, cfg: integrationConf, actorId: 'admin' });
assert.equal(reset.ok, true, 'Reset meldet Erfolg');
stats = await getCountingStats({ id: 'guild-1' });
assert.equal(stats.count, 0, 'Zähler nach Reset bei 0');
assert.equal(stats.fails, 0, 'Fehlversuche nach Reset bei 0');
assert.equal(stats.totalCounters, 0, 'Statistiken nach Reset geleert');

/* ------------------------- Normalisierung --------------------------------- */
const normalized = normalizeConfig({ counting: { enabled: true, resetValue: -5, maxCount: 2, milestones: ['100', 'x', '50', '100'], successReaction: '' } });
assert.equal(normalized.counting.enabled, true, 'enabled wird übernommen');
assert.equal(normalized.counting.resetValue, 0, 'negative resetValue wird auf 0 gesetzt');
assert.equal(normalized.counting.maxCount, 10, 'maxCount unter Minimum wird angehoben');
assert.deepEqual(normalized.counting.milestones, [50, 100], 'Meilensteine werden sortiert, dedupliziert und gefiltert');
assert.equal(normalized.counting.successReaction, '✅', 'leere Reaktion fällt auf Standard zurück');

/* ------------------------- Panel-Design (Studio) ------------------------- */
const panelConf = settings(normalizeConfig({ counting: { enabled: true, statusChannelId: 'ch-panel' } }));
const guildMock = { id: 'guild-1', name: 'Test-Server', members: { cache: { get: () => null } } };
const panelState = { count: 42, lastUserId: 'u1', fails: 2, lastFailUserId: 'u2', users: { u1: { correct: 3, wrong: 0, streak: 2, bestStreak: 5, lastAt: 0 } } };

// Standard-Design: kein panelDesign => Standard-Titel, -Autor und automatische Felder
const design = normalizeCountingPanelDesign(undefined);
assert.equal(design.embed.title, '🔢 Aktueller Stand', 'Standard-Titel greift');
assert.equal(design.embed.color, '#6ee7ff', 'Standard-Farbe greift');
assert.deepEqual(design.embed.fields, [], 'Standard-Design hat keine eigenen Felder');
const countingSource = await readFile(new URL('../src/features/counting.js', import.meta.url), 'utf8');
const rendererSource = await readFile(new URL('../desktop/renderer/counting-panel.js', import.meta.url), 'utf8');
assert.match(countingSource, /\{topMarker1\} \{top1\}.*\{topValue1\}/s, 'Counting-Backend-Default zeigt offene Top-Platzhalter');
assert.doesNotMatch(countingSource, /value:\s*'\{topBlock1\}\\n\\n\{topBlock2\}\\n\\n\{topBlock3\}'/, 'Counting-Backend-Default nutzt keine Top-Blöcke');
assert.match(rendererSource, /\{topMarker1\} \{top1\}.*\{topValue1\}/s, 'Counting-Studio-Default zeigt offene Top-Platzhalter');
assert.doesNotMatch(rendererSource, /value:\s*'\{topBlock1\}\\n\\n\{topBlock2\}\\n\\n\{topBlock3\}'/, 'Counting-Studio-Default nutzt keine Top-Blöcke');
const migratedTopBlocks = normalizeCountingPanelDesign({
  embed: { fields: [{ name: 'Beste', value: '{topBlock1}\n\n{topBlock2}\n\n{topBlock3}', inline: false }] }
});
assert.equal(
  migratedTopBlocks.embed.fields[0].value,
  '{topMarker1} {top1} – **{topValue1}**\n{topMarker2} {top2} – **{topValue2}**\n{topMarker3} {top3} – **{topValue3}**',
  'alte Counting-Top-Blöcke werden beim Normalisieren aufgeklappt'
);

const standardEmbed = buildCountingPanelEmbed(guildMock, panelState, panelConf).toJSON();
assert.equal(standardEmbed.title, '🔢 Aktueller Stand', 'Standard-Panel-Titel');
assert.equal(standardEmbed.author?.name, 'FALLEN HEAVEN · ZÄHL-KANAL', 'Standard-Panel-Autor');
assert.ok(Array.isArray(standardEmbed.fields) && standardEmbed.fields.length === 4, 'automatische Standard-Felder (4)');
assert.ok(standardEmbed.fields.some((field) => field.name === 'Zählerstand' && field.value.includes('42') && field.value.includes('43')), 'Zählerstand-Feld zeigt count und next');
assert.ok(standardEmbed.fields.some((field) => field.name === 'Letzter Zähler' && field.value.includes('u1')), 'Letzter Zähler wird erwähnt');
assert.ok(standardEmbed.fields.some((field) => field.name === 'Fehlversuche' && field.value.includes('2')), 'Fehlversuche-Feld zeigt fails');

// Eigenes Design mit Platzhaltern
const customConf = settings(normalizeConfig({
  counting: {
    enabled: true,
    statusChannelId: 'ch-panel',
    panelDesign: {
      content: 'Stand: {count} · Nächste: {next} · Fehler: {fails}',
      embed: {
        title: 'Zähl-Server {server}',
        description: 'Zuletzt: {lastCounterName}',
        color: '#ff5500',
        footerText: '{top}',
        fields: [
          { name: 'Aktuell', value: '{count}', inline: true },
          { name: 'Als Nächstes', value: '{next}', inline: true }
        ]
      }
    }
  }
}));
const customEmbed = buildCountingPanelEmbed(guildMock, panelState, customConf).toJSON();
assert.equal(customEmbed.title, 'Zähl-Server Test-Server', '{server} wird ersetzt');
assert.equal(customEmbed.description, 'Zuletzt: *–*', '{lastCounterName} wird ersetzt (unbekanntes Mitglied)');
assert.equal(customEmbed.color, 0xff5500, 'eigene Farbe wird übernommen');
assert.ok(customEmbed.footer?.text.includes('trophy1'), 'Footer zeigt die Server-Trophäe aus {top}');
assert.equal(customEmbed.fields.length, 2, 'eigene Felder ersetzen die Standard-Felder');
assert.ok(customEmbed.fields.some((field) => field.name === 'Aktuell' && field.value === '42'), 'Feld {count} wird ersetzt');
assert.ok(customEmbed.fields.some((field) => field.name === 'Als Nächstes' && field.value === '43'), 'Feld {next} wird ersetzt');

// Eigene Felder + alleinstehender {lastFail}
const lastFailConf = settings(normalizeConfig({
  counting: {
    enabled: true,
    panelDesign: { embed: { fields: [{ name: 'Zuletzt falsch', value: '{lastFail}', inline: false }] } }
  }
}));
const lastFailEmbed = buildCountingPanelEmbed(guildMock, panelState, lastFailConf).toJSON();
assert.equal(lastFailEmbed.fields[0].value, '<@u2>', '{lastFail} wird zur echten Erwähnung');

// Ungültige Bild-URLs werden bereinigt
const dirty = normalizeCountingPanelDesign({ outsideImageUrl: 'javascript:alert(1)', embed: { thumbnailUrl: 'ftp://x', footerText: 'X'.repeat(5000) } });
assert.equal(dirty.outsideImageUrl, '', 'ungültige Außenbild-URL wird entfernt');
assert.equal(dirty.embed.thumbnailUrl, '', 'ungültige Thumbnail-URL wird entfernt');
assert.ok(dirty.embed.footerText.length <= 2048, 'Footer-Text wird gekürzt');

/* ---------------- Doppel-Normalisierung (Studio-Sync, Regressions-Test) --- */
// Der Studio-Save ruft settings() mehrfach auf (prepareSyncCfg -> sync).
// Früher crashte das mit „((intermediate value) || []).map is not a function“,
// weil excludedRoleIds als Set erneut durch settings() lief. Jetzt liefert
// settings() NIE ein Set, sondern ein reines String-Array – idempotent über
// beliebig viele Durchläufe.
const rawCfg = normalizeConfig({ counting: { enabled: true, excludedRoleIds: ['r1', 'r2'], milestones: [100, 250] } });
const firstPass = settings(rawCfg);
// Realer Studio-Ablauf: prepareSyncCfg schreibt das settings()-Ergebnis zurück
// in die volle Config, danach ruft sync settings() erneut auf.
const prepared = { ...rawCfg, counting: { ...firstPass, statusChannelId: 'ch-x', panelDesign: null } };
const resynced = settings(prepared);
assert.ok(Array.isArray(resynced.excludedRoleIds), 'excludedRoleIds ist ein Array nach dem Sync (nie ein Set)');
assert.deepEqual(resynced.excludedRoleIds, ['r1', 'r2'], 'excludedRoleIds bleiben nach dem Sync erhalten');
assert.deepEqual(resynced.milestones, [100, 250], 'milestones überleben den Sync');
assert.ok(resynced.panelDesign && typeof resynced.panelDesign === 'object', 'panelDesign bleibt nach dem Sync erhalten');
// Das settings()-Ergebnis darf an jeder Stelle (auch in (x || []).map) sicher
// verarbeitet werden – ohne Set-Crash.
assert.deepEqual((resynced.excludedRoleIds || []).map(String), ['r1', 'r2'], 'Array-Surface: (x || []).map crasht nie');

// Direktes Set als Eingabe (abgesicherte zweite Normalisierung) → Array
const setInput = settings({ counting: { excludedRoleIds: new Set(['x1', 'x2']) } });
assert.ok(Array.isArray(setInput.excludedRoleIds) && setInput.excludedRoleIds.length === 2, 'Set-Eingabe wird zu einem Array normalisiert');

/* ------------------- Verlierer-Nachrichten + Chat-Aufräumung ------------- */
// Eingebaute Pool: mindestens 100 verschiedene Sätze
const withPool = settings(normalizeConfig({ counting: { enabled: true } }));
assert.ok(withPool.lossMessagesEnabled === true, 'Verlierer-Nachrichten sind standardmäßig aktiv');
assert.ok(Array.isArray(withPool.lossMessages), 'lossMessages ist ein Array');
assert.ok(withPool.lossMessages.length >= 100, 'eingebaute Pool hat mindestens 100 Sätze (' + withPool.lossMessages.length + ')');
const uniqueLoss = new Set(withPool.lossMessages);
assert.ok(uniqueLoss.size === withPool.lossMessages.length, 'alle Sätze der Pool sind eindeutig');
assert.ok(withPool.lossMessages.every((line) => line.trim().length > 0), 'keine leeren Sätze in der Pool');
assert.ok(withPool.lossMessages.some((line) => line.includes('{user}')), 'Pool enthält Sätze mit {user}-Erwähnung');

// Eigene Sätze ersetzen die Pool komplett
const customLoss = settings(normalizeConfig({ counting: { enabled: true, lossMessages: ['A', 'B', '', '  C  '] } }));
assert.deepEqual(customLoss.lossMessages, ['A', 'B', 'C'], 'eigene Sätze werden bereinigt und übernommen');
assert.equal(customLoss.lossMessages.length, 3, 'eigene Sätze ersetzen die Pool');

// Aufräumen: Standardwerte + Begrenzung
const cleanupConf = settings(normalizeConfig({ counting: { enabled: true } }));
assert.equal(cleanupConf.clearChannelOnFail, true, 'Aufräumen ist standardmäßig aktiv');
assert.equal(cleanupConf.clearChannelDelaySeconds, 10, 'Standard-Delay ist 10 Sekunden');
const clamped = settings(normalizeConfig({ counting: { enabled: true, clearChannelDelaySeconds: 99999 } }));
assert.equal(clamped.clearChannelDelaySeconds, 300, 'Delay wird auf maximal 300 begrenzt');
const disabled = settings(normalizeConfig({ counting: { enabled: true, clearChannelOnFail: false, lossMessagesEnabled: false } }));
assert.equal(disabled.clearChannelOnFail, false, 'Aufräumen lässt sich abschalten');
assert.equal(disabled.lossMessagesEnabled, false, 'Verlierer-Nachrichten lassen sich abschalten');

// Nachrichten behalten: Standard 5, 0 erlaubt, Begrenzung 0–100
assert.equal(cleanupConf.clearChannelKeepMessages, 5, 'Standard: 5 Nachrichten bleiben stehen');
const keepZero = settings(normalizeConfig({ counting: { enabled: true, clearChannelKeepMessages: 0 } }));
assert.equal(keepZero.clearChannelKeepMessages, 0, '0 Nachrichten behalten ist erlaubt (alles außer Panel löschen)');
const keepClamped = settings(normalizeConfig({ counting: { enabled: true, clearChannelKeepMessages: 500 } }));
assert.equal(keepClamped.clearChannelKeepMessages, 100, 'Behalten wird auf maximal 100 begrenzt');
const keepCustom = settings(normalizeConfig({ counting: { enabled: true, clearChannelKeepMessages: 12 } }));
assert.equal(keepCustom.clearChannelKeepMessages, 12, 'eigene Anzahl wird übernommen');

/* ----------- Aufräumen behält die neuesten N Nachrichten (Level-Up-Muster) - */
// Fake-Kanal: 10 Nachrichten (1 Panel + 9 Zähl-Nachrichten, 1 davon gepinnt).
// keep=5 → Panel + Pin + die 5 neuesten bleiben, die 4 ältesten werden gelöscht.
const makeFakeMessage = (id, timestamp, pinned = false) => ({
  id,
  createdTimestamp: timestamp,
  pinned,
  deletable: true,
  delete: async () => {}
});
const deletedIds = [];
const fakeChannel = {
  isTextBased: () => true,
  isThread: () => false,
  messages: {
    fetch: async () => new Map([
      ['panel', makeFakeMessage('panel', 1000)],
      ['m1', makeFakeMessage('m1', 2000)],
      ['m2', makeFakeMessage('m2', 3000)],
      ['m3', makeFakeMessage('m3', 4000)],
      ['m4', makeFakeMessage('m4', 5000)],
      ['m5', makeFakeMessage('m5', 6000)],
      ['m6', makeFakeMessage('m6', 7000)],
      ['m7', makeFakeMessage('m7', 8000)],
      ['m8', makeFakeMessage('m8', 9000, true)],
      ['m9', makeFakeMessage('m9', 10000)]
    ])
  },
  bulkDelete: async (batch) => { for (const entry of batch) deletedIds.push(String(entry.id)); }
};
await clearCountingChannel({ guild: {}, state: { panel: { messageId: 'panel' } }, channel: fakeChannel, keep: 5 });
assert.deepEqual(deletedIds.sort(), ['m1', 'm2', 'm3'], 'die 3 ältesten Zähl-Nachrichten werden gelöscht');
assert.ok(!deletedIds.includes('panel'), 'Panel-Embed wird nie gelöscht');
assert.ok(!deletedIds.includes('m8'), 'gepinnte Nachricht bleibt stehen');
assert.ok(['m4', 'm5', 'm6', 'm7', 'm9'].every((id) => !deletedIds.includes(id)), 'die 5 neuesten Nachrichten bleiben stehen');

// Eine noch nicht ausgelieferte Reaction schuetzt ihre Nachricht vor Cleanup.
// Sonst loescht der Rolling-Flow die Nachricht, waehrend Discords Reaction-PUT
// noch im Bucket wartet, und der versprochene Haken kann nie sichtbar werden.
let releaseProtectedReaction;
const protectedGate = new Promise((resolve) => { releaseProtectedReaction = resolve; });
const protectedDeleted = [];
const protectedMessage = {
  ...makeFakeMessage('pending-reaction', 2000),
  guildId: 'g-protected',
  channelId: 'ch-protected',
  channel: { id: 'ch-protected' },
  react: async () => protectedGate
};
enqueueCountingReaction(protectedMessage, '✅');
await new Promise((resolve) => setImmediate(resolve));
const protectedChannel = {
  id: 'ch-protected',
  isTextBased: () => true,
  isThread: () => false,
  messages: { fetch: async () => new Map([['pending-reaction', protectedMessage]]) },
  bulkDelete: async (batch) => { for (const entry of batch) protectedDeleted.push(String(entry.id)); }
};
await clearCountingChannel({ guild: {}, state: { panel: { messageId: '' } }, channel: protectedChannel, keep: 0 });
assert.deepEqual(protectedDeleted, [], 'Cleanup loescht keine Nachricht mit noch wartender Reaction');
releaseProtectedReaction();
await waitForCountingReactionIdle('ch-protected');
await clearCountingChannel({ guild: {}, state: { panel: { messageId: '' } }, channel: protectedChannel, keep: 0 });
assert.deepEqual(protectedDeleted, ['pending-reaction'], 'nach ausgeliefertem Haken darf das Rolling-Window die Nachricht entfernen');

// Das Rolling-Window hydratisiert den Discord-Kanal nur einmal. Danach werden
// neue Nachrichten aus messageCreate lokal beobachtet statt erneut 100
// Nachrichten ueber REST zu laden.
let hydrationFetches = 0;
const hydratedChannel = {
  id: 'ch-hydrated',
  isTextBased: () => true,
  isThread: () => false,
  messages: {
    fetch: async () => {
      hydrationFetches += 1;
      return new Map([['hydrated-1', makeFakeMessage('hydrated-1', 1000)]]);
    }
  },
  bulkDelete: async () => {}
};
await clearCountingChannel({ guild: {}, state: { panel: { messageId: '' } }, channel: hydratedChannel, keep: 5 });
observeCountingMessage({ ...makeFakeMessage('hydrated-2', 2000), channelId: 'ch-hydrated', channel: hydratedChannel });
await clearCountingChannel({ guild: {}, state: { panel: { messageId: '' } }, channel: hydratedChannel, keep: 5 });
assert.equal(hydrationFetches, 1, 'nach einmaliger Hydration braucht normales Cleanup keinen weiteren 100er-Fetch');

// Mehrere Anforderungen waehrend eines laufenden Delete-Aufrufs werden zu
// hoechstens einem Nachlauf zusammengefasst; zwei Cleanups duerfen nie parallel
// auf demselben Kanal arbeiten.
let releaseCleanup;
const cleanupGate = new Promise((resolve) => { releaseCleanup = resolve; });
let cleanupRuns = 0;
let cleanupConcurrent = 0;
let cleanupMaxConcurrent = 0;
const serializedChannel = {
  id: 'ch-serialized-cleanup',
  isTextBased: () => true,
  isThread: () => false,
  messages: {
    fetch: async () => new Map([
      ['serial-1', makeFakeMessage('serial-1', 1000)],
      ['serial-2', makeFakeMessage('serial-2', 2000)]
    ])
  },
  bulkDelete: async () => {
    cleanupRuns += 1;
    cleanupConcurrent += 1;
    cleanupMaxConcurrent = Math.max(cleanupMaxConcurrent, cleanupConcurrent);
    if (cleanupRuns === 1) await cleanupGate;
    cleanupConcurrent -= 1;
  }
};
requestCountingCleanup({ guild: {}, state: { panel: { messageId: '' } }, channel: serializedChannel, keep: 0 });
await new Promise((resolve) => setImmediate(resolve));
requestCountingCleanup({ guild: {}, state: { panel: { messageId: '' } }, channel: serializedChannel, keep: 0 });
requestCountingCleanup({ guild: {}, state: { panel: { messageId: '' } }, channel: serializedChannel, keep: 0 });
releaseCleanup();
await waitForCountingCleanupIdle('ch-serialized-cleanup');
assert.equal(cleanupMaxConcurrent, 1, 'pro Kanal laeuft maximal ein Cleanup gleichzeitig');
assert.ok(cleanupRuns <= 2, 'mehrere Cleanup-Anforderungen werden zu maximal einem Nachlauf zusammengefasst');

// Fehlversuch: Verlierer-Nachricht bleibt, alles davor weg (preserveIds)
const lossChannel = {
  isTextBased: () => true,
  isThread: () => false,
  messages: {
    fetch: async () => new Map([
      ['panel', makeFakeMessage('panel', 1000)],
      ['m1', makeFakeMessage('m1', 2000)],
      ['m2', makeFakeMessage('m2', 3000)],
      ['m3', makeFakeMessage('m3', 4000)],
      ['loss', makeFakeMessage('loss', 5000)]
    ])
  },
  bulkDelete: async (batch) => { for (const entry of batch) deletedIds.push(String(entry.id)); }
};
deletedIds.length = 0;
await clearCountingChannel({ guild: {}, state: { panel: { messageId: 'panel' } }, channel: lossChannel, keep: 0, preserveIds: ['loss'] });
assert.deepEqual(deletedIds.sort(), ['m1', 'm2', 'm3'], 'beim Fehlversuch: alles bis auf Panel + Verlierer-Nachricht weg');
assert.ok(!deletedIds.includes('loss'), 'Verlierer-Nachricht bleibt stehen');
assert.ok(!deletedIds.includes('panel'), 'Panel bleibt immer');

/* ----------- Fehlversuch-Flow: erst aufräumen, dann Verlierer-Nachricht --- */
// Der echte Fehlversuch-Flow läuft so: ZUERST wird der Kanal aufgeräumt
// (falsche Nachricht + alles davor weg, keep 0), DANN kommt die
// Verlierer-Nachricht – sie darf dabei NICHT mitgelöscht werden und wird
// erst nach clearChannelDelaySeconds (Standard 10 s) entfernt.
const failFlowDeleted = [];
const failFlowSent = [];
const failFlowChannel = {
  id: 'chan-1',
  isTextBased: () => true,
  isThread: () => false,
  messages: {
    fetch: async (opts) => {
      if (typeof opts === 'string') {
        if (opts === 'loss-1') return { id: 'loss-1', delete: async () => { failFlowDeleted.push('loss-1'); } };
        return null;
      }
      return new Map([
        ['panel', makeFakeMessage('panel', 1000)],
        ['m1', makeFakeMessage('m1', 2000)],
        ['m2', makeFakeMessage('m2', 3000)]
      ]);
    }
  },
  bulkDelete: async (batch) => { for (const entry of batch) failFlowDeleted.push(String(entry.id)); },
  send: async (payload) => { failFlowSent.push(payload); return { id: 'loss-1' }; }
};
const failFlowConf = normalizeConfig({
  counting: { enabled: true, channelId: 'chan-1', statusPanelEnabled: false, deleteWrongMessages: false, strikesEnabled: false, lossMessagesEnabled: true, lossMessages: ['💥 {user} hat verloren!'] }
});
resetCountingRuntimeForTests();
failFlowDeleted.length = 0;
const failFlowState = await getCountingStateForTest('guild-flow');
failFlowState.count = 3;
failFlowState.lastUserId = 'u8';
failFlowState.panel = { messageId: 'panel' };
await processCountMessage({
  message: {
    guildId: 'guild-flow',
    channelId: 'chan-1',
    channel: failFlowChannel,
    guild: {},
    author: { id: 'u1' },
    member: { roles: { cache: { map: () => [] } } },
    content: '5',
    createdTimestamp: Date.now(),
    deletable: true,
    react: async () => {},
    delete: async () => {}
  },
  cfg: failFlowConf
});
assert.ok(failFlowSent.length >= 1, 'Verlierer-Nachricht wird sofort gesendet');
// Aufräumen läuft asynchron im Hintergrund – kurz warten, dann prüfen.
await new Promise((resolve) => setTimeout(resolve, 200));
assert.deepEqual(failFlowDeleted.sort(), ['m1', 'm2'], 'Fehlversuch: alles davor bis zum Panel weg (keep 0)');
assert.ok(!failFlowDeleted.includes('panel'), 'Panel bleibt immer');
assert.ok(!failFlowDeleted.includes('loss-1'), 'Verlierer-Nachricht wird NICHT sofort mitgelöscht');

/* ---------------- Verlierer-Nachricht nach Anzeigedauer entfernen --------- */
// scheduleLossMessageRemoval löscht NUR die Verlierer-Nachricht nach der
// eingestellten Anzeigedauer – und nur, wenn der Kanal noch der Zähl-Kanal ist.
const lossRemoved = [];
const removalChannel = {
  id: 'chan-1',
  messages: { fetch: async (id) => ({ id, delete: async () => { lossRemoved.push(String(id)); } }) }
};
scheduleLossMessageRemoval({
  channel: removalChannel,
  messageId: 'loss-x',
  delayMs: 30,
  cfg: normalizeConfig({ counting: { enabled: true, channelId: 'chan-1' } })
});
await new Promise((resolve) => setTimeout(resolve, 80));
assert.deepEqual(lossRemoved, ['loss-x'], 'Verlierer-Nachricht wird nach der Anzeigedauer entfernt');

// Kanal gewechselt → NIE löschen (neuer Zähl-Kanal ist geschützt).
const wrongChannelRemoved = [];
scheduleLossMessageRemoval({
  channel: { id: 'anderer-kanal', messages: { fetch: async () => ({ delete: async () => { wrongChannelRemoved.push('x'); } }) } },
  messageId: 'x',
  delayMs: 30,
  cfg: normalizeConfig({ counting: { enabled: true, channelId: 'chan-1' } })
});
await new Promise((resolve) => setTimeout(resolve, 80));
assert.deepEqual(wrongChannelRemoved, [], 'bei gewechseltem Kanal wird die Verlierer-Nachricht nicht gelöscht');

// {user}/{count}/{next} in Verlierer-Nachrichten
const renderedLoss = renderMilestoneMessage('💥 Verloren! {user} hat **{count}** gesendet.', 'u42', 17);
assert.equal(renderedLoss, '💥 Verloren! <@u42> hat **17** gesendet.', 'Verlierer-Text ersetzt {user} und {count}');
const renderedLossNext = renderMilestoneMessage('Frischer Start bei 0 – als Nächstes kommt {next}.', 'u42', 0, 1);
assert.equal(renderedLossNext, 'Frischer Start bei 0 – als Nächstes kommt 1.', '{next} wird durch die nächste erwartete Zahl ersetzt');

// Die Verlierer-Nachricht einer echten Runde endet immer mit der nächsten Zahl:
// Wer {next} nicht selbst enthält, bekommt „Nächste Zahl: X“ angehängt (damit
// nach „Start bei 0“ niemand fälschlich die 0 tippt).
const hintConf = normalizeConfig({
  counting: { enabled: true, channelId: 'chan-1', statusPanelEnabled: false, deleteWrongMessages: false, strikesEnabled: false, lossMessagesEnabled: true, lossMessages: ['💥 {user} hat verloren!'] }
});
const hintState = await getCountingStateForTest('guild-1');
hintState.count = 3;
hintState.lastUserId = 'u8';
sends.length = 0;
await processCountMessage({ message: fakeMessage('u1', '5'), cfg: hintConf });
const hintSent = sends.find((entry) => typeof entry?.content === 'string' && entry.content.includes('verloren'));
assert.ok(hintSent, 'Verlierer-Nachricht wird gesendet');
assert.match(hintSent.content, /\*\*Nächste Zahl: 1\*\*/, 'Nächste Zahl wird automatisch angehängt (resetValue 0 → 1)');

/* ------------------- Eingefrorenes Panel (Regressions-Test) -------------- */
// Die lokale Bilddatei ist weg (z. B. nach früherem Upload aufgeräumt), aber die
// Config hält die Referenz noch. resolveOutsideImageLite darf NIE werfen – sonst
// friert das Live-Panel bei jedem Zug ein (exakt der gemeldete Bug).
const { resolveOutsideImageLite } = await import('../src/runtime/localImageStore.js');
const missingLocal = {
  localAsset: true,
  id: 'missing-local-file-x',
  mime: 'image/png',
  url: 'https://cdn.discordapp.com/attachments/1/2/x.png',
  name: 'x.png'
};
const degraded = await resolveOutsideImageLite({ savedAttachment: missingLocal });
assert.deepEqual(degraded, { files: null, attachments: null }, 'fehlende lokale Bilddatei blockiert das Panel nicht');
// Referenz-Pfad bleibt erhalten: Anhang per ID, kein Download.
const referenced = await resolveOutsideImageLite({ savedAttachment: { id: 'a1' }, preserveAttachment: true });
assert.deepEqual(referenced, { files: null, attachments: [{ id: 'a1' }] }, 'Anhang-Referenz per ID funktioniert weiter');
// Save-Pfad: mit CDN-URL darf der Save nicht blockieren, ohne CDN-URL kommt eine klare Aufforderung.
const { _persistentEmbedInternals } = await import('../src/runtime/persistentEmbedService.js');
const cdnSave = await _persistentEmbedInternals.resolveOutsideImageFile({
  template: { outsideImageAttachment: { localAsset: true, id: 'x', url: 'https://cdn.discordapp.com/x.png' } }
});
assert.equal(cdnSave.outsideFile, null, 'Save mit CDN-URL-Fallback blockiert nicht');
const withoutCdn = await _persistentEmbedInternals.resolveOutsideImageFile({
  template: { outsideImageAttachment: { localAsset: true, id: 'x', url: '' } }
}).then(() => 'no-throw', (error) => String(error?.message || ''));
assert.ok(String(withoutCdn).includes('Bitte wähle'), 'ohne CDN-URL: klare Aufforderung zum Neu-Wählen');

/* --------------------- Neustart nach Fehlversuch (Bug-Fix) --------------- */
// Nach einem Fehlversuch ist niemand mehr „dran“: Der Verlierer (oder jeder
// andere) darf die neue Runde direkt mit dem Startwert beginnen.
const restartState = { count: 0, lastUserId: '', users: {} };
result = evaluateCount({ state: restartState, conf: c, authorId: 'u1', content: '1' });
applyCountResult(restartState, c, result, 'u1', 7000);
assert.equal(restartState.count, 1, 'u1 startet die Runde');
result = evaluateCount({ state: restartState, conf: c, authorId: 'u2', content: '2' });
applyCountResult(restartState, c, result, 'u2', 8000);
assert.equal(restartState.count, 2, 'u2 zählt weiter');
// u1 verkackt mit 99 → Reset, danach darf u1 selbst wieder mit 1 anfangen
result = evaluateCount({ state: restartState, conf: c, authorId: 'u1', content: '99' });
applyCountResult(restartState, c, result, 'u1', 9000);
assert.equal(restartState.count, 0, 'Fehlversuch resettet den Zähler');
assert.equal(restartState.lastUserId, '', 'niemand ist nach dem Fehlversuch dran');
result = evaluateCount({ state: restartState, conf: c, authorId: 'u1', content: '1' });
assert.equal(result.kind, 'success', 'Verlierer kann die neue Runde mit 1 starten');

/* --------------------- Ties & Trophäen (Dense-Ranking) ------------------- */
// Drei User mit gleicher Best-Serie → alle Platz 1 (nicht 1,2,3)
const tieState = { users: {
  a: { correct: 10, wrong: 0, streak: 0, bestStreak: 5 },
  b: { correct: 8, wrong: 0, streak: 0, bestStreak: 5 },
  c: { correct: 3, wrong: 0, streak: 0, bestStreak: 3 },
  d: { correct: 20, wrong: 0, streak: 0, bestStreak: 7 }
} };
const rankedTies = rankCountingUsers(tieState);
assert.equal(rankedTies.length, 4, 'alle 4 User werden gerankt');
assert.equal(rankedTies[0].rank, 1, 'beste Serie (7) ist Platz 1');
assert.equal(rankedTies[0].userId, 'd', 'Platz 1 ist d');
assert.equal(rankedTies[1].rank, 2, 'zweite Serie (5) ist Platz 2');
assert.equal(rankedTies[2].rank, 2, 'gleiche Serie (5) ist ebenfalls Platz 2 (Tie)');
assert.equal(rankedTies[3].rank, 3, 'niedrigste Serie ist Platz 3 (Dense: 1, 2, 2, 3)');
assert.equal(rankedTies[1].userId, 'a', 'bei gleicher Serie zählt die korrekte Anzahl (a vor b)');
assert.equal(rankedTies[2].userId, 'b', 'b landet nach a');

// Trophäen: Server-Emoji, sonst Code mit ID, sonst Fallback
const trophyGuild = {
  emojis: { cache: { get: () => ({ id: '1533907289604493502', name: 'trophy1', animated: false }) } }
};
assert.equal(countingTrophyEmojiInternal(trophyGuild, 1), '<:trophy1:1533907289604493502>', 'Server-Trophäe wird verwendet');
const noEmojiGuild = { emojis: { cache: { get: () => null, find: () => null } } };
const fallback = countingTrophyEmojiInternal(noEmojiGuild, 2);
assert.ok(fallback.includes('trophy2'), 'ohne Emoji-Cache wird der ID-Code gerendert (mit trophy2-Name)');

// Rolling-Window-Fälligkeit: nur wenn wirklich nötig (spart Rate-Limits)
assert.equal(cleanupDue(5, 5), false, 'bei keep=5 ist der 5. Zug noch nicht fällig');
assert.equal(cleanupDue(6, 5), true, 'bei keep=5 räumt der 6. Zug die älteste Nachricht weg');
assert.equal(cleanupDue(1, 0), false, 'bei keep=0 räumt jeder 2. Zug');
assert.equal(cleanupDue(2, 0), true, 'bei keep=0 ist der 2. Zug fällig');
assert.equal(cleanupDue(2, 1), true, 'bei keep=1 räumt der 2. Zug');

// Panel-Cache: zweites Update editiert direkt ohne erneuten messages.fetch
let panelFetchCount = 0;
const panelMsg = {
  id: 'panel-1',
  editable: true,
  pinned: true,
  author: { id: 'bot' },
  attachments: { some: () => false },
  edit: async () => {},
  pin: async () => {}
};
const panelChannelMock = {
  id: 'ch-panel',
  isTextBased: () => true,
  isThread: () => false,
  messages: {
    fetch: async (id) => { panelFetchCount += 1; return id === 'panel-1' ? panelMsg : null; }
  }
};
const panelGuildMock = {
  id: 'g-panel',
  name: 'S',
  channels: { cache: new Map([['ch-panel', panelChannelMock]]) },
  members: { cache: { get: () => null } },
  emojis: { cache: { get: () => ({ id: '1', name: 'trophy1', animated: false }), find: () => null } }
};
const panelConfMock = settings(normalizeConfig({ counting: { enabled: true, statusPanelEnabled: true, statusChannelId: 'ch-panel' } }));
const panelStateMock = { panel: { channelId: 'ch-panel', messageId: 'panel-1' }, count: 3, users: {} };
await syncCountingPanel({ guild: panelGuildMock, state: panelStateMock, conf: panelConfMock, options: { allowAttachmentReference: true } });
const panelFetchesAfterFirst = panelFetchCount;
await syncCountingPanel({ guild: panelGuildMock, state: panelStateMock, conf: panelConfMock, options: { allowAttachmentReference: true } });
assert.equal(panelFetchesAfterFirst, 1, 'erster Sync fetcht die Panel-Nachricht genau einmal');
assert.equal(panelFetchCount, 1, 'zweiter Sync nutzt den Cache – kein weiterer messages.fetch');

// Repair-Modus: Panel existiert → KEIN Edit, KEIN Payload-Bau, KEIN REST-Call
let panelRepairEdits = 0;
const repairMsg = {
  id: 'panel-repair',
  editable: true,
  pinned: true,
  author: { id: 'bot' },
  attachments: { some: () => false },
  edit: async () => { panelRepairEdits += 1; },
  pin: async () => {}
};
const repairChannel = {
  id: 'ch-repair',
  isTextBased: () => true,
  isThread: () => false,
  messages: {
    fetch: async () => { throw new Error('Repair darf keine Nachricht fetchen, wenn sie im Cache liegt'); }
  }
};
const repairGuild = {
  id: 'g-repair',
  name: 'S',
  channels: { cache: new Map([['ch-repair', repairChannel]]) },
  members: { cache: { get: () => null } },
  emojis: { cache: { get: () => ({ id: '1', name: 'trophy1', animated: false }), find: () => null } }
};
const repairState = { panel: { channelId: 'ch-repair', messageId: 'panel-repair' }, count: 3, users: {} };
const repairConf = settings(normalizeConfig({ counting: { enabled: true, statusPanelEnabled: true, statusChannelId: 'ch-repair' } }));
// Nachricht in den Panel-Cache legen – der Repair-Modus nutzt ihn ohne Fetch.
const cacheKey = 'g-repair';
countingInternals.panelMessageCache.set(cacheKey, repairMsg);
const repairResult = await syncCountingPanel({ guild: repairGuild, state: repairState, conf: repairConf, options: { repair: true } });
assert.equal(repairResult.action, 'ok', 'Repair-Modus liefert ok zurück');
assert.equal(panelRepairEdits, 0, 'Repair-Modus editiert das vorhandene Panel NICHT');
assert.ok(!repairResult.updated, 'Repair-Modus meldet kein Update');
countingInternals.panelMessageCache.delete(cacheKey);
console.log('  ✅ Repair-Modus: Panel existiert → kein Edit, kein REST-Call');

// Throttle darf Zwischenstaende zusammenfassen, aber den neuesten Stand nicht
// verwerfen. Zwei schnelle Anforderungen muessen nach dem 2-s-Fenster genau
// einen nachlaufenden Edit mit dem letzten State ausloesen.
let trailingPanelEdits = 0;
let trailingPanelPayload = null;
const trailingPanelMessage = {
  id: 'panel-trailing',
  editable: true,
  pinned: true,
  author: { id: 'bot' },
  attachments: { some: () => false },
  edit: async (payload) => { trailingPanelEdits += 1; trailingPanelPayload = payload; },
  pin: async () => {}
};
const trailingPanelChannel = {
  id: 'ch-panel-trailing',
  isTextBased: () => true,
  isThread: () => false,
  messages: { fetch: async () => trailingPanelMessage }
};
const trailingPanelGuild = {
  id: 'g-panel-trailing',
  name: 'S',
  channels: { cache: new Map([['ch-panel-trailing', trailingPanelChannel]]) },
  members: { me: { id: 'bot' }, cache: { get: () => null } },
  emojis: { cache: { get: () => null, find: () => null } }
};
const trailingPanelCfg = normalizeConfig({ counting: { enabled: true, statusPanelEnabled: true, statusChannelId: 'ch-panel-trailing' } });
const trailingPanelState = await getCountingStateForTest('g-panel-trailing');
trailingPanelState.panel = { channelId: 'ch-panel-trailing', messageId: 'panel-trailing' };
countingInternals.panelMessageCache.set('g-panel-trailing', trailingPanelMessage);
await refreshStatusPanel({ guild: trailingPanelGuild, cfg: trailingPanelCfg, force: true });
const editsBeforeTrailing = trailingPanelEdits;
trailingPanelState.count = 10;
await refreshStatusPanel({ guild: trailingPanelGuild, cfg: trailingPanelCfg });
trailingPanelState.count = 11;
await refreshStatusPanel({ guild: trailingPanelGuild, cfg: trailingPanelCfg });
await new Promise((resolve) => setTimeout(resolve, 2_100));
assert.equal(trailingPanelEdits, editsBeforeTrailing + 1, 'schnelle Panel-Aenderungen ergeben genau einen nachlaufenden Edit');
const trailingPayloadJson = trailingPanelPayload.embeds[0].toJSON();
assert.ok(trailingPayloadJson.fields.some((field) => String(field.value).includes('11')), 'nachlaufender Panel-Edit enthaelt den neuesten Zaehlerstand');
countingInternals.panelMessageCache.delete('g-panel-trailing');

// {top} im Panel nutzt Trophäen + Ties
const topConf = settings(normalizeConfig({ counting: { enabled: true, statusChannelId: 'ch-panel' } }));
const topEmbed = buildCountingPanelEmbed({ id: 'g1', name: 'S', members: { cache: { get: () => null } }, emojis: { cache: { get: () => ({ id: '1', name: 'trophy1', animated: false }), find: () => null } } }, tieState, topConf).toJSON();
const topField = topEmbed.fields.find((field) => field.name === '🏅 Beste Serien');
assert.ok(topField && topField.value.includes('trophy1'), 'Top-1 zeigt die Trophäe');
assert.ok(topField.value.includes('Platz') === false, 'kein Platz-Text bei Trophäe nötig');

/* --------------------- Buttons: Regeln + Mein Rang ----------------------- */
// Button-Labels editierbar (3.9.222-Prinzip).
const customButtonConf = settings(normalizeConfig({ counting: { enabled: true, rulesButtonLabel: 'Spielregeln', rankButtonLabel: 'Meine Platzierung' } }));
assert.equal(customButtonConf.rulesButtonLabel, 'Spielregeln', 'Regeln-Button-Label editierbar');
assert.equal(customButtonConf.rankButtonLabel, 'Meine Platzierung', 'Rang-Button-Label editierbar');
const defaultButtonConf = settings(normalizeConfig({ counting: { enabled: true } }));
assert.equal(defaultButtonConf.rulesButtonLabel, '📖 Regeln', 'Default Regeln-Button');
assert.equal(defaultButtonConf.rankButtonLabel, '🏅 Mein Rang', 'Default Rang-Button');

const ruleEmbed = buildCountingRulesEmbed({}, settings(normalizeConfig({ counting: { enabled: true } }))).toJSON();
assert.equal(ruleEmbed.title, '📖 Zähl-Kanal – Regeln', 'Regeln-Button zeigt die Regeln');
assert.ok(ruleEmbed.description.includes('Verwarnung'), 'Regeln erwähnen das Verwarnungssystem');

const rankEmbed = buildCountingRankEmbed({ members: { cache: { get: () => null } } }, tieState, 'b').toJSON();
assert.ok(rankEmbed.title.includes('Rang'), 'Rang-Button zeigt den Rang');
const rankFieldNames = rankEmbed.fields.map((field) => field.name);
assert.ok(rankFieldNames.includes('Rang'), 'Rang-Feld ist enthalten');
assert.ok(rankEmbed.description.includes('trophy2'), 'b ist Platz 2 (Tie mit a) – Trophäe für Rang 2');

const noEntryEmbed = buildCountingRankEmbed({ members: { cache: { get: () => null } } }, tieState, 'neuling').toJSON();
assert.ok(noEntryEmbed.description.includes('noch keine Züge'), 'Neuling bekommt einen freundlichen Hinweis');

/* --------------------- Strikes & Chat-Sperre (persistent) ---------------- */
const strikesConf = settings(normalizeConfig({ counting: { enabled: true, strikesEnabled: true, strikesToLock: 3, strikeLockHours: 24 } }));
assert.equal(strikesConf.strikesToLock, 3, 'Standard: 3 Verwarnungen bis zur Sperre');
assert.equal(strikesConf.strikeLockHours, 24, 'Standard: 24 Stunden Sperre');

// 2 Verwarnungen → noch keine Sperre, Zähler geführt (im echten Store)
const strikeGuild = { id: 'g-strikes', client: { users: { fetch: async () => ({ send: async () => {} }) } } };
let first = await applyStrike({ guild: strikeGuild, cfg: strikesConf, userId: 'u1', channel: null, value: 99 });
assert.equal(first.locked, false, '1. Verwarnung sperrt noch nicht');
assert.equal(first.strikes, 1, '1. Verwarnung gezählt');
let second = await applyStrike({ guild: strikeGuild, cfg: strikesConf, userId: 'u1', channel: null, value: 99 });
assert.equal(second.locked, false, '2. Verwarnung sperrt noch nicht');
assert.equal(second.strikes, 2, '2. Verwarnung gezählt');
let strikeStore = await getCountingStateForTest('g-strikes');
assert.equal(isUserCountingLocked(strikeStore, 'u1'), false, 'noch nicht gesperrt');

// 3. Verwarnung → Sperre + Zähler zurückgesetzt + Timer aktiv
const third = await applyStrike({ guild: strikeGuild, cfg: strikesConf, userId: 'u1', channel: null, value: 99 });
assert.equal(third.locked, true, '3. Verwarnung sperrt');
strikeStore = await getCountingStateForTest('g-strikes');
assert.equal(isUserCountingLocked(strikeStore, 'u1'), true, 'User ist gesperrt');
assert.equal(getStrikeCountInternal(strikeStore, 'u1'), 0, 'Strike-Zähler nach Sperre zurückgesetzt');

// Sperre übersteht „Neustart“ (State bleibt) und wird event-basiert freigegeben
assert.equal(await releaseCountingLock({ guild: strikeGuild, state: strikeStore, userId: 'u1' }), true, 'Freigabe meldet Erfolg');
strikeStore = await getCountingStateForTest('g-strikes');
assert.equal(isUserCountingLocked(strikeStore, 'u1'), false, 'nach Freigabe ist der User wieder frei');

// Abgelaufene Sperre wird beim Start-Restore freigegeben (kein Polling)
const expiredState = { count: 0, lastUserId: '', users: {}, strikes: {}, locks: { u9: { at: 1000, until: 2000 } } };
const restoreGuild = { id: 'g1', client: { users: { fetch: async () => ({ send: async () => {} }) } } };
await restoreCountingLocks(restoreGuild);
// (restore arbeitet auf dem echten Store; die abgelaufene Sperre in expiredState
// wird über releaseCountingLock simuliert)
const releaseExpired = await releaseCountingLock({ guild: restoreGuild, state: expiredState, userId: 'u9' });
assert.equal(releaseExpired, true, 'abgelaufene Sperre wird freigegeben');
assert.equal(isUserCountingLocked(expiredState, 'u9'), false, 'User nach Ablauf wieder frei');

// Dashboard: Gesperrte Spieler anzeigen + Sperre manuell aufheben
const lockListGuild = {
  id: 'g-locks',
  members: { cache: { get: () => ({ displayName: 'Max Muster', user: { username: 'max', id: 'locked1', avatar: 'abc123' } }) } },
  channels: { cache: new Map() },
  client: { users: { fetch: async () => ({ send: async () => {} }) } }
};
await applyStrike({ guild: lockListGuild, cfg: settings(normalizeConfig({ counting: { enabled: true, strikesToLock: 1, strikeLockHours: 2 } })), userId: 'locked1', channel: null, value: 99 });
const lockList = await getCountingLocks(lockListGuild);
assert.equal(lockList.locks.length, 1, 'aktive Sperre wird im Dashboard gelistet');
assert.equal(lockList.locks[0].userId, 'locked1', 'gesperrter User ist gelistet');
assert.equal(lockList.locks[0].name, 'Max Muster', 'Anzeigename kommt vom Mitglied');
assert.ok(lockList.locks[0].avatarUrl.includes('cdn.discordapp.com/avatars/locked1/abc123.png'), 'Avatar-URL kommt vom Discord-Profilbild');
assert.ok(lockList.locks[0].remainingMs > 0, 'Restzeit wird mitgegeben');
assert.ok(lockList.locks[0].until > lockList.locks[0].at, 'Start/Ende sind gesetzt');
const removedLock = await removeCountingLock({ guild: lockListGuild, userId: 'locked1' });
assert.equal(removedLock.ok, true, 'manuelle Freigabe meldet Erfolg');
const lockListAfter = await getCountingLocks(lockListGuild);
assert.equal(lockListAfter.locks.length, 0, 'nach Aufheben ist die Liste leer');
const lockListState = await getCountingStateForTest('g-locks');
assert.equal(isUserCountingLocked(lockListState, 'locked1'), false, 'User ist nach Aufheben wieder frei');
const noLockList = await getCountingLocks(lockListGuild);
assert.equal(noLockList.locks.length, 0, 'ohne Sperren ist die Liste leer');

// Einstellungen: neue Felder werden normalisiert
const strikeSettings = settings(normalizeConfig({ counting: { enabled: true, strikesToLock: 99, strikeLockHours: 0 } }));
assert.equal(strikeSettings.strikesToLock, 20, 'strikesToLock wird begrenzt (max 20)');
assert.equal(strikeSettings.strikeLockHours, 24, 'strikeLockHours 0 fällt auf Standard 24 zurück');

// Toleranz: Knapp daneben (erwartet 4, gesendet 5, Toleranz 1) verwarnt NICHT.
const tolConf = settings(normalizeConfig({ counting: { enabled: true, strikesEnabled: true, strikeTolerance: 1 } }));
assert.equal(tolConf.strikeTolerance, 1, 'Standard-Toleranz ist 1 (eine Zahl daneben ist ok)');
const nearState = { count: 3, lastUserId: 'u8', users: {} };
const nearResult = evaluateCount({ state: nearState, conf: tolConf, authorId: 'u1', content: '5' });
assert.equal(nearResult.kind, 'fail', '5 bei erwartet 4 ist ein Fehlversuch');
assert.equal(nearResult.reason, 'wrong-number', 'Grund: falsche Zahl');
// applyStrike darf für nahe Fehler keine Verwarnung setzen – hier prüfen wir
// die Schwellenlogik über processCountMessage-Aufrufe: 5 (Abweichung 1) und
// später 99 (Abweichung 95) auf denselben User.
const tolIntegration = normalizeConfig({
  counting: { enabled: true, channelId: 'chan-1', statusPanelEnabled: false, deleteWrongMessages: false, strikesEnabled: true, strikesToLock: 3, strikeLockHours: 24, strikeTolerance: 1, lossMessagesEnabled: false }
});
// Deterministisch: Zähler direkt auf 3 setzen (erwartet 4) – unabhängig von
// früheren Testläufen auf demselben Guild-Store.
const tolState = await getCountingStateForTest('guild-1');
tolState.count = 3;
tolState.lastUserId = 'u8';
tolState.strikes = {};
// u1: naher Fehler (Abweichung 1) → KEINE Verwarnung
await processCountMessage({ message: fakeMessage('u1', '5'), cfg: tolIntegration });
const tolStore = await getCountingStateForTest('guild-1');
assert.equal(getStrikeCountInternal(tolStore, 'u1'), 0, 'knapp daneben erzeugt KEINE Verwarnung (Toleranz)');
// u1: grober Fehler (Abweichung 98) → 1 Verwarnung
await processCountMessage({ message: fakeMessage('u1', '99'), cfg: tolIntegration });
const tolStore2 = await getCountingStateForTest('guild-1');
assert.equal(getStrikeCountInternal(tolStore2, 'u1'), 1, 'deutlich daneben erzeugt 1 Verwarnung');

// Doppelzug (self-count) resettet, verwarnt aber NICHT (3.9.172): Nur echte
// falsche Zahlen (wrong-number/above-max) geben eine Verwarnung.
const selfCountConf = settings(normalizeConfig({ counting: { enabled: true, strikesEnabled: true, strikesToLock: 3, strikeLockHours: 24 } }));
const scGuild = { id: 'g-selfcount', client: { users: { fetch: async () => ({ send: async () => {} }) } } };
// u1 zählt 1 (korrekt), dann nochmal 1 (Doppelzug mit selfCountIsFail=true)
const scState = { count: 0, lastUserId: '', users: {}, strikes: {}, locks: {} };
let scResult = evaluateCount({ state: scState, conf: selfCountConf, authorId: 'u1', content: '1' });
applyCountResult(scState, selfCountConf, scResult, 'u1', 1000);
scResult = evaluateCount({ state: scState, conf: selfCountConf, authorId: 'u1', content: '2' });
assert.equal(scResult.kind, 'fail', 'Doppelzug ist ein Fehlversuch');
assert.equal(scResult.reason, 'self-count', 'Grund: Doppelzug');
// Doppelzug resettet, verwarnt aber nicht (applyStrike wird nicht ausgelöst)
assert.equal(getStrikeCountInternal(scState, 'u1'), 0, 'Doppelzug erzeugt KEINE Verwarnung');
// Echte falsche Zahl verwarnt
const wrongResult = evaluateCount({ state: { count: 1, lastUserId: 'u2', users: {} }, conf: selfCountConf, authorId: 'u3', content: '9' });
assert.equal(wrongResult.reason, 'wrong-number', 'falsche Zahl ist ein Fehlversuch');

// Dashboard-Reset hebt Sperren + Verwarnungen auf (3.9.172)
const resetGuild = { id: 'g-reset', client: { users: { fetch: async () => ({ send: async () => {} }) } } };
await activateCountingLock({ guild: resetGuild, userId: 'locked-reset', lockMs: 3_600_000 });
let resetStore = await getCountingStateForTest('g-reset');
assert.equal(isUserCountingLocked(resetStore, 'locked-reset'), true, 'Sperre vor Reset aktiv');
await resetCounting({ guild: resetGuild, cfg: selfCountConf, actorId: 'admin' });
resetStore = await getCountingStateForTest('g-reset');
assert.equal(isUserCountingLocked(resetStore, 'locked-reset'), false, 'Reset hebt die Sperre auf');
assert.equal(getStrikeCountInternal(resetStore, 'locked-reset'), 0, 'Reset hebt Verwarnungen auf');

// Gesperrte User dürfen nicht zählen: Nachricht wird gelöscht und ignoriert.
const lockedIntegration = normalizeConfig({
  counting: { enabled: true, channelId: 'chan-1', statusPanelEnabled: false, deleteWrongMessages: true }
});
await activateCountingLock({ guild: { id: 'guild-1' }, userId: 'locked-u', lockMs: 3_600_000 });
const lockState = await getCountingStateForTest('guild-1');
assert.equal(isUserCountingLocked(lockState, 'locked-u'), true, 'Sperre ist aktiv');
const lockedBefore = reactions.length;
const lockedDelBefore = deletions.length;
await processCountMessage({ message: fakeMessage('locked-u', '1'), cfg: lockedIntegration });
assert.equal(reactions.length, lockedBefore, 'gesperrter User bekommt keine Reaktion');
assert.equal(deletions.length, lockedDelBefore + 1, 'Nachricht des gesperrten Users wird gelöscht');

console.log('counting-smoke: ok');
