#!/usr/bin/env node
/**
 * Smoke-Test: Inaktivitäts-Erinnerung (inactiveReminder).
 *
 * Beweist:
 *   1. Defaults + Normalisierung (thresholdDays, excludedRoleIds, dmDesign).
 *   2. settings() klemmt Werte auf gültige Bereiche.
 *   3. saveInactiveReminderDesign baut ein normales Design mit section 'dm'
 *      (Pipeline-fähig, ohne Guild-Client).
 *   4. Platzhalter werden korrekt ersetzt – {user} wird zu einem ECHTEN
 *      Discord-Mention (`<@id>`), nicht zu Text.
 *   5. findInactiveCandidates: ausgenommene Rollen, Bots, zu junger Beitritt
 *      und zuletzt aktive Mitglieder werden nie angeschrieben; der Server-Index
 *      schützt zusätzlich aktive Autoren.
 *   6. getInactiveReminderSnapshot liefert Stats + Einträge.
 *   7. KEIN Auto-Kick: settings() kennt keine Antwortfrist; offene Erinnerungen
 *      bleiben einfach offen (nur Zählung, nie Kick).
 */
import assert from 'node:assert/strict';

// WICHTIG: MUSS der erste Import sein – lenkt den Datenordner auf einen
// temporären Ordner um, damit dieser Test nie echte Nutzerdaten anfasst.
import './smoke-test-env.mjs';

import { defaultGuildConfig, normalizeConfig } from '../src/defaultConfig.js';
import { _inactiveReminderInternals } from '../src/features/inactiveReminder.js';
import { _localImageStoreInternals } from '../src/runtime/localImageStore.js';

const { settings, saveInactiveReminderDesign, fillPlaceholders, findInactiveCandidates, getInactiveReminderSnapshot, runInactiveReminderScanSafe, runInactiveReminderScan } = _inactiveReminderInternals;

let passed = 0;
const ok = (label) => { passed += 1; console.log(`  ✅ ${label}`); };

// 1) Defaults + Normalisierung
{
  const def = defaultGuildConfig('1').inactiveReminder;
  assert.equal(def.enabled, false);
  assert.equal(def.thresholdDays, 180, 'Standard: ein halbes Jahr');
  assert.equal(def.responseTimeoutHours, undefined, 'KEINE Antwortfrist (kein Auto-Kick)');
  const norm = normalizeConfig({ inactiveReminder: { enabled: true, thresholdDays: 99999, excludedRoleIds: ['111111111111111111'], dmDesign: { embed: { title: 'T' } } } }).inactiveReminder;
  assert.equal(norm.enabled, true);
  assert.equal(norm.thresholdDays, 3650, 'thresholdDays wird auf Maximum geklemmt');
  assert.equal(norm.responseTimeoutHours, undefined, 'Antwortfrist wird verworfen');
  assert.deepEqual(norm.excludedRoleIds, ['111111111111111111']);
  assert.equal(norm.dmDesign.embed.title, 'T', 'dmDesign bleibt erhalten');
  ok('Defaults + Normalisierung (ohne Auto-Kick-Frist)');
}

// 2) settings() klemmt Werte + kennt KEINE Antwortfrist (kein Auto-Kick)
{
  const conf = settings({ inactiveReminder: { thresholdDays: 'abc' } });
  assert.equal(conf.thresholdDays, 180, 'ungültiger Wert fällt auf Standard zurück');
  assert.equal(conf.responseTimeoutHours, undefined, 'settings() enthält keine Antwortfrist');
  ok('settings() klemmt Werte, keine Antwortfrist');
}

// 2b) Das Erinnerungs-Embed ist NIE leer – Default-Design greift
{
  const fresh = normalizeConfig({ guildId: '1', guildName: 'Test' }).inactiveReminder.dmDesign;
  assert.ok(fresh?.embed?.title, 'frische Config hat ein Default-Design mit Titel');
  assert.ok(fresh?.embed?.description, 'Default-Design hat eine Beschreibung');
  assert.ok(String(fresh.embed.description).includes('{user}'), 'Default nutzt {user}-Platzhalter');

  const old = normalizeConfig({ guildId: '1', guildName: 'Test', inactiveReminder: { dmDesign: null } }).inactiveReminder.dmDesign;
  assert.ok(old?.embed?.title, 'alte Config mit dmDesign:null bekommt das Default-Design');

  const fallback = settings({}).dmDesign;
  assert.ok(fallback?.embed?.title, 'settings() ohne Design liefert einen nicht-leeren Fallback');
  assert.ok(String(fallback.embed.description).includes('{thresholdDays}'), 'Fallback-Design nutzt Platzhalter');

  const custom = normalizeConfig({ guildId: '1', guildName: 'Test', inactiveReminder: { dmDesign: { embed: { title: 'Mein Titel', description: 'x', color: '#123456' } } } }).inactiveReminder.dmDesign;
  assert.equal(custom.embed.title, 'Mein Titel', 'eigenes Design bleibt erhalten');
  ok('Erinnerungs-Embed nie leer (Default-Fallback, eigenes Design bleibt)');
}

// 3) saveInactiveReminderDesign (Pipeline-fähig)
{
  const result = await saveInactiveReminderDesign({
    guild: { id: 'g1', name: 'FALLEN HEAVEN' },
    conf: {},
    template: {
      content: 'Hallo {user}',
      embeds: [{ title: 'Bist du noch da?', description: '{guild}', color: '#9a8cff' }]
    }
  });
  assert.equal(result.section, 'dm');
  assert.equal(result.design.content, 'Hallo {user}');
  assert.equal(result.design.embed.title, 'Bist du noch da?');
  assert.equal(result.design.embed.color, '#9a8cff');
  ok('saveInactiveReminderDesign baut Design mit section "dm"');
}

// 3b) Außenbild wird beim Speichern NICHT verworfen (wie Aktivitäts-Liga/Counting/Levels)
{
  const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const uploaded = await _localImageStoreInternals.saveLocalImage({ dataUrl: 'data:image/png;base64,' + tinyPng.toString('base64'), name: 'reminder.png' });
  const localAsset = { localAsset: true, ...uploaded };
  const result = await saveInactiveReminderDesign({
    guild: { id: 'g1', name: 'FALLEN HEAVEN' },
    conf: {},
    template: {
      content: '',
      outsideImageUrl: '',
      outsideImageAttachment: localAsset,
      embeds: [{ title: 'Bist du noch da?', description: 'x', color: '#9a8cff' }]
    }
  });
  // Wie bei allen anderen Modulen: lokales Bild wird in eine anzeigbare URL
  // (Data-URL) gewandelt, damit es nach erneutem Öffnen sichtbar ist.
  assert.ok(/^data:image\/png;base64,/.test(String(result.design.outsideImageUrl || '')), 'localAsset wird zur anzeigbaren Data-URL materialisiert');
  assert.equal(result.design.outsideImageAttachment?.localAsset, true, 'lokale Referenz bleibt für den Versand erhalten');

  const urlResult = await saveInactiveReminderDesign({
    guild: { id: 'g1', name: 'FALLEN HEAVEN' },
    conf: {},
    template: {
      content: '',
      outsideImageUrl: 'https://cdn.example.com/reminder.png',
      embeds: [{ title: 'Bist du noch da?', description: 'x', color: '#9a8cff' }]
    }
  });
  assert.equal(urlResult.design.outsideImageUrl, 'https://cdn.example.com/reminder.png', 'HTTP-Außenbild-URL bleibt erhalten');
  assert.equal(urlResult.design.outsideImageAttachment, null);
  ok('Außenbild (localAsset → Data-URL + HTTP-URL) wird gespeichert – nie verworfen');
}

