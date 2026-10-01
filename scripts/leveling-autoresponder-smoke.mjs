import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Leveling in ein eigenes Temp-Verzeichnis lenken, damit awardXp-Tests niemals
// echte lokale Daten (z. B. ./data) berühren – daher dynamischer Import.
process.env.FALLEN_HEAVEN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-levels-smoke-'));
const { _levelInternals } = await import('../src/features/levels.js');
// Dynamischer Import NACH dem Setzen der Env-Var: statische Imports laufen vor
// dem Modul-Code und würden sonst ins echte ./data schreiben.
const { _botUpdatesInternals } = await import('../src/features/botUpdates.js');
const { _localImageStoreInternals } = await import('../src/runtime/localImageStore.js');
import { _autoResponderInternals } from '../src/features/autoResponder.js';
import { defaultGuildConfig, normalizeConfig, featureCards } from '../src/defaultConfig.js';

// Balance V1: frühe Level bleiben erreichbar, ab Level 20 steigt die Kurve
// progressiv bis 1.238.400 XP bei Level 110.
assert.equal(_levelInternals.levelFromXp(300), 1);
assert.equal(_levelInternals.levelFromXp(840), 2);
assert.equal(_levelInternals.levelFromXp(8400), 10);
assert.equal(_levelInternals.levelFromXp(45000), 25);
assert.equal(_levelInternals.levelFromXp(216000), 50);
assert.equal(_levelInternals.levelFromXp(1238400), 110);
assert.equal(_levelInternals.levelFromXp(99999999, 40), 40, 'sichtbares Level bleibt am konfigurierten Rollenmaximum');
assert.deepEqual(_levelInternals.parseMappings(['1=123', '5=456']), [{ level: 1, roleId: '123' }, { level: 5, roleId: '456' }]);
assert.equal(_levelInternals.fingerprint(' Hallo   <@123> '), 'hallo');

const cfg = normalizeConfig({ levels: { xpPerMessageMin: 20, xpPerMessageMax: 5, ignoredChannelIds: ['12', '12'], excludedRoleIds: ['34'], noXpRoleIds: ['77'], levelRoleMappings: ['1=56'] } });
assert.deepEqual(cfg.levels.ignoredChannelIds, ['12']);
assert.deepEqual(cfg.levels.excludedRoleIds, ['34']);
assert.deepEqual(cfg.levels.noXpRoleIds, ['77']);
assert.deepEqual(cfg.levels.levelRoleMappings, ['1=56']);
assert.equal(cfg.levels.balanceVersion, 'progressive-v1');
assert.equal(cfg.levels.xpPerMessage, 5);
assert.equal(cfg.levels.xpPerMessageMin, 5);
assert.equal(cfg.levels.xpPerMessageMax, 5);
assert.equal(cfg.levels.cooldownSeconds, 0);
assert.equal(cfg.levels.voiceXpPerMinute, 1);
assert.equal(cfg.levels.voiceMinimumParticipants, 2);
assert.equal(cfg.levels.levelCurveBase, 60);
assert.equal(cfg.levels.activityBonusPlace1, 0);
assert.equal(cfg.levels.activityBonusMaxPerDay, 0);
assert.equal(cfg.levels.panelDesign.embed.title, '💯 Leveln');
assert.equal(cfg.levels.minMessageLength, 2, 'Mindestlänge 2 Buchstaben');
assert.equal(cfg.levels.maxXpPerDay, 0, 'kein Tageslimit im Standard');
assert.ok(featureCards.find((feature) => feature.id === 'levels').fields.some((field) => field.key === 'levels.levelRoleMappings' && field.type === 'roleMappingSelect'));
assert.ok(featureCards.find((feature) => feature.id === 'levels').fields.some((field) => field.key === 'levels.xpPerMessage'));
assert.ok(featureCards.find((feature) => feature.id === 'levels').fields.some((field) => field.key === 'levels.voiceXpPerMinute'));
assert.ok(!featureCards.find((feature) => feature.id === 'levels').fields.some((field) => field.key === 'levels.activityBonusPlace1'));
assert.ok(featureCards.find((feature) => feature.id === 'levels').fields.some((field) => field.key === 'levels.levelRolesPanelChannelId' && field.type === 'channelSelect'));
assert.ok(!featureCards.find((feature) => feature.id === 'levels').fields.some((field) => field.key === 'levels.levelRolesPanelTitle'), 'hässliche Textfelder entfernt');

// Legacy-Textfelder werden automatisch in panelDesign migriert.
{
  const legacy = normalizeConfig({ levels: { levelRolesPanelTitle: 'Alt-Titel', levelRolesPanelDescription: 'Alt-Beschreibung', levelRolesPanelFooter: 'Alt-Fußzeile', levelRolesPanelColor: '#123456' } });
  assert.equal(legacy.levels.panelDesign.embed.title, 'Alt-Titel');
  assert.equal(legacy.levels.panelDesign.embed.footerText, 'Alt-Fußzeile');
  assert.equal(legacy.levels.panelDesign.embed.color, '#123456');
  assert.match(legacy.levels.panelDesign.embed.description, /Alt-Beschreibung/);
  assert.match(legacy.levels.panelDesign.embed.description, /\{levelRoleBlock1\}/, 'Legacy-Listen-Platzhalter werden auf einzelne Rollen-Blöcke migriert');
}

// NO-XP-Rolle: Mitglieder mit der Rolle erhalten keine XP.
{
  const guild = { id: 'g1' };
  const noXpMember = {
    guild,
    author: { id: 'u1', bot: false },
    member: { roles: { cache: { some: (fn) => fn({ id: '77' }) } } },
    channelId: 'c1',
    channel: { id: 'c1', parentId: '' },
    content: 'Das ist eine ausreichend lange Nachricht.'
  };
  const profile = { xp: 0, level: 0, lastAt: 0, lastFingerprint: '', lastFingerprintAt: 0 };
  const decision = _levelInternals.shouldAward(noXpMember, cfg, profile, Date.now());
  assert.equal(decision.ok, false, 'NO-XP-Rolle blockiert XP');
  assert.equal(decision.reason, 'no-xp');
}

// Levelrollen-Panel-Zeilen: NO-XP-Zeile + Mapping-Zeilen als echte Rollen-Mentions (<@&id>).
{
  const guild = { roles: { cache: new Map([['111', { name: 'Asche-Engel' }], ['222', { name: 'NO-XP' }]]) } };
  const lines = _levelInternals.buildLevelRoleLines(guild, { noXpRoleIds: ['222'], levelRoleMappings: ['10=111', '25=333'] });
  assert.deepEqual(lines, ['| <@&222> | Nur auf Anfrage', '| <@&111> | Ab Level 10', '| <@&333> | Ab Level 25']);
}

// Level-Rollen an alle vergeben (Massen-Sync): liest den XP-Stand, vergibt
// die passenden Rollen und entfernt falsche verwaltete Rollen. Die XP werden
// über awardXp (ohne Rollen-Mappings) in den Store geschrieben, damit die
// Rollenvergabe wirklich durch grantLevelRolesToAll passiert.
{
  const makeGuild = (roleEntries) => ({
    id: 'g7',
    roles: {
      cache: new Map(roleEntries.map(([id, name]) => [id, { id, name, managed: false, editable: true, position: 1 }]))
    },
    members: {
      me: { id: 'bot', permissions: { has: () => true }, roles: { highest: { position: 99 } } },
      fetch: async (args) => {
        if (args) throw new Error('mock-fresh');
        return new Map([['x1', x1], ['x2', x2], ['x3', x3], ['x4', x4]]);
      }
    }
  });
  const makeMember = (guild, id, roleIds = []) => {
    const member = {
      id,
      user: { id, bot: false },
      guild,
      manageable: true,
      roles: {
        cache: new Map(roleIds.map((roleId) => [roleId, { id: roleId }])),
        add: async (toAdd) => { for (const roleId of toAdd) member.roles.cache.set(roleId, { id: roleId }); return member; },
        remove: async (toRemove) => { for (const roleId of toRemove) member.roles.cache.delete(roleId); return member; }
      }
    };
    return member;
  };
  const guild = makeGuild([['111', 'Asche-Engel'], ['222', 'Silber-Engel']]);
  const x1 = makeMember(guild, 'x1', []);
  const x2 = makeMember(guild, 'x2', []);
  const x3 = makeMember(guild, 'x3', ['222']); // trägt 222, hat aber 0 XP → wird entfernt
  const x4 = makeMember(guild, 'x4', []);
  // XP ohne Rollen-Mappings vergeben (leeres Mapping → awardXp vergibt keine Rollen).
  const seedConf = { levels: { levelRoleMappings: [] } };
  await _levelInternals.awardXp({ guild, member: x1, cfg: seedConf, conf: seedConf.levels, amount: 300, silent: true });
  await _levelInternals.awardXp({ guild, member: x2, cfg: seedConf, conf: seedConf.levels, amount: 720, silent: true });
  const grantConf = {
    levels: {
      cumulativeRoleRewards: true,
      levelRoleMappings: [{ level: 1, roleId: '111' }, { level: 2, roleId: '222' }]
    }
  };
  const granted = await _levelInternals.grantLevelRolesToAll(guild, grantConf);
  assert.equal(granted.ok, true);
  assert.equal(granted.added, 3, '111 an x1, 111 + 222 an x2 (kumulativ)');
  assert.equal(granted.removed, 1, 'Falsche Rolle 222 von x3 wird entfernt');
  assert.equal(granted.processed, 3, 'Drei Mitglieder wurden angepasst');
  assert.equal(granted.members, 3, 'Drei Mitglieder hatten Handlungsbedarf');
  assert.equal(granted.blockedCount, 0);
  assert.equal(granted.hadErrors, false);
  assert.ok(x1.roles.cache.has('111') && !x1.roles.cache.has('222'), 'x1 bekommt nur Rolle 111');
  assert.ok(x2.roles.cache.has('111') && x2.roles.cache.has('222'), 'x2 bekommt beide Rollen (kumulativ)');
  assert.equal(x3.roles.cache.size, 0, 'x3 verliert die falsche Rolle');
  assert.equal(x4.roles.cache.size, 0, 'x4 ohne XP bleibt unberührt');

  // Erneuter Lauf: alles passt bereits → keine Änderungen, aber kein Fehler.
  const again = await _levelInternals.grantLevelRolesToAll(guild, grantConf);
  assert.equal(again.ok, true);
  assert.equal(again.added, 0, 'Bereits passende Rollen werden nicht doppelt vergeben');
  assert.equal(again.removed, 0);
  assert.equal(again.hadErrors, false);
  // Ohne konfigurierte Rollen: klarer Fehlergrund statt stiller Erfolg.
  const noMappings = await _levelInternals.grantLevelRolesToAll(guild, { levels: { levelRoleMappings: [] } });
  assert.equal(noMappings.ok, false);
  assert.equal(noMappings.reason, 'no-mappings');
}

// awardXp: Aktivität ist nie gedeckelt; passive Quellen sind abgeschaltet.
{
  const guild = { id: 'g1' };
  const member = { id: 'u1', guild };
  const conf = {
    maxXpPerDay: 100,
    activityBonusMaxPerDay: 50,
    activityBonusPlace1: 100,
    levelCurveBase: 20,
    levelRoleMappings: [],
    announce: false,
    levelUpMessage: ''
  };
  const cfg = { general: { timezone: 'Europe/Berlin' }, levels: conf };
  const award = (amount, source) => _levelInternals.awardXp({ guild, member, cfg, conf, amount, source, silent: true });

  const first = await award(30, 'message');
  assert.equal(first.amount, 30);
  assert.equal(first.profile.xp, 30);
  assert.equal(first.profile.dailyXp, 30);
  const second = await award(30, 'message');
  assert.equal(second.amount, 30);
  assert.equal(second.profile.xp, 60);
  const uncapped = await award(100, 'message');
  assert.equal(uncapped.amount, 100, 'Legacy-Tageslimit wird ignoriert');
  assert.equal(uncapped.profile.dailyXp, 160);
  assert.equal(uncapped.profile.xp, 160);
  const next = await award(10, 'message');
  assert.equal(next.amount, 10, 'jede weitere legitime Aktivität zählt');
  const bonus = await award(100, 'bonus');
  const tag = await award(100, 'tag-bonus');
  const boost = await award(100, 'boost-bonus');
  assert.equal(bonus.amount, 0, 'Liga erzeugt keine Level-XP');
  assert.equal(tag.amount, 0, 'Server-Tag erzeugt keine Level-XP');
  assert.equal(boost.amount, 0, 'Booster erzeugt keine Level-XP');
  assert.equal(next.profile.xp, 170);
}

// Kurven-Umkehrung + Fortschrittsbalken für die Level-Karte.
{
  assert.equal(_levelInternals.xpForLevel(1), 300);
  assert.equal(_levelInternals.xpForLevel(10), 8400);
  assert.equal(_levelInternals.xpForLevel(25), 45000);
  assert.equal(_levelInternals.xpForLevel(110), 1238400);
  assert.equal(_levelInternals.xpForLevel(0), 0);
  assert.equal(_levelInternals.progressBar(0), '▱▱▱▱▱▱▱▱▱▱▱▱');
  assert.equal(_levelInternals.progressBar(1), '▰▰▰▰▰▰▰▰▰▰▰▰');
  assert.equal(_levelInternals.progressBar(0.5), '▰▰▰▰▰▰▱▱▱▱▱▱');
}

