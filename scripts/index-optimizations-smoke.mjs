#!/usr/bin/env node
/**
 * Smoke-Test: Index-Optimierungen (3.9.195).
 *
 * Beweist:
 *   1. Migration 1002: alter voller messages_system_idx ist weg, die beiden
 *      schmalen partiellen Indizes (System / Boost) existieren.
 *   2. Member-Stats-Precompute: Ingest pflegt member_stats inkrementell,
 *      Bearbeitungen korrigieren Link-/Medien-Zähler, Löschungen rechnen
 *      vollständig neu, Lazy-Backfill liefert Bestandsdaten.
 *   3. getServerIndexAuthorSummary / ...ChannelBreakdown lesen aus den
 *      Precompute-Daten und liefern dieselben Werte wie die Live-Abfrage.
 *   4. Kanalverlauf: Keyset-Cursor (beforeMessageId) ohne COUNT/OFFSET liefert
 *      korrekte Reihenfolge, hasMore und nextBefore.
 */
import assert from 'node:assert/strict';

// WICHTIG: Muss der erste Import sein – temporärer Datenordner.
import './smoke-test-env.mjs';

import {
  persistServerIndexMessages,
  deleteServerIndexMessages,
  getServerIndexAuthorSummary,
  getServerIndexAuthorChannelBreakdown,
  getServerIndexChannelPage,
  getServerIndexSystemEventCounts,
  getServerIndexSystemEvents,
  verifyServerIndexJsonlMigrated,
  _serverIndexInternals
} from '../src/serverIndexStore.js';

let passed = 0;
const ok = (label) => { passed += 1; console.log(`  ✅ ${label}`); };

const GUILD = '111111111111111111';
const CH1 = '222222222222222221';
const CH2 = '222222222222222222';
const USER = '333333333333333333';

const mkRecord = ({ id, channelId = CH1, authorId = USER, content = '', attachments = [], createdAt, type = 0, system = false, systemEvent = null }) => ({
  id,
  guildId: GUILD,
  channelId,
  channelName: channelId === CH1 ? 'hauptchat' : 'anderer-kanal',
  authorId,
  authorName: 'Tester',
  content,
  attachments,
  type,
  system,
  systemEvent,
  createdAt,
  embeds: []
});

const iso = (ms) => new Date(ms).toISOString();
const T0 = Date.parse('2026-08-01T10:00:00.000Z');
const T1 = Date.parse('2026-08-02T10:00:00.000Z');
const T2 = Date.parse('2026-08-03T10:00:00.000Z');

// 1) Migration 1002: partielle Indizes
{
  const database = _serverIndexInternals.getDatabase();
  const indexes = database.prepare(
    "SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='messages'"
  ).all();
  const names = indexes.map((row) => row.name);
  assert.ok(names.includes('messages_system_partial_idx'), 'partieller System-Index fehlt');
  assert.ok(names.includes('messages_boost_partial_idx'), 'partieller Boost-Index fehlt');
  assert.ok(!names.includes('messages_system_idx'), 'alter voller System-Index existiert noch');
  const systemSql = indexes.find((row) => row.name === 'messages_system_partial_idx')?.sql || '';
  const boostSql = indexes.find((row) => row.name === 'messages_boost_partial_idx')?.sql || '';
  assert.ok(/WHERE is_system = 1/.test(systemSql), 'System-Index ist nicht partiell');
  assert.ok(/WHERE message_type = 8/.test(boostSql), 'Boost-Index ist nicht partiell');
  const memberTables = database.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('member_stats','member_channel_stats')"
  ).all();
  assert.equal(memberTables.length, 2, 'member_stats Tabellen fehlen');
  ok('Migration 1002: partielle Indizes + member_stats Tabellen vorhanden, alter Index weg');
}