// 3c) Studio-Reload nach dem Speichern zeigt das gespeicherte Design
// (Wurzel des „Embed nach jedem Speichern leer“-Bugs: result.config ist die
// VOLLE Config – der Renderer muss den Modul-Abschnitt daraus lesen).
{
  const { _embedDesignPipelineInternals } = await import('../src/runtime/embedDesignPipeline.js');
  const fullConfig = { inactiveReminder: { enabled: false, thresholdDays: 180, dmDesign: null }, levels: { enabled: true } };
  const response = await _embedDesignPipelineInternals.persistEmbedDesign({
    guild: { id: 'g1' },
    key: 'inactiveReminder',
    payload: { template: { content: 'Hallo', embeds: [{ title: 'Mein Titel', description: 'Meine Beschreibung', color: '#123456' }] } },
    getConfig: () => fullConfig,
    save: async ({ guild, cfg, payload }) => {
      const result = await saveInactiveReminderDesign({ guild, conf: cfg, template: payload.template || payload });
      return { patch: { inactiveReminder: { ...cfg.inactiveReminder, dmDesign: result.normalizedDesign } }, result: { design: result.normalizedDesign, section: 'dm' } };
    },
    persist: (patch) => { fullConfig.inactiveReminder = patch.inactiveReminder; return fullConfig; }
  });
  assert.ok(Object.prototype.hasOwnProperty.call(response.config, 'levels'), 'result.config ist die volle Config');
  // Renderer-onSaved-Logik: Modul-Abschnitt statt volle Config in den Modul-Slot
  const moduleSection = response.config?.inactiveReminder || response.config;
  assert.equal(moduleSection.dmDesign.embed.title, 'Mein Titel', 'Studio zeigt nach dem Speichern das gespeicherte Design');
  assert.equal(moduleSection.dmDesign.embed.description, 'Meine Beschreibung');
  ok('Studio-Reload nach Save zeigt das gespeicherte Embed (nicht leer)');
}

// 4) Platzhalter → echte Mentions
{
  const member = { id: '987654321', displayName: 'Max Muster', user: { username: 'maxi' } };
  const guild = { name: 'FALLEN HEAVEN' };
  const conf = { thresholdDays: 180 };
  assert.equal(
    fillPlaceholders('Hallo {user}, du warst {thresholdDays} Tage ohne Aktivität – auf {guild} wartet man auf dich.', { guild, member, conf }),
    'Hallo <@987654321>, du warst 180 Tage ohne Aktivität – auf FALLEN HEAVEN wartet man auf dich.',
    '{user} wird zu einem ECHTEN Discord-Mention'
  );
  assert.equal(fillPlaceholders('@{username} ({displayName})', { guild, member, conf }), '@maxi (Max Muster)');
  assert.equal(fillPlaceholders('{server}', { guild, member, conf }), 'FALLEN HEAVEN');
  ok('Platzhalter: {user} → echter Mention, übrige werden ersetzt');
}

// 4b) Aktivitäts-Beweis: {lastMessageAt} / {lastVoiceAt} / {lastActiveAt} werden
//     mit echten deutschen Datumsangaben gefüllt („… um HH:MM Uhr“) oder
//     „unbekannt“, wenn nichts aufgezeichnet wurde.
{
  const { formatActivityDate, fillPlaceholders: fill } = _inactiveReminderInternals;
  assert.equal(
    formatActivityDate(new Date('2026-03-12T13:30:00Z').getTime()),
    '12.03.2026 um 14:30 Uhr',
    'deutsches Datum mit Uhrzeit (lokale Zeitzone)'
  );
  assert.equal(formatActivityDate(0), 'unbekannt', 'ohne Aufzeichnung → „unbekannt“');
  assert.equal(formatActivityDate(null), 'unbekannt');

  const member = { id: '987654321', displayName: 'Max Muster', user: { username: 'maxi' } };
  const guild = { name: 'FALLEN HEAVEN' };
  const conf = { thresholdDays: 180 };
  const activity = {
    lastMessageMs: new Date('2026-03-12T13:30:00Z').getTime(),
    lastVoiceMs: new Date('2026-02-01T19:00:00Z').getTime(),
    lastActiveMs: new Date('2026-03-12T13:30:00Z').getTime()
  };
  const text = fill('📩 Letzte Nachricht: {lastMessageAt}\n🎙️ Letzter Call: {lastVoiceAt}\nZuletzt aktiv: {lastActiveAt}', { guild, member, conf, activity });
  assert.ok(text.includes('12.03.2026 um 14:30 Uhr'), '{lastMessageAt} wird gefüllt');
  assert.ok(text.includes('01.02.2026 um 20:00 Uhr'), '{lastVoiceAt} wird gefüllt');
  assert.ok(text.includes('Zuletzt aktiv: 12.03.2026'), '{lastActiveAt} wird gefüllt');
  const missing = fill('Voice: {lastVoiceAt}', { guild, member, conf, activity: {} });
  assert.equal(missing, 'Voice: unbekannt', 'fehlende Aktivität → unbekannt');
  ok('Aktivitäts-Beweis: {lastMessageAt}/{lastVoiceAt}/{lastActiveAt} mit echten Daten');
}

// 4c) Default-/Migrationstext: Das gespeicherte Design enthält den Aktivitäts-
//     Beweis (Migration ersetzt alte Beschreibungen), und neue Designs sind
//     nicht doppelt formuliert.
{
  const migrated = normalizeConfig({
    guildId: '1',
    guildName: 'T',
    inactiveReminder: { dmDesign: { embed: { title: 'Mein Titel', description: 'alter Text ohne Beweis', color: '#123456' } } }
  }).inactiveReminder.dmDesign;
  assert.equal(migrated.embed.title, 'Mein Titel', 'Titel bleibt bei Migration erhalten');
  assert.ok(migrated.embed.description.includes('{lastMessageAt}'), 'alte Beschreibung wird durch Beweis-Text ersetzt');
  assert.ok(migrated.embed.description.includes('{lastVoiceAt}'));
  const fresh = normalizeConfig({ guildId: '1', guildName: 'T' }).inactiveReminder.dmDesign;
  assert.ok(fresh.embed.description.includes('{lastMessageAt}'), 'Default-Design enthält Beweis-Platzhalter');
  ok('Design-Migration: Beweis-Platzhalter in alten und neuen Designs');
}

// 5) Kandidaten-Findung
{
  const now = Date.now();
  const cutoff = now - 180 * 24 * 60 * 60 * 1000;
  const mkMember = (id, joinedAt, roleIds = [], bot = false) => ({
    id: String(id),
    user: { id: String(id), username: 'u' + id, bot },
    joinedAt: new Date(joinedAt),
    roles: { cache: { some: (cb) => roleIds.some((roleId) => cb({ id: String(roleId) })) } }
  });
  const conf = { thresholdDays: 180, excludedRoleIds: ['team'] };
  const activitySnapshot = {
    // aktiv vor langer Zeit → gilt als inaktiv
    '1000': 1000000,
    // aktiv innerhalb der Schwelle → aktiv
    '2000': now - 10 * 24 * 60 * 60 * 1000
  };
  const indexActive = new Set(['3000']);
  const guild = {
    id: 'g1',
    members: { cache: new Map() }
  };
  const members = [
    mkMember('1000', cutoff - 1000),            // alt + inaktiv → Kandidat
    mkMember('2000', cutoff - 1000),            // alt, aber aktiv → kein Kandidat
    mkMember('3000', cutoff - 1000),            // alt, Index aktiv → kein Kandidat
    mkMember('4000', cutoff - 1000, ['team']),  // ausgenommene Rolle → kein Kandidat
    mkMember('5000', now - 1000),               // zu neuer Beitritt → kein Kandidat
    mkMember('6000', cutoff - 1000, [], true)   // Bot → kein Kandidat
  ];
  members.forEach((member) => guild.members.cache.set(member.id, member));
  const candidates = await findInactiveCandidates({ guild, conf, activitySnapshot, indexActive });
  assert.deepEqual(candidates.map((c) => c.id), ['1000'], 'Genau das inaktive, nicht ausgenommene Mitglied wird Kandidat');
  ok('findInactiveCandidates: Rolle/Bot/Aktivität/Beitrittsalter werden beachtet');
}