// /level: Kanal-Beschränkung + Level-Karte.
{
  let replyPayload = null;
  const interaction = {
    commandName: 'level',
    channelId: 'other-channel',
    guild: { id: 'g1', channels: { cache: new Map([['cmd', { toString: () => '<#cmd>' }]]) } },
    options: { getUser: () => null },
    reply: async (payload) => { replyPayload = payload; }
  };
  await _levelInternals.handleLevelCommand({ interaction, cfg: { levels: { enabled: true, commandChannelId: 'cmd' } } });
  assert.match(replyPayload.content, /Level-Kanal/);
  assert.equal(replyPayload.flags, 64, 'Kanal-Hinweis ist ephemer');

  const disabled = { ...interaction, channelId: 'cmd' };
  await _levelInternals.handleLevelCommand({ interaction: disabled, cfg: { levels: { enabled: false } } });
  assert.match(replyPayload.content, /deaktiviert/);

  const member = { id: 'u1', user: { username: 'Tester', id: 'u1' }, roles: { cache: new Map() } };
  const success = {
    ...interaction,
    channelId: 'cmd',
    user: { id: 'u1' },
    member,
    guild: {
      id: 'g1',
      channels: { cache: new Map([['cmd', { toString: () => '<#cmd>' }]]) },
      members: { cache: { has: (id) => id === 'u1' }, fetch: async () => member }
    }
  };
  await _levelInternals.handleLevelCommand({
    interaction: success,
    cfg: { general: { timezone: 'Europe/Berlin' }, levels: { enabled: true, commandChannelId: 'cmd', levelCurveBase: 20 } }
  });
  assert.equal(replyPayload.embeds?.[0]?.data?.title, 'Level 0', 'Level-Karte berechnet das Level kanonisch aus den gespeicherten XP');
  assert.match(replyPayload.embeds[0].data.description, /Rang:\*\* #1 auf dem Server/);
  assert.match(replyPayload.embeds[0].data.description, /bis Level 1/);
}

// Level-Karte ist ein Embed-Studio-Template im Fallen-Heaven-Standard.
{
  const normalized = normalizeConfig({});
  const card = normalized.embeds.templates.find((template) => template.id === 'level-card');
  assert.ok(card, 'Level-Karte-Template existiert im Standard');
  assert.equal(card.embed.color, '#f1b84b', 'Level-Karte im FH-Gold');
  assert.equal(card.embed.title, 'Level {level}');
  assert.ok(card.embed.fields.some((field) => field.value.includes('{levelSpan}')));
  assert.ok(card.embed.fields.some((field) => field.name === 'Lifetime-XP' && field.value.includes('{xp}')));
  assert.ok(!card.embed.fields.some((field) => field.name === 'Liga-Bonus' || field.value.includes('{bonusXp}')),
    'Die neue Standardkarte darf keinen abgeschalteten Liga-Bonus mehr anzeigen.');
  assert.match(card.embed.footerText, /FALLEN HEAVEN/);

  // Migration: gespeicherte Alt-Templates werden automatisch auf das neue Design angehoben.
  const migrated = normalizeConfig({
    embeds: { templates: [{ id: 'level-card', enabled: true, embed: { title: '{username} · Level {level}', description: 'alt', color: '#8b82ff', fields: [] } }] }
  }).embeds.templates.find((template) => template.id === 'level-card');
  assert.equal(migrated.embed.title, 'Level {level}', 'Alt-Level-Karte wird migriert');
  assert.equal(migrated.embed.color, '#f1b84b');
  assert.ok(migrated.embed.fields.some((field) => field.value.includes('{levelSpan}')));
  const migratedBalanceCard = normalizeConfig({
    embeds: { templates: [{
      id: 'level-card',
      enabled: true,
      embed: {
        title: 'Level {level}',
        description: 'eigenes Layout',
        authorName: 'Eigener Author',
        fields: [{ name: 'Liga-Bonus', value: '{bonusXp} XP', inline: true }]
      }
    }] }
  }).embeds.templates.find((template) => template.id === 'level-card');
  assert.equal(migratedBalanceCard.embed.authorName, 'Eigener Author', 'Die Balance-Migration muss eigene Kartengestaltung erhalten.');
  assert.deepEqual(migratedBalanceCard.embed.fields, [{ name: 'Lifetime-XP', value: '{xp} XP', inline: true }]);
  const kept = normalizeConfig({
    embeds: { templates: [{ id: 'level-card', enabled: true, embed: { title: 'Mein eigenes Design', description: 'custom', color: '#123456', fields: [] } }] }
  }).embeds.templates.find((template) => template.id === 'level-card');
  assert.equal(kept.embed.title, 'Mein eigenes Design', 'Eigene Designs bleiben unangetastet');

  const member = { id: 'u1', user: { username: 'Tester', id: 'u1' }, roles: { cache: new Map() } };
  let replyPayload = null;
  const interaction = {
    commandName: 'level',
    channelId: 'cmd',
    user: { id: 'u1' },
    member,
    guild: {
      id: 'g1',
      channels: { cache: new Map([['cmd', { toString: () => '<#cmd>' }]]) },
      members: { cache: { has: (id) => id === 'u1' }, fetch: async () => member }
    },
    options: { getUser: () => null },
    reply: async (payload) => { replyPayload = payload; }
  };
  const withTemplate = {
    general: { timezone: 'Europe/Berlin' },
    levels: { enabled: true, commandChannelId: 'cmd', levelCurveBase: 20 },
    embeds: { templates: [{ id: 'level-card', enabled: true, embed: { title: 'Level {level} · Rang #{rank}', description: '{progressBar} {progressPercent}%', color: '#8b82ff', fields: [] } }] }
  };
  await _levelInternals.handleLevelCommand({ interaction, cfg: withTemplate });
  assert.equal(replyPayload.embeds[0].data.title, 'Level 0 · Rang #1', 'Template-Platzhalter {level}/{rank} werden ersetzt');
}

// Levelrollen-Panel: Rollen-Embed + Regeln-Ansicht (FH-Standard, wie Aktivitäts-Liga).
{
  const guild = {
    id: 'g1',
    iconURL: () => '',
    channels: { cache: new Map([['ch1', { name: 'allgemein' }]]) },
    roles: { cache: new Map([['111', { name: 'Asche-Engel' }], ['222', { name: 'NO-XP' }]]) }
  };
  const conf = {
    panelDesign: {
      content: '',
      outsideImageUrl: '',
      outsideImageAttachment: null,
      embed: {
        title: '💯 Leveln',
        url: '',
        description: 'Intro\n\n{levelRoles}',
        color: '#8b82ff',
        authorName: '',
        authorIconUrl: '',
        thumbnailUrl: '',
        imageUrl: '',
        footerText: 'FALLEN HEAVEN',
        footerIconUrl: '',
        timestamp: true,
        fields: []
      }
    },
    levelRoleMappings: ['10=111'],
    noXpRoleIds: ['222'],
    ignoredChannelIds: ['ch1'],
    excludedRoleIds: [],
    xpPerMessageMin: 6,
    xpPerMessageMax: 16,
    minMessageLength: 2,
    cooldownSeconds: 60,
    maxXpPerDay: 0,
    voiceXpPerMinute: 2,
    voiceMinimumParticipants: 2,
    excludeDeafenedVoice: true,
    activityBonusEnabled: true,
    activityBonusPlace1: 100,
    activityBonusPlace2: 70,
    activityBonusPlace3: 40,
    activityBonusMaxPerDay: 150,
    tagBonusXpPerDay: 30,
    boostBonusEnabled: true,
    boostBonusXpPerBoost: 10,
    boostBonusMaxPerDay: 40,
    levelCurveBase: 20
  };
  const rolesEmbed = _levelInternals.buildLevelRolesEmbed(guild, conf);
  assert.equal(rolesEmbed.data.title, '💯 Leveln');
  assert.match(rolesEmbed.data.description, /\| <@&111> \| Ab Level 10/);
  assert.match(rolesEmbed.data.description, /\| <@&222> \| Nur auf Anfrage/);
  assert.match(rolesEmbed.data.description, /Intro/);
  // Ohne {levelRoles}-Platzhalter wird NICHTS angehängt – die Beschreibung
  // bleibt exakt wie im Studio gestaltet (eigener Text ohne Rollenliste).
  const fallbackConf = { ...conf, panelDesign: { ...conf.panelDesign, embed: { ...conf.panelDesign.embed, description: 'Nur Intro' } } };
  const fallbackEmbed = _levelInternals.buildLevelRolesEmbed(guild, fallbackConf);
  assert.match(fallbackEmbed.data.description, /Nur Intro/);
  assert.ok(!fallbackEmbed.data.description.includes('Ab Level 10'), 'Ohne {levelRoles} wird keine Rollenliste angehängt');
  assert.equal(fallbackEmbed.data.description.trim(), 'Nur Intro', 'Beschreibung bleibt exakt wie geschrieben');
  // Migration: Anker-Anhänge (privater „fh-assets“-Kanal) sind abgeschafft.
  // Die CDN-URL bleibt als einfache Bild-URL erhalten, der Anhang wird entfernt.
  const anchoredDesign = _levelInternals.normalizeLevelsPanelDesign({
    embed: { title: 'X' },
    outsideImageUrl: 'https://cdn.discordapp.com/attachments/1/2/banner.png',
    outsideImageAttachment: {
      id: 'att1', url: 'https://cdn.discordapp.com/attachments/1/2/banner.png', name: 'banner.png', size: 10,
      anchored: true, channelId: 'a1', messageId: 'm1'
    }
  });
  assert.equal(anchoredDesign.outsideImageAttachment, null, 'Anker-Anhang wird entfernt (kein Kanal mehr)');
  assert.equal(anchoredDesign.outsideImageUrl, 'https://cdn.discordapp.com/attachments/1/2/banner.png', 'CDN-URL bleibt als Bild-URL erhalten');
  // Thumbnail/Embed-Bild: erlaubte externe URL bleibt direkt gesetzt; geblockte
  // Discord-CDN-Anhang-URLs werden lokal geladen und als echter Anhang
  // (attachment://) referenziert – so funktioniert die Thumbnail-URL im Panel.
  const allowedConf = { ...conf, panelDesign: { ...conf.panelDesign, embed: { ...conf.panelDesign.embed, thumbnailUrl: 'https://example.com/bild.png', imageUrl: '' } } };
  const cdnThumbConf = { ...conf, panelDesign: { ...conf.panelDesign, embed: { ...conf.panelDesign.embed, thumbnailUrl: 'https://cdn.discordapp.com/attachments/1/2/thumb.gif?ex=1&is=2&hm=3&', imageUrl: '' } } };
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    headers: { get: () => 'image/gif' },
    arrayBuffer: async () => Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64')
  });
  try {
    const allowedPayload = await _levelInternals.buildLevelsRolesPayload(guild, allowedConf, allowedConf);
    assert.equal(allowedPayload.embeds[0].data.thumbnail.url, 'https://example.com/bild.png', 'Erlaubte URL bleibt direkt gesetzt');
    assert.ok(!allowedPayload.files, 'Erlaubte URL erzeugt keine Anhang-Datei');
    const cdnPayload = await _levelInternals.buildLevelsRolesPayload(guild, cdnThumbConf, cdnThumbConf);
    assert.match(cdnPayload.embeds[0].data.thumbnail.url, /^attachment:\/\/embed-[a-f0-9]+\.gif$/, 'CDN-Thumbnail wird als Anhang referenziert (attachment://)');
    assert.ok(Array.isArray(cdnPayload.files) && cdnPayload.files.length === 1, 'CDN-Thumbnail wird als Datei angehängt');
    assert.equal(cdnPayload.files[0].name, cdnPayload.embeds[0].data.thumbnail.url.replace('attachment://', ''), 'Dateiname passt zur attachment-Referenz');
  } finally {
    global.fetch = originalFetch;
  }
  const rules = _levelInternals.buildLevelsRulesPayload(guild, conf);
  const rulesEmbed = rules.embeds[0];
  assert.equal(rulesEmbed.data.title, 'Regeln und Wertung');
  const fieldNames = rulesEmbed.data.fields.map((field) => field.name);
  assert.ok(fieldNames.includes('CHAT'));
  assert.ok(fieldNames.includes('SPRACHCHAT'));
  assert.ok(!fieldNames.includes('AKTIVITÄTS-BONUS'));
  assert.ok(!fieldNames.includes('ROLLEN- & BOOSTER-BONUS'));
  assert.ok(fieldNames.includes('LEVEL-KURVE'));
  assert.ok(fieldNames.includes('NO-XP-ROLLE'), 'Regeln nennen die NO-XP-Rolle explizit');
  const noXpField = rulesEmbed.data.fields.find((field) => field.name === 'NO-XP-ROLLE');
  assert.match(noXpField.value, /NO-XP/);
  assert.match(noXpField.value, /weder im Chat noch im Sprachchat XP/);
  assert.match(rulesEmbed.data.fields[0].value, /fest \*\*5 XP\*\*/);
  assert.match(rulesEmbed.data.fields[0].value, /Kein Cooldown, kein Tageslimit/);
  assert.ok(!/Tageslimit: \*\*500 XP\*\*/.test(rulesEmbed.data.fields[0].value));
  assert.match(rulesEmbed.data.fields[2].value, /Level 110: \*\*1\.238\.400 XP\*\*/);
  // Rollen-Ansicht: nur REGELN (Rollen stehen bereits im Embed); Regeln-Ansicht: kein Button.
  assert.deepEqual(rules.components, [], 'Regeln-Ansicht hat keinen Button');
  const rolesNav = _levelInternals.buildLevelsPanelNavigation().components.map((button) => button.data.custom_id);
  assert.deepEqual(rolesNav, ['fh-levels:rules']);
  // normalizeLevelsPanelDesign migriert das alte Listenpaket auf einzelne
  // Rollen-Platzhalter, damit jede Zeile im Studio unabhängig editierbar ist.
  const normalizedDesign = _levelInternals.normalizeLevelsPanelDesign(conf.panelDesign);
  assert.match(normalizedDesign.embed.description, /\{levelRoleBlock1\}/);
  assert.doesNotMatch(normalizedDesign.embed.description, /\{levelRoles\}/);
  assert.equal(normalizedDesign.embed.title, '💯 Leveln');
}

