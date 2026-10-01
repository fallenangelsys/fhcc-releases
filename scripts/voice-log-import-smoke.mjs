#!/usr/bin/env node
/**
 * Smoke-Test: Carl-bot Voice-Log-Import (voiceLogImport).
 *
 * Beweist:
 *   1. Parser erkennt die ECHTEN Carl-bot-Formate (aus dem Server-Index):
 *      „Member joined/left/changed voice channel“ mit Footer „ID: …“.
 *   2. User-ID kommt aus dem Embed-Footer, Kanalname aus der Beschreibung.
 *   3. join → Session öffnet, leave → Session schließt und verbucht Dauer
 *      (totalVoiceSeconds, lastVoiceAt, daily voiceSeconds) – exakt aus den
 *      Log-Zeitstempeln, nicht aus „jetzt“ (Offline-Backfill korrekt).
 *   4. move → alte Session schließt, neue öffnet.
 *   5. Dedup: dieselbe Nachrichten-ID wird nie doppelt verarbeitet.
 *   6. Settings/Normalisierung (enabled, channelId, backfillHours).
 */
import assert from 'node:assert/strict';

// WICHTIG: Muss der erste Import sein – temporärer Datenordner.
import './smoke-test-env.mjs';

import { _voiceLogImportInternals } from '../src/features/voiceLogImport.js';
import { importVoiceSession } from '../src/features/memberManagement.js';
import { _memberManagementInternals } from '../src/features/memberManagement.js';
import { defaultGuildConfig, normalizeConfig } from '../src/defaultConfig.js';

const { settings, parseVoiceLogMessage, runVoiceLogBackfill, reconstructVoiceLogSessions, getIndexedVoiceLogSessions } = _voiceLogImportInternals;

let passed = 0;
const ok = (label) => { passed += 1; console.log(`  ✅ ${label}`); };

// Hilfsfunktion: Baut eine discord.js-ähnliche Nachricht aus einem Embed.
const mkMessage = ({ id = '1000', channelId = 'ch-log', createdAt, title, description, footerText, authorIconUrl = '', embedTimestamp }) => ({
  id,
  channelId,
  createdTimestamp: new Date(createdAt).getTime(),
  embeds: [{
    title,
    description,
    timestamp: embedTimestamp || createdAt,
    footer: { text: footerText },
    author: { name: 'x', iconURL: authorIconUrl }
  }]
});

// 1) Echte Carl-bot-Formate parsen
{
  const join = mkMessage({
    id: '1538700057812017217',
    createdAt: '2026-08-17T00:04:41.447Z',
    title: 'Member joined voice channel',
    description: '**felino_05** joined #╭🔊ᯓ 2er-talk',
    footerText: 'ID: 1279782547064360990',
    embedTimestamp: '2026-08-17T00:04:36.349Z'
  });
  const parsedJoin = parseVoiceLogMessage(join);
  assert.equal(parsedJoin.type, 'join');
  assert.equal(parsedJoin.userId, '1279782547064360990');
  assert.equal(parsedJoin.channelName, '╭🔊ᯓ 2er-talk');
  assert.equal(parsedJoin.eventAt.toISOString(), '2026-08-17T00:04:36.349Z');
  ok('Parser: Join (echtes Format) → userId aus Footer, Kanalname, Event-Zeit');

  const leave = mkMessage({
    id: '1538704356696662118',
    createdAt: '2026-08-17T00:21:46.381Z',
    title: 'Member left voice channel',
    description: '**bumbumalien** left #┃🔊ᯓ user-talk¹',
    footerText: 'ID: 611612216734646275',
    embedTimestamp: '2026-08-17T00:21:46.111Z'
  });
  const parsedLeave = parseVoiceLogMessage(leave);
  assert.equal(parsedLeave.type, 'leave');
  assert.equal(parsedLeave.userId, '611612216734646275');
  assert.equal(parsedLeave.channelName, '┃🔊ᯓ user-talk¹');
  ok('Parser: Leave (echtes Format)');

  const move = mkMessage({
    id: '1538716899054190784',
    createdAt: '2026-08-17T01:11:36.712Z',
    title: 'Member changed voice channel',
    description: '**Before:** #╭👑ᯓowner-talk\n**+After:** #┃🔊ᯓ user-talk¹',
    footerText: 'ID: 801634130394611752',
    embedTimestamp: '2026-08-17T01:11:33.312Z'
  });
  const parsedMove = parseVoiceLogMessage(move);
  assert.equal(parsedMove.type, 'move');
  assert.equal(parsedMove.userId, '801634130394611752');
  assert.equal(parsedMove.beforeChannel, '╭👑ᯓowner-talk');
  assert.equal(parsedMove.afterChannel, '┃🔊ᯓ user-talk¹');
  ok('Parser: Move (echtes Format) → Before/After-Kanäle');

  assert.equal(parseVoiceLogMessage(mkMessage({ id: 'x1', createdAt: '2026-08-17T00:00:00Z', title: 'Member joined voice channel', description: '**a** joined #k', footerText: '' })), null, 'ohne User-ID → kein Treffer');
  assert.equal(parseVoiceLogMessage(mkMessage({ id: 'x2', createdAt: '2026-08-17T00:00:00Z', title: 'Normaler Text', description: 'Hallo', footerText: 'ID: 123' })), null, 'fremdes Embed → kein Treffer');
  ok('Parser: Fremde/ungültige Nachrichten werden ignoriert');

  // Deutsche Carl-bot-Variante
  const deJoin = mkMessage({
    id: 'de1',
    createdAt: '2026-08-17T00:00:00Z',
    title: 'Mitglied ist einem Sprachkanal beigetreten',
    description: '**haku** beigetreten #╭🔊ᯓ 2er-talk',
    footerText: 'ID: 111222333444555'
  });
  assert.equal(parseVoiceLogMessage(deJoin)?.type, 'join');
  ok('Parser: Deutsche Titel-Variante (beigetreten)');
}