// 6) Snapshot liefert Stats + Einträge
{
  const snapshot = getInactiveReminderSnapshot('g-none', { inactiveReminder: { enabled: true, thresholdDays: 180, excludedRoleIds: [] } });
  assert.equal(snapshot.enabled, true);
  assert.equal(snapshot.thresholdDays, 180);
  assert.equal(snapshot.responseTimeoutHours, undefined, 'Snapshot enthält keine Antwortfrist');
  assert.equal(typeof snapshot.stats, 'object', 'Stats-Objekt vorhanden');
  assert.ok(Array.isArray(snapshot.entries), 'Einträge sind eine Liste');
  ok('getInactiveReminderSnapshot liefert Stats + Einträge');
}

// 8) DOKUMENTIERTER BUG-FIX: „DM embed 2 mal jedem“.
//    Überlappende Scans (startup + config + manual + timer) haben alle
//    dieselben Kandidaten gelesen und jeder hat DMs an alle gesendet. Zwei
//    gleichzeitige Scans dürfen jetzt maximal EIN DM pro Mitglied senden:
//    Single-Flight (koaleszierend) + DB-Reservierung VOR dem Senden.
{
  const now = Date.now();
  const cutoff = now - 180 * 24 * 60 * 60 * 1000;
  const sends = new Map(); // userId -> Anzahl gesendeter DMs
  const mkMember = (id) => ({
    id: String(id),
    displayName: 'Mitglied ' + id,
    user: { id: String(id), username: 'user' + id, bot: false },
    joinedAt: new Date(cutoff - 1000),
    roles: { cache: { some: () => false } },
    send: async () => { sends.set(String(id), (sends.get(String(id)) || 0) + 1); return {}; }
  });
  const members = [mkMember('7000'), mkMember('7001'), mkMember('7002')];
  const guild = { id: 'g-race', name: 'Race-Test', members: { cache: new Map(members.map((m) => [m.id, m])) } };
  const conf = normalizeConfig({
    guildId: 'g-race',
    guildName: 'Race-Test',
    inactiveReminder: { enabled: true, thresholdDays: 180, dmDesign: null }
  });

  // Beide Quellen gleichzeitig starten – genau die Race-Situation von vorhin.
  // Der zweite Aufruf koalesziert in denselben Lauf (Single-Flight) und der
  // vorgemerkte Folge-Scan läuft danach mit frischem Stand – sendet 0.
  const [a, b] = await Promise.all([
    runInactiveReminderScanSafe({ guild, conf, source: 'startup' }),
    runInactiveReminderScanSafe({ guild, conf, source: 'config' })
  ]);
  assert.equal(a.sent, 3, 'erster Scan sendet an alle 3 Kandidaten');
  assert.equal(b, a, 'zweiter Aufruf koalesziert in denselben Single-Flight-Lauf');
  assert.deepEqual([...sends.values()], [1, 1, 1], 'jedes Mitglied genau EIN DM');
  assert.equal(sends.size, 3, 'kein Mitglied wurde doppelt angeschrieben');
  ok('Doppel-Send-Schutz: 2 gleichzeitige Scans → genau 1 DM pro Mitglied');

  // Crash-Lücke: Scan erneut ausführen – Reservierung verhindert Wiederholung.
  const third = await runInactiveReminderScan({ guild, conf, source: 'manual' });
  assert.equal(third.sent, 0, 'Wiederholung nach abgeschlossenem Scan sendet nicht erneut');
  assert.deepEqual([...sends.values()], [1, 1, 1], 'weiterhin genau 1 DM pro Mitglied');
  ok('Wiederholungs-Schutz: kein zweites DM nach abgeschlossenem Scan');
}

// 9) DM-Löschung (gezielt + alle) – „alle DMs löschen / gezielt eine DM löschen“
{
  const cutoff = Date.now() - 180 * 24 * 60 * 60 * 1000;
  const mkMember = (id) => ({
    id: String(id),
    displayName: 'U' + id,
    user: { id: String(id), username: 'u' + id, bot: false },
    joinedAt: new Date(cutoff - 1000),
    roles: { cache: { some: () => false } },
    send: async () => ({ id: 'msg-' + id, channelId: 'dm-' + id })
  });
  const members = [mkMember('8000'), mkMember('8001')];
  const guild = { id: 'g-dm', name: 'DM-Test', members: { cache: new Map(members.map((m) => [m.id, m])) } };
  const conf = normalizeConfig({ guildId: 'g-dm', guildName: 'DM-Test', inactiveReminder: { enabled: true, thresholdDays: 180, dmDesign: null } });
  await runInactiveReminderScan({ guild, conf, source: 'manual' });

  const { getInactiveReminder } = await import('../src/runtime/inactiveReminderStore.js');
  const rec = getInactiveReminder('g-dm', '8000');
  assert.equal(rec.dmMessageId, 'msg-8000', 'DM-Referenz (Message-ID) wird gespeichert');
  assert.equal(rec.dmChannelId, 'dm-8000', 'DM-Referenz (Kanal-ID) wird gespeichert');

  const { deleteReminderDm, deleteAllReminderDms } = _inactiveReminderInternals;
  const client = {
    channels: {
      cache: new Map([
        ['dm-8000', { messages: { cache: new Map([['msg-8000', { delete: async () => {} }]]), fetch: async () => null } }],
        ['dm-8001', { messages: { cache: new Map([['msg-8001', { delete: async () => {} }]]), fetch: async () => null } }]
      ])
    }
  };
  const r1 = await deleteReminderDm({ guild, userId: '8000', client });
  assert.equal(r1.ok, true, 'gezieltes Löschen erfolgreich');
  const rec2 = getInactiveReminder('g-dm', '8000');
  assert.equal(rec2.status, 'dm-deleted', 'Eintrag als gelöscht markiert');
  assert.equal(rec2.dmMessageId, null, 'DM-Referenz aufgeräumt');
  const r2 = await deleteAllReminderDms({ guild, client });
  assert.equal(r2.deleted, 1, '„Alle löschen“ entfernt die verbleibende DM');
  assert.equal(getInactiveReminder('g-dm', '8001').status, 'dm-deleted');
  ok('DM-Löschung: gezielt + alle, Empfänger wird nie erneut angeschrieben');
}