const rules = _autoResponderInternals.parseRules([{ trigger: 'hi', response: 'Hallo', mode: 'word' }]);
assert.equal(rules[0].mode, 'word');
assert.equal(_autoResponderInternals.matchesRule('hi freund', 'hi', 'word'), true);
assert.equal(_autoResponderInternals.matchesRule('himmel', 'hi', 'word'), false);
assert.equal(_autoResponderInternals.matchesRule('himmel', 'hi', 'contains'), true);
assert.equal(_autoResponderInternals.claimMessage('message-1'), true);
assert.equal(_autoResponderInternals.claimMessage('message-1'), false);
assert.equal(_autoResponderInternals.formatResponse('Hi {username} auf {guild}', { author: { id: '1', username: 'Mira' }, member: { displayName: 'Mira' }, guild: { name: 'FALLEN HEAVEN' }, channelId: '2' }), 'Hi Mira auf FALLEN HEAVEN');

const appSource = fs.readFileSync(new URL('../desktop/renderer/app.js', import.meta.url), 'utf8');
const moduleConfigInputsSource = fs.readFileSync(new URL('../desktop/renderer/module-config-inputs.js', import.meta.url), 'utf8');
const levelsPanelSource = fs.readFileSync(new URL('../desktop/renderer/levels-panel.js', import.meta.url), 'utf8');
assert.match(moduleConfigInputsSource, /Benötigtes Level/);
assert.match(moduleConfigInputsSource, /Level-Belohnungen/);
assert.ok(defaultGuildConfig('1').autoresponder.rules.every((rule) => rule.mode === 'word'));