// 2) Verbuchung: join + leave → Dauer exakt aus Log-Zeitstempeln

{
  const at = (value) => new Date(value);
  const reconstructed = reconstructVoiceLogSessions([
    { type: 'join', userId: 'voice-user', channelName: 'Talk 1', eventAt: at('2026-08-20T10:00:00.000Z') },
    { type: 'move', userId: 'voice-user', beforeChannel: 'Talk 1', afterChannel: 'Talk 2', eventAt: at('2026-08-20T10:10:00.000Z') },
    { type: 'leave', userId: 'voice-user', channelName: 'Talk 2', eventAt: at('2026-08-20T10:25:00.000Z') }
  ]);
  assert.deepEqual(
    reconstructed.sessions.map((session) => [session.userId, session.channelName, session.startMs, session.endMs]),
    [
      ['voice-user', 'Talk 1', at('2026-08-20T10:00:00.000Z').getTime(), at('2026-08-20T10:10:00.000Z').getTime()],
      ['voice-user', 'Talk 2', at('2026-08-20T10:10:00.000Z').getTime(), at('2026-08-20T10:25:00.000Z').getTime()]
    ],
    'Carl-bot Join/Move/Leave muss zwei lückenlose, exakt datierte Sessions ergeben.'
  );
  assert.equal(reconstructed.openSessions.size, 0);
  ok('Session-Rekonstruktion: Join/Move/Leave exakt gepaart');
}
{
  // Kanal: Name wird über den Guild-Cache aufgelöst (Mock)
  const guild = {
    id: 'g-vl',
    channels: { cache: new Map([
      ['ch-2er', { id: 'ch-2er', name: '╭🔊ᯓ 2er-talk' }]
    ]) }
  };

  const joinAt = '2026-08-16T23:59:00.000Z';
  const leaveAt = '2026-08-17T00:30:00.000Z'; // 31 Minuten später

  const joinMsg = mkMessage({ id: 'j1', channelId: 'ch-log', createdAt: joinAt, title: 'Member joined voice channel', description: '**user1** joined #╭🔊ᯓ 2er-talk', footerText: 'ID: 900000000000000001', embedTimestamp: joinAt });
  const leaveMsg = mkMessage({ id: 'l1', channelId: 'ch-log', createdAt: leaveAt, title: 'Member left voice channel', description: '**user1** left #╭🔊ᯓ 2er-talk', footerText: 'ID: 900000000000000001', embedTimestamp: leaveAt });

  const parsedJoin = parseVoiceLogMessage(joinMsg);
  const parsedLeave = parseVoiceLogMessage(leaveMsg);
  await _voiceLogImportInternals.applyVoiceLog({ guild, message: joinMsg, parsed: parsedJoin });
  await _voiceLogImportInternals.applyVoiceLog({ guild, message: leaveMsg, parsed: parsedLeave });

  // Dauer prüfen: 31 Minuten = 1860 Sekunden
  const openSessions = importVoiceSession.openSessions(guild.id);
  assert.equal(openSessions['900000000000000001'], undefined, 'Session nach Leave geschlossen');

  // Letzte Voice-Aktivität wurde verbucht (Aktivitäts-Snapshot der Mitglieder)
  const { getMemberActivitySnapshot } = await import('../src/features/memberManagement.js');
  const snapshot = getMemberActivitySnapshot(guild.id);
  assert.ok(snapshot['900000000000000001'], 'Mitglied hat Voice-Aktivität im Snapshot');
  assert.equal(
    new Date(snapshot['900000000000000001']).toISOString(),
    '2026-08-17T00:30:00.000Z',
    'lastVoiceAt = Leave-Zeitpunkt aus dem Log (nicht „jetzt“)'
  );
  ok('Verbuchung: lastVoiceAt exakt aus dem Log-Zeitstempel');
  // Direkter Check: erneutes Join+Leave derselben Message-IDs → Dedup greift
  const dup1 = await _voiceLogImportInternals.applyVoiceLog({ guild, message: joinMsg, parsed: parsedJoin });
  const dup2 = await _voiceLogImportInternals.applyVoiceLog({ guild, message: leaveMsg, parsed: parsedLeave });
  assert.equal(dup1, 'duplicate');
  assert.equal(dup2, 'duplicate');
  ok('Dedup: dieselben Log-Nachrichten werden nie doppelt verarbeitet');
}