// 9b) VORSCHAU (dryRun): Derselbe Scan wie „Jetzt scannen“, aber OHNE
//     DM-Versand und OHNE Datenbank-Änderung – nur die Kandidaten-Liste.
{
  const now = Date.now();
  const cutoff = now - 180 * 24 * 60 * 60 * 1000;
  const sends = new Map();
  const mkMember = (id) => ({
    id: String(id),
    displayName: 'Mitglied ' + id,
    user: { id: String(id), username: 'user' + id, bot: false },
    joinedAt: new Date(cutoff - 1000),
    roles: { cache: { some: () => false } },
    send: async () => { sends.set(String(id), (sends.get(String(id)) || 0) + 1); return { id: 'msg-' + id, channelId: 'dm-' + id }; }
  });
  const members = [mkMember('9100'), mkMember('9101')];
  const guild = { id: 'g-preview', name: 'Preview-Test', members: { cache: new Map(members.map((m) => [m.id, m])) } };
  const conf = normalizeConfig({ guildId: 'g-preview', guildName: 'Preview-Test', inactiveReminder: { enabled: true, thresholdDays: 180, dmDesign: null } });

  const preview = await runInactiveReminderScan({ guild, conf, source: 'preview', dryRun: true });
  assert.equal(preview.preview, true, 'Vorschau-Modus erkannt');
  assert.equal(preview.sent, 0, 'Vorschau sendet KEINE DMs');
  assert.equal(preview.candidates, 2, 'Kandidaten werden ermittelt');
  assert.ok(Array.isArray(preview.candidatesList) && preview.candidatesList.length === 2, 'Kandidaten-Liste vorhanden');
  assert.equal(preview.candidatesList[0].userId, '9100', 'Liste enthält die Nutzer-IDs');
  assert.equal(sends.size, 0, 'kein einziger DM-Versuch');

  const { getInactiveReminder } = await import('../src/runtime/inactiveReminderStore.js');
  assert.equal(getInactiveReminder('g-preview', '9100'), null, 'Vorschau schreibt NICHTS in die Datenbank');

  // Danach echter Scan: dieselben 2 Kandidaten bekommen genau 1 DM.
  const real = await runInactiveReminderScan({ guild, conf, source: 'manual' });
  assert.equal(real.sent, 2, 'echter Scan sendet nach der Vorschau normal');
  assert.deepEqual([...sends.values()], [1, 1], 'jeweils genau 1 DM');
  ok('Vorschau (dryRun): Kandidaten ohne DM-Versand und ohne DB-Änderung');
}

// 9c) „Senden an ausgewählte“: Der Scan zeigt erst alle Kandidaten, DMs
//     gehen NUR an die manuell markierten Mitglieder. Nicht gewählte werden
//     übersprungen, bereits angeschriebene nie doppelt.
{
  const now = Date.now();
  const cutoff = now - 180 * 24 * 60 * 60 * 1000;
  const sends = new Map();
  const mkMember = (id) => ({
    id: String(id),
    displayName: 'Mitglied ' + id,
    user: { id: String(id), username: 'user' + id, bot: false },
    joinedAt: new Date(cutoff - 1000),
    roles: { cache: { some: () => false } },
    send: async () => { sends.set(String(id), (sends.get(String(id)) || 0) + 1); return { id: 'msg-' + id, channelId: 'dm-' + id }; }
  });
  const members = [mkMember('9200'), mkMember('9201'), mkMember('9202')];
  const guild = { id: 'g-select', name: 'Select-Test', members: { cache: new Map(members.map((m) => [m.id, m])) } };
  const conf = normalizeConfig({ guildId: 'g-select', guildName: 'Select-Test', inactiveReminder: { enabled: true, thresholdDays: 180, dmDesign: null } });

  // 1) Erst Vorschau – alle Kandidaten, noch kein DM.
  const preview = await runInactiveReminderScan({ guild, conf, source: 'preview', dryRun: true });
  assert.equal(preview.candidates, 3, 'Vorschau zeigt ALLE Kandidaten');
  assert.equal(sends.size, 0, 'Vorschau sendet nichts');

  // 2) Nur 9200 + 9202 auswählen → nur diese beiden bekommen ein DM.
  const send = await runInactiveReminderScan({ guild, conf, source: 'manual-selected', userIds: ['9200', '9202'] });
  assert.equal(send.sent, 2, 'genau die ausgewählten 2 erhalten ein DM');
  assert.equal(send.skipped, 1, 'nicht ausgewähltes Mitglied (9201) wird übersprungen');
  assert.deepEqual([...sends.keys()].sort(), ['9200', '9202'], 'nur ausgewählte IDs wurden angeschrieben');

  // 3) Wiederholung mit derselben Auswahl → 0 neue DMs (Reservierung greift).
  const repeat = await runInactiveReminderScan({ guild, conf, source: 'manual-selected', userIds: ['9200', '9202'] });
  assert.equal(repeat.sent, 0, 'bereits angeschriebene werden nie doppelt gesendet');
  assert.deepEqual([...sends.values()], [1, 1], 'weiterhin genau 1 DM pro Mitglied');
  ok('„Senden an ausgewählte“: nur markierte Mitglieder, Übersprungene bleiben, keine Doppel-DMs');
}

// 9d) Bereits erfolgreich angeschriebene Mitglieder bekommen nie wieder eine
//     zweite oder erneuerte Erinnerungs-DM, auch nicht nach alter Legacy-Frist.
{
  const now = Date.now();
  const cutoff = now - 180 * 24 * 60 * 60 * 1000;
  let sends = 0;
  let edits = 0;
  const editedMessage = {
    id: 'msg-edit-1',
    attachments: new Map(),
    edit: async () => { edits += 1; }
  };
  const dmChannel = {
    messages: {
      cache: new Map([['msg-edit-1', editedMessage]]),
      fetch: async () => editedMessage
    }
  };
  const member = {
    id: 'edit-1',
    displayName: 'Edit-Test',
    user: { id: 'edit-1', username: 'edituser', bot: false },
    joinedAt: new Date(cutoff - 1000),
    roles: { cache: { some: () => false } },
    send: async () => { sends += 1; return { id: 'NEU', channelId: 'dm-neu' }; }
  };
  const guild = {
    id: 'g-edit',
    name: 'Edit-Test',
    client: { channels: { cache: new Map([['dm-edit-1', dmChannel]]) } },
    members: { cache: new Map([['edit-1', member]]) }
  };
  const conf = normalizeConfig({ guildId: 'g-edit', guildName: 'Edit-Test', inactiveReminder: { enabled: true, thresholdDays: 180, dmDesign: null } });

  const { upsertInactiveReminder } = await import('../src/runtime/inactiveReminderStore.js');
  // Alter Legacy-Eintrag: „geblieben“, frühere Frist abgelaufen.
  upsertInactiveReminder({
    guildId: 'g-edit',
    userId: 'edit-1',
    username: 'Edit-Test',
    status: 'stayed',
    response: 'stay',
    dmChannelId: 'dm-edit-1',
    dmMessageId: 'msg-edit-1',
    respondedAt: new Date(now - 200 * 24 * 60 * 60 * 1000).toISOString(),
    nextReminderAt: new Date(now - 1).toISOString()
  });

  const result = await runInactiveReminderScan({ guild, conf, source: 'manual' });
  assert.equal(result.sent, 0, 'keine Folge-Erinnerung wird versendet');
  assert.equal(result.candidates, 0, 'bereits angeschriebenes Mitglied ist kein Kandidat');
  assert.equal(sends, 0, 'keine neue DM gesendet');
  assert.equal(edits, 0, 'bestehende DM wird nicht als Folge-Erinnerung editiert');
  const { getInactiveReminder } = await import('../src/runtime/inactiveReminderStore.js');
  const rec = getInactiveReminder('g-edit', 'edit-1');
  assert.equal(rec.dmMessageId, 'msg-edit-1', 'DM-Referenz bleibt erhalten');
  assert.equal(rec.status, 'stayed', 'Status bleibt unverändert');
  ok('Bereits versendete Erinnerung wird niemals wiederholt');
}