// 2) Ingest pflegt Stats inkrementell
(async () => {
  await persistServerIndexMessages([
    mkRecord({ id: '101', content: 'hallo https://example.com', createdAt: iso(T0) }),
    mkRecord({ id: '102', content: 'zweite nachricht', createdAt: iso(T1) }),
    mkRecord({ id: '103', content: 'dritte', createdAt: iso(T2), channelId: CH2 })
  ], { source: 'live' });
  await new Promise((resolve) => setTimeout(resolve, 250));

  // allowedChannelIds: null = alle Kanäle (leeres Array würde „kein Kanal sichtbar“ bedeuten)
  let summary = await getServerIndexAuthorSummary({ guildId: GUILD, authorId: USER, allowedChannelIds: null });
  assert.equal(summary.count, 3, 'count nach Ingest falsch');
  assert.equal(summary.channelCount, 2, 'channelCount nach Ingest falsch');
  assert.equal(summary.firstMessageAt, iso(T0), 'firstMessageAt falsch');
  assert.equal(summary.lastMessageAt, iso(T2), 'lastMessageAt falsch');

  let breakdown = await getServerIndexAuthorChannelBreakdown({ guildId: GUILD, authorId: USER, allowedChannelIds: null });
  assert.equal(breakdown.linkCount, 1, 'linkCount falsch');
  assert.equal(breakdown.mediaCount, 0, 'mediaCount falsch');
  assert.equal(breakdown.channels.length, 2, 'Kanal-Breakdown falsch');
  assert.equal(breakdown.channels[0].count, 2, 'Hauptkanal-Zähler falsch');
  ok('Precompute: Ingest zählt Nachrichten, Kanäle, erste/letzte Nachricht, Links');

  // Kanal-Scope (Berechtigungsfilter)
  const scoped = await getServerIndexAuthorSummary({ guildId: GUILD, authorId: USER, allowedChannelIds: [CH1] });
  assert.equal(scoped.count, 2, 'Kanal-Scope-Filter falsch');
  assert.equal(scoped.channelCount, 1, 'Kanal-Scope-Kanalzahl falsch');
  ok('Precompute: Kanal-Scope (allowedChannelIds) korrekt aus Channel-Rows gefiltert');

  // 3) Bearbeitung korrigiert Link-Zähler
  await persistServerIndexMessages([
    mkRecord({ id: '101', content: 'kein link mehr', createdAt: iso(T0) })
  ], { source: 'live' });
  await new Promise((resolve) => setTimeout(resolve, 250));
  breakdown = await getServerIndexAuthorChannelBreakdown({ guildId: GUILD, authorId: USER, allowedChannelIds: null });
  assert.equal(breakdown.linkCount, 0, 'Edit korrigiert linkCount nicht');
  summary = await getServerIndexAuthorSummary({ guildId: GUILD, authorId: USER, allowedChannelIds: null });
  assert.equal(summary.count, 3, 'Edit ändert message_count fälschlich');
  ok('Precompute: Bearbeitung passt Link-/Medien-Zähler an, Zählung bleibt');

  // 4) Löschung rechnet vollständig neu
  await deleteServerIndexMessages({ guildId: GUILD, messageIds: ['101'] });
  summary = await getServerIndexAuthorSummary({ guildId: GUILD, authorId: USER, allowedChannelIds: null });
  assert.equal(summary.count, 2, 'count nach Löschung falsch');
  breakdown = await getServerIndexAuthorChannelBreakdown({ guildId: GUILD, authorId: USER, allowedChannelIds: null });
  assert.equal(breakdown.channels.find((row) => row.channelId === CH1)?.count, 1, 'Kanalzähler nach Löschung falsch');
  ok('Precompute: Löschung rechnet Stats für betroffene Autoren neu');

  // 5) Werte-Konsistenz: Precompute == Live-Aggregation
  const summaryLive = await _serverIndexInternals.liveAuthorSummaryForTest(GUILD, USER);
  assert.equal(summaryLive.count, summary.count, 'Precompute weicht von Live-Aggregation ab (count)');
  assert.equal(summaryLive.firstMessageAt, summary.firstMessageAt, 'firstMessageAt weicht ab');
  assert.equal(summaryLive.lastMessageAt, summary.lastMessageAt, 'lastMessageAt weicht ab');
  ok('Precompute: identisch zur Live-Aggregation (Referenzabgleich)');

  // 6) Kanal-Cursor-Pagination (Keyset, kein COUNT/OFFSET)
  const many = [];
  for (let index = 0; index < 25; index += 1) {
    many.push(mkRecord({
      id: String(4000 + index),
      content: `nachricht ${index}`,
      createdAt: iso(T0 + index * 60_000)
    }));
  }
  await persistServerIndexMessages(many, { source: 'backfill', batchId: 'cursor-test' });
  await new Promise((resolve) => setTimeout(resolve, 250));

  const firstPage = await getServerIndexChannelPage({ guildId: GUILD, channelId: CH1, page: 1, pageSize: 10 });
  assert.equal(firstPage.rows.length, 10, 'erste Seite hat nicht 10 Zeilen');
  assert.equal(firstPage.hasMore, true, 'hasMore fehlt auf Seite 1');
  assert.ok(firstPage.nextBefore, 'nextBefore fehlt');
  const oldestOnPage1 = firstPage.rows[0].id;
  const cursor = firstPage.nextBefore;
  const secondPage = await getServerIndexChannelPage({ guildId: GUILD, channelId: CH1, beforeMessageId: cursor, pageSize: 10 });
  assert.equal(secondPage.rows.length, 10, 'Cursor-Seite hat nicht 10 Zeilen');
  assert.ok(secondPage.rows.every((row) => String(row.id) !== String(oldestOnPage1)), 'Cursor-Seite enthält schon gesehene Nachricht');
  const thirdPage = await getServerIndexChannelPage({ guildId: GUILD, channelId: CH1, beforeMessageId: secondPage.nextBefore, pageSize: 10 });
  assert.equal(thirdPage.rows.length, 6, 'letzte Cursor-Seite hat nicht die Rest-Zeilen (26 gesamt, 2x10 geladen)');
  assert.equal(thirdPage.hasMore, false, 'letzte Seite hat fälschlich hasMore');
  // Reihenfolge: Jede Seite intern aufsteigend; die nächste Seite ist KOMPLETT
  // älter als die vorherige (Cursor-Pagination geht in die Vergangenheit).
  const pageDates = [firstPage, secondPage, thirdPage].map((page) => page.rows.map((row) => row.createdAt));
  for (const dates of pageDates) {
    for (let index = 1; index < dates.length; index += 1) {
      assert.ok(String(dates[index]) >= String(dates[index - 1]), `Seite intern nicht aufsteigend bei ${dates[index]}`);
    }
  }
  for (let index = 1; index < pageDates.length; index += 1) {
    const previousOldest = pageDates[index - 1][0];
    const nextNewest = pageDates[index][pageDates[index].length - 1];
    assert.ok(String(nextNewest) < String(previousOldest), `Seite ${index + 1} ist nicht älter als Seite ${index}`);
  }
  ok('Kanal-Cursor: Keyset liefert lückenlose, chronologische Seiten mit hasMore/nextBefore');

  // 5b) Lazy-Backfill-Vollständigkeits-Flag: Eine neue Nachricht erzeugt eine
  // Precompute-Zeile, aber historische Nachrichten fehlen noch (simuliert durch
  // entfernte Stats bei vorhandenen messages). Das Profil muss trotzdem die
  // GESAMTE Historie melden – erst nach dem kompletten Recompute (Flag=1)
  // zählen neue Nachrichten inkrementell weiter.
  {
    const db = _serverIndexInternals.getDatabase();
    db.prepare('DELETE FROM member_stats WHERE guild_id=? AND author_id=?').run(GUILD, USER);
    db.prepare('DELETE FROM member_channel_stats WHERE guild_id=? AND author_id=?').run(GUILD, USER);
    await persistServerIndexMessages([
      mkRecord({ id: '105', content: 'neue nachricht nach backfill-luecke', createdAt: iso(T2 + 60_000) })
    ], { source: 'live' });
    await new Promise((resolve) => setTimeout(resolve, 250));
    const summaryAfter = await getServerIndexAuthorSummary({ guildId: GUILD, authorId: USER, allowedChannelIds: null });
    const liveAfter = await _serverIndexInternals.liveAuthorSummaryForTest(GUILD, USER);
    assert.equal(summaryAfter.count, liveAfter.count, 'Lazy-Backfill meldet nicht die gesamte Historie');
    const flag = db.prepare('SELECT backfill_complete FROM member_stats WHERE guild_id=? AND author_id=?').get(GUILD, USER);
    assert.equal(Number(flag?.backfill_complete || 0), 1, 'backfill_complete wurde nach Recompute nicht gesetzt');
    await persistServerIndexMessages([
      mkRecord({ id: '106', content: 'weitere nachricht', createdAt: iso(T2 + 120_000) })
    ], { source: 'live' });
    await new Promise((resolve) => setTimeout(resolve, 250));
    const summaryFinal = await getServerIndexAuthorSummary({ guildId: GUILD, authorId: USER, allowedChannelIds: null });
    const liveFinal = await _serverIndexInternals.liveAuthorSummaryForTest(GUILD, USER);
    assert.equal(summaryFinal.count, liveFinal.count, 'inkrementelle Zählung nach vollständigem Backfill weicht ab');
    ok('Lazy-Backfill: backfill_complete erzwingt komplette Historie, danach zählt der Ingest weiter');
  }

  // 6b) Systemereignis-Zähler über die partiellen Indizes + SQL-Keyset + Kategorie-Filter
  const systemEvents = [
    mkRecord({ id: '7001', content: '1', createdAt: iso(T0), system: true, systemEvent: 'boost_started', type: 8 }),
    mkRecord({ id: '7002', content: '1', createdAt: iso(T0 + 60_000), system: true, systemEvent: 'boost_started', type: 8 }),
    mkRecord({ id: '7003', content: 'willkommen', createdAt: iso(T1), system: true, systemEvent: 'member_joined', type: 7 }),
    mkRecord({ id: '7004', content: 'lebt nicht mehr', createdAt: iso(T1 + 60_000), system: true, systemEvent: 'member_left', type: 0 }),
    mkRecord({ id: '7005', content: 'unbekannt', createdAt: iso(T1 + 120_000), system: true, systemEvent: 'discord_system', type: 0 }),
    // Katalog-message_type=8 wird beim Ingest automatisch auf is_system=1
    // gehoben (SYSTEM_EVENT_NAMES) – zählt trotzdem als Boost.
    mkRecord({ id: '7006', content: '2', createdAt: iso(T2), system: false, type: 8 })
  ];
  await persistServerIndexMessages(systemEvents, { source: 'backfill', batchId: 'system-count-test' });
  await new Promise((resolve) => setTimeout(resolve, 250));

  const counts = await getServerIndexSystemEventCounts({ guildId: GUILD });
  assert.equal(counts.total, 6, 'System-Zähler total falsch (partielle Indizes)');
  assert.equal(counts.boosts, 3, 'System-Zähler boosts falsch (2 is_system=1 + 1 catalog message_type=8)');
  assert.equal(counts.joins, 1, 'System-Zähler joins falsch');
  assert.equal(counts.ended, 1, 'System-Zähler ended falsch (member_left)');
  assert.equal(counts.categories.boosts, 3, 'Kategorie boosts falsch');
  assert.equal(counts.categories.membership, 2, 'Kategorie membership falsch');
  assert.equal(counts.categories.other, 1, 'Kategorie other falsch (discord_system)');
  ok('System-Counts: Zähler + Kategorien kommen aus den partiellen Indizes');

  // Query-Plan-Regression: Die Systemabfrage darf NUR die schmalen partiellen
  // Indizes nutzen – nie den vollen messages_guild_created_idx (OR-Query oder
  // breiter message_type-IN-Fallback wären ein Query-Plan-Regress).
  const plan = _serverIndexInternals.explainSystemEventsQuery(GUILD, 25);
  const planText = (plan || []).map((row) => String(row?.detail || '')).join('\n');
  assert.ok(/messages_system_partial_idx/.test(planText), 'Query-Plan nutzt nicht den partiellen System-Index');
  assert.ok(/messages_boost_partial_idx/.test(planText), 'Query-Plan nutzt nicht den partiellen Boost-Index');
  assert.ok(!/messages_guild_created_idx/.test(planText), 'Query-Plan scannnt weiterhin den vollen Guild-Index');
  ok('Query-Plan: Systemseite läuft ausschließlich über die partiellen Indizes');

  const boostCounts = await getServerIndexSystemEventCounts({ guildId: GUILD, category: 'boosts' });
  assert.equal(boostCounts.total, 3, 'Kategorie-Filter boosts im Count falsch');
  const boostPage = await getServerIndexSystemEvents({ guildId: GUILD, limit: 100, category: 'boosts' });
  assert.equal(boostPage.length, 3, 'Kategorie-Filter boosts liefert falsche Anzahl');
  assert.ok(boostPage.every((entry) => entry.metadata?.category === 'boosts'), 'Kategorie-Filter enthält Fremd-Kategorien');
  const memberPage = await getServerIndexSystemEvents({ guildId: GUILD, limit: 100, category: 'membership' });
  assert.equal(memberPage.length, 2, 'Kategorie-Filter membership liefert falsche Anzahl');
  const otherPage = await getServerIndexSystemEvents({ guildId: GUILD, limit: 100, category: 'other' });
  assert.ok(otherPage.length >= 1 && otherPage.every((entry) => entry.metadata?.category === 'other'), 'Kategorie-Filter other falsch');
  ok('System-Kategorie-Filter: SQL-Prädikat liefert exakt die gewünschte Kategorie');

  // SQL-Keyset über Systemereignisse: vorherige Seite komplett älter, keine Duplikate
  const allSystem = await getServerIndexSystemEvents({ guildId: GUILD, limit: 100 });
  const pageA = await getServerIndexSystemEvents({ guildId: GUILD, limit: 2 });
  assert.equal(pageA.length, 2, 'System-Keyset-Seite A hat nicht 2 Ereignisse');
  const cursorA = { beforeCreatedAt: pageA[pageA.length - 1].createdAt, beforeMessageId: pageA[pageA.length - 1].messageId };
  const pageB = await getServerIndexSystemEvents({ guildId: GUILD, limit: 2, ...cursorA });
  assert.equal(pageB.length, 2, 'System-Keyset-Seite B hat nicht 2 Ereignisse');
  const overlap = pageA.filter((entry) => pageB.some((other) => other.messageId === entry.messageId));
  assert.equal(overlap.length, 0, 'System-Keyset-Seiten überlappen');
  assert.ok(new Date(pageB[0].createdAt).getTime() <= new Date(pageA[pageA.length - 1].createdAt).getTime(), 'System-Keyset-Seite B ist nicht älter als A');
  const seenIds = new Set([...pageA, ...pageB].map((entry) => entry.messageId));
  for (const entry of allSystem) {
    if (seenIds.has(entry.messageId)) continue;
    assert.ok(allSystem.indexOf(entry) >= 4, 'System-Keyset lässt Ereignisse aus (Reihenfolge nicht absteigend)');
  }
  ok('System-Keyset: Cursor liefert lückenlose, überlappungsfreie Seiten');

  // 7) JSONL-Integritätsprüfung
  const fsp = await import('node:fs/promises');
  const path = await import('node:path');
  const dir = path.join(process.env.FALLEN_HEAVEN_DATA_DIR, 'integrity');
  await fsp.mkdir(dir, { recursive: true });
  const goodFile = path.join(dir, '2026-08-01.jsonl');
  const badFile = path.join(dir, '2026-08-02.jsonl');
  const corruptFile = path.join(dir, '2026-08-03.jsonl');
  await fsp.writeFile(goodFile, [
    JSON.stringify({ v: 1, messageId: '102', guildId: GUILD, text: 'x' }),
    JSON.stringify({ v: 1, messageId: '103', guildId: GUILD, text: 'y' })
  ].join('\n'), 'utf8');
  await fsp.writeFile(badFile, [
    JSON.stringify({ v: 1, messageId: '999999999999999999', guildId: GUILD, text: 'fehlt' }),
    JSON.stringify({ v: 1, messageId: '102', guildId: GUILD, text: 'x' })
  ].join('\n'), 'utf8');
  await fsp.writeFile(corruptFile, [
    JSON.stringify({ v: 1, messageId: '102', guildId: GUILD, text: 'ok' }),
    '{ dies ist keine json zeile',
    JSON.stringify({ v: 1, text: 'ohne id' })
  ].join('\n'), 'utf8');
  const good = await verifyServerIndexJsonlMigrated(goodFile);
  assert.equal(good.checked, 2, 'Integrität: checked falsch');
  assert.equal(good.missing, 0, 'Integrität: vorhandene Datei als fehlend erkannt');
  assert.equal(good.unparsed, 0, 'Integrität: gute Datei als unparsed erkannt');
  const bad = await verifyServerIndexJsonlMigrated(badFile);
  assert.equal(bad.missing, 1, 'Integrität: fehlende Nachricht nicht erkannt');
  const corrupt = await verifyServerIndexJsonlMigrated(corruptFile);
  assert.equal(corrupt.unparsed, 2, 'Integrität: kaputte/ID-lose Zeilen nicht als unparsed gezählt');
  ok('JSONL-Integrität: vorhandene Datei löschbar, fehlende Nachricht UND kaputte Zeilen blockieren');

  console.log(`\nIndex-Optimierungen: ${passed} Checks grün.`);
  if (passed < 12) process.exit(1);
})().catch((error) => {
  console.error('SMOKE FEHLGESCHLAGEN:', error);
  process.exit(1);
});