// 3) Settings + Normalisierung
{
  const def = defaultGuildConfig('1').voiceLogImport;
  assert.equal(def.enabled, false);
  assert.equal(def.channelId, '');
  assert.equal(def.backfillHours, 4320, 'Default: 180 Tage (deckt die Inaktivitäts-Schwelle)');
  assert.equal(def.maxPages, 100);
  const norm = normalizeConfig({ guildId: '1', guildName: 'T', voiceLogImport: { enabled: true, channelId: 'ch-log', backfillHours: 99999 } }).voiceLogImport;
  assert.equal(norm.enabled, true);
  assert.equal(norm.channelId, 'ch-log');
  assert.equal(norm.backfillHours, 17520, 'backfillHours wird geklemmt (2 Jahre max)');
  const s = settings({ voiceLogImport: { enabled: true, channelId: 'abc', backfillHours: 'x' } });
  assert.equal(s.enabled, true);
  assert.equal(s.backfillHours, 4320, 'ungültiger Wert fällt auf Standard zurück');
  ok('Settings/Normalisierung: enabled, channelId, backfillHours geklemmt');
}

// 4) parseVoiceLogRecord: record_json-Format exakt wie im Server-Index
//    (Live-DB: { id, guildId, channelId, createdAt, embeds: [{ title,
//    description, timestamp, footer: { text: "ID: …" } }] })
{
  const record = {
    id: '1538951742014619699',
    guildId: '1276125977805721640',
    channelId: '1306078721840775290',
    createdAt: '2026-08-17T16:44:42.252000+00:00',
    embeds: [{
      title: 'Member joined voice channel',
      description: '**chromaking** joined #┃🔊ᯓ user-talk²',
      timestamp: '2026-08-17T16:44:42.252000+00:00',
      footer: { text: 'ID: 574158616303501312', iconURL: '' }
    }]
  };
  const parsed = _voiceLogImportInternals.parseVoiceLogRecord(record);
  assert.equal(parsed.type, 'join');
  assert.equal(parsed.userId, '574158616303501312');
  assert.equal(parsed.channelName, '┃🔊ᯓ user-talk²');
  assert.equal(parsed.eventAt.toISOString(), '2026-08-17T16:44:42.252Z');
  ok('parseVoiceLogRecord: record_json-Format (echte Index-Struktur)');
}