// 9e) DM-Buttons geben FEEDBACK: In der DM gibt es kein interaction.guildId –
//     der Handler muss die Server-ID aus dem customId lesen, sofort antworten
//     (ephemer) und die Buttons aus der Nachricht entfernen. Vor dem Fix wurden
//     DM-Klicks nie verarbeitet („Knöpfe funktionieren nicht / kein Feedback“).
{
  const now = Date.now();
  const cutoff = now - 180 * 24 * 60 * 60 * 1000;
  const member = {
    id: 'dm-click-1',
    displayName: 'DM-Klick',
    user: { id: 'dm-click-1', username: 'dmclick', bot: false },
    joinedAt: new Date(cutoff - 1000),
    roles: { cache: { some: () => false } },
    send: async () => ({ id: 'msg-1', channelId: 'dm-1' })
  };
  const guild = { id: 'g-dm-click', name: 'DM-Click', members: { cache: new Map([['dm-click-1', member]]) } };
  const conf = normalizeConfig({ guildId: 'g-dm-click', guildName: 'DM-Click', inactiveReminder: { enabled: true, thresholdDays: 180, dmDesign: null } });
  await runInactiveReminderScan({ guild, conf, source: 'manual' });

  let replied = null;
  let edited = 0;
  const interaction = {
    customId: 'fh-inactive:stay:g-dm-click:dm-click-1',
    // DM: kein guildId, kein guild – nur der Bot-Client.
    guildId: null,
    guild: null,
    client: { guilds: { cache: new Map([['g-dm-click', guild]]) } },
    reply: async (payload) => { replied = payload; },
    message: { edit: async () => { edited += 1; } }
  };
  const { handleInactiveReminderInteraction } = _inactiveReminderInternals;
  const handled = await handleInactiveReminderInteraction({ interaction, cfg: conf });
  assert.equal(handled, true, 'DM-Button wird verarbeitet');
  assert.ok(replied && String(replied.content).includes('Danke'), 'Mitglied erhält sofortiges Feedback');
  assert.equal(replied.flags, 64, 'Feedback ist ephemer (nur für das Mitglied sichtbar)');
  assert.equal(edited, 1, 'Buttons werden aus der DM entfernt');
  const { getInactiveReminder } = await import('../src/runtime/inactiveReminderStore.js');
  assert.equal(getInactiveReminder('g-dm-click', 'dm-click-1').status, 'stayed', 'Antwort wird gespeichert');
  ok('DM-Buttons: sofortiges Feedback + Buttons entfernt + Status gespeichert');
}

// 9f) ABLAUF VOR DEM SENDEN: Es wird NUR gesendet, wenn CHAT-Aktivität UND
//     CALL-Aktivität BEIDE über der Grenze liegen (älter als die Schwelle).
//     Wer in EINER Dimension unter der Grenze liegt (kürzlich geschrieben ODER
//     kürzlich im Call), bekommt KEIN Embed.
{
  const { importVoiceSession } = await import('../src/features/memberManagement.js');
  const { runInactiveReminderScan: scan } = _inactiveReminderInternals;
  const now = Date.now();
  const cutoff = now - 180 * 24 * 60 * 60 * 1000;
  const mkMember = (id) => ({
    id: String(id),
    displayName: 'M' + id,
    user: { id: String(id), username: 'u' + id, bot: false },
    joinedAt: new Date(cutoff - 1000),
    roles: { cache: { some: () => false } }
  });

  // A) Aktuell im Call (offene Session) → KEIN Kandidat
  const guildA = { id: 'g-flow-a', name: 'Flow-A', members: { cache: new Map() } };
  const mA = mkMember('f-a-1');
  guildA.members.cache.set(mA.id, mA);
  await importVoiceSession.open('g-flow-a', 'f-a-1', 'vc-1', new Date(now - 5 * 60 * 1000));
  const previewA = await scan({ guild: guildA, conf: normalizeConfig({ guildId: 'g-flow-a', guildName: 'Flow-A', inactiveReminder: { enabled: true, thresholdDays: 180, dmDesign: null } }), source: 'preview', dryRun: true });
  assert.equal(previewA.candidates, 0, 'aktuell im Call → kein Embed');

  // B) Letzter Call VOR 30 Tagen (innerhalb 180d), keine Nachrichten → KEIN Kandidat
  const guildB = { id: 'g-flow-b', name: 'Flow-B', members: { cache: new Map() } };
  const mB = mkMember('f-b-1');
  guildB.members.cache.set(mB.id, mB);
  await importVoiceSession.open('g-flow-b', 'f-b-1', 'vc-1', new Date(now - 30 * 24 * 60 * 60 * 1000));
  await importVoiceSession.close('g-flow-b', 'f-b-1', 'left', new Date(now - 30 * 24 * 60 * 60 * 1000 + 60_000));
  const previewB = await scan({ guild: guildB, conf: normalizeConfig({ guildId: 'g-flow-b', guildName: 'Flow-B', inactiveReminder: { enabled: true, thresholdDays: 180, dmDesign: null } }), source: 'preview', dryRun: true });
  assert.equal(previewB.candidates, 0, 'Call vor 30 Tagen (unter 180d-Grenze) → kein Embed');

  // C) Keine Chat- UND keine Call-Aktivität → Kandidat (Embed ja)
  const guildC = { id: 'g-flow-c', name: 'Flow-C', members: { cache: new Map() } };
  const mC = mkMember('f-c-1');
  guildC.members.cache.set(mC.id, mC);
  const previewC = await scan({ guild: guildC, conf: normalizeConfig({ guildId: 'g-flow-c', guildName: 'Flow-C', inactiveReminder: { enabled: true, thresholdDays: 180, dmDesign: null } }), source: 'preview', dryRun: true });
  assert.equal(previewC.candidates, 1, 'keine Aktivität → Kandidat (beide Dimensionen über der Grenze)');
  assert.equal(previewC.voiceChatExcluded, 0, 'nichts fälschlich ausgeschlossen');
  ok('Ablauf vor dem Senden: Chat UND Call müssen BEIDE über der Grenze liegen – sonst kein Embed');
}

// 10) Voice-Aktivität aus dem Carl-bot-Kanal: Reine Call-Nutzer („nur im
//     Call, schreibt nie“) sind aktiv, solange ihre Voice-Session offen ist.
//     lastVoiceAt wird beim BETRETEN gesetzt (nicht erst beim Verlassen), und
//     eine offene Session zählt im Aktivitäts-Snapshot als „jetzt aktiv“.
{
  const { getMemberActivitySnapshot, importVoiceSession } = await import('../src/features/memberManagement.js');
  const guildId = 'g-voice-active';
  await importVoiceSession.open(guildId, '9000', 'vc-1', new Date(Date.now() - 5 * 60 * 1000));
  const snap = getMemberActivitySnapshot(guildId);
  const activeMs = Number(snap['9000'] || 0);
  assert.ok(activeMs >= Date.now() - 60_000, 'offene Voice-Session zählt als aktuell aktiv (Date.now())');
  assert.ok(activeMs >= Date.now() - 10 * 60 * 1000, 'lastVoiceAt wurde beim Betreten der Session gesetzt');
  ok('Offene Voice-Session = aktiv (reine Call-Nutzer gelten nicht als inaktiv)');
}

// 11) Carl-bot-Backfill vor dem Erinnerungs-Scan: runVoiceLogBackfill liefert
//     bei einem bereits laufenden Backfill dieselbe Promise (await statt
//     „already-running“) – die Erinnerung kann ihren Scan erst starten, wenn
//     die Voice-Daten wirklich verbucht sind (keine Race-DMs).
{
  const { runVoiceLogBackfill } = await import('../src/features/voiceLogImport.js');
  let resolveFetch = null;
  const channel = {
    isTextBased: () => true,
    messages: { fetch: () => new Promise((resolve) => { resolveFetch = resolve; }) }
  };
  const guild = { id: 'g-voice-backfill', channels: { cache: new Map([['c1', channel]]) } };
  const conf = normalizeConfig({ guildId: 'g-voice-backfill', voiceLogImport: { enabled: true, channelId: 'c1', backfillHours: 48, batchSize: 20, maxPages: 1 } });
  const first = runVoiceLogBackfill({ guild, cfg: conf, source: 'test-a' });
  const second = runVoiceLogBackfill({ guild, cfg: conf, source: 'test-b' });
  // Der zweite Aufruf darf NICHT sofort „already-running“ liefern, sondern muss
  // auf den laufenden Backfill warten (kein Race für den Erinnerungs-Scan).
  resolveFetch(new Map());
  const [resultA, resultB] = await Promise.all([first, second]);
  assert.equal(resultA, resultB, 'beide Aufrufe erhalten DASSELBE Backfill-Ergebnis (Single-Flight + await)');
  assert.equal(resultA.status, 'ok', 'Backfill läuft durch und liefert ein Ergebnis');
  assert.equal(resultA.fetched, 0, 'leerer Kanal → 0 Nachrichten');
  ok('Backfill-Single-Flight wird awaitet (kein Race für den Erinnerungs-Scan)');
}