// Level-Up-Template ist im Fallen-Heaven-Stil (Gold, FH-Footer), mit
// Progress-Bar, XP-Statistik, Content-Ping ({user}) und EINER User-Markierung
// (kein doppelter Inhalt, kein doppelter Ping im Embed).
{
  const templates = defaultGuildConfig('1').embeds.templates;
  const levelUp = templates.find((entry) => entry.id === 'level-up');
  assert.equal(levelUp.embed.color, '#f1b84b', 'Level-Up im FH-Gold');
  assert.match(levelUp.embed.footerText, /FALLEN HEAVEN/);
  assert.equal(levelUp.content, '{user}', 'Content erwähnt den User → echter Ping außerhalb des Embeds');
  assert.match(levelUp.embed.description, /\{level\}/);
  assert.match(levelUp.embed.description, /\{progressBar\}/);
  assert.match(levelUp.embed.description, /\{progressPercent\}/);
  assert.match(levelUp.embed.description, /\{xpNeeded\}/);
  assert.match(levelUp.embed.description, /\{roleText\}/);
  assert.equal((levelUp.embed.description.match(/\{user\}/g) || []).length, 1, 'User wird im Embed genau EINMAL erwähnt');
  assert.ok(!levelUp.embed.description.includes('erreicht und steigt in der Rangliste auf'), 'kein doppelter „erreicht“-Satz');
  assert.ok(levelUp.embed.fields.some((field) => field.value.includes('{rank}')));
  assert.ok(levelUp.embed.fields.some((field) => field.value.includes('{xp}')));
  assert.ok(levelUp.embed.fields.some((field) => field.value.includes('{levelSpan}')));
  // Design v2: Author-Zeile (Name + Profilbild) + großer Avatar als Thumbnail.
  assert.equal(levelUp.embed.authorName, '{username}', 'Level-Up hat eine Author-Zeile mit dem Usernamen');
  assert.equal(levelUp.embed.authorIconUrl, '{userAvatar}', 'Author-Zeile trägt das Profilbild');
  assert.equal(levelUp.embed.thumbnailUrl, '{userAvatar}', 'Großer Avatar als Thumbnail rechts');
  assert.match(levelUp.embed.footerText, /Level \{level\}/);

  // Migration: altes Level-Up-Design (wie in gespeicherten Configs) wird angehoben.
  const migratedUp = normalizeConfig({
    embeds: { templates: [{ id: 'level-up', enabled: true, embed: { title: 'Level Up!', description: '{user} hat Level **{level}** erreicht und steigt in der Rangliste auf! 🚀', color: '#35d07f', fields: [{ name: 'Server', value: '{guild}', inline: true }] } }] }
  }).embeds.templates.find((template) => template.id === 'level-up');
  assert.equal(migratedUp.embed.title, '🏆 Level Up!', 'Alt-Level-Up wird migriert');
  assert.equal(migratedUp.embed.color, '#f1b84b');
  assert.match(migratedUp.embed.description, /\{roleText\}/);
  assert.equal(migratedUp.content, '{user}', 'Migration bringt auch den Content-Ping mit');
  assert.ok(!migratedUp.embed.description.includes('erreicht und steigt in der Rangliste auf'));

  // Migration v2: Der bisher gespeicherte Standard („🏆 Level Up!“ + „Rang #“,
  // ohne Author-Zeile) wird einmalig auf das neue Design (Author + Thumbnail)
  // angehoben – ohne eigene Anpassungen des Users zu überschreiben.
  const migratedV2 = normalizeConfig({
    embeds: { templates: [{ id: 'level-up', enabled: true, embed: { title: '🏆 Level Up!', description: '{roleText}{user} hat Level **{level}** erreicht – Rang #{rank} 🚀\n\n{progressBar} **{progressPercent} %** · noch **{xpNeeded}** XP bis Level **{nextLevel}**', color: '#f1b84b', authorName: '', authorIconUrl: '', thumbnailUrl: '{userAvatar}', footerText: 'FALLEN HEAVEN · Leveling', timestamp: true, fields: [{ name: 'Neues Level', value: '{level}', inline: true }] } }] }
  }).embeds.templates.find((template) => template.id === 'level-up');
  assert.equal(migratedV2.embed.authorName, '{username}', 'Design v2 bringt die Author-Zeile mit');
  assert.equal(migratedV2.embed.authorIconUrl, '{userAvatar}', 'Author-Zeile trägt das Profilbild');
  assert.equal(migratedV2.embed.thumbnailUrl, '{userAvatar}', 'Thumbnail bleibt');
  assert.ok(!String(migratedV2.embed.description).includes('– Rang #{rank}'), 'Beschreibung ist auf das neue Design gehoben');
  assert.match(String(migratedV2.embed.description), /jetzt \*\*Rang/);
  // Eigene User-Anpassungen (anderer Titel) werden NICHT überschrieben.
  const customKept = normalizeConfig({
    embeds: { templates: [{ id: 'level-up', enabled: true, embed: { title: 'Mein Level-Design', description: '{user} ist aufgestiegen.', color: '#ff0000', authorName: 'Eigen', fields: [] } }] }
  }).embeds.templates.find((template) => template.id === 'level-up');
  assert.equal(customKept.embed.title, 'Mein Level-Design', 'Eigene Titel werden nie überschrieben');
  assert.equal(customKept.embed.authorName, 'Eigen', 'Eigene Author-Zeile bleibt erhalten');
}
// Level-Up-Announcement pingt den User IMMER im Content (außerhalb des Embeds)
// – auch wenn ein benutzerdefiniertes Template keine eigene Erwähnung hat.
{
  let sent = null;
  const member = { id: 'u1', user: { id: 'u1', bot: false, username: 'Shiro', displayAvatarURL: () => '' }, roles: { cache: new Map() } };
  const channel = { id: 'c99', isTextBased: () => true, send: async (payload) => { sent = payload; return { id: 'm1' }; } };
  const guild = {
    id: 'g9',
    name: 'FALLEN HEAVEN',
    memberCount: 1,
    channels: { cache: new Map([['c99', channel]]) },
    members: { cache: new Map([['u1', member]]) },
    roles: { cache: new Map() }
  };
  const customCfg = normalizeConfig({
    levels: { enabled: true, announceChannelId: 'c99' },
    embeds: { templates: [{ id: 'level-up', enabled: true, content: 'Level geschafft!', embed: { title: 'T', description: 'Nur Text.', color: '#ffffff', fields: [] } }] }
  });
  await _levelInternals.announceLevelUp({ guild, member, cfg: customCfg, conf: customCfg.levels, level: 3, newRoleId: null, fallbackChannel: null });
  assert.ok(sent, 'Level-Up wird gesendet');
  assert.match(String(sent.content || ''), /<@u1>/, 'User wird im Content erwähnt → echter Discord-Ping');
  assert.deepEqual(sent.allowedMentions, { users: ['u1'], roles: [] }, 'nur der User darf gepingt werden');
  assert.ok(Array.isArray(sent.embeds) && sent.embeds.length === 1, 'Embed kommt mit');
}
// Rollen-Freischalt-Texte sind abwechslungsreich, rollen-fokussiert und OHNE
// {user} – die einzelne User-Markierung trägt die Hauptzeile des Embeds.
{
  assert.ok(Array.isArray(_levelInternals.ROLE_UNLOCK_TEXTS));
  assert.ok(_levelInternals.ROLE_UNLOCK_TEXTS.length >= 3, 'mindestens 3 verschiedene Rollen-Texte');
  assert.ok(new Set(_levelInternals.ROLE_UNLOCK_TEXTS).size >= 3, 'Texte sind unterschiedlich');
  const guild = { name: 'FALLEN HEAVEN' };
  const user = { id: '1', toString: () => '<@1>' };
  const role = { id: '111', name: 'Asche-Engel' };
  for (let i = 0; i < 20; i += 1) {
    const text = _levelInternals.pickRoleUnlockText({ guild, user, level: 10, role });
    assert.match(text, /<@&111>/);
    assert.ok(!text.includes('<@1>'), 'Rollen-Text erwähnt den User nicht (kein Doppel-Ping im Embed)');
  }
  const noRole = _levelInternals.pickRoleUnlockText({ guild, user, level: 10, role: null });
  assert.equal(noRole, '');
}
// Passive Level-XP sind vollständig deaktiviert; Rollen/Perks bleiben in ihren Modulen.
{
  const levels = defaultGuildConfig('1').levels;
  assert.equal(levels.tagBonusXpPerDay, 0);
  assert.equal(levels.boostBonusEnabled, false);
  assert.equal(levels.boostBonusXpPerBoost, 0);
  assert.equal(levels.boostBonusMaxPerDay, 0);
}
// Level-Up-Kanal: persistentes Info-Embed (Template, Config) + Cleaner-Schutz.
{
  const templates = defaultGuildConfig('1').embeds.templates;
  const info = templates.find((entry) => entry.id === 'level-up-info');
  assert.ok(info, 'level-up-info-Template vorhanden');
  assert.match(info.embed.description, /\/level/);
  const levels = defaultGuildConfig('1').levels;
  assert.equal(levels.levelUpInfoEnabled, false);
  assert.equal(levels.levelUpCleanupEnabled, false);
  assert.equal(levels.levelUpCleanupMaxMessages, 20);
  const cfg = normalizeConfig({ levels: { levelUpInfoEnabled: true, levelUpCleanupEnabled: true, levelUpCleanupMaxMessages: 5 } });
  assert.equal(cfg.levels.levelUpInfoEnabled, true);
  assert.equal(cfg.levels.levelUpCleanupEnabled, true);
  assert.equal(cfg.levels.levelUpCleanupMaxMessages, 5);
  const payload = await _levelInternals.buildLevelUpInfoPayload(cfg, { id: 'g1', name: 'FALLEN HEAVEN' }, cfg.levels);
  assert.ok(Array.isArray(payload.embeds), 'Info-Embed-Payload nutzt embeds (Array), nie embed (singular)');
  assert.match(payload.embeds[0].data.title, /Leveling/);
  assert.match(payload.embeds[0].data.description, /\/level/);
  // Außenbild-Sync-Optionen: frische Datei ersetzt den alten Anhang, Entfernen räumt auf.
  const withFile = await _levelInternals.buildLevelUpInfoPayload(
    cfg, { id: 'g1', name: 'FALLEN HEAVEN' }, cfg.levels,
    { outsideFile: Buffer.from('x'), outsideImageName: 'info.png' }
  );
  assert.equal(withFile.files?.length, 1, 'Außenbild-Datei wird als Anhang gesendet');
  assert.deepEqual(withFile.attachments, [], 'Alter Anhang wird beim Ersetzen geleert');
  const remove = await _levelInternals.buildLevelUpInfoPayload(
    cfg, { id: 'g1', name: 'FALLEN HEAVEN' }, cfg.levels,
    { removeOutsideImage: true }
  );
  assert.deepEqual(remove.attachments, [], 'removeOutsideImage leert Anhänge');
  // Außenbild nach dem Aktivitäts-Liga-Muster: Der gespeicherte Anhang wird
  // beim Bearbeiten per ID referenziert – ohne Download. Bei einem frischen
  // Versand gibt es keine Nachricht zum Referenzieren, daher bleibt das Embed
  // ohne Bild (kein CDN-Download, kein Fehler, keine URL im Text).
  const confirmed = { id: 'att-9', url: 'https://cdn.discordapp.com/attachments/9/9/info.png', name: 'info.png', size: 1234 };
  const cfgWithAttachment = normalizeConfig({ levels: { levelUpInfoEnabled: true }, embeds: { templates: [{ id: 'level-up-info', enabled: true, embed: { title: '💜 Leveling', description: 'Info', color: '#8b82ff', fields: [] }, outsideImageUrl: confirmed.url, outsideImageAttachment: confirmed }] } });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new TextEncoder().encode('PNGDATA').buffer });
  try {
    const fresh = await _levelInternals.buildLevelUpInfoPayload(
      cfgWithAttachment, { id: 'g1', name: 'FALLEN HEAVEN' }, cfgWithAttachment.levels
    );
    assert.deepEqual(fresh.attachments || [], [], 'Frischer Send referenziert keine Anhang-ID');
    assert.equal(fresh.files, undefined, 'Frischer Send lädt NICHT von der CDN-URL (Liga-Muster)');
    assert.equal(String(fresh.content || '').includes(confirmed.url), false, 'Keine sichtbare URL im Content');
    const edit = await _levelInternals.buildLevelUpInfoPayload(
      cfgWithAttachment, { id: 'g1', name: 'FALLEN HEAVEN' }, cfgWithAttachment.levels,
      { allowAttachmentReference: true }
    );
    assert.deepEqual(edit.attachments, [{ id: 'att-9' }], 'Beim Bearbeiten wird der Anhang referenziert');
    assert.equal(edit.files, undefined, 'Beim Bearbeiten wird kein Bild neu hochgeladen');
  } finally {
    globalThis.fetch = originalFetch;
  }
  // Auch bei Download-Fehler: kein Fehlerwurf, kein URL-Link im Text – das Bild
  // wird schlicht weggelassen (Liga-Verhalten, „dreht sich nicht im Kreis“).
  const originalFetch2 = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('offline'); };
  try {
    const offline = await _levelInternals.buildLevelUpInfoPayload(
      cfgWithAttachment, { id: 'g1', name: 'FALLEN HEAVEN' }, cfgWithAttachment.levels
    );
    assert.equal(offline.files, undefined, 'Offline: kein Download-Versuch (Liga-Muster)');
    assert.deepEqual(offline.attachments || [], [], 'Offline: keine Anhang-Referenz beim Frischversand');
    assert.equal(String(offline.content || '').includes(confirmed.url), false, 'Offline: keine URL im Text');
  } finally {
    globalThis.fetch = originalFetch2;
  }
}
// Kanal-Info-Embed: saveLevelUpInfoDesign speichert + aktualisiert die Live-Nachricht sofort.
{
  let sent = 0;
  let edited = 0;
  let currentMessage = null;
  const channelId = 'info-chan';
  const makeMessage = (id) => ({
    id,
    channelId,
    editable: true,
    attachments: { first: () => ({ id: 'att-' + id, url: 'https://cdn.discordapp.com/attachments/9/9/info.png', name: 'info.png', size: 1234 }) },
    edit: async () => { edited += 1; return currentMessage; }
  });
  const channel = {
    id: channelId,
    isTextBased: () => true,
    isThread: () => false,
    permissionsFor: () => ({ has: () => true }),
    messages: {
      fetch: async (arg) => {
        if (typeof arg === 'string') return currentMessage?.id === arg ? currentMessage : null;
        if (arg?.force) return currentMessage?.id === arg.message ? currentMessage : null;
        return currentMessage;
      }
    },
    send: async () => { sent += 1; currentMessage = makeMessage('info-msg-' + sent); return currentMessage; }
  };
  const guild = {
    id: 'g5',
    name: 'FALLEN HEAVEN',
    members: { me: { id: 'bot' } },
    channels: { cache: { get: (id) => (id === channelId ? channel : null) }, fetch: async (id) => (id === channelId ? channel : null) }
  };
  const infoTemplate = defaultGuildConfig('1').embeds.templates.find((entry) => entry.id === 'level-up-info');
  const infoTemplatePayload = { content: '', outsideImageUrl: '', outsideImageAttachment: null, embeds: [infoTemplate.embed] };
  const result = await _levelInternals.saveLevelUpInfoDesign({
    guild,
    cfg: normalizeConfig({ levels: { levelUpInfoEnabled: true, levelUpInfoChannelId: channelId } }),
    template: infoTemplatePayload
  });
  assert.equal(result.design.id, 'level-up-info');
  assert.equal(sent, 1, 'Info-Embed wird bei aktivem Modul + Kanal sofort gesendet');
  assert.equal(result.status.action, 'posted', 'Status meldet das gesendete Info-Embed');

  const second = await _levelInternals.saveLevelUpInfoDesign({
    guild,
    cfg: normalizeConfig({ levels: { levelUpInfoEnabled: true, levelUpInfoChannelId: channelId } }),
    template: infoTemplatePayload
  });
  assert.equal(second.status.action, 'updated', 'Beim erneuten Speichern wird die Nachricht bearbeitet');
  assert.equal(edited, 1, 'Bestehende Nachricht wird editiert statt neu gesendet');
  assert.equal(sent, 1, 'Es wird keine zweite Nachricht gesendet');

  // Auto-Enable: Info-Embed war noch nicht aktiv, aber ein Kanal ist gewählt →
  // Speichern aktiviert es und aktualisiert die Nachricht sofort.
  const autoCfg = normalizeConfig({ levels: { levelUpInfoEnabled: false, levelUpInfoChannelId: channelId } });
  const auto = await _levelInternals.saveLevelUpInfoDesign({ guild, cfg: autoCfg, template: infoTemplatePayload });
  assert.equal(auto.status.autoEnabled, true, 'Info-Embed wird beim Speichern automatisch aktiviert');
  assert.equal(auto.status.action, 'updated', 'Nachricht wird beim Auto-Enable aktualisiert');

  // Ohne Kanal: nur speichern – kein falscher Erfolg, Design bleibt erhalten.
  const off = await _levelInternals.saveLevelUpInfoDesign({
    guild,
    cfg: normalizeConfig({ levels: { levelUpInfoEnabled: false } }),
    template: infoTemplatePayload
  });
  assert.equal(off.status.action, 'no-channel', 'Ohne Kanal meldet der Status „no-channel“');
  assert.ok(!off.status.autoEnabled, 'Ohne Kanal wird nicht automatisch aktiviert');
  assert.equal(off.design.id, 'level-up-info', 'Design wird trotzdem gespeichert');

  const noChannel = await _levelInternals.saveLevelUpInfoDesign({
    guild,
    cfg: normalizeConfig({ levels: { levelUpInfoEnabled: true, levelUpInfoChannelId: '' } }),
    template: infoTemplatePayload
  });
  assert.equal(noChannel.status.action, 'no-channel', 'Ohne Kanal meldet der Status „no-channel“');

  // Außenbild ohne Kanal: die lokale Bild-Referenz bleibt im Design erhalten.
  const local = await _localImageStoreInternals.saveLocalImage({ dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', name: 'info-bild.png' });
  const pending = await _levelInternals.saveLevelUpInfoDesign({
    guild,
    cfg: normalizeConfig({ levels: { levelUpInfoEnabled: true, levelUpInfoChannelId: '' } }),
    template: { ...infoTemplatePayload, outsideImageAttachment: local }
  });
  assert.equal(pending.status.action, 'no-channel');
  assert.equal(pending.design.outsideImageAttachment?.localAsset, true, 'Lokale Bild-Referenz bleibt im Design');
}
// Außenbild-Preservation beim erneuten Speichern: passender Anhang bleibt, fremder nicht.
{
  const preserved = _levelInternals.resolveLevelsPanelImagePreservation({
    sourceOutsideImage: 'https://cdn.discordapp.com/attachments/9/9/info.png',
    incomingAttachment: { id: 'a1', url: 'https://cdn.discordapp.com/attachments/9/9/info.png', name: 'info.png', size: 123 },
    previousDesign: null
  });
  assert.equal(preserved.outsideImageAttachment?.id, 'a1', 'Passender Anhang bleibt beim erneuten Speichern erhalten');
  const mismatched = _levelInternals.resolveLevelsPanelImagePreservation({
    sourceOutsideImage: 'https://cdn.discordapp.com/attachments/9/9/neu.png',
    incomingAttachment: { id: 'a1', url: 'https://cdn.discordapp.com/attachments/9/9/alt.png', name: 'alt.png', size: 123 },
    previousDesign: null
  });
  assert.equal(mismatched.outsideImageAttachment, null, 'Fremder Anhang wird nicht übernommen');
}
// Bot-Updates-Modul: Defaults, Normalisierung und {version}-Payload.
{
  const bu = defaultGuildConfig('1').botUpdates;
  assert.equal(bu.enabled, false);
  assert.equal(normalizeConfig({ botUpdates: { enabled: true, channelId: 'c1' } }).botUpdates.channelId, 'c1');
  assert.equal(normalizeConfig({ botUpdates: { enabled: true, channelId: 'c1' } }).botUpdates.enabled, true);
  const conf = _botUpdatesInternals.normalizeBotUpdatesConfig({ enabled: true, channelId: '123', design: null });
  const payload = await _botUpdatesInternals.buildBotUpdatesPayload({ id: 'g1', name: 'FALLEN HEAVEN' }, { botUpdates: conf });
  const fields = payload.embeds[0].toJSON().fields || [];
  // Die erwartete Version aus package.json ableiten statt sie fest zu
  // verdrahten – sonst bricht der Test bei jedem Hauptversionswechsel.
  const { version: appVersion } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.ok(
    payload.embeds[0].data.title.includes('v' + appVersion),
    `Bot-Update-Titel muss die installierte Version v${appVersion} nennen, nicht 3.9.x fest verdrahten.`
  );
  assert.ok(fields.some((field) => field.name === 'Was ist neu'));
  assert.ok(fields.some((field) => field.name === 'Bekannte Probleme'));
  // Update-Zähler: {updateCount} steigt bei jeder Aktualisierung im Titel hoch.
  const countPayload = await _botUpdatesInternals.buildBotUpdatesPayload(
    { id: 'g1', name: 'FALLEN HEAVEN' },
    { botUpdates: _botUpdatesInternals.normalizeBotUpdatesConfig({ enabled: true, channelId: '123', design: null }) },
    { updateCount: 7 }
  );
  assert.match(countPayload.embeds[0].data.title, /Update #7/, 'Update-Nummer erscheint im Titel');
  // Standard-Felder sind echte Inhalte – und leere/Platzhalter-Felder werden ersetzt.
  const freshDesign = _botUpdatesInternals.normalizeBotUpdatesDesign(null);
  const freshValue = String(freshDesign.embed.fields[0]?.value || '');
  assert.match(freshValue, /• \{change1\}/, 'Standard-Update-Feld nutzt offene Changelog-Platzhalter');
  assert.doesNotMatch(freshValue, /\{changeBlock1\}/, 'Standard-Update-Feld enthält keinen undurchsichtigen Change-Block');
  assert.doesNotMatch(freshValue, /\{changelog\}/, 'Standard-Update-Feld enthält kein Changelog-Paket mehr');
  const legacyDesign = _botUpdatesInternals.normalizeBotUpdatesDesign({
    embed: { fields: [{ name: 'Was ist neu', value: '• Fülle dieses Feld im Embed Studio mit den aktuellen Änderungen.' }] }
  });
  assert.match(String(legacyDesign.embed.fields[0]?.value || ''), /• \{change1\}/, 'Legacy-Platzhalter-Felder werden durch offene Changelog-Platzhalter ersetzt');
  const legacyBlockDesign = _botUpdatesInternals.normalizeBotUpdatesDesign({
    embed: { fields: [{ name: 'Was ist neu', value: '{changeBlock1}\n{changeBlock2}' }] }
  });
  assert.equal(String(legacyBlockDesign.embed.fields[0]?.value || ''), '• {change1}\n• {change2}', 'alte Change-Blöcke werden beim Normalisieren geöffnet');
  assert.doesNotMatch(String(legacyDesign.embed.fields[0]?.value || ''), /\{changelog\}/);
  // Changelog: Der Platzhalter wird durch echte Neuerungen der aktuellen Version ersetzt.
  const latest = _botUpdatesInternals.getLatestChangelogEntry();
  assert.ok(latest && Array.isArray(latest.changes) && latest.changes.length > 0, 'Changelog hat echte Einträge');
  const changelogPayload = await _botUpdatesInternals.buildBotUpdatesPayload(
    { id: 'g1', name: 'FALLEN HEAVEN' },
    { botUpdates: _botUpdatesInternals.normalizeBotUpdatesConfig({ enabled: true, channelId: '123', design: null }) }
  );
  const changelogField = changelogPayload.embeds[0].toJSON().fields.find((field) => field.name === 'Was ist neu');
  assert.match(String(changelogField?.value || ''), /\n• /, 'Was-ist-neu zeigt echte Changelog-Punkte');
  assert.ok(!/{changelog}/.test(String(changelogField?.value || '')), 'Changelog-Platzhalter ist aufgelöst');
  const customDesign = _botUpdatesInternals.normalizeBotUpdatesDesign({
    embed: { fields: [{ name: 'Eigene Zeile', value: 'Eigener Inhalt', inline: false }] }
  });
  assert.equal(customDesign.embed.fields[0].name, 'Eigene Zeile', 'Eigene Felder bleiben erhalten');
  // Außenbild: gespeichertes Attachment wird beim nächsten Panel-Update erhalten.
  // Beim Bearbeiten (allowAttachmentReference) wird die Anhang-ID referenziert –
  // bei einem frischen Versand NIE (Discord antwortet sonst mit 400).
  const attPayload = await _botUpdatesInternals.buildBotUpdatesPayload(
    { id: 'g1', name: 'FALLEN HEAVEN' },
    { botUpdates: { enabled: true, channelId: '123', design: _botUpdatesInternals.normalizeBotUpdatesDesign({
      embed: { title: 'X' },
      outsideImageAttachment: { id: 'att1', url: 'https://cdn/x.png', name: 'x.png', size: 10 }
    }) } },
    { allowAttachmentReference: true }
  );
  assert.deepEqual(attPayload.attachments, [{ id: 'att1' }], 'Legacy-Anhang bleibt beim Bearbeiten erhalten (bis zur Migration)');
  assert.ok(!String(attPayload.content || '').includes('https://'), 'Legacy-Attachment-URL wird nicht als Text doppelt angehängt');
  // Frischer Versand (Liga-Muster): Das Bild wird NICHT von der CDN-URL neu
  // geladen – es bleibt ohne Anhang, ohne Link, ohne Fehler. Erst beim nächsten
  // Bearbeiten wird die gespeicherte Anhang-ID referenziert.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new TextEncoder().encode('PNGDATA').buffer });
  try {
    const attFresh = await _botUpdatesInternals.buildBotUpdatesPayload(
      { id: 'g1', name: 'FALLEN HEAVEN' },
      { botUpdates: { enabled: true, channelId: '123', design: _botUpdatesInternals.normalizeBotUpdatesDesign({
        embed: { title: 'X' },
        outsideImageUrl: 'https://cdn/x.png',
        outsideImageAttachment: { id: 'att1', url: 'https://cdn/x.png', name: 'x.png', size: 10 }
      }) } }
    );
    assert.deepEqual(attFresh.attachments || [], [], 'Frischer Versand referenziert keine Anhang-ID');
    assert.equal(attFresh.files, undefined, 'Frischer Versand lädt NICHT von der CDN-URL (Liga-Muster)');
    assert.ok(!String(attFresh.content || '').includes('https://'), 'Keine sichtbare URL im Content des frischen Versands');
  } finally {
    globalThis.fetch = originalFetch;
  }
  // Anker-Modus (Liga-Muster): kein Attachment-Link am Panel und KEINE URL im
  // Content – das migrierte Bild wird schlicht weggelassen (kein Download, kein
  // Fehler, kein hässlicher Link).
  const originalFetch3 = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('offline'); };
  try {
    const anchored = await _botUpdatesInternals.buildBotUpdatesPayload(
      { id: 'g1', name: 'FALLEN HEAVEN' },
      { botUpdates: { enabled: true, channelId: '123', design: _botUpdatesInternals.normalizeBotUpdatesDesign({
        embed: { title: 'X' },
        outsideImageUrl: 'https://cdn.discordapp.com/attachments/1/2/leveln.png',
        outsideImageAttachment: {
          id: 'att1', url: 'https://cdn.discordapp.com/attachments/1/2/leveln.png', name: 'leveln.png', size: 10,
          anchored: true, channelId: 'a1', messageId: 'm1'
        }
      }) } }
    );
    assert.equal(anchored.files, undefined, 'Anker-Modus: kein Download (Liga-Muster)');
    assert.deepEqual(anchored.attachments || [], [], 'Anker-Modus: keine Anhang-Referenz beim Frischversand');
    assert.ok(!String(anchored.content || '').includes('https://'), 'Anker-Modus: keine URL im Content');
  } finally {
    globalThis.fetch = originalFetch3;
  }
}
// Lokal End-to-End: Ein hochgeladenes Bild wird als normaler Discord-Anhang auf
// die Panel-Nachricht gelegt – es wird KEIN Kanal angelegt, kein Anker.
{
  let panelSent = 0;
  const panelChannel = {
    id: 'panel-1',
    isTextBased: () => true,
    isThread: () => false,
    permissionsFor: () => ({ has: () => true }),
    messages: { fetch: async () => null },
    send: async (payload) => {
      panelSent += 1;
      return {
        id: 'panel-msg-' + panelSent,
        channelId: 'panel-1',
        editable: true,
        attachments: { first: () => ({ id: 'att-panel-' + panelSent, url: 'https://cdn.discordapp.com/attachments/9/9/leveln.png', name: String(payload.files?.[0]?.name || 'banner.png'), size: 4 }) },
        edit: async () => null
      };
    }
  };
  const channelsCache = {
    get: (id) => (id === 'panel-1' ? panelChannel : null),
    find: () => null
  };
  const guild = {
    id: 'g2',
    name: 'FALLEN HEAVEN',
    members: { me: { id: 'bot', permissions: { has: () => true } } },
    roles: { everyone: { id: '0' } },
    channels: { cache: channelsCache, fetch: async (id) => channelsCache.get(id) },
    emojis: { fetch: async () => null }
  };
  const cfg = { botUpdates: { enabled: true, channelId: 'panel-1', design: null } };
  const baseDesign = _botUpdatesInternals.normalizeBotUpdatesDesign(null);
  const result = await _botUpdatesInternals.saveBotUpdatesDesign({
    guild,
    cfg,
    channelId: 'panel-1',
    template: {
      ...baseDesign,
      outsideImageUrl: 'data:image/png;base64,AAAA',
      outsideImageName: 'LEVELN-Banner.png'
    }
  });
  assert.equal(panelSent, 1, 'Panel wird gesendet');
  assert.equal(result.design.outsideImageAttachment?.anchored, undefined, 'Kein Anker-Flag – Bild liegt als normaler Discord-Anhang am Panel');
  assert.equal(result.design.outsideImageUrl, 'https://cdn.discordapp.com/attachments/9/9/leveln.png', 'Serielle Attachment-URL gespeichert');
  assert.equal(result.status.action, 'posted', 'Status meldet das gesendete Panel');
}
// Lokale Bild-Referenz (localAsset): Das Studio lädt das Bild einmal auf den
// PC, der Bot liest die Datei und legt sie als Anhang aufs Panel – ohne Kanal,
// ohne Data-URL-Roundtrip. Nach Erfolg wird die lokale Datei aufgeräumt.
{
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const saved = await _localImageStoreInternals.saveLocalImage({ dataUrl: 'data:image/png;base64,' + png.toString('base64'), name: 'LEVELN-Banner.png' });
  assert.equal(saved.localAsset, true, 'Bild wird lokal auf dem PC gespeichert');
  assert.ok(saved.id, 'lokale ID vergeben');

  let panelSent = 0;
  const panelChannel = {
    id: 'panel-4',
    isTextBased: () => true,
    isThread: () => false,
    permissionsFor: () => ({ has: () => true }),
    messages: { fetch: async () => null },
    send: async (payload) => {
      panelSent += 1;
      return {
        id: 'panel-msg-4',
        channelId: 'panel-4',
        editable: true,
        attachments: { first: () => ({ id: 'att-4', url: 'https://cdn.discordapp.com/attachments/9/9/leveln.png', name: String(payload.files?.[0]?.name || 'banner.png'), size: png.length }) },
        edit: async () => null
      };
    }
  };
  const channelsCache = {
    get: (id) => (id === 'panel-4' ? panelChannel : null),
    find: () => null
  };
  const guild = {
    id: 'g5',
    name: 'FALLEN HEAVEN',
    members: { me: { id: 'bot', permissions: { has: () => true } } },
    roles: { everyone: { id: '0' } },
    channels: { cache: channelsCache, fetch: async (id) => channelsCache.get(id) }
  };
  const result = await _botUpdatesInternals.saveBotUpdatesDesign({
    guild,
    cfg: { botUpdates: { enabled: true, channelId: 'panel-4', design: null } },
    channelId: 'panel-4',
    template: {
      ..._botUpdatesInternals.normalizeBotUpdatesDesign(null),
      outsideImageUrl: '',
      outsideImageAttachment: saved
    }
  });
  assert.equal(panelSent, 1, 'Panel mit lokalem Bild gesendet');
  assert.equal(result.design.outsideImageUrl, 'https://cdn.discordapp.com/attachments/9/9/leveln.png', 'Discord-Attachment-URL gespeichert');
  const leftover = await _localImageStoreInternals.readLocalImage(saved);
  assert.equal(leftover, null, 'Lokale Datei nach erfolgreichem Upload aufgeräumt');
}
// Deaktiviertes Modul + gewählter Kanal → Panel wird trotzdem sofort gesendet
// („Kanal gewählt → Modul an“) und der Kanal landet in der Config.
{
  let panelSent = 0;
  const panelChannel = {
    id: 'panel-2',
    isTextBased: () => true,
    isThread: () => false,
    permissionsFor: () => ({ has: () => true }),
    messages: { fetch: async () => null },
    send: async () => {
      panelSent += 1;
      return { id: 'panel-msg-2', channelId: 'panel-2', editable: true, attachments: { first: () => null }, edit: async () => null };
    }
  };
  const channelsCache = {
    get: (id) => (id === 'panel-2' ? panelChannel : null),
    find: () => null
  };
  const guild = {
    id: 'g3',
    name: 'FALLEN HEAVEN',
    members: { me: { id: 'bot', permissions: { has: () => true } } },
    roles: { everyone: { id: '0' } },
    channels: { cache: channelsCache, fetch: async (id) => channelsCache.get(id) }
  };
  const result = await _botUpdatesInternals.saveBotUpdatesDesign({
    guild,
    cfg: { botUpdates: { enabled: false, channelId: '', design: null } },
    channelId: 'panel-2',
    template: _botUpdatesInternals.normalizeBotUpdatesDesign(null)
  });
  assert.equal(panelSent, 1, 'Panel wird gesendet, obwohl das Modul vorher aus war');
  assert.equal(result.channelId, 'panel-2', 'Gewählter Kanal wird zurückgegeben');
  assert.equal(result.status.action, 'posted', 'Status meldet das gesendete Panel');
}
// Levelrollen-Panel: gewählter Kanal reicht – Panel wird auch bei deaktiviertem
// Leveling-Modul gesendet („Kanal gewählt → Panel an“). Status trägt den Grund.
{
  let panelSent = 0;
  const panelChannel = {
    id: 'panel-3',
    isTextBased: () => true,
    isThread: () => false,
    permissionsFor: () => ({ has: () => true }),
    messages: { fetch: async () => null },
    send: async () => {
      panelSent += 1;
      return { id: 'panel-msg-3', channelId: 'panel-3', editable: true, attachments: { first: () => null }, edit: async () => null };
    }
  };
  const channelsCache = {
    get: (id) => (id === 'panel-3' ? panelChannel : null),
    find: () => null
  };
  const guild = {
    id: 'g4',
    name: 'FALLEN HEAVEN',
    members: { me: { id: 'bot', permissions: { has: () => true } } },
    roles: { everyone: { id: '0' } },
    channels: { cache: channelsCache, fetch: async (id) => channelsCache.get(id) }
  };
  const baseConfig = normalizeConfig({ levels: { enabled: false, levelRolesPanelChannelId: '', panelDesign: null } });
  const result = await _levelInternals.saveLevelsPanelDesign({
    guild,
    cfg: baseConfig,
    template: {
      ..._levelInternals.defaultLevelsPanelDesign(),
      channelId: 'panel-3',
      embed: _levelInternals.defaultLevelsPanelDesign().embed
    }
  });
  assert.equal(panelSent, 1, 'Levelrollen-Panel wird bei gewähltem Kanal gesendet (Modul aus)');
  assert.equal(result.channelId, 'panel-3', 'Kanal wird zurückgegeben');
  assert.equal(result.status.action, 'posted', 'Status meldet das gesendete Panel');

  const noChannel = await _levelInternals.saveLevelsPanelDesign({
    guild,
    cfg: baseConfig,
    template: { ..._levelInternals.defaultLevelsPanelDesign(), channelId: '' }
  });
  assert.equal(noChannel.status.action, 'no-channel', 'Ohne Kanal meldet der Status „no-channel“');
}
// Bot-Updates-Panel: Reparatur-Lauf ohne Zähler-Bump, Neupost bei fehlendem Embed.
{
  let sent = 0;
  let edited = 0;
  let currentMessage = null;
  const channelId = 'chan-1';
  const makeMessage = (id) => ({
    id,
    channelId,
    editable: true,
    attachments: { first: () => null },
    edit: async () => { edited += 1; return currentMessage; }
  });
  const channel = {
    id: channelId,
    isTextBased: () => true,
    isThread: () => false,
    permissionsFor: () => ({ has: () => true }),
    messages: {
      fetch: async (arg) => {
        if (!currentMessage) return null;
        if (typeof arg === 'string') return currentMessage.id === arg ? currentMessage : null;
        return currentMessage;
      }
    },
    send: async () => { sent += 1; currentMessage = makeMessage('msg-' + sent); return currentMessage; }
  };
  const guild = {
    id: 'g1',
    name: 'FALLEN HEAVEN',
    members: { me: { id: 'bot' } },
    channels: { cache: { get: (id) => (id === channelId ? channel : null) } }
  };
  const cfg = { botUpdates: { enabled: true, channelId, design: _botUpdatesInternals.normalizeBotUpdatesDesign(null) } };

  const first = await _botUpdatesInternals.ensureBotUpdatesPanel({ guild, cfg });
  assert.equal(first.action, 'posted');
  assert.equal(first.updateCount, 1, 'Erstpost startet bei #1');
  assert.equal(sent, 1);

  const second = await _botUpdatesInternals.ensureBotUpdatesPanel({ guild, cfg });
  assert.equal(second.action, 'updated');
  assert.equal(second.updateCount, 2, 'Normales Update erhöht den Zähler');
  assert.equal(edited, 1);
  assert.equal(sent, 1, 'Update editiert, postet nicht neu');

  const repairOk = await _botUpdatesInternals.ensureBotUpdatesPanel({ guild, cfg, options: { repair: true } });
  assert.equal(repairOk.action, 'ok');
  assert.equal(repairOk.updateCount, 2, 'Reparatur bei vorhandenem Embed bumpst nicht');
  assert.equal(edited, 1, 'Reparatur editiert nicht, wenn das Embed da ist');

  currentMessage = null; // Embed wurde im Kanal gelöscht
  const repairPost = await _botUpdatesInternals.ensureBotUpdatesPanel({ guild, cfg, options: { repair: true } });
  assert.equal(repairPost.action, 'posted', 'Fehlendes Embed wird automatisch neu gepostet');
  assert.equal(repairPost.updateCount, 2, 'Reparatur-Neupost erhöht den Zähler NICHT');
  assert.equal(sent, 2);

  const runtime = _botUpdatesInternals.ensureBotUpdatesRuntime(guild);
  _botUpdatesInternals.startBotUpdatesRuntime(runtime, cfg);
  assert.ok(runtime.repairTimer, 'Reparatur-Timer läuft');
  _botUpdatesInternals.stopBotUpdatesRuntime(runtime);
  assert.equal(runtime.repairTimer, null, 'Timer wird sauber gestoppt');
}
// Level-Up-Embed ist im Embed Studio bearbeitbar (Modul-Karte + Studio-Verdrahtung).
assert.match(appSource, /data-levels-open-up-studio/);
assert.match(levelsPanelSource, /async function saveLevelUpStudioTemplate/);
assert.match(levelsPanelSource, /specialTemplate: 'levelUp'/);
assert.match(levelsPanelSource, /announceChannelId:\s*String\(template\.channelId/, 'Level-Up-Studio muss die Kanalwahl als announceChannelId speichern.');
assert.match(levelsPanelSource, /levelUpInfoStudioTemplate[\s\S]*levelUpInfoChannelId/, 'Level-Up-Info-Studio muss den gespeicherten Level-Up-Info-Kanal wieder laden.');
assert.match(appSource, /levelUpInfoActive[\s\S]*rulesChatFieldText[\s\S]*rulesVoiceFieldText/, 'Level-Up-Info-Studio muss Regel-Platzhalter als Chips anbieten.');
assert.match(appSource, /loadStudioTemplate\(levelUpInfoStudioTemplate\(state\.config \|\| \{\}\)\)/, 'Level-Up-Info-Standard laden darf die gespeicherten Level-Settings nicht verlieren.');
// Panel sendet Rollen-Mentions: allowedMentions erlaubt Rollen-Parsing (kein @everyone/@here).
const levelsSource = fs.readFileSync(new URL('../src/features/levels.js', import.meta.url), 'utf8');
assert.match(levelsSource, /allowedMentions: \{ parse: \['roles'\] \}/);
assert.match(levelsSource, /replaceAll\('\{rulesChatFieldText\}'/, 'Level-Up-Info muss Regel-Textplatzhalter beim Senden ersetzen.');
assert.match(levelsSource, /replaceAll\('\{rulesVoiceFieldText\}'/, 'Level-Up-Info muss Voice-Regelplatzhalter beim Senden ersetzen.');

// NO-XP-Toggle am Levelrollen-Panel + Wipe + manuelles Level-Setzen.
{
  const makeGuild = (roleEntries) => {
    const guild = {
      id: 'g1',
      roles: {
        cache: new Map(roleEntries.map(([id, name]) => [id, { id, name, managed: false, editable: true, position: 1 }]))
      },
      members: {
        me: { id: 'bot', permissions: { has: () => true }, roles: { highest: { position: 99 } } },
        // freshMember erwartet einen Fehler, um auf das übergebene Member-Objekt zurückzufallen.
        fetch: async () => { throw new Error('mock-fetch'); }
      }
    };
    return guild;
  };
  const makeMember = (guild, id, roleIds = []) => {
    const member = {
      id,
      user: { id, bot: false },
      guild,
      manageable: true,
      roles: {
        cache: new Map(roleIds.map((roleId) => [roleId, { id: roleId }])),
        add: async (toAdd) => { for (const roleId of toAdd) member.roles.cache.set(roleId, { id: roleId }); return member; },
        remove: async (toRemove) => { for (const roleId of toRemove) member.roles.cache.delete(roleId); return member; }
      }
    };
    return member;
  };
  const conf = {
    levelCurveBase: 20,
    levelRoleMappings: [{ level: 1, roleId: '111' }, { level: 2, roleId: '222' }],
    noXpRoleIds: ['333']
  };
  const guild = makeGuild([['111', 'Asche-Engel'], ['222', 'Silber-Engel'], ['333', 'NO-XP']]);

  // Navigation: NO-XP-Button nur, wenn eine NO-XP-Rolle konfiguriert ist.
  const navPlain = _levelInternals.buildLevelsPanelNavigation().components.map((button) => button.data.custom_id);
  assert.deepEqual(navPlain, ['fh-levels:rules']);
  const navWithNoXp = _levelInternals.buildLevelsPanelNavigation({ noXpRoleIds: ['333'] }).components.map((button) => button.data.custom_id);
  assert.deepEqual(navWithNoXp, ['fh-levels:rules', 'fh-levels:no-xp']);

  // NO-XP aktivieren: Level-Rolle weg, NO-XP-Rolle dazu.
  const member = makeMember(guild, 'u1', ['111']);
  const on = await _levelInternals.toggleNoXpRole({ guild, member, conf });
  assert.equal(on.ok, true);
  assert.equal(on.active, true);
  assert.ok(member.roles.cache.has('333'), 'NO-XP-Rolle wurde vergeben');
  assert.ok(!member.roles.cache.has('111') && !member.roles.cache.has('222'), 'Level-Rollen wurden entnommen');

  // NO-XP deaktivieren: NO-XP-Rolle weg, Level-Rolle nach aktuellem Level zurück.
  const off = await _levelInternals.toggleNoXpRole({ guild, member, conf });
  assert.equal(off.ok, true);
  assert.equal(off.active, false);
  assert.ok(!member.roles.cache.has('333'), 'NO-XP-Rolle wurde entfernt');

  // Wipe: entfernt alle Level-Rollen von allen Mitgliedern.
  const g2 = makeGuild([['111', 'Asche-Engel'], ['222', 'Silber-Engel']]);
  const m1 = makeMember(g2, 'a', ['111', '222']);
  const m2 = makeMember(g2, 'b', ['111']);
  const m3 = makeMember(g2, 'c', []);
  // fetch() ohne Argument = alle Mitglieder; mit user-Argument = „frisch holen“
  // (wirft, damit der Rollendienst auf das vorhandene Member-Objekt zurückfällt).
  g2.members.fetch = async (args) => {
    if (args) throw new Error('mock-fresh');
    return new Map([['a', m1], ['b', m2], ['c', m3]]);
  };
  const wiped = await _levelInternals.wipeLevelRoles(g2, { levels: { levelRoleMappings: conf.levelRoleMappings } });
  assert.equal(wiped.ok, true);
  assert.equal(wiped.removed, 3, 'Wipe entfernt alle 3 Level-Rollen');
  assert.equal(wiped.members, 2, '2 Mitglieder hatten Level-Rollen');
  assert.equal(wiped.blockedCount, 0);
  assert.equal(wiped.hadErrors, false);
  assert.equal(m1.roles.cache.size, 0);
  assert.equal(m2.roles.cache.size, 0);
  assert.equal(m3.roles.cache.size, 0);

  // Wipe mit blockierter Rolle (über der höchsten Bot-Rolle): ehrliche Meldung,
  // nur wirklich Entfernbares wird entfernt.
  const g4 = makeGuild([['111', 'Asche-Engel'], ['222', 'Silber-Engel']]);
  g4.roles.cache.get('111').position = 150; // über der höchsten Bot-Rolle (99)
  const m4 = makeMember(g4, 'd', ['111']);
  const m5 = makeMember(g4, 'e', ['222']);
  g4.members.fetch = async () => new Map([['d', m4], ['e', m5]]);
  const partial = await _levelInternals.wipeLevelRoles(g4, { levels: { levelRoleMappings: conf.levelRoleMappings } });
  assert.equal(partial.removed, 1, 'Nur die entfernbare Rolle wird entfernt');
  assert.ok(m4.roles.cache.has('111'), 'Blockierte Rolle bleibt (kann der Bot nicht entfernen)');
  assert.ok(!m5.roles.cache.has('222'), 'Entfernbare Rolle wurde entfernt');
  assert.equal(partial.blockedCount, 1, 'Blockierte Rolle wird gemeldet');
  assert.equal(partial.hadErrors, true);

  // Wipe bei komplett blockierten Rollen: kein falscher Erfolg.
  const g6 = makeGuild([['111', 'Asche-Engel']]);
  g6.roles.cache.get('111').position = 150;
  const m7 = makeMember(g6, 'h', ['111']);
  g6.members.fetch = async () => new Map([['h', m7]]);
  const allBlocked = await _levelInternals.wipeLevelRoles(g6, { levels: { levelRoleMappings: conf.levelRoleMappings } });
  assert.equal(allBlocked.ok, false, 'Wenn nichts entfernt werden kann, ist der Wipe kein Erfolg');
  assert.equal(allBlocked.reason, 'nothing-removed');
  assert.ok(m7.roles.cache.has('111'), 'Blockierte Rolle bleibt');

  // Wipe mit Discord-Rate-Limit: Retry mit Backoff, danach echter Erfolg.
  const g5 = makeGuild([['111', 'Asche-Engel']]);
  const m6 = makeMember(g5, 'f', ['111']);
  let attempts = 0;
  m6.roles.remove = async function (toRemove) {
    attempts += 1;
    if (attempts === 1) {
      const error = new Error('You are being rate limited.');
      error.status = 429;
      error.rateLimited = true;
      error.retryAfter = 1;
      throw error;
    }
    for (const roleId of toRemove) m6.roles.cache.delete(roleId);
    return m6;
  };
  g5.members.fetch = async () => new Map([['f', m6]]);
  const retried = await _levelInternals.wipeLevelRoles(g5, { levels: { levelRoleMappings: conf.levelRoleMappings } });
  assert.equal(retried.removed, 1, 'Rate-Limit wird abgewartet und die Rolle trotzdem entfernt');
  assert.equal(attempts, 2, 'Genau ein Retry nach dem Rate-Limit');
  assert.ok(!m6.roles.cache.has('111'), 'Rolle wurde nach dem Retry entfernt');

  // Manuelles Level-Setzen: XP auf Kurve + passende Level-Rolle vergeben.
  const g3 = makeGuild([['111', 'Asche-Engel'], ['222', 'Silber-Engel']]);
  const setMember = makeMember(g3, 'u9', []);
  const setResult = await _levelInternals.setMemberLevel({
    guild: g3,
    member: setMember,
    cfg: { levels: { levelCurveBase: 20, levelRoleMappings: conf.levelRoleMappings } },
    level: 2
  });
  assert.equal(setResult.ok, true);
  assert.equal(setResult.level, 2);
  assert.equal(setResult.xp, _levelInternals.xpForLevel(2, 20));
  assert.ok(setMember.roles.cache.has('222'), 'Rolle für Level 2 vergeben');
  const profile = await _levelInternals.getLevelProfileSnapshot('g1', 'u9');
  assert.equal(profile.level, 2, 'Profil-Level wurde dauerhaft gesetzt');
}

// Bot-Updates: Blätter-Knöpfe durch die echten Changelog-Einträge.
{
  const entries = _botUpdatesInternals.CHANGELOG_ENTRIES;
  assert.ok(entries.length >= 2, 'Changelog hat mehrere echte Einträge');
  assert.ok(entries[0].changes?.length > 0, 'Neuester Eintrag hat echte Punkte');
  const versions = entries.map((entry) => entry.version);
  // Numerisch absteigend vergleichen — String-Sortierung versagt ab 3.9.100
  // ("3.9.99" < "3.9.100" als Text).
  const numericDesc = [...versions].sort((a, b) => {
    const pa = String(a).split('.').map(Number);
    const pb = String(b).split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const da = pa[i] || 0;
      const db = pb[i] || 0;
      if (da !== db) return db - da;
    }
    return 0;
  });
  assert.deepEqual(versions, numericDesc, 'Changelog ist absteigend sortiert (neueste zuerst)');
  // Nav: an den Rändern deaktiviert, dazwischen aktiv.
  const first = _botUpdatesInternals.botUpdatesNavigation(0, entries.length).components.map((b) => ({ id: b.data.custom_id, disabled: b.data.disabled }));
  assert.deepEqual(first, [
    { id: 'fh-updates:prev', disabled: false },
    { id: 'fh-updates:next', disabled: true }
  ]);
  const last = _botUpdatesInternals.botUpdatesNavigation(entries.length - 1, entries.length).components.map((b) => ({ id: b.data.custom_id, disabled: b.data.disabled }));
  assert.deepEqual(last, [
    { id: 'fh-updates:prev', disabled: true },
    { id: 'fh-updates:next', disabled: false }
  ]);
  assert.equal(_botUpdatesInternals.botUpdatesNavigation(0, 1).components.length, 0, 'Ein Eintrag: keine Blätter-Knöpfe');
  // Blätter-Button-Labels sind editierbare Vorlagen (3.9.222-Prinzip).
  const customNav = _botUpdatesInternals.botUpdatesNavigation(0, entries.length, { prevButtonLabel: 'Vorherige', nextButtonLabel: 'Nächste' }, 'FALLEN HEAVEN')
    .components.map((b) => b.data.label);
  assert.deepEqual(customNav, ['Vorherige', 'Nächste'], 'Blätter-Button-Labels editierbar');
  const guildNav = _botUpdatesInternals.botUpdatesNavigation(0, entries.length, { prevButtonLabel: 'Älter · {guild}', nextButtonLabel: 'Neuer' }, 'FH-Test')
    .components.map((b) => b.data.label);
  assert.deepEqual(guildNav, ['Älter · FH-Test', 'Neuer'], '{guild}-Platzhalter in Blätter-Label ersetzt');
  // Payload trägt die Blätter-Knöpfe und zeigt auf Wunsch eine ältere Version.
  const conf = _botUpdatesInternals.normalizeBotUpdatesConfig({ enabled: true, channelId: '123', design: null });
  const payload = await _botUpdatesInternals.buildBotUpdatesPayload({ id: 'g1', name: 'FALLEN HEAVEN' }, { botUpdates: conf });
  const ids = (payload.components || []).flatMap((row) => row.components.map((button) => button.data.custom_id));
  assert.ok(ids.includes('fh-updates:prev') && ids.includes('fh-updates:next'), 'Update-Panel hat Blätter-Knöpfe');
  const older = await _botUpdatesInternals.buildBotUpdatesPayload(
    { id: 'g1', name: 'FALLEN HEAVEN' },
    { botUpdates: conf },
    { version: entries[1].version, pageIndex: 1 }
  );
  assert.match(older.embeds[0].data.title, new RegExp(entries[1].version), 'Ältere Version wird angezeigt');
}

// Außenbild für Template-Embeds: lokal gespeichertes Bild wird als Anhang
// aufgelöst und die Config-Normalisierung behält Außenbild + lokale Referenz.
{
  const resolve = _localImageStoreInternals.resolveOutsideImagePayload;
  // CDN-URL ohne Download-Möglichkeit → klarer Fehler statt Content-Zeile:
  // ein Link im Nachrichtentext wäre der hässliche Link.
  const originalFetch0 = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('offline'); };
  try {
    await assert.rejects(
      resolve({ outsideImageUrl: 'https://cdn.discordapp.com/attachments/1/2/leveln.png' }),
      /Außenbild|geladen/,
      'CDN-URL ohne Download muss einen klaren Fehler werfen.'
    );
  } finally {
    globalThis.fetch = originalFetch0;
  }
  // Bereits hochgeladener Discord-Anhang → wird NUR beim Bearbeiten referenziert.
  const legacy = await resolve({ outsideImageAttachment: { id: 'att1', url: 'https://cdn/x.png', name: 'x.png', size: 10 }, allowAttachmentReference: true });
  assert.deepEqual(legacy.attachments, [{ id: 'att1' }]);
  // Frischer Versand → keine Anhang-Referenz (Discord antwortet sonst mit 400):
  // das Bild wird von der CDN-URL neu geladen; ohne Download klarer Fehler.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('offline'); };
  try {
    await assert.rejects(
      resolve({ outsideImageUrl: 'https://cdn/x.png', outsideImageAttachment: { id: 'att1', url: 'https://cdn/x.png', name: 'x.png', size: 10 } }),
      /Außenbild|geladen/,
      'Ohne Download muss ein klarer Fehler geworfen werden statt URL im Text.'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  // Lokal gespeichertes Bild → wird als echter Discord-Anhang (files) aufgelöst.
  const saved = await _localImageStoreInternals.saveLocalImage({
    dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    name: 'leveln.png'
  });
  assert.equal(saved.localAsset, true);
  const local = await resolve({ outsideImageAttachment: saved });
  assert.ok(Array.isArray(local.files) && local.files.length === 1, 'lokales Außenbild wird als Anhang aufgelöst');
  assert.ok(Buffer.isBuffer(local.files[0].attachment) && local.files[0].attachment.length > 0);
  // „Mit Bot senden“: localAsset muss vor dem Payload-Bau zu einer Data-URL
  // materialisiert werden – sonst wird das gewählte Außenbild still verworfen.
  const materialized = await _localImageStoreInternals.materializeOutsideImageTemplate({
    outsideImageUrl: '',
    outsideImageName: '',
    outsideImageAttachment: saved
  });
  assert.ok(String(materialized.outsideImageUrl || '').startsWith('data:image/png;base64,'), 'localAsset wird zu einer Data-URL aufgelöst');
  const decoded = Buffer.from(String(materialized.outsideImageUrl).split(',')[1] || '', 'base64');
  assert.ok(decoded.length > 0 && decoded.length === saved.size, 'Materialisierte Data-URL entspricht der Originaldatei');
  assert.equal(materialized.outsideImageName, saved.name, 'Dateiname bleibt erhalten');
  assert.equal(materialized.removeOutsideImage, false);
  // Ohne localAsset: Template bleibt unverändert.
  const untouched = await _localImageStoreInternals.materializeOutsideImageTemplate({ outsideImageUrl: 'https://cdn/x.png', outsideImageAttachment: null });
  assert.equal(untouched.outsideImageUrl, 'https://cdn/x.png');
  // Unbekannte lokale Datei: ehrlicher Fehler statt stillem Verlust.
  await assert.rejects(
    () => _localImageStoreInternals.materializeOutsideImageTemplate({
      outsideImageUrl: '',
      outsideImageAttachment: { localAsset: true, id: 'gibt-es-nicht', name: 'x.png', mime: 'image/png' }
    }),
    /nicht gefunden/,
    'Fehlende lokale Datei wirft einen klaren Fehler'
  );
  // Config-Normalisierung: Template behält Außenbild + lokale Referenz.
  const withImage = normalizeConfig({
    embeds: {
      templates: [{
        id: 'level-up-info', enabled: true,
        outsideImageUrl: '',
        outsideImageAttachment: { localAsset: true, id: saved.id, name: saved.name, size: saved.size, mime: saved.mime },
        embed: { title: 'T', description: 'D', color: '#f1b84b', fields: [] }
      }]
    }
  }).embeds.templates.find((t) => t.id === 'level-up-info');
  assert.equal(withImage.outsideImageAttachment?.localAsset, true, 'lokale Referenz bleibt in der Config');
  assert.equal(withImage.outsideImageAttachment?.id, saved.id);
  // Legacy: embed.outsideImageUrl wird nach oben gezogen.
  const lifted = normalizeConfig({
    embeds: { templates: [{ id: 'level-up', enabled: true, embed: { title: 'T', outsideImageUrl: 'https://cdn/x.png', fields: [] } }] }
  }).embeds.templates.find((t) => t.id === 'level-up');
  assert.equal(lifted.outsideImageUrl, 'https://cdn/x.png', 'embed.outsideImageUrl wird auf Template-Ebene migriert');
}

// Level-Up-Kanal-Info: neues Fallen-Heaven-Gold-Design.
{
  const templates = defaultGuildConfig('1').embeds.templates;
  const info = templates.find((entry) => entry.id === 'level-up-info');
  assert.ok(info, 'level-up-info-Template vorhanden');
  assert.equal(info.embed.color, '#f1b84b', 'Kanal-Info im FH-Gold');
  assert.match(info.embed.title, /Leveling/);
  assert.match(info.embed.description, /\/level/);
  assert.match(info.embed.description, /\{rulesVoiceFieldName\}/);
  assert.match(info.embed.description, /\{rulesVoiceFieldText\}/);
  assert.match(info.embed.description, /\{rulesCurveFieldText\}/);
  assert.ok(!info.embed.description.includes('{rulesBonusFieldText}'), 'Neuer Standard zeigt keine passiven Level-Boni');
  // Migration: altes Lila-Design wird angehoben.
  const migratedInfo = normalizeConfig({
    embeds: { templates: [{ id: 'level-up-info', enabled: true, embed: { title: '💜 Leveling – so funktioniert es', description: 'alt', color: '#8b82ff', fields: [] } }] }
  }).embeds.templates.find((t) => t.id === 'level-up-info');
  assert.equal(migratedInfo.embed.color, '#f1b84b', 'Alt-Kanal-Info wird auf Gold migriert');
  const migratedGoldInfo = normalizeConfig({
    embeds: { templates: [{ id: 'level-up-info', enabled: true, embed: { title: '🕊️ Leveling – so funktioniert es', description: '**SPRACHCHAT**\nAlter Standard', color: '#f1b84b', fields: [] } }] }
  }).embeds.templates.find((t) => t.id === 'level-up-info');
  assert.match(migratedGoldInfo.embed.description, /\{rulesVoiceFieldText\}/, 'Alter Gold-Standard ohne Platzhalter wird auf Platzhalter-Standard migriert');
  const migratedChatVoiceInfo = normalizeConfig({
    embeds: { templates: [{ id: 'level-up-info', enabled: true, embed: { title: '𑣲 Leveling', description: '𑣲 💬 CHAT-XP 🪽\nAlter Standard\n𑣲 🎙️ VOICE-XP 🪽\n𑣲 📊 LEVEL PRÜFEN 🪽\n𑣲 🚫 NO-XP 🪽', color: '#f1b84b', fields: [] } }] }
  }).embeds.templates.find((t) => t.id === 'level-up-info');
  assert.match(migratedChatVoiceInfo.embed.description, /\{rulesChatFieldText\}/, 'Alter CHAT-XP/VOICE-XP-Standard ohne Platzhalter wird auf Platzhalter-Standard migriert');
}

// ---------------------------------------------------------------------------
// Studio-Außenbild-Vorschau: Die Keep-Logik aus loadStudioTemplate darf die
// frisch gewählte Datei nur bei DERSELBEN lokalen Referenz behalten – sonst
// würde beim Laden anderer Entwürfe ein Geisterbild stehen bleiben.
// (Regression für „Bild außerhalb verschwindet andauernd in der Vorschau“.)
// ---------------------------------------------------------------------------
const normalizeAttachment = (value) => {
  if (!value || typeof value !== 'object') return null;
  const localAsset = value.localAsset === true;
  if (!localAsset && !/^(?:https?:\/\/|data:image\/)/i.test(String(value.url || ''))) return null;
  return { id: String(value.id || ''), url: String(value.url || ''), name: String(value.name || ''), size: Math.max(0, Number(value.size || 0)), localAsset };
};
const computeKeepPreview = (previous, picked, incoming, legacyOutside) => {
  const next = normalizeAttachment(incoming);
  const sameLocalAsset = Boolean(
    previous?.localAsset && next?.localAsset && previous.id && next.id === previous.id
  );
  const keep = Boolean(picked && sameLocalAsset);
  return { keep, outsideValue: legacyOutside || (keep ? picked : '') };
};
const localAssetRef = { localAsset: true, id: 'L1', name: 'banner.png', size: 10, mime: 'image/png' };
const dataUrl = 'data:image/png;base64,AAAA';
{
  // A: Gleiche lokale Referenz nach Save ohne Kanal → Bild bleibt in der Vorschau.
  const r = computeKeepPreview(localAssetRef, dataUrl, localAssetRef, '');
  assert.equal(r.keep, true, 'Gleiche lokale Referenz bleibt sichtbar');
  assert.equal(r.outsideValue, dataUrl, 'Daten-URL bleibt im Hidden-Input');
}
{
  // B: Nach Save mit Kanal kommt ein CDN-Anhang zurück → Vorschau nutzt die URL.
  const cdn = { id: 'att9', url: 'https://cdn.discordapp.com/attachments/9/9/b.png', name: 'b.png', size: 10 };
  const r = computeKeepPreview(localAssetRef, dataUrl, cdn, cdn.url);
  assert.equal(r.keep, false, 'CDN-Anhang ersetzt die lokale Referenz');
  assert.equal(r.outsideValue, cdn.url, 'CDN-URL landet im Hidden-Input');
}
{
  // C: Anderes/kein Bild geladen → alte Daten-URL wird verworfen (kein Geisterbild).
  const r = computeKeepPreview(localAssetRef, dataUrl, null, '');
  assert.equal(r.keep, false, 'Ohne Bild wird zurückgesetzt');
  assert.equal(r.outsideValue, '', 'Hidden-Input bleibt leer');
}

// Panel-Repair-Modus: Nachricht existiert noch → KEIN Edit, kein Payload-Bau.
// Der periodische Timer (alle 10 Minuten) darf das Levelrollen-Panel nicht bei
// jedem Tick neu editieren – nur neu senden, wenn es fehlt.
{
  let editCount = 0;
  const existingPanel = {
    id: 'panel-exists',
    channelId: 'ch-lvl',
    editable: true,
    attachments: { some: () => false },
    edit: async () => { editCount += 1; },
    pin: async () => {}
  };
  const lvlChannel = {
    id: 'ch-lvl',
    isTextBased: () => true,
    isThread: () => false,
    permissionsFor: () => ({ has: () => true }),
    messages: {
      fetch: async (id) => (id === 'panel-exists' ? existingPanel : null),
      cache: { get: () => null }
    },
    send: async () => { throw new Error('Repair-Modus darf nicht neu senden, wenn das Panel existiert'); }
  };
  const lvlGuild = {
    id: 'g-panel-repair',
    name: 'S',
    members: { me: { id: 'bot', permissions: { has: () => true } } },
    roles: { everyone: { id: '0' } },
    channels: { cache: { get: (id) => (id === 'ch-lvl' ? lvlChannel : null) }, fetch: async (id) => (id === 'ch-lvl' ? lvlChannel : null) }
  };
  const lvlCfg = {
    levels: {
      enabled: true,
      levelRolesPanelChannelId: 'ch-lvl',
      panelDesign: { embed: { title: '💯 Leveln' } }
    }
  };
  // Vorhandenes Panel direkt im Store registrieren (Temp-Datenverzeichnis).
  const panelFile = path.join(process.env.FALLEN_HEAVEN_DATA_DIR, 'leveling-panel.json');
  fs.writeFileSync(panelFile, JSON.stringify({ version: 1, guilds: { 'g-panel-repair': { channelId: 'ch-lvl', messageId: 'panel-exists' } } }), 'utf8');
  const runtime = { guild: lvlGuild };
  const result = await _levelInternals.syncLevelRolesPanel(runtime, lvlCfg, { repair: true });
  assert.equal(editCount, 0, 'Repair-Modus editiert das vorhandene Panel NICHT');
  assert.ok(result, 'Repair-Modus liefert das vorhandene Panel zurück');
  console.log('  ✅ Levelrollen-Panel: Repair-Modus editiert vorhandenes Panel nicht');
}

// Regeln-Ansicht (REGELN-Button): editierbare Textbausteine nach 3.9.222-Prinzip.
{
  const rulesGuild = {
    id: 'g-rules',
    name: 'S',
    iconURL: () => null,
    channels: {
      cache: {
        get: () => null
      }
    },
    roles: {
      cache: {
        get: () => null
      }
    }
  };
  const rulesConf = {
    levels: {
      enabled: true,
      xpPerMessageMin: 6,
      xpPerMessageMax: 16,
      minMessageLength: 2,
      cooldownSeconds: 60,
      dailyLimitXp: 0,
      voiceXpPerMinute: 2,
      voiceMinimumParticipants: 2,
      excludeDeafenedVoice: true,
      levelCurveBase: 20,
      activityBonusEnabled: true,
      activityBonusPlace1: 100,
      activityBonusPlace2: 70,
      activityBonusPlace3: 40,
      activityBonusMaxPerDay: 150,
      tagBonusXpPerDay: 0,
      boostBonusEnabled: false,
      panelDesign: { embed: { color: '#8b82ff' } },
      // Eigene editierbare Texte:
      rulesTitle: 'Meine eigenen Regeln',
      rulesChatFieldName: 'CHAT-REGELN',
      rulesChatFieldText: 'Wertung: **{xpMin}–{xpMax} XP** je Nachricht, Limit **{cooldown} s**\n{dailyLimitLine}',
      rulesVoiceFieldName: 'SPRACH-REGELN',
      rulesVoiceFieldText: '**{voiceXp} XP/min**, ab **{voiceMin}** Personen, taub zählt {deafened}',
      rulesActivityFieldName: 'BONUS',
      rulesActivityFieldText: 'Platz 1: **{bonus1}** · Platz 2: **{bonus2}** · Platz 3: **{bonus3}** (max. {bonusMax}/Tag)',
      rulesBonusFieldName: 'EXTRAS',
      rulesBonusFieldText: '{tagBonusLine}{boostBonusLine}Extras-Text',
      rulesCurveFieldName: 'KURVE',
      rulesCurveFieldText: 'Basis {curveBase}',
      rulesFooter: 'Privat-Ansicht · {server}'
    }
  };
  const rulesPayload = await _levelInternals.buildLevelsRulesPayload(rulesGuild, rulesConf.levels);
  const embeds = rulesPayload.embeds || rulesPayload.embed || [];
  const raw = Array.isArray(embeds) ? embeds[0] : embeds;
  const e = raw?.data || raw;
  assert.ok(e, 'Regeln-Ansicht liefert ein Embed');
  assert.equal(e.title, 'Meine eigenen Regeln', 'Regeln-Titel ist editierbar');
  assert.equal(e.footer?.text, 'Privat-Ansicht · S', 'Regeln-Footer ist editierbar inkl. {server}');
  const chatField = e.fields?.find((f) => f.name === 'CHAT-REGELN');
  assert.ok(chatField, 'Regeln-Feldname ist editierbar');
  assert.ok(chatField.value.includes('**5–5 XP**'), 'Legacy-Platzhalter {xpMin}/{xpMax} lösen auf den festen Wert auf');
  assert.ok(chatField.value.includes('Limit **0 s**'), 'Legacy-{cooldown} zeigt korrekt keinen Cooldown');
  assert.ok(chatField.value.includes('Kein Aktivitätslimit'), '{dailyLimitLine} erklärt das No-Limit-System');
  const voiceField = e.fields?.find((f) => f.name === 'SPRACH-REGELN');
  assert.ok(voiceField.value.includes('**2 XP/min**') && voiceField.value.includes('**nicht**'), 'Sprachchat-Text ersetzt {voiceXp}/{deafened}');
  const bonusField = e.fields?.find((f) => f.name === 'BONUS');
  assert.equal(bonusField, undefined, 'Passive Bonusfelder werden im neuen Level-Regel-Embed nicht mehr gezeigt');
  console.log('  ✅ Level-Regeln-Ansicht: Titel, Feldnamen, Texte und Footer sind editierbar (Platzhalter innen)');
}

// Regeln-Ansicht (3.9.229): KEINE Paket-Platzhalter {noXpLines}/{excludedLines}
// mehr – ausgeschriebene Defaults mit einzelnen Platzhaltern.
{
  const guildWithLists = {
    id: 'g-lists',
    name: 'S',
    iconURL: () => null,
    channels: {
      cache: {
        get: (id) => ({ '111': { name: 'spam-chat' }, '222': { name: 'off-topic' } }[String(id)] || null)
      }
    },
    roles: {
      cache: {
        get: (id) => ({ '333': { name: 'No-XP-Rolle' }, '444': { name: 'Moderator' } }[String(id)] || null)
      }
    }
  };
  const listConf = {
    levels: {
      xpPerMessageMin: 6,
      xpPerMessageMax: 16,
      minMessageLength: 2,
      cooldownSeconds: 60,
      dailyLimitXp: 0,
      voiceXpPerMinute: 2,
      voiceMinimumParticipants: 2,
      excludeDeafenedVoice: true,
      levelCurveBase: 20,
      activityBonusEnabled: true,
      noXpRoleIds: ['333'],
      excludedRoleIds: ['444'],
      ignoredChannelIds: ['111', '222']
    }
  };
  const listPayload = _levelInternals.buildLevelsRulesPayload(guildWithLists, listConf.levels);
  const listEmbed = listPayload.embeds[0];
  const noXpField = listEmbed.data.fields.find((f) => f.name === 'NO-XP-ROLLE');
  const excludedField = listEmbed.data.fields.find((f) => f.name === 'AUSGESCHLOSSEN');
  assert.ok(noXpField, 'NO-XP-ROLLE-Feld vorhanden');
  assert.ok(excludedField, 'AUSGESCHLOSSEN-Feld vorhanden');
  assert.ok(noXpField.value.includes('No-XP-Rolle'), 'Einzelner Platzhalter {noXpRoleNames} zeigt Rollennamen');
  assert.ok(!noXpField.value.includes('{noXpLines}'), 'Kein Paket-Platzhalter {noXpLines} mehr im Feldwert');
  assert.ok(excludedField.value.includes('spam-chat, off-topic'), '{excludedChannels} zeigt Kanalnamen');
  assert.ok(excludedField.value.includes('Moderator'), '{excludedRoles} zeigt Rollennamen');
  assert.ok(!excludedField.value.includes('{excludedLines}'), 'Kein Paket-Platzhalter {excludedLines} mehr im Feldwert');
  // Backfill: alte Config mit {noXpLines} wird auf den ausgeschriebenen Default umgestellt.
  const legacyConf = {
    levels: {
      xpPerMessageMin: 6,
      xpPerMessageMax: 16,
      minMessageLength: 2,
      cooldownSeconds: 60,
      dailyLimitXp: 0,
      voiceXpPerMinute: 2,
      voiceMinimumParticipants: 2,
      excludeDeafenedVoice: true,
      levelCurveBase: 20,
      activityBonusEnabled: true,
      noXpRoleIds: ['333'],
      excludedRoleIds: ['444'],
      ignoredChannelIds: ['111', '222'],
      rulesNoXpFieldText: '{noXpLines}',
      rulesExcludedFieldText: '{excludedLines}'
    }
  };
  const legacyPayload = _levelInternals.buildLevelsRulesPayload(guildWithLists, legacyConf.levels);
  const legacyEmbed = legacyPayload.embeds[0];
  const legacyNoXp = legacyEmbed.data.fields.find((f) => f.name === 'NO-XP-ROLLE');
  const legacyExcluded = legacyEmbed.data.fields.find((f) => f.name === 'AUSGESCHLOSSEN');
  assert.ok(legacyNoXp.value.includes('No-XP-Rolle') && legacyNoXp.value.includes('weder im Chat noch im Sprachchat XP'), 'Backfill: {noXpLines} → ausgeschriebener Text mit {noXpRoleNames}');
  assert.ok(legacyExcluded.value.includes('spam-chat, off-topic') && legacyExcluded.value.includes('Moderator'), 'Backfill: {excludedLines} → ausgeschriebener Text mit {excludedChannels}/{excludedRoles}');
  assert.ok(!legacyNoXp.value.includes('{noXpLines}') && !legacyExcluded.value.includes('{excludedLines}'), 'Backfill: keine Paket-Platzhalter mehr');
  console.log('  ✅ Level-Regeln-Ansicht: {noXpLines}/{excludedLines} → einzelne Platzhalter ({noXpRoleNames}/{excludedChannels}/{excludedRoles}) + Backfill');
}

console.log('Leveling-/Autoresponder-Smoke bestanden: No-Limit-Balance, Duplikatschutz, Rollenauswahl, Wortgrenzen, Einzelantwort, Studio-Außenbild-Logik und editierbare Regeln-Ansicht sind verbunden.');