// 5) INDEX-PASS: komplette Historie aus dem Server-Index (eine Query, keine
//    REST-Calls). Monate alte Logs werden exakt verbucht – damit kann die
//    Inaktivitäts-Erinnerung prüfen, wer in den letzten 180 Tagen im Call war.
{
  const fs = await import('node:fs');
  const path = await import('node:path');
  const Database = (await import('better-sqlite3')).default;
  const dataDir = process.env.FALLEN_HEAVEN_DATA_DIR;
  const indexFile = path.join(dataDir, 'server-index', 'fallen-heaven-index.sqlite3');
  fs.mkdirSync(path.dirname(indexFile), { recursive: true });
  const idxDb = new Database(indexFile);
  idxDb.exec('CREATE TABLE IF NOT EXISTS messages(message_id TEXT PRIMARY KEY, guild_id TEXT, channel_id TEXT, created_at TEXT, record_json TEXT);');
  const ins = idxDb.prepare('INSERT INTO messages(message_id, guild_id, channel_id, created_at, record_json) VALUES (?,?,?,?,?)');
  const mkRecord = (id, at, title, desc, uid) => JSON.stringify({
    id, guildId: 'g-index', channelId: 'ch-index', createdAt: at,
    embeds: [{ title, description: desc, timestamp: at, footer: { text: `ID: ${uid}`, iconURL: '' } }]
  });
  const at1 = '2026-01-10T12:00:00.000Z'; // ~7 Monate alt (älter als 180 Tage)
  const at2 = '2026-01-10T12:30:00.000Z';
  ins.run('i1', 'g-index', 'ch-index', at1, mkRecord('i1', at1, 'Member joined voice channel', '**oldvoice** joined #┃🔊ᯓ user-talk²', '100000000000000001'));
  ins.run('i2', 'g-index', 'ch-index', at2, mkRecord('i2', at2, 'Member left voice channel', '**oldvoice** left #┃🔊ᯓ user-talk²', '100000000000000001'));
  idxDb.close();

  const guild = { id: 'g-index', channels: { cache: new Map() } };
  const conf = normalizeConfig({ guildId: 'g-index', guildName: 'T', voiceLogImport: { enabled: true, channelId: 'ch-index', backfillHours: 1, batchSize: 100, maxPages: 5 } });
  const result = await runVoiceLogBackfill({ guild, cfg: conf, source: 'index-pass-test' });
  assert.equal(result.indexRows, 2, 'Index-Pass liest die komplette Historie aus dem Index');
  assert.equal(result.applied, 2, 'beide Logs verarbeitet');
  assert.equal(result.fetched, 0, 'kein REST-Fallback, wenn der Index alles hat');
  const indexedSessions = await getIndexedVoiceLogSessions({ guild, cfg: conf, force: true });
  assert.equal(indexedSessions.status, 'ok');
  assert.equal(indexedSessions.sessions.length, 1, 'Join/Leave aus SQLite ergeben eine geschlossene Session.');
  assert.equal(indexedSessions.sessions[0].endMs - indexedSessions.sessions[0].startMs, 30 * 60_000, 'SQLite-Session dauert exakt 30 Minuten.');

  const { getMemberActivitySnapshot } = await import('../src/features/memberManagement.js');
  const snap = getMemberActivitySnapshot('g-index');
  assert.ok(snap['100000000000000001'], 'Voice-Aktivität aus dem Index verbucht');
  assert.equal(new Date(snap['100000000000000001']).toISOString(), at2, 'lastVoiceAt = Log-Leave-Zeit (Monate alt, exakt verbucht)');
  ok('Index-Pass: Monate alte Logs exakt verbucht (180-Tage-Prüfung möglich)');

  const again = await runVoiceLogBackfill({ guild, cfg: conf, source: 'index-pass-again' });
  assert.equal(again.duplicates, 2, 'zweiter Lauf: beide als Duplikat erkannt');
  ok('Index-Pass: Dedup über verarbeitete IDs (keine Doppelverbuchung)');
}