// 12) Voice-Beweis aus dem INDEX (persistente Carl-bot-Tabelle), nicht aus
//     dem Live-Zustand „aktuell im Call“: Ein Mitglied, das laut Index vor
//     30 Tagen im Call war (keine offene Session), gilt als aktiv und wird
//     von der Erinnerung ausgeschlossen – auch „nach Neustart“ (gleiche DB,
//     neues Lesen), genau wie der gemeldete t3trit-Fall.
{
  const { setUserLastVoiceAt, getLastVoiceAtMap, getAllLastVoiceAt } = await import('../src/runtime/voiceLogStateStore.js');
  const guildId = 'g-index-voice-proof';
  const userId = '510441049718521870';
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  setUserLastVoiceAt({ guildId, userId, eventAt: thirtyDaysAgo });
  // „Neustart“: frisch aus der DB lesen (persistiert, nicht im Gedächtnis).
  const map = getLastVoiceAtMap(guildId, [userId]);
  const all = getAllLastVoiceAt(guildId);
  assert.equal(String(Object.keys(map)[0]), userId, 'letzter Call kommt aus der index-abgeleiteten Tabelle');
  assert.equal(map[userId], thirtyDaysAgo.getTime(), 'Zeitpunkt exakt erhalten (30 Tage zurück)');
  assert.equal(all[userId], thirtyDaysAgo.getTime(), 'Komplett-Stand liefert denselben Wert');
  const proof = await (async () => {
    const { _inactiveReminderInternals } = await import('../src/features/inactiveReminder.js');
    return _inactiveReminderInternals.buildActivityProof({
      activityDetail: {}, // KEIN Live-Zustand
      lastMessageMap: {},
      lastVoiceMap: map,
      userId
    });
  })();
  assert.ok(proof.lastVoiceMs > 0, 'Proof.lastVoiceMs kommt aus dem Index (nicht aus Live-Sessions)');
  assert.equal(proof.lastVoiceMs, thirtyDaysAgo.getTime());
  ok('Voice-Beweis aus dem Index: letzter Call vor 30 Tagen schützt vor der DM (kein Live-Zustand nötig)');
}

// 9g) „Ja, zum Server“ gibt FEEDBACK + markiert als aktiv: Der Button ist ein
//     Interaktions-Button (Discord meldet KEINE Klicks auf reine Link-Buttons),
//     die Antwort enthält die Einladung als Link-Button. Der Empfänger wird
//     sofort als „stayed“ markiert → nie wieder angeschrieben.
{
  const { buildReminderActionRow, settings, handleInactiveReminderInteraction } = _inactiveReminderInternals;
  const row = buildReminderActionRow('g-invite', 'u-invite', 'https://discord.gg/fallen-heaven').toJSON();
  const buttons = row.components || [];
  assert.equal(buttons.length, 2, 'zwei Buttons in der DM');
  const yes = buttons[0];
  const no = buttons[1];
  assert.equal(yes.label, 'Ja, zum Server', 'grüner Button heißt „Ja, zum Server“');
  assert.equal(yes.style, 3, 'grüner Button ist ein Interaktions-Button (Success)');
  assert.equal(yes.custom_id, 'fh-inactive:join:g-invite:u-invite', 'Button hat ein customId für sofortiges Feedback');
  assert.equal(no.label, 'Nein, bitte entfernen', 'roter Button unverändert');
  assert.equal(no.style, 4, 'roter Button bleibt Danger');
  assert.equal(no.custom_id, 'fh-inactive:leave:g-invite:u-invite', 'Kick-Button behält sein customId');

  // Standard-Einladung aus der Config wird übernommen.
  const conf = normalizeConfig({ guildId: 'g-invite', guildName: 'Invite', inactiveReminder: { enabled: true, thresholdDays: 180 } });
  const s = settings(conf);
  assert.equal(s.inviteUrl, 'https://discord.gg/fallen-heaven', 'Standard-Einladung aus der Config');

  // Klick auf „Ja, zum Server“ → sofortiges Feedback mit Einladungs-Link-Button
  // + Status „stayed“ + Buttons aus der DM entfernt.
  const member = {
    id: 'u-invite',
    displayName: 'Invite-Test',
    user: { id: 'u-invite', username: 'invitetest', bot: false },
    joinedAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000),
    roles: { cache: { some: () => false } },
    send: async () => ({ id: 'msg-i', channelId: 'dm-i' })
  };
  const guild = { id: 'g-invite', name: 'Invite', members: { cache: new Map([['u-invite', member]]) } };
  await runInactiveReminderScan({ guild, conf, source: 'manual' });

  let replied = null;
  let edited = 0;
  let editPayload = null;
  const interaction = {
    customId: 'fh-inactive:join:g-invite:u-invite',
    guildId: null,
    guild: null,
    client: { guilds: { cache: new Map([['g-invite', guild]]) } },
    reply: async (payload) => { replied = payload; },
    message: {
      // Nachricht hat ein Embed (wie eine echte DM) – nach dem Klick muss das
      // Embed den Entscheidungs-Status zeigen und die Buttons müssen weg sein.
      embeds: [{ title: '🕊️ Wir vermissen dich!', description: '✅ Ja, ich bleibe … ❌ Nein, bitte entfernen …' }],
      edit: async (payload) => { edited += 1; editPayload = payload; }
    }
  };
  const handled = await handleInactiveReminderInteraction({ interaction, cfg: conf });
  assert.equal(handled, true, '„Ja, zum Server“ wird verarbeitet');
  assert.ok(replied && String(replied.content).includes('aktiv'), 'Feedback: „als aktiv markiert“');
  assert.ok(replied && String(replied.content).includes('Einladung'), 'Feedback enthält den Einladungshinweis');
  assert.equal(replied.flags, 64, 'Feedback ist ephemer');
  const replyButtons = (replied.components || [])[0]?.components || [];
  assert.equal(replyButtons.length, 1, 'Antwort enthält genau einen Link-Button');
  assert.equal(replyButtons[0].data.style, 5, 'Einladung ist ein Link-Button in der Antwort');
  assert.equal(replyButtons[0].data.url, 'https://discord.gg/fallen-heaven', 'Einladungs-URL stimmt');
  assert.equal(edited, 1, 'Buttons werden aus der DM entfernt');
  assert.ok(editPayload && Array.isArray(editPayload.components) && editPayload.components.length === 0, 'keine Buttons mehr in der Nachricht');
  assert.ok(Array.isArray(editPayload.embeds) && editPayload.embeds.length === 1, 'Haupt-Embed bleibt stehen');
  const updatedEmbed = editPayload.embeds[0];
  assert.ok(String(updatedEmbed.title || '').includes('Du bleibst'), 'Titel zeigt „Du bleibst bei uns!“');
  assert.ok(String(updatedEmbed.description || '').includes('aktiv markiert'), 'Inhalt zeigt die Entscheidung');
  assert.ok(!String(updatedEmbed.description || '').includes('Nein, bitte entfernen'), 'Optionstexte bleiben nicht stehen');
  assert.ok(Array.isArray(updatedEmbed.fields) && updatedEmbed.fields.length === 0, 'Beweis-Felder werden entfernt');
  const { getInactiveReminder } = await import('../src/runtime/inactiveReminderStore.js');
  const stored = getInactiveReminder('g-invite', 'u-invite');
  assert.equal(stored.status, 'stayed', 'als aktiv markiert → nie wieder angeschrieben');
  assert.equal(stored.nextReminderAt, null, 'keine Folge-Erinnerung geplant');
  ok('„Ja, zum Server“: sofortiges Feedback + Einladungs-Link + als aktiv markiert');

  // Safety net: Wer nach einer Erinnerung über die Einladung zurückkehrt
  // (onGuildMemberAdd) und noch auf „sent“ steht, wird automatisch aktiviert.
  {
    const store = await import('../src/runtime/inactiveReminderStore.js');
    store.upsertInactiveReminder({ guildId: 'g-join-safety', userId: 'join-back-1', status: 'sent', dmSentAt: new Date().toISOString(), dmMessageId: 'm-1' });
    const { feature } = await import('../src/features/inactiveReminder.js');
    await feature.onGuildMemberAdd({
      member: { id: 'join-back-1', guild: { id: 'g-join-safety' }, user: { username: 'joinback' } },
      cfg: conf
    });
    assert.equal(store.getInactiveReminder('g-join-safety', 'join-back-1').status, 'stayed', 'Rückkehrer wird automatisch als aktiv markiert');
    ok('Rückkehr über die Einladung (Member-Join) markiert automatisch als aktiv');
  }
}

// 9h) Bereinigung beantworteter DMs: Aus DMs mit bereits getroffener
//     Entscheidung (stayed/left) werden Embed + Buttons entfernt – nur der
//     Bestätigungstext bleibt. Läuft beim Start + manuell über das Modul.
{
  const { cleanupRespondedReminderDms } = _inactiveReminderInternals;
  const store = await import('../src/runtime/inactiveReminderStore.js');
  store.upsertInactiveReminder({ guildId: 'g-clean', userId: 'clean-1', username: 'cleanone', status: 'stayed', dmSentAt: new Date().toISOString(), dmChannelId: 'ch-1', dmMessageId: 'm-1' });
  store.upsertInactiveReminder({ guildId: 'g-clean', userId: 'clean-2', username: 'cleantwo', status: 'left', dmSentAt: new Date().toISOString(), dmChannelId: 'ch-1', dmMessageId: 'm-2' });
  store.upsertInactiveReminder({ guildId: 'g-clean', userId: 'clean-3', username: 'cleanthree', status: 'sent', dmSentAt: new Date().toISOString(), dmChannelId: 'ch-1', dmMessageId: 'm-3' });
  const edits = [];
  const guild = {
    id: 'g-clean',
    client: {
      channels: { cache: new Map([['ch-1', {
        messages: {
          cache: new Map(),
          fetch: async (id) => ({ id, embeds: [{ title: '🕊️ Wir vermissen dich!', description: 'Optionstexte …' }], edit: async (payload) => { edits.push({ id, payload }); } })
        }
      }]]) }
    }
  };
  const result = await cleanupRespondedReminderDms({ guild });
  assert.equal(result.total, 2, 'nur beantwortete DMs (stayed/left) werden geprüft');
  assert.equal(result.cleaned, 2, 'beide beantworteten DMs werden bereinigt');
  assert.equal(edits.length, 2, 'genau zwei Nachrichten werden editiert (die offene „sent“-DM bleibt unberührt)');
  for (const edit of edits) {
    assert.ok(Array.isArray(edit.payload.embeds) && edit.payload.embeds.length === 1, 'Haupt-Embed bleibt bei der Bereinigung stehen');
    assert.ok(Array.isArray(edit.payload.components) && edit.payload.components.length === 0, 'Buttons werden entfernt');
  }
  const titles = edits.map((edit) => String(edit.payload.embeds[0].title || ''));
  assert.ok(titles.some((title) => title.includes('Du bleibst')), 'Entscheidungs-Titel für „geblieben“');
  assert.ok(titles.some((title) => title.includes('Du verlässt')), 'Entscheidungs-Titel für „entfernt“');
  ok('Bereinigung: Haupt-Embed bleibt, Inhalt zeigt die Entscheidung, Buttons weg');
}

// 9i) Manuelle DM: sendet JETZT an ein bestimmtes Mitglied (unabhängig vom
//     Scan), speichert wer/wann/Referenz. Bots und unbekannte Mitglieder
//     werden abgelehnt.
{
  const { sendManualReminderDm } = _inactiveReminderInternals;
  const store = await import('../src/runtime/inactiveReminderStore.js');
  const member = {
    id: 'manual-1',
    displayName: 'Manual Test',
    user: { id: 'manual-1', username: 'manualtest', bot: false },
    joinedAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000),
    roles: { cache: { some: () => false } },
    send: async () => ({ id: 'msg-manual', channelId: 'dm-manual' })
  };
  const guild = { id: 'g-manual', name: 'Manual', members: { cache: new Map([['manual-1', member]]) } };
  const conf = normalizeConfig({ guildId: 'g-manual', guildName: 'Manual', inactiveReminder: { enabled: true, thresholdDays: 180 } });

  const result = await sendManualReminderDm({ guild, userId: 'manual-1', conf });
  assert.equal(result.ok, true, 'manuelle DM wird gesendet');
  assert.equal(result.sent, 1, 'genau eine DM');
  assert.equal(result.edited, false, 'frische DM (keine vorhandene Referenz)');
  const rec = store.getInactiveReminder('g-manual', 'manual-1');
  assert.equal(rec.status, 'sent', 'Eintrag gespeichert (wartet auf Antwort)');
  assert.equal(rec.dmMessageId, 'msg-manual', 'DM-Referenz gespeichert (löschbar)');

  const botMember = { id: 'manual-2', displayName: 'Bot', user: { id: 'manual-2', username: 'somebot', bot: true } };
  guild.members.cache.set('manual-2', botMember);
  const botResult = await sendManualReminderDm({ guild, userId: 'manual-2', conf });
  assert.equal(botResult.ok, false, 'Bots werden nicht angeschrieben');

  const missingResult = await sendManualReminderDm({ guild, userId: 'unbekannt-999', conf });
  assert.equal(missingResult.ok, false, 'unbekanntes Mitglied wird abgelehnt');
  ok('Manuelle DM: sendet gezielt, speichert Referenz, lehnt Bots/Unbekannte ab');
}

// Sicherheitsumbau: Quellenfehler blockieren, Live-Voice wird direkt
// persistiert, und automatische Läufe senden nur nach vollständigem Backfill.
{
  const previousSmokeFlag = process.env.FALLEN_HEAVEN_SMOKE_TEST;
  process.env.FALLEN_HEAVEN_SMOKE_TEST = '0';
  const source = _inactiveReminderInternals.getIndexActivitySource('missing-index', new Date().toISOString());
  assert.equal(source.available, false, 'fehlender Nachrichtenindex ist nicht leer, sondern unverfügbar');
  const blocked = await runInactiveReminderScan({
    guild: { id: 'missing-index', name: 'Missing', members: { cache: new Map() } },
    conf: normalizeConfig({ guildId: 'missing-index', inactiveReminder: { enabled: true } }),
    source: 'preview',
    dryRun: true
  });
  assert.equal(blocked.status, 'data-incomplete');
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.candidates, 0);
  process.env.FALLEN_HEAVEN_SMOKE_TEST = previousSmokeFlag;

  const { feature } = await import('../src/features/inactiveReminder.js');
  const { getLastVoiceAtMap } = await import('../src/runtime/voiceLogStateStore.js');
  await feature.onVoiceStateUpdate({
    guild: { id: 'g-direct-voice' },
    oldState: { id: 'voice-user', channelId: null },
    newState: { id: 'voice-user', channelId: 'voice-1' }
  });
  assert.ok(Number(getLastVoiceAtMap('g-direct-voice', ['voice-user'])['voice-user'] || 0) > Date.now() - 10_000, 'Discord-Voice-Event wird persistent gespeichert');
  assert.equal(settings({ inactiveReminder: { enabled: true } }).deliveryMode, 'automatic-qualified');
  assert.ok(String(feature.onClientReady).includes('runAutomaticInactiveReminderScan'), 'Start-Hook startet den sicheren automatischen Lauf');
  assert.ok(String(feature.onConfigUpdate).includes('runAutomaticInactiveReminderScan'), 'Config-Hook nutzt denselben sicheren automatischen Lauf');
  const autoBlocked = await _inactiveReminderInternals.runAutomaticInactiveReminderScan({
    guild: { id: 'g-auto-blocked', name: 'Auto Blocked' },
    cfg: normalizeConfig({ guildId: 'g-auto-blocked', inactiveReminder: { enabled: true } }),
    source: 'startup'
  });
  assert.equal(autoBlocked.blocked, true, 'fehlende Voice-Historie blockiert den automatischen Versand');
  assert.equal(autoBlocked.sent, 0);
  ok('Fail-closed Quellen, direkte Voice-Erfassung und sichere Automatik');
}