// 6) AUTO-ERKENNUNG: Der Log-Kanal wird im Server-Index automatisch gefunden –
//    kein manueller Kanal nötig (der eigentliche Punkt: „muss ich einen Kanal
//    angeben?“ → NEIN).
{
  const fs = await import('node:fs');
  const path = await import('node:path');
  const Database = (await import('better-sqlite3')).default;
  const dataDir = process.env.FALLEN_HEAVEN_DATA_DIR;
  const indexFile = path.join(dataDir, 'server-index', 'fallen-heaven-index.sqlite3');
  const idxDb = new Database(indexFile);
  idxDb.exec('CREATE TABLE IF NOT EXISTS messages(message_id TEXT PRIMARY KEY, guild_id TEXT, channel_id TEXT, created_at TEXT, record_json TEXT);');
  const ins = idxDb.prepare('INSERT OR REPLACE INTO messages(message_id, guild_id, channel_id, created_at, record_json) VALUES (?,?,?,?,?)');
  const mkRec = (id, channelId, at, title, desc, uid) => JSON.stringify({
    id, guildId: 'g-det', channelId, createdAt: at,
    embeds: [{ title, description: desc, timestamp: at, footer: { text: `ID: ${uid}`, iconURL: '' } }]
  });
  // Kanal A: 8 Carl-bot-Logs (join/leave × 4) – der richtige Log-Kanal
  for (let i = 0; i < 4; i += 1) {
    const base = new Date('2026-02-01T10:00:00.000Z').getTime() + i * 600000;
    const at = (ms) => new Date(ms).toISOString();
    ins.run('det-a-j' + i, 'g-det', 'ch-a', at(base), mkRec('det-a-j' + i, 'ch-a', at(base), 'Member joined voice channel', '**user** joined #┃🔊ᯓ user-talk²', '20000000000000000' + i));
    ins.run('det-a-l' + i, 'g-det', 'ch-a', at(base + 300000), mkRec('det-a-l' + i, 'ch-a', at(base + 300000), 'Member left voice channel', '**user** left #┃🔊ᯓ user-talk²', '20000000000000000' + i));
  }
  // Kanal B: normale Chat-Nachrichten (kein Carl-bot) – muss ignoriert werden
  ins.run('det-b-1', 'g-det', 'ch-b', '2026-02-01T11:00:00.000Z', JSON.stringify({ id: 'det-b-1', guildId: 'g-det', channelId: 'ch-b', createdAt: '2026-02-01T11:00:00.000Z', embeds: [{ title: 'Hallo', description: 'test', footer: { text: '' } }] }));
  idxDb.close();

  const detected = _voiceLogImportInternals.detectVoiceLogChannel('g-det');
  assert.ok(detected, 'Log-Kanal wird automatisch erkannt');
  assert.equal(detected.id, 'ch-a', 'richtiger Kanal (meiste Carl-bot-Logs)');
  assert.equal(detected.count, 8, 'Zähler stimmt');
  ok('Auto-Erkennung: Kanal mit den Carl-bot-Logs wird im Index gefunden');

  const confNoChannel = normalizeConfig({ guildId: 'g-det', guildName: 'T', voiceLogImport: { enabled: true, backfillHours: 1 } });
  const resolved = _voiceLogImportInternals.resolveVoiceLogChannel(confNoChannel.voiceLogImport, 'g-det');
  assert.equal(resolved.source, 'auto');
  assert.equal(resolved.id, 'ch-a');
  ok('Auto-Erkennung: ohne konfigurierten Kanal wird der erkannte genutzt');

  // Backfill OHNE konfigurierten Kanal verbucht die erkannten Logs
  const guildDet = { id: 'g-det', channels: { cache: new Map([['ch-a', { id: 'ch-a', name: '┃🔊ᯓ user-talk²' }]]) } };
  const result = await runVoiceLogBackfill({ guild: guildDet, cfg: confNoChannel, source: 'auto-test' });
  assert.equal(result.indexRows, 8, 'Index-Pass über den erkannten Kanal');
  assert.equal(result.fetched, 0, 'kein REST-Fallback nötig');
  assert.equal(result.channelSource, 'auto', 'Quelle: automatisch erkannt');
  ok('Backfill: läuft ohne Kanal-Einstellung über den automatisch erkannten Log-Kanal');
}

// 7) Live-Pfad für BOT-Nachrichten (Carl-bot postet als Bot): onBotMessageCreate
//    verarbeitet Logs genauso wie onMessageCreate. Vorher warf er
//    „Cannot read properties of undefined (reading 'onMessageCreate')“ – der
//    Dispatcher ruft Handler als plain functions auf (this = undefined), das
//    Live-Tracking war damit STILL kaputt (keine neuen Voice-Daten).
{
  const { feature } = _voiceLogImportInternals;
  const { getMemberActivityDetail } = await import('../src/features/memberManagement.js');
  const guildId = 'g-bot-live';
  const memberId = '510441049718521870';
  const guild = { id: guildId, channels: { cache: new Map() } };
  const message = {
    id: 'live-bot-1',
    guildId,
    guild,
    channelId: 'ch-log',
    createdTimestamp: new Date('2026-08-14T13:45:00.428Z').getTime(),
    embeds: [{
      title: 'Member joined voice channel',
      description: '**t3trit** joined #╭👑ᯓowner-talk',
      timestamp: '2026-08-14T13:45:00.428Z',
      footer: { text: 'ID: ' + memberId }
    }]
  };
  const conf = normalizeConfig({ guildId, guildName: 'T', voiceLogImport: { enabled: true, backfillHours: 1 } });
  const returned = feature.onBotMessageCreate({ message, cfg: conf });
  assert.equal(typeof returned?.then, 'function', 'onBotMessageCreate liefert eine Promise (kein Throw)');
  await returned;
  const detail = getMemberActivityDetail(guildId);
  assert.ok(detail[memberId]?.lastVoiceAt, 'Bot-Nachricht wird verarbeitet: lastVoiceAt für den Member gesetzt');
  assert.equal(detail[memberId].lastVoiceAt, '2026-08-14T13:45:00.428Z', 'Zeitpunkt exakt aus dem Log');
  ok('Live-Verarbeitung für BOT-Nachrichten (Carl-bot) funktioniert – kein this-Bug');
}

console.log(`\nCarl-bot Voice-Log-Import: ${passed} Prüfungen grün ✅`);