// Fehlerzustände bleiben wahr: DM-Fehler ist kein „geblieben“, eine nicht
// löschbare DM bleibt referenziert und ein abgelehnter Kick bleibt offen.
{
  const store = await import('../src/runtime/inactiveReminderStore.js');
  const old = Date.now() - 200 * 24 * 60 * 60 * 1000;
  const failedMember = {
    id: 'dm-fail-user', displayName: 'DM Fail', user: { id: 'dm-fail-user', username: 'dmfail', bot: false },
    joinedAt: new Date(old), roles: { cache: { some: () => false } }, send: async () => { throw new Error('DM closed'); }
  };
  const failedGuild = { id: 'g-dm-fail', name: 'DM Fail', members: { cache: new Map([[failedMember.id, failedMember]]) } };
  const failedResult = await runInactiveReminderScan({
    guild: failedGuild,
    conf: normalizeConfig({ guildId: failedGuild.id, inactiveReminder: { enabled: true, thresholdDays: 180 } }),
    source: 'manual-selected', userIds: [failedMember.id]
  });
  assert.equal(failedResult.dmFailed, 1);
  assert.equal(store.getInactiveReminder(failedGuild.id, failedMember.id).status, 'dm-failed');

  store.upsertInactiveReminder({ guildId: 'g-delete-proof', userId: 'delete-user', status: 'sent', dmSentAt: new Date().toISOString(), dmChannelId: 'missing-dm', dmMessageId: 'missing-message' });
  const deleteResult = await _inactiveReminderInternals.deleteReminderDm({
    guild: { id: 'g-delete-proof', client: { channels: { cache: new Map() } } },
    userId: 'delete-user'
  });
  assert.equal(deleteResult.ok, false);
  assert.equal(store.getInactiveReminder('g-delete-proof', 'delete-user').status, 'sent', 'ohne Discord-Löschbeweis bleibt der Eintrag erhalten');

  store.upsertInactiveReminder({ guildId: 'g-kick-fail', userId: 'kick-user', status: 'sent', dmSentAt: new Date().toISOString() });
  let finalReply = '';
  const kickMember = { id: 'kick-user', kickable: true, kick: async () => { throw new Error('Missing Permissions'); } };
  const kickGuild = { id: 'g-kick-fail', name: 'Kick Fail', members: { cache: new Map([[kickMember.id, kickMember]]) } };
  await _inactiveReminderInternals.handleInactiveReminderInteraction({
    interaction: {
      customId: 'fh-inactive:leave:g-kick-fail:kick-user', user: { id: 'kick-user' }, guild: kickGuild,
      deferReply: async () => {}, editReply: async (payload) => { finalReply = payload.content; }, message: { edit: async () => {} }
    },
    cfg: normalizeConfig({ guildId: kickGuild.id, inactiveReminder: { enabled: true } })
  });
  assert.equal(store.getInactiveReminder('g-kick-fail', 'kick-user').status, 'leave-requested');
  assert.ok(finalReply.includes('abgelehnt'));
  ok('Wahrheitsgetreue DM-, Lösch- und Kick-Fehlerzustände');
}

console.log('Editierbare Texte (3.9.222-Prinzip):');
{
  const { reminderTexts, formatReminderText, DEFAULT_REMINDER_TEXTS, buildReminderActionRow, buildRespondedReminderEdit } = _inactiveReminderInternals;
  // Eigene Texte greifen
  const customCfg = normalizeConfig({
    guildId: 'g-texts', guildName: 'TextServer',
    inactiveReminder: {
      enabled: true, thresholdDays: 90,
      joinButtonLabel: 'Komm zurück!',
      leaveButtonLabel: 'Bitte entfernen',
      joinInviteButtonLabel: '➡️ Direkt beitreten',
      stayConfirmTitle: 'Super, du bleibst!',
      stayConfirmDescription: 'Du bist aktiv – nächste Erinnerung in {thresholdDays} Tagen.',
      leaveConfirmTitle: 'Tschüss!',
      leaveConfirmDescription: 'Wir entfernen dich freundlich vom Server.',
      joinReplyText: 'Willkommen zurück auf **{guild}**!',
      stayReplyText: 'Du bleibst – nächste Erinnerung in {thresholdDays} Tagen.',
      leaveReplyText: 'Alles klar, wir verabschieden dich.'
    }
  });
  const s = settings(customCfg);
  assert.equal(s.texts.joinButtonLabel, 'Komm zurück!', 'Ja-Button editierbar');
  assert.equal(s.texts.leaveButtonLabel, 'Bitte entfernen', 'Nein-Button editierbar');
  assert.equal(s.texts.stayConfirmTitle, 'Super, du bleibst!', 'Entscheidungs-Titel editierbar');

  // Button-Row nutzt die eigenen Labels
  const row = buildReminderActionRow('g-texts', 'u-texts', 'https://discord.gg/fallen-heaven', s.texts, { guild: 'TextServer', thresholdDays: 90 }).toJSON();
  assert.equal(row.components[0].label, 'Komm zurück!', 'DM-Button übernimmt eigenes Label');

  // Entscheidungs-Embed nutzt eigene Titel + Platzhalter
  const fakeMessage = {
    embeds: [new (await import('discord.js')).EmbedBuilder().setTitle('Alt').setDescription('Alt').toJSON()]
  };
  const edit = buildRespondedReminderEdit(fakeMessage, 'stay', 90, s.texts, { guild: 'TextServer', thresholdDays: 90 });
  assert.equal(edit.embeds[0].title, 'Super, du bleibst!', 'Entscheidungs-Embed-Titel editierbar');
  assert.ok(edit.embeds[0].description.includes('90 Tagen'), '{thresholdDays} im Entscheidungs-Text ersetzt');

  // Antwort-Texte mit Platzhaltern
  assert.equal(formatReminderText('Willkommen zurück auf **{guild}**!', { guild: 'TextServer' }), 'Willkommen zurück auf **TextServer**!', '{guild} in Antwort-Text ersetzt');
  assert.equal(formatReminderText('in {thresholdDays} Tagen', { thresholdDays: 90 }), 'in 90 Tagen', '{thresholdDays} ersetzt');

  // Defaults bleiben stabil
  const defaults = reminderTexts({});
  assert.equal(defaults.joinButtonLabel, 'Ja, zum Server', 'Default Ja-Button');
  assert.equal(defaults.stayConfirmTitle, '✅ Du bleibst bei uns!', 'Default Entscheidungs-Titel');
  assert.equal(Object.keys(DEFAULT_REMINDER_TEXTS()).length, 10, 'Alle 10 Textbausteine vorhanden');
  ok('Erinnerung: DM-Buttons, Entscheidungs-Embeds und Antwort-Texte sind editierbar (Platzhalter innen)');
}

console.log(`\nInaktivitäts-Erinnerung: ${passed} Prüfungen grün ✅`);
