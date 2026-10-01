import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OverwriteType, PermissionFlagsBits } from 'discord.js';

// TempVoice-State in ein eigenes Temp-Verzeichnis lenken, damit Tests niemals
// echte lokale Daten (z. B. ./data) berühren – daher dynamischer Import.
process.env.FALLEN_HEAVEN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-tempvoice-smoke-'));
const { _tempVoiceInternals, feature: tempVoiceFeature } = await import('../src/features/tempVoice.js');
import { normalizeConfig, featureCards } from '../src/defaultConfig.js';

const {
  normalizeTempVoiceConfig,
  normalizeTempVoiceInterfaceDesign,
  normalizeTempVoiceState,
  getUserProfile,
  setUserProfile,
  deleteUserProfile,
  clearGuildProfiles,
  resolveChannelSettings,
  createTempChannel,
  runCreationSingleFlight,
  parseUserLimit,
  handleLimit,
  showRegionPicker,
  resetOwnerProfile,
  permissionTriState,
  captureAccessBaseline,
  applyAccessMode,
  captureLockBaseline,
  applyLockMode,
  accessDeniedReason,
  channelNameFor,
  safeName,
  interfaceRows,
  interfaceEmbed,
  findOwnedChannel,
  setChannelEntry,
  missingPermissions,
  buildChannelOverwrites,
  handleAnyInteraction,
  handleVoiceStateChange,
  channelMemberOptions,
  blockedMemberOptions,
  deleteTrackedChannel,
  transferOwnership,
  runChannelOperation,
  scheduleCleanup,
  REGIONS,
  PREFIX
} = _tempVoiceInternals;

// --- Config-Normalisierung ---
const conf = normalizeTempVoiceConfig({
  enabled: true,
  creatorChannelIds: ['111', '111', '222'],
  channelNameTemplate: '🎧 {user}',
  defaultUserLimit: 5,
  emptyGraceSeconds: 99999,
  allowTransfer: false
});
assert.equal(conf.enabled, true);
assert.deepEqual(conf.creatorChannelIds, ['111', '222'], 'Duplikate werden entfernt');
assert.equal(conf.defaultUserLimit, 5);
assert.equal(conf.emptyGraceSeconds, 3600, 'über Max wird begrenzt');
assert.equal(normalizeTempVoiceConfig({ emptyGraceSeconds: 0 }).emptyGraceSeconds, 0, '0 = sofort löschen');
assert.equal(conf.allowTransfer, false, 'Übertragen abschaltbar');
assert.equal(conf.allowRename, true, 'nicht gesetzt → Standard true');
assert.equal(normalizeTempVoiceConfig({}).rememberUserProfiles, true);
assert.equal(normalizeConfig({ tempVoice: { rememberUserProfiles: false } }).tempVoice.rememberUserProfiles, false);

// Deaktivierte Config
assert.equal(normalizeTempVoiceConfig({}).enabled, false);
assert.deepEqual(normalizeTempVoiceConfig({}).creatorChannelIds, []);
assert.deepEqual(
  normalizeTempVoiceInterfaceDesign(undefined),
  _tempVoiceInternals.defaultTempVoiceInterfaceDesign(),
  'undefined liefert das vollstaendige TempVoice-Standarddesign'
);

// --- Namensschema ---
assert.equal(channelNameFor({ channelNameTemplate: '🎧 {user}' }, { displayName: 'Max', user: { username: 'maxi' } }), '🎧 Max');
assert.equal(channelNameFor({ channelNameTemplate: '{username} hier' }, { displayName: 'Max', user: { username: 'maxi' } }), 'maxi hier');
assert.equal(channelNameFor({ channelNameTemplate: '' }, { displayName: 'Max', user: { username: 'maxi' } }), '🎧 Max', 'leeres Template → Standard');

// --- safeName filtert nur Discord-Verbotenes (@ # : + Steuerzeichen) ---
assert.equal(safeName('Mein Kanal'), 'Mein Kanal');
assert.equal(safeName('Lobby & Chill'), 'Lobby & Chill', '& bleibt erhalten');
assert.equal(safeName('A/B:C*D?E"F<G>H|I'), 'A/BC*D?E"F<G>H|I', 'nur @ # : werden entfernt');
assert.equal(safeName('   '), 'Kanal', 'leerer String → Fallback');

// --- State-v4-Migration und persönliche Profile ---
const migrated = normalizeTempVoiceState({
  version: 3,
  channels: { c1: { guildId: 'g1', ownerId: 'u1' } }
});
assert.equal(migrated.version, 4);
assert.equal(migrated.channels.c1.ownerId, 'u1');
assert.deepEqual(migrated.profiles, {});

await setUserProfile('g1', 'u1', {
  customName: '  Gaming @ Home  ',
  userLimit: 500,
  rtcRegion: 'moon'
});
const storedProfile = await getUserProfile('g1', 'u1');
assert.equal(storedProfile.customName, 'Gaming  Home');
assert.equal(storedProfile.userLimit, 99);
assert.equal(storedProfile.rtcRegion, 'automatic');
assert.match(storedProfile.updatedAt, /^\d{4}-\d{2}-\d{2}T/);

assert.deepEqual(resolveChannelSettings(
  normalizeTempVoiceConfig({ channelNameTemplate: 'Call {user}', defaultUserLimit: 4, defaultRegion: 'europe' }),
  { displayName: 'Max', user: { username: 'maxi' } },
  storedProfile
), {
  name: 'Gaming  Home',
  userLimit: 99,
  rtcRegion: 'automatic'
});

assert.equal(await deleteUserProfile('g1', 'u1'), true);
assert.equal(await deleteUserProfile('g1', 'u1'), false);
await setUserProfile('g1', 'u1', { customName: 'Eins' });
await setUserProfile('g1', 'u2', { customName: 'Zwei' });
assert.equal(await clearGuildProfiles('g1'), 2);
assert.equal(await getUserProfile('g1', 'u1'), null);

// --- Interface baut gültige Rows (max 5 Komponenten pro Row) ---
const rows = interfaceRows(normalizeTempVoiceConfig({ enabled: true, allowTransfer: true }));
assert.ok(rows.length <= 2, 'voller Featuresatz bleibt bei hoechstens zwei Hauptreihen');
for (const row of rows) {
  assert.ok(row.components.length <= 5, 'max 5 Buttons pro Row');
}
assert.equal(rows[0].components.length, 5, 'Reihe 1 voll (5 Buttons)');
assert.equal(rows[1].components.length, 4, 'Reihe 2 enthält nur funktionale Aktionen');
const ids = rows.flatMap((row) => row.components.map((component) => component.data.custom_id));
assert.ok(ids.includes(PREFIX + 'rename'), 'Rename-Button vorhanden');
assert.ok(ids.includes(PREFIX + 'delete'), 'Löschen-Button vorhanden');
assert.ok(ids.includes(PREFIX + 'claim'), 'Übernehmen-Button vorhanden');
assert.ok(ids.includes(PREFIX + 'transfer'), 'Übertragen-Button vorhanden');
assert.ok(ids.includes(PREFIX + 'access'), 'ein gemeinsamer Zugangs-Button vorhanden');
assert.ok(!ids.includes(PREFIX + 'block') && !ids.includes(PREFIX + 'unblock'), 'keine zwei separaten Zugangs-Hauptbuttons');
assert.ok(!ids.includes(PREFIX + 'thread'), 'VoiceChannel zeigt keinen funktionslosen Thread-Button');
assert.ok(ids.includes(PREFIX + 'profile-reset'), 'Profil-Reset vorhanden');

// Mit abgeschalteten Optionen verschwinden Buttons
const minimalRows = interfaceRows(normalizeTempVoiceConfig({
  enabled: true,
  allowRename: false,
  allowLimit: false,
  allowLock: false,
  allowRegion: false,
  allowTransfer: false
}));
const minimalIds = minimalRows.flatMap((row) => row.components.map((component) => component.data.custom_id));
assert.ok(!minimalIds.includes(PREFIX + 'rename'));
assert.ok(!minimalIds.includes(PREFIX + 'lock'));
assert.ok(minimalIds.includes(PREFIX + 'delete'), 'Löschen bleibt immer');
assert.ok(minimalIds.includes(PREFIX + 'access'), 'Zugangsverwaltung bleibt immer');

// --- Embed enthält Besitzer- und Zeitinfo, KEIN Slash-Command-Hinweis ---
const embed = interfaceEmbed({ ownerName: 'Max', createdAt: '2026-08-12T10:00:00.000Z' }, { name: 'FALLEN HEAVEN' });
assert.equal(embed.data.title, 'TempVoice · Kanal');
assert.ok(embed.data.fields.some((field) => field.name.toLowerCase().includes('besitzer') && field.value === 'Max'));
// ERSTELLT ist ein Discord-Zeitstempel (relativ, live), kein statischer Text.
const createdField = embed.data.fields.find((field) => field.name.toLowerCase().includes('erstellt'));
assert.match(createdField.value, /^<t:\d+:R>$/, 'ERSTELLT nutzt Discord-Zeitstempel <t:…:R>');
assert.ok(createdField.value.includes(String(Math.floor(new Date('2026-08-12T10:00:00.000Z').getTime() / 1000))), 'Zeitstempel zeigt die Erstellzeit');
// Besitzer ist ein ECHTER Mention, solange er noch auf dem Server ist
const mentionEmbed = interfaceEmbed(
  { ownerId: 'u42', ownerName: 'Max', createdAt: '2026-08-12T10:00:00.000Z' },
  { name: 'FALLEN HEAVEN', members: { cache: new Map([['u42', { displayName: 'Max', user: { username: 'max' } }]]) } }
);
assert.ok(mentionEmbed.data.fields.some((field) => field.name.toLowerCase().includes('besitzer') && field.value === '<@u42>'), 'BESITZER rendert als Mention, wenn der Besitzer online ist');
const goneEmbed = interfaceEmbed(
  { ownerId: 'u42', ownerName: 'Max', createdAt: '2026-08-12T10:00:00.000Z' },
  { name: 'FALLEN HEAVEN', members: { cache: new Map() } }
);
assert.ok(goneEmbed.data.fields.some((field) => field.name.toLowerCase().includes('besitzer') && field.value === 'Max'), 'Ex-Besitzer fällt auf Klarname zurück (kein „Deleted User“)');
assert.equal(embed.data.footer.text, 'FALLEN HEAVEN');
assert.doesNotMatch(embed.data.description, /\/tempvoice|\/voice/, 'kein Slash-Command-Hinweis im Interface-Text');
assert.match(embed.data.description, /temporären Sprachkanal/, 'Standardbeschreibung wird gerendert');

const expandingOwner = '123456789012345678';
const expandingGuild = {
  id: 'render-limit-guild',
  name: 'Render Limit',
  members: { cache: new Map([[expandingOwner, { displayName: 'Owner', user: { username: 'owner' } }]]) }
};
assert.throws(() => interfaceEmbed(
  { ownerId: expandingOwner, ownerName: 'Owner', createdAt: new Date().toISOString() },
  expandingGuild,
  normalizeTempVoiceConfig({
    interfaceDesign: {
      embed: {
        title: 'Grenztest',
        description: '{owner}'.repeat(500),
        fields: [
          { name: 'A', value: '{owner}'.repeat(120) },
          { name: 'B', value: '{owner}'.repeat(120) }
        ]
      }
    }
  }),
  { guild: expandingGuild, name: 'Call', members: new Map(), userLimit: 0, rtcRegion: null, permissionOverwrites: { cache: new Map() } }
), /6\.000/, 'Platzhalter dürfen ein gültiges Template nicht über Discords gerenderte 6.000-Zeichen-Grenze heben');

// --- State-Persistenz (findOwnedChannel / setChannelEntry) ---
await setChannelEntry('ch1', { guildId: 'g1', ownerId: 'u1', ownerName: 'Max', createdAt: new Date().toISOString() });
const entry = await findOwnedChannel('g1', 'ch1');
assert.ok(entry && entry.ownerId === 'u1');
assert.equal(await findOwnedChannel('g2', 'ch1'), null, 'fremde Guild → kein Eintrag');
assert.equal(await findOwnedChannel('g1', 'ch2'), null);
await setChannelEntry('ch1', null);
assert.equal(await findOwnedChannel('g1', 'ch1'), null, 'gelöscht');

// --- Regionen-Liste valide ---
assert.ok(REGIONS.some(([value]) => value === 'europe'));
assert.ok(REGIONS.some(([value]) => value === 'automatic'));

// --- normalizeConfig integriert tempVoice (Dashboard-Schema) ---
const cards = featureCards.find((card) => card.id === 'tempVoice');
assert.ok(cards, 'tempVoice-Feature-Card im Dashboard-Schema');
assert.ok(cards.fields.some((field) => field.key === 'tempVoice.creatorChannelIds'));
assert.ok(cards.fields.some((field) => field.key === 'tempVoice.channelNameTemplate'));
assert.ok(!cards.fields.some((field) => field.key === 'tempVoice.allowThreads'), 'funktionsloser Thread-Schalter ist aus der Config-UI entfernt');
const normalized = normalizeConfig({ tempVoice: { enabled: true, creatorChannelIds: ['1', '1'], emptyGraceSeconds: 15, allowTransfer: false } });
assert.equal(normalized.tempVoice.enabled, true);
// Das Dashboard-Schema dedupliziert nicht – die Feature-Normalisierung (uniqueIds) macht das beim Laden.
assert.deepEqual(normalized.tempVoice.creatorChannelIds, ['1', '1']);
assert.deepEqual(normalizeTempVoiceConfig(normalized.tempVoice).creatorChannelIds, ['1'], 'Feature-Level dedupliziert');
assert.equal(normalized.tempVoice.emptyGraceSeconds, 15);
assert.equal(normalized.tempVoice.allowTransfer, false);
assert.equal(normalized.tempVoice.allowThreads, false, 'Legacy-Thread-Flag bleibt für alte Clients ehrlich deaktiviert');
assert.equal(normalized.tempVoice.allowRename, true);
assert.equal(normalized.tempVoice.channelNameTemplate, '🎧 {user}', 'Standard-Template');

// --- missingPermissions liefert fehlende Rechte (ohne guild.members.me → alle) ---
const missing = missingPermissions({});
assert.ok(missing.length >= 3, 'ohne Bot-Member werden alle Pflichtrechte gemeldet');

// --- Zugangskontrolle: Blacklist-Rollen sperren, Required-Rollen sind Pflicht ---
const memberWithRoles = (roleIds) => ({ id: 'u1', roles: { cache: new Map(roleIds.map((id) => [id, { id }])) }, user: { bot: false } });
const memberNoRoles = { id: 'u2', roles: { cache: new Map() }, user: { bot: false } };
const memberBot = { id: 'u3', roles: { cache: new Map() }, user: { bot: true } };
const openConf = normalizeTempVoiceConfig({ enabled: true });
assert.equal(accessDeniedReason(memberNoRoles, openConf), null, 'ohne Regeln darf jeder joinen');
assert.equal(accessDeniedReason(memberBot, openConf), null, 'Bots werden ignoriert');
const blackConf = normalizeTempVoiceConfig({ enabled: true, blacklistRoleIds: ['rBlack'] });
assert.ok(accessDeniedReason(memberWithRoles(['rBlack']), blackConf), 'Blacklist-Rolle → gesperrt');
assert.equal(accessDeniedReason(memberNoRoles, blackConf), null, 'ohne Blacklist-Rolle → erlaubt');
const requiredConf = normalizeTempVoiceConfig({ enabled: true, requiredRoleIds: ['rMember'] });
assert.ok(accessDeniedReason(memberNoRoles, requiredConf), 'ohne Pflicht-Rolle → gesperrt');
assert.equal(accessDeniedReason(memberWithRoles(['rMember']), requiredConf), null, 'mit Pflicht-Rolle → erlaubt');
assert.equal(accessDeniedReason(memberWithRoles(['rOther', 'rMember']), requiredConf), null, 'eine von mehreren Pflicht-Rollen reicht');
assert.ok(accessDeniedReason(memberWithRoles(['rBlack']), { ...blackConf, requiredRoleIds: ['rMember'] }), 'Blacklist schlägt Required');

// --- Buttons-Reihenfolge: Interface bleibt stabil ---
const stable = interfaceRows(normalizeTempVoiceConfig({ enabled: true }));
const firstRowIds = stable[0].components.map((component) => component.data.custom_id);
assert.deepEqual(firstRowIds, [PREFIX + 'rename', PREFIX + 'limit', PREFIX + 'region', PREFIX + 'lock', PREFIX + 'access'], 'Reihe 1: Anpassen + Zugriff (5 Buttons)');
const allIds = stable.flatMap((row) => row.components.map((component) => component.data.custom_id));
assert.ok(allIds.includes(PREFIX + 'lock'), 'Sperren-Toggle vorhanden');
assert.ok(!allIds.includes(PREFIX + 'unlock'), 'kein separater Öffnen-Button mehr (Toggle)');
const accessRow = stable[1].components.map((component) => component.data.custom_id);
assert.deepEqual(accessRow, [PREFIX + 'claim', PREFIX + 'transfer', PREFIX + 'delete', PREFIX + 'profile-reset'], 'Reihe 2: Besitz + Verwalten (4 Buttons)');
// Icon-Buttons: Label ist nur ein Leerzeichen, die Funktion steht im Emoji (professionelles Design).
for (const component of stable.flatMap((row) => row.components)) {
  assert.equal(component.data.label, ' ', 'Icon-Button darf kein Text-Label tragen');
  assert.ok(component.data.emoji?.name, 'Icon-Button braucht ein Emoji');
}

// --- Bitrate: Einheit ist kbps (max 384) mit Migration von alten bps-Werten ---
assert.equal(normalizeTempVoiceConfig({ defaultBitrate: 96 }).defaultBitrate, 96, 'kbps bleibt unverändert');
assert.equal(normalizeTempVoiceConfig({ defaultBitrate: 384 }).defaultBitrate, 384, 'kbps Max');
assert.equal(normalizeTempVoiceConfig({ defaultBitrate: 999 }).defaultBitrate, 384, 'Bitrate wird auf Max begrenzt');
assert.equal(normalizeTempVoiceConfig({ defaultBitrate: 96000 }).defaultBitrate, 96, 'alte bps-Werte werden auf kbps migriert');
const normalizedBitrate = normalizeConfig({ tempVoice: { defaultBitrate: 96, defaultRegion: 'europe' } });
assert.equal(normalizedBitrate.tempVoice.defaultBitrate, 96, 'normalizeConfig hält kbps');
assert.equal(normalizedBitrate.tempVoice.defaultRegion, 'europe');
const migratedBitrate = normalizeConfig({ tempVoice: { defaultBitrate: 96000 } });
assert.equal(migratedBitrate.tempVoice.defaultBitrate, 96, 'normalizeConfig migriert alte bps-Werte');

// --- Berechtigungen: Alte Import-Felder werden weiterhin normalisiert (Kompatibilität),
// --- aber beim Kanalbau zählt nur noch die Kategorie.
const overwriteConf = normalizeTempVoiceConfig({
  permissionOverwrites: [
    { id: 'rolePremium', type: 0, allow: '1048576', deny: '0' }, // Connect
    { id: 'userX', type: 1, allow: '0', deny: '1048576' }
  ]
});
assert.equal(overwriteConf.permissionOverwrites.length, 2, 'Overwrites bleiben erhalten');
assert.equal(overwriteConf.permissionOverwrites[0].id, 'rolePremium');
assert.equal(overwriteConf.permissionOverwrites[0].type, 0);
assert.equal(overwriteConf.permissionOverwrites[1].type, 1, 'Member-Typ bleibt erhalten');
assert.equal(normalizeTempVoiceConfig({}).permissionOverwrites.length, 0, 'ohne Import: leer');
assert.equal(
  normalizeTempVoiceConfig({ permissionOverwrites: [{ deny: '1' }, null, { id: 'ok', allow: '2' }] }).permissionOverwrites.length,
  1,
  'ungültige Einträge werden gefiltert'
);

// --- buildChannelOverwrites: Kategorie-Berechtigungen als Basis + Bot-Verwaltung + Besitzer-Join ---
const guild = { id: 'g1' };
const me = { id: 'bot1' };
const member = { id: 'owner1' };
const category = {
  id: 'cat1',
  type: 4,
  permissionOverwrites: {
    cache: new Map([
      ['rolePremium', { id: 'rolePremium', type: 0, allow: { bitfield: 1048576n }, deny: { bitfield: 0n } }],
      ['userX', { id: 'userX', type: 1, allow: { bitfield: 0n }, deny: { bitfield: 1048576n } }]
    ])
  }
};
const built = buildChannelOverwrites({ guild, me, member, category });
const byId = new Map(built.map((entry) => [String(entry.id), entry]));
assert.ok(byId.has('rolePremium'), 'Kategorie-Rolle bleibt');
assert.equal(byId.get('rolePremium').allow, 1048576n);
assert.ok(byId.has('userX'), 'Kategorie-Member bleibt');
assert.equal(byId.get('userX').deny, 1048576n, 'Deny wird beibehalten');
assert.ok(!byId.has('cat1'), 'Kategorie selbst taucht nicht als Overwrite auf');
const botEntry = byId.get('bot1');
assert.ok(botEntry && (botEntry.allow & 1048576n) === 1048576n, 'Bot darf immer joinen');
assert.ok(botEntry && (botEntry.allow & 16n) === 16n, 'Bot darf immer verwalten (ManageChannels=16)');
const ownerEntry = byId.get('owner1');
assert.ok(ownerEntry && (ownerEntry.allow & 1048576n) === 1048576n, 'Besitzer darf immer joinen');

// Ohne Kategorie: Standard-Overwrites (alle sehen + joinen, Bot verwaltet)
const defaultBuilt = buildChannelOverwrites({ guild, me, member, category: null });
const defaultById = new Map(defaultBuilt.map((entry) => [String(entry.id), entry]));
assert.ok(defaultById.has('g1'), '@everyone vorhanden');
assert.equal(defaultById.get('g1').allow, 1048576n | 1024n, 'Standard: Connect + ViewChannel');
assert.ok((defaultById.get('bot1').allow & 16n) === 16n, 'Bot verwaltet auch ohne Kategorie');
assert.ok((defaultById.get('owner1').allow & 1048576n) === 1048576n, 'Besitzer joined auch ohne Kategorie');


// Private Kategorie (ViewChannel gesperrt): Sperre bleibt, Bot + Besitzer kommen trotzdem rein
const privateCategory = {
  id: 'catPrivate',
  type: 4,
  permissionOverwrites: {
    cache: new Map([
      ['g1', { id: 'g1', type: 0, allow: { bitfield: 0n }, deny: { bitfield: 1024n | 1048576n } }]
    ])
  }
};
const privateBuilt = buildChannelOverwrites({ guild, me, member, category: privateCategory });
const privateById = new Map(privateBuilt.map((entry) => [String(entry.id), entry]));
assert.equal(privateById.get('g1').deny, 1024n | 1048576n, 'Private Kategorie bleibt privat');
assert.ok((privateById.get('bot1').allow & (1024n | 1048576n | 16n)) === (1024n | 1048576n | 16n), 'Bot sieht/joined/verwaltet trotz privater Kategorie');
assert.ok((privateById.get('owner1').allow & (1024n | 1048576n)) === (1024n | 1048576n), 'Besitzer sieht/joined trotz privater Kategorie');

// normalizeConfig hält permissionOverwrites
const owNormalized = normalizeConfig({ tempVoice: { permissionOverwrites: [{ id: 'r1', type: 0, allow: '1', deny: '2' }, { id: 'x' }] } });
assert.equal(owNormalized.tempVoice.permissionOverwrites.length, 2);
assert.equal(owNormalized.tempVoice.permissionOverwrites[0].allow, '1');
// Embed und funktionale Buttons sind getrennt: Der Standard zeigt Live-Werte,
// die Aktionsliste bleibt vollständig in den echten Komponenten.
const interfaceEmbedData = interfaceEmbed({ ownerName: 'Tester', createdAt: new Date().toISOString() }, { name: 'Test-Server' }, normalizeTempVoiceConfig({ enabled: true }));
const embedText = interfaceEmbedData.data.description + '\n' + interfaceEmbedData.data.fields.map((field) => field.name + '\n' + field.value).join('\n');
assert.ok(embedText.includes('Tester'), 'Embed rendert den Besitzer aus einem atomaren Platzhalter');
assert.ok(embedText.includes('Automatisch'), 'Embed rendert die aktuelle Region');
assert.doesNotMatch(embedText, /\{tempVoiceBlock\}/, 'kein großer Block-Platzhalter');
assert.ok(!embedText.includes('waitroom') && !embedText.includes('Warteraum'), 'kein Warteraum im Embed');

// --- Exakte Permission-Baselines fuer Zugang und Lock/Open ---
const overwriteFor = ({ viewChannel = null, connect = null, id = 'target', type = OverwriteType.Member } = {}) => ({
  id,
  type,
  allow: { has: (permission) => (permission === PermissionFlagsBits.ViewChannel ? viewChannel === true : connect === true) },
  deny: { has: (permission) => (permission === PermissionFlagsBits.ViewChannel ? viewChannel === false : connect === false) }
});
assert.equal(permissionTriState(overwriteFor({ connect: true }), PermissionFlagsBits.Connect), true);
assert.equal(permissionTriState(overwriteFor({ connect: false }), PermissionFlagsBits.Connect), false);
assert.equal(permissionTriState(overwriteFor({ connect: null }), PermissionFlagsBits.Connect), null);
assert.equal(permissionTriState(null, PermissionFlagsBits.Connect), null);

const accessEdits = [];
const disconnects = [];
const accessGuild = { id: 'access-guild' };
const accessChannel = {
  id: 'access-channel',
  guild: accessGuild,
  permissionOverwrites: {
    cache: new Map([
      ['access-guild', overwriteFor({ id: 'access-guild', type: OverwriteType.Role, connect: false })]
    ]),
    edit: async (id, data, options) => { accessEdits.push({ id, data, options }); }
  },
  members: new Map([['guest-1', { voice: { disconnect: async () => { disconnects.push('guest-1'); } } }]])
};
await setChannelEntry('access-channel', { guildId: 'access-guild', ownerId: 'access-owner' });
let accessEntry = await findOwnedChannel('access-guild', 'access-channel');
const allowed = await applyAccessMode({ channel: accessChannel, entry: accessEntry, userId: 'guest-1', mode: 'allow' });
assert.deepEqual(accessEdits.at(-1), {
  id: 'guest-1',
  data: { ViewChannel: true, Connect: true },
  options: { type: OverwriteType.Member }
});
assert.deepEqual(allowed.entry.accessBaselines['guest-1'], { viewChannel: null, connect: null });
const revoked = await applyAccessMode({ channel: accessChannel, entry: allowed.entry, userId: 'guest-1', mode: 'revoke' });
assert.deepEqual(accessEdits.at(-1).data, { ViewChannel: null, Connect: null });
assert.deepEqual(revoked.entry.accessBaselines['guest-1'], { viewChannel: null, connect: null });

accessChannel.permissionOverwrites.cache.set('existing-guest', overwriteFor({ id: 'existing-guest', viewChannel: true, connect: false }));
const capturedExisting = await captureAccessBaseline(accessChannel, revoked.entry, 'existing-guest');
assert.deepEqual(capturedExisting.accessBaselines['existing-guest'], { viewChannel: true, connect: false });
const unblockedExisting = await applyAccessMode({ channel: accessChannel, entry: capturedExisting, userId: 'existing-guest', mode: 'unblock' });
assert.deepEqual(accessEdits.at(-1).data, { ViewChannel: true, Connect: false }, 'Unblock stellt beide alten Tri-State-Werte wieder her');
const blockedAgain = await applyAccessMode({ channel: accessChannel, entry: unblockedExisting.entry, userId: 'existing-guest', mode: 'block' });
assert.deepEqual(blockedAgain.entry.accessBaselines['existing-guest'], { viewChannel: true, connect: false }, 'Baseline wird nur einmal erfasst');

for (const originalConnect of [true, false, null]) {
  const channelId = `lock-${String(originalConnect)}`;
  const lockEdits = [];
  const lockChannel = {
    id: channelId,
    guild: { id: 'lock-guild' },
    permissionOverwrites: {
      cache: new Map([['lock-guild', overwriteFor({ id: 'lock-guild', type: OverwriteType.Role, connect: originalConnect })]]),
      edit: async (id, data, options) => { lockEdits.push({ id, data, options }); }
    }
  };
  await setChannelEntry(channelId, { guildId: 'lock-guild', ownerId: 'lock-owner' });
  const initial = await findOwnedChannel('lock-guild', channelId);
  const captured = await captureLockBaseline(lockChannel, initial);
  assert.equal(captured.lockBaseline.connect, originalConnect);
  const locked = await applyLockMode({ channel: lockChannel, entry: captured, locked: true });
  const opened = await applyLockMode({ channel: lockChannel, entry: locked.entry, locked: false });
  const everyoneEdits = lockEdits.filter((edit) => edit.id === 'lock-guild');
  assert.equal(everyoneEdits[0].data.Connect, false);
  assert.equal(everyoneEdits[1].data.Connect, originalConnect, `Open restauriert ${String(originalConnect)}`);
  assert.deepEqual(lockEdits.find((edit) => edit.id === 'lock-owner')?.data, { ViewChannel: true, Connect: true });
  assert.equal(opened.entry.locked, false);
}

// --- Picker bleiben an den Ursprungskanal gebunden; alte IDs funktionieren weiter ---
const edits = [];
const followUps = [];
const makeChannel = (id, victimInChannel) => ({
  id,
  guild: null,
  isTextBased: () => false,
  permissionOverwrites: {
    cache: new Map(),
    edit: async (targetId, data, options) => { edits.push({ channelId: id, id: targetId, data, options }); return {}; }
  },
  members: new Map(victimInChannel
    ? [['victim-1', { id: 'victim-1', voice: { disconnect: async () => { disconnects.push('victim-1'); } } }]]
    : [])
});
const makeSelect = (customId, values, currentChannel, guild) => ({
  customId,
  values,
  inGuild: () => true,
  guildId: 'guild-1',
  guild,
  member: { voice: { channel: currentChannel } },
  user: { id: 'owner-1' },
  replied: false,
  deferred: false,
  isButton: () => false,
  isUserSelectMenu: () => customId.endsWith(':pick') && customId.startsWith(PREFIX),
  isStringSelectMenu: () => false,
  isModalSubmit: () => false,
  deferUpdate: async () => {},
  reply: async () => {},
  followUp: async (payload) => { followUps.push(payload); return payload; }
});
const baseCfg = { tempVoice: { enabled: true, creatorChannelIds: ['creator-1'] } };
const originChannel = makeChannel('temp-origin', true);
const switchedChannel = makeChannel('temp-switched', false);
const interactionGuild = {
  id: 'guild-1',
  channels: { cache: new Map([['temp-origin', originChannel], ['temp-switched', switchedChannel]]) }
};
originChannel.guild = interactionGuild;
switchedChannel.guild = interactionGuild;
await setChannelEntry('temp-origin', { guildId: 'guild-1', ownerId: 'owner-1', ownerName: 'Owner' });

// Der gebundene Picker bearbeitet nach einem Call-Wechsel weiterhin nur den Ursprungskanal.
edits.length = 0; disconnects.length = 0; followUps.length = 0;
await handleAnyInteraction({ interaction: makeSelect(PREFIX + 'access:block:temp-origin:pick', ['victim-1'], switchedChannel, interactionGuild), cfg: baseCfg });
assert.equal(edits.length, 1);
assert.equal(edits[0].channelId, 'temp-origin');
assert.deepEqual(edits[0].data, { Connect: false });
assert.deepEqual(edits[0].options, { type: OverwriteType.Member });
assert.deepEqual(disconnects, ['victim-1'], 'Blocken muss ein anwesendes Mitglied sofort aus dem Kanal schmeißen.');
assert.ok(followUps.some((payload) => String(payload.content || '').includes('ausgeschlossen')), 'Bestätigung nach dem Blocken.');

// Ein fremder oder nicht mehr getrackter Ursprungskanal wird nie bearbeitet.
edits.length = 0; disconnects.length = 0; followUps.length = 0;
await handleAnyInteraction({ interaction: makeSelect(PREFIX + 'access:block:temp-switched:pick', ['victim-1'], switchedChannel, interactionGuild), cfg: baseCfg });
assert.deepEqual(edits, [], 'Ungetrackter Ursprungskanal bleibt unveraendert');

// Legacy-ID bleibt kompatibel, ist aber auf den aktuell getrackten Owner-Kanal begrenzt.
edits.length = 0; followUps.length = 0;
await handleAnyInteraction({ interaction: makeSelect(PREFIX + 'unblock:pick', ['victim-1'], originChannel, interactionGuild), cfg: baseCfg });
assert.equal(edits[0].channelId, 'temp-origin');

// Nicht-Besitzer darf nicht blocken.
edits.length = 0; disconnects.length = 0; followUps.length = 0;
const stranger = makeSelect(PREFIX + 'access:block:temp-origin:pick', ['victim-1'], originChannel, interactionGuild);
stranger.user = { id: 'stranger-1' };
await handleAnyInteraction({ interaction: stranger, cfg: baseCfg });
assert.deepEqual(edits, [], 'Nur der Besitzer darf blocken.');
assert.deepEqual(disconnects, [], 'Fremde dürfen niemanden rausschmeißen.');
await setChannelEntry('temp-origin', null);

// --- Picker-Optionen: Ausschließen zeigt Call-Mitglieder, Freigeben nur Gesperrte ---
const fakeChannel = {
  members: new Map([
    ['in-call-1', { id: 'in-call-1', user: { bot: false, username: 'maxi' }, displayName: 'Max' }],
    ['bot-1', { id: 'bot-1', user: { bot: true, username: 'helper' }, displayName: 'Helper' }]
  ]),
  permissionOverwrites: { cache: new Map([
    ['blocked-1', { id: 'blocked-1', type: 1, deny: { has: (bit) => bit === PermissionFlagsBits.Connect } }],
    ['allowed-1', { id: 'allowed-1', type: 1, deny: { has: () => false } }],
    ['everyone', { id: 'everyone', type: 0, deny: { has: (bit) => bit === PermissionFlagsBits.Connect } }]
  ]) },
  guild: { members: { cache: new Map([['blocked-1', { id: 'blocked-1', user: { bot: false, username: 'gela' }, displayName: 'Gela' }]]) } },
  client: { users: { cache: new Map() } }
};
const inCallAll = channelMemberOptions(fakeChannel);
assert.deepEqual(inCallAll.map((entry) => entry.id), ['in-call-1'], 'Im Call: nur Nicht-Bots, Bots ausgefiltert');
assert.ok(inCallAll[0].label.startsWith('🔊 Max'), 'Im Call: Name mit 🔊-Präfix');
const inCallOwner = channelMemberOptions(fakeChannel, { excludeId: 'in-call-1' });
assert.equal(inCallOwner.length, 0, 'Besitzer wird aus der Call-Liste ausgeschlossen');
const blockedOnly = blockedMemberOptions(fakeChannel);
assert.deepEqual(blockedOnly.map((entry) => entry.id), ['blocked-1'], 'Freigeben: nur echte Member-Sperren (Connect: deny), Everyone-Overwrite ignoriert');
assert.ok(blockedOnly[0].label.startsWith('⛔ Gela'), 'Freigeben: Name aus dem Guild-Cache');

// --- Besitzer mit bestehendem Kanal: erneuter Creator-Join erzeugt KEINEN
// zweiten Kanal, sondern verschiebt zurück in den eigenen + DM-Hinweis ---
await setChannelEntry('temp-1', { guildId: 'guild-1', ownerId: 'owner-1', ownerName: 'Owner' });
const voiceMoves = [];
const ownerDms = [];
const ownerMember = {
  id: 'owner-1',
  displayName: 'Owner',
  user: { username: 'owner' },
  voice: { setChannel: async (id) => { voiceMoves.push(String(id)); } },
  send: async (payload) => { ownerDms.push(String(payload)); }
};
const fakeGuild2 = {
  id: 'guild-1',
  name: 'Test-Server',
  channels: { cache: { get: (id) => (String(id) === 'temp-1' ? { id: 'temp-1' } : null) } }
};
voiceMoves.length = 0; ownerDms.length = 0;
await handleVoiceStateChange({
  oldState: { channelId: null, guild: fakeGuild2 },
  newState: { channelId: 'creator-1', guild: fakeGuild2, member: ownerMember },
  cfg: { tempVoice: { enabled: true, creatorChannelIds: ['creator-1'] } }
});
assert.deepEqual(voiceMoves, ['temp-1'], 'Erneuter Creator-Join verschiebt zurück in den eigenen Kanal (kein zweiter).');
assert.ok(ownerDms.length === 1 && ownerDms[0].includes('bereits einen TempVoice-Kanal'), 'DM informiert über den bestehenden Kanal.');

// --- Profildaten haben bei der Erstellung Vorrang; Abschalten nutzt Defaults ---
const makeCreatedVoiceChannel = (id, payload, options = {}) => ({
  id,
  name: payload.name,
  guild: options.guild,
  isTextBased: () => false,
  delete: options.delete || (async () => {}),
  members: new Map()
});
const makeCreationGuild = (id, create) => {
  const cache = new Map();
  const guild = {
    id,
    name: 'Creation Guild',
    premiumTier: 0,
    members: { me: { id: 'bot-creation' } },
    channels: {
      cache,
      create: async (payload) => {
        const channel = await create(payload, guild);
        cache.set(String(channel.id), channel);
        return channel;
      }
    }
  };
  return guild;
};
const profileMember = {
  id: 'profile-user',
  displayName: 'Profile User',
  user: { username: 'profile-user', tag: 'profile-user' },
  voice: { setChannel: async () => {} },
  send: async () => {}
};
const createPayloads = [];
const profileGuild = makeCreationGuild('profile-guild', async (payload, guild) => {
  createPayloads.push(payload);
  return makeCreatedVoiceChannel('created-profile', payload, { guild });
});
await setUserProfile('profile-guild', 'profile-user', {
  customName: 'Night Lounge',
  userLimit: 7,
  rtcRegion: 'europe'
});
await createTempChannel({ guild: profileGuild, member: profileMember, conf: normalizeTempVoiceConfig({ enabled: true }) });
assert.equal(createPayloads[0].name, 'Night Lounge');
assert.equal(createPayloads[0].userLimit, 7);
assert.equal(createPayloads[0].rtcRegion, 'europe');

const fallbackPayloads = [];
const fallbackGuild = makeCreationGuild('fallback-guild', async (payload, guild) => {
  fallbackPayloads.push(payload);
  return makeCreatedVoiceChannel('created-fallback', payload, { guild });
});
await setUserProfile('fallback-guild', 'profile-user', {
  customName: 'Nicht verwenden',
  userLimit: 9,
  rtcRegion: 'us-east'
});
await createTempChannel({
  guild: fallbackGuild,
  member: profileMember,
  conf: normalizeTempVoiceConfig({
    enabled: true,
    rememberUserProfiles: false,
    channelNameTemplate: 'Default {user}',
    defaultUserLimit: 3,
    defaultRegion: 'europe'
  })
});
assert.equal(fallbackPayloads[0].name, 'Default Profile User');
assert.equal(fallbackPayloads[0].userLimit, 3);
assert.equal(fallbackPayloads[0].rtcRegion, 'europe');

// Der ursprüngliche Member-Overwrite der Kategorie wird vor der Owner-Freigabe
// gespeichert, damit ein späterer Transfer ihn exakt wiederherstellen kann.
const baselineGuild = makeCreationGuild('baseline-guild', async (payload, guild) => makeCreatedVoiceChannel('created-baseline', payload, { guild }));
baselineGuild.channels.cache.set('baseline-category', {
  id: 'baseline-category',
  type: 4,
  permissionOverwrites: {
    cache: new Map([[
      'profile-user',
      {
        id: 'profile-user',
        type: 1,
        allow: { bitfield: PermissionFlagsBits.ViewChannel },
        deny: { bitfield: PermissionFlagsBits.Connect }
      }
    ]])
  }
});
await createTempChannel({
  guild: baselineGuild,
  member: profileMember,
  conf: normalizeTempVoiceConfig({ enabled: true, categoryId: 'baseline-category', rememberUserProfiles: false })
});
assert.deepEqual(
  (await findOwnedChannel('baseline-guild', 'created-baseline')).ownerBaseline,
  { viewChannel: true, connect: false },
  'Creation bewahrt die Rechtebasis vor dem Owner-Grant'
);

// Scheitert das Verschieben, entscheidet ausschließlich der bestätigte
// Discord-Delete darüber, ob der Tracking-State entfernt werden darf.
const moveFailureMember = {
  ...profileMember,
  id: 'move-failure-user',
  voice: { setChannel: async () => { throw new Error('Move failed'); } },
  send: async () => {}
};
const moveDeleteFailsGuild = makeCreationGuild('move-delete-fails-guild', async (payload, guild) => makeCreatedVoiceChannel(
  'move-delete-fails', payload, {
    guild,
    delete: async () => { throw Object.assign(new Error('Missing Permissions'), { code: 50013 }); }
  }
));
await assert.rejects(
  () => createTempChannel({ guild: moveDeleteFailsGuild, member: moveFailureMember, conf: normalizeTempVoiceConfig({ enabled: true }) }),
  /Move failed/
);
assert.ok(await findOwnedChannel('move-delete-fails-guild', 'move-delete-fails'), 'fehlgeschlagener Creation-Rollback bleibt getrackt');

const moveDeleteSucceedsGuild = makeCreationGuild('move-delete-ok-guild', async (payload, guild) => makeCreatedVoiceChannel(
  'move-delete-ok', payload, { guild, delete: async () => {} }
));
await assert.rejects(
  () => createTempChannel({ guild: moveDeleteSucceedsGuild, member: moveFailureMember, conf: normalizeTempVoiceConfig({ enabled: true }) }),
  /Move failed/
);
assert.equal(await findOwnedChannel('move-delete-ok-guild', 'move-delete-ok'), null, 'bestätigter Creation-Rollback räumt State');

// --- Parallele Creator-Events teilen exakt dieselbe Erstellung ---
let releaseCreate;
let createCalls = 0;
const creatorChannel = {
  id: 'creator-race',
  guild: null,
  permissionsFor: () => ({ has: () => true })
};
const raceGuild = makeCreationGuild('race-guild', async (payload, guild) => {
  createCalls += 1;
  await new Promise((resolve) => { releaseCreate = resolve; });
  return makeCreatedVoiceChannel('created-race', payload, { guild });
});
creatorChannel.guild = raceGuild;
raceGuild.channels.cache.set('creator-race', creatorChannel);
const raceMember = {
  id: 'race-user',
  displayName: 'Race User',
  user: { username: 'race-user', tag: 'race-user' },
  voice: { setChannel: async () => {} },
  send: async () => {},
  roles: { cache: new Map() }
};
const raceContext = {
  oldState: { channelId: null, guild: raceGuild },
  newState: { channelId: 'creator-race', channel: creatorChannel, guild: raceGuild, member: raceMember },
  cfg: { tempVoice: { enabled: true, creatorChannelIds: ['creator-race'] } }
};
const firstCreation = handleVoiceStateChange(raceContext);
const secondCreation = handleVoiceStateChange(raceContext);
await new Promise((resolve) => setImmediate(resolve));
releaseCreate();
await Promise.all([firstCreation, secondCreation]);
assert.equal(createCalls, 1, 'parallele Creator-Events erzeugen genau einen Kanal');

// Der öffentliche Helper selbst gibt für denselben Schlüssel dieselbe Promise zurück.
let flightCalls = 0;
const flightA = runCreationSingleFlight('g-flight', 'u-flight', async () => { flightCalls += 1; return 'ok'; });
const flightB = runCreationSingleFlight('g-flight', 'u-flight', async () => { flightCalls += 1; return 'falsch'; });
assert.equal(await flightA, 'ok');
assert.equal(await flightB, 'ok');
assert.equal(flightCalls, 1);

// Kanal-Erstellung und das dadurch ausgeloeste Voice-Join-Refresh duerfen nicht
// gleichzeitig zwei Interface-Nachrichten senden, bevor die erste Message-ID
// im State gespeichert ist.
let interfaceRaceSends = 0;
let interfaceRaceRefresh = Promise.resolve();
const interfaceRaceMessages = new Map();
const interfaceRaceGuild = makeCreationGuild('interface-race-guild', async (payload, guild) => {
  const channel = {
    ...makeCreatedVoiceChannel('interface-race-channel', payload, { guild }),
    isTextBased: () => true,
    messages: { cache: interfaceRaceMessages },
    send: async () => {
      interfaceRaceSends += 1;
      const call = interfaceRaceSends;
      await new Promise((resolve) => setTimeout(resolve, 25));
      const message = { id: `interface-race-message-${call}`, edit: async () => {} };
      interfaceRaceMessages.set(message.id, message);
      return message;
    }
  };
  return channel;
});
const interfaceRaceMember = {
  id: 'interface-race-user',
  displayName: 'Interface Race',
  user: { username: 'interface-race', tag: 'interface-race' },
  roles: { cache: new Map() },
  send: async () => {},
  voice: {
    setChannel: async (channelId) => {
      const channel = interfaceRaceGuild.channels.cache.get(String(channelId));
      interfaceRaceRefresh = handleVoiceStateChange({
        oldState: { channelId: 'creator-interface-race', guild: interfaceRaceGuild, member: interfaceRaceMember },
        newState: { channelId: String(channelId), channel, guild: interfaceRaceGuild, member: interfaceRaceMember },
        cfg: { tempVoice: { enabled: true, creatorChannelIds: ['creator-interface-race'] } }
      });
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
};
await createTempChannel({
  guild: interfaceRaceGuild,
  member: interfaceRaceMember,
  conf: normalizeTempVoiceConfig({ enabled: true, creatorChannelIds: ['creator-interface-race'] })
});
await interfaceRaceRefresh;
await new Promise((resolve) => setTimeout(resolve, 80));
assert.equal(interfaceRaceSends, 1, 'Erstellung und Voice-Refresh senden exakt ein TempVoice-Panel');

// --- Limit wird streng validiert und das Modal zeigt den Live-Wert ---
assert.deepEqual(parseUserLimit('7'), { ok: true, value: 7 });
assert.deepEqual(parseUserLimit('0'), { ok: true, value: 0 });
assert.equal(parseUserLimit('abc').ok, false);
assert.equal(parseUserLimit('100').ok, false);
let shownLimitModal = null;
await handleLimit({ showModal: async (modal) => { shownLimitModal = modal; } }, { userLimit: 6 });
assert.equal(shownLimitModal.components[0].components[0].data.value, '6');

let shownRegionPicker = null;
await showRegionPicker({ reply: async (payload) => { shownRegionPicker = payload; } }, { rtcRegion: 'europe' });
const regionOptions = shownRegionPicker.components[0].components[0].options;
assert.equal(regionOptions.find((option) => option.data.value === 'europe').data.default, true);

// --- Rename meldet Discord-Fehler exakt einmal und speichert nur nach Erfolg ---
await setUserProfile('action-guild', 'action-owner', { customName: 'Vorher' });
const makeRenameInteraction = (channel, setName) => {
  const deferredReplies = [];
  const editedReplies = [];
  return {
    customId: PREFIX + 'rename:modal',
    guildId: 'action-guild',
    guild: { id: 'action-guild' },
    member: { voice: { channel } },
    user: { id: 'action-owner' },
    fields: { getTextInputValue: () => 'Nachher' },
    replied: false,
    deferred: false,
    isButton: () => false,
    isUserSelectMenu: () => false,
    isStringSelectMenu: () => false,
    isModalSubmit: () => true,
    deferReply: async (payload) => { deferredReplies.push(payload); },
    editReply: async (payload) => { editedReplies.push(payload); },
    reply: async () => { throw new Error('Modal-Submit darf nicht direkt antworten'); },
    deferredReplies,
    editedReplies,
    setName
  };
};
const failingActionChannel = {
  id: 'action-channel',
  name: 'Vorher',
  guild: { id: 'action-guild' },
  setName: async () => { throw new Error('Discord verweigert'); },
  isTextBased: () => false
};
await setChannelEntry('action-channel', { guildId: 'action-guild', ownerId: 'action-owner', ownerName: 'Owner' });
const failingRename = makeRenameInteraction(failingActionChannel);
await handleAnyInteraction({ interaction: failingRename, cfg: { tempVoice: { enabled: true } } });
assert.equal(failingRename.deferredReplies.length, 1);
assert.equal(failingRename.editedReplies.length, 1);
assert.match(failingRename.editedReplies[0].content, /fehlgeschlagen/i);
assert.equal((await getUserProfile('action-guild', 'action-owner')).customName, 'Vorher');

const successfulActionChannel = {
  ...failingActionChannel,
  setName: async (name) => { successfulActionChannel.name = name; }
};
const successfulRename = makeRenameInteraction(successfulActionChannel);
await handleAnyInteraction({ interaction: successfulRename, cfg: { tempVoice: { enabled: true } } });
assert.equal(successfulRename.deferredReplies.length, 1);
assert.equal(successfulRename.editedReplies.length, 1);
assert.match(successfulRename.editedReplies[0].content, /umbenannt/i);
assert.equal((await getUserProfile('action-guild', 'action-owner')).customName, 'Nachher');

// Profilfehler verhindert weder Refresh noch eine einzelne, wahrheitsgetreue Antwort.
let refreshedAfterProfileFailure = 0;
const profileFailureChannel = {
  ...failingActionChannel,
  id: 'profile-failure-channel',
  name: 'Vorher',
  isTextBased: () => true,
  setName: async (name) => { profileFailureChannel.name = name; },
  messages: {
    cache: new Map([['profile-failure-message', { edit: async () => { refreshedAfterProfileFailure += 1; } }]])
  }
};
await setChannelEntry('profile-failure-channel', {
  guildId: 'action-guild',
  ownerId: '__proto__',
  ownerName: 'Owner',
  interfaceMessageId: 'profile-failure-message',
  interfaceChannelId: 'profile-failure-channel'
});
const profileFailureRename = makeRenameInteraction(profileFailureChannel);
profileFailureRename.user = { id: '__proto__' };
profileFailureRename.editReply = async (payload) => {
  profileFailureRename.editedReplies.push(payload);
  throw new Error('Antworttransport fehlgeschlagen');
};
await handleAnyInteraction({ interaction: profileFailureRename, cfg: { tempVoice: { enabled: true } } });
assert.equal(profileFailureRename.deferredReplies.length, 1);
assert.equal(profileFailureRename.editedReplies.length, 1, 'Reply-Fehler erzeugt keinen zweiten Antwortversuch');
assert.equal(refreshedAfterProfileFailure, 1, 'Refresh laeuft trotz Profilwrite-Fehler');
assert.match(profileFailureRename.editedReplies[0].content, /nicht.*gespeichert/i);

// Modal- und Select-Submits respektieren Modul- und Feature-Schalter.
let disabledRenameCalls = 0;
const disabledChannel = { ...failingActionChannel, setName: async () => { disabledRenameCalls += 1; } };
const disabledRename = makeRenameInteraction(disabledChannel);
await handleAnyInteraction({ interaction: disabledRename, cfg: { tempVoice: { enabled: false } } });
assert.equal(disabledRenameCalls, 0);
assert.match(disabledRename.editedReplies[0].content, /deaktiviert/i);
const forbiddenRename = makeRenameInteraction(disabledChannel);
await handleAnyInteraction({ interaction: forbiddenRename, cfg: { tempVoice: { enabled: true, allowRename: false } } });
assert.equal(disabledRenameCalls, 0);
assert.match(forbiddenRename.editedReplies[0].content, /deaktiviert/i);

let disabledRegionCalls = 0;
const disabledRegionResponses = [];
const disabledRegionInteraction = {
  ...makeSelect(PREFIX + 'region:pick', ['europe'], failingActionChannel, { id: 'action-guild', channels: { cache: new Map([['action-channel', failingActionChannel]]) } }),
  isUserSelectMenu: () => false,
  isStringSelectMenu: () => true,
  deferUpdate: async () => {},
  followUp: async (payload) => { disabledRegionResponses.push(payload); }
};
failingActionChannel.setRTCRegion = async () => { disabledRegionCalls += 1; };
await handleAnyInteraction({ interaction: disabledRegionInteraction, cfg: { tempVoice: { enabled: true, allowRegion: false } } });
assert.equal(disabledRegionCalls, 0);
assert.match(disabledRegionResponses[0].content, /deaktiviert/i);

const liveEmbed = interfaceEmbed(
  { ownerId: 'action-owner', ownerName: 'Owner', createdAt: new Date().toISOString() },
  { id: 'action-guild', name: 'Action Guild', members: { cache: new Map() } },
  normalizeTempVoiceConfig({ enabled: true }),
  {
    name: 'Live Call',
    userLimit: 6,
    rtcRegion: 'europe',
    members: new Map([['u', {}]]),
    guild: { id: 'action-guild' },
    permissionOverwrites: { cache: new Map() }
  }
);
const liveStatus = liveEmbed.data.fields.map((field) => `${field.name}: ${field.value}`).join('\n');
assert.match(liveEmbed.data.title, /Live Call/);
assert.match(liveStatus, /Mitglieder: 1 \/ 6/);
assert.match(liveStatus, /Europa/);
assert.match(liveStatus, /Offen/);

await setUserProfile('reset-guild', 'reset-owner', { customName: 'Eigen', userLimit: 9, rtcRegion: 'europe' });
const resetCalls = [];
const resetReplies = [];
const resetChannel = {
  id: 'reset-channel',
  name: 'Eigen',
  userLimit: 9,
  rtcRegion: 'europe',
  guild: { id: 'reset-guild' },
  isTextBased: () => false,
  setName: async (value) => { resetCalls.push(['name', value]); },
  setUserLimit: async (value) => { resetCalls.push(['limit', value]); },
  setRTCRegion: async (value) => { resetCalls.push(['region', value]); }
};
await setChannelEntry('reset-channel', { guildId: 'reset-guild', ownerId: 'reset-owner', ownerName: 'Reset Owner' });
await resetOwnerProfile({
  interaction: {
    member: { displayName: 'Reset Owner', user: { username: 'reset-owner' } },
    followUp: async (payload) => { resetReplies.push(payload); }
  },
  channel: resetChannel,
  entry: { ownerId: 'reset-owner' },
  conf: normalizeTempVoiceConfig({ channelNameTemplate: 'Default {user}', defaultUserLimit: 4, defaultRegion: 'automatic' })
});
assert.deepEqual(resetCalls, [['name', 'Default Reset Owner'], ['limit', 4], ['region', null]]);
assert.equal(await getUserProfile('reset-guild', 'reset-owner'), null);
assert.equal(resetReplies.length, 1);

const failedResetReplies = [];
const failedReset = await resetOwnerProfile({
  interaction: {
    member: { displayName: 'Reset Owner', user: { username: 'reset-owner' } },
    followUp: async (payload) => { failedResetReplies.push(payload); }
  },
  channel: resetChannel,
  entry: { ownerId: 'reset-owner' },
  conf: normalizeTempVoiceConfig({ channelNameTemplate: 'Default {user}', defaultUserLimit: 4 }),
  deleteProfile: async () => { throw new Error('Datentraeger voll'); }
});
assert.equal(failedReset.ok, false);
assert.doesNotMatch(failedResetReplies[0].content, /Profil wurde zurückgesetzt/i, 'fehlgeschlagene Profilloeschnung meldet keinen Erfolg');
assert.match(failedResetReplies[0].content, /nicht.*zurückgesetzt/i);

// --- Task 6: Discord-Löschung und State bleiben atomar nachvollziehbar ---
const trackedDeleteEntry = { guildId: 'delete-guild', ownerId: 'delete-owner', ownerName: 'Delete Owner' };
const deletionChannel = (id, deleteImpl, members = new Map()) => ({
  id,
  guild: { id: 'delete-guild' },
  members,
  delete: deleteImpl
});

await setChannelEntry('delete-fails', trackedDeleteEntry);
const failedDeletion = await deleteTrackedChannel(
  deletionChannel('delete-fails', async () => { throw Object.assign(new Error('Missing Permissions'), { code: 50013 }); }),
  'test'
);
assert.equal(failedDeletion.deleted, false);
assert.ok(await findOwnedChannel('delete-guild', 'delete-fails'), 'Permission-Fehler behält den Tracking-State');

await setChannelEntry('delete-network', trackedDeleteEntry);
const networkDeletion = await deleteTrackedChannel(
  deletionChannel('delete-network', async () => { throw new Error('ECONNRESET'); }),
  'test'
);
assert.equal(networkDeletion.deleted, false);
assert.ok(await findOwnedChannel('delete-guild', 'delete-network'), 'Netzfehler behält den Tracking-State');

await setChannelEntry('delete-unknown', trackedDeleteEntry);
const unknownDeletion = await deleteTrackedChannel(
  deletionChannel('delete-unknown', async () => { throw Object.assign(new Error('Unknown Channel'), { code: 10003 }); }),
  'test'
);
assert.equal(unknownDeletion.deleted, true, 'Discord Unknown Channel bestätigt die Löschung');
assert.equal(await findOwnedChannel('delete-guild', 'delete-unknown'), null);

await setChannelEntry('delete-ok', trackedDeleteEntry);
let successfulDeleteCalls = 0;
const successfulDeletion = await deleteTrackedChannel(
  deletionChannel('delete-ok', async () => { successfulDeleteCalls += 1; }),
  'test'
);
assert.equal(successfulDeletion.deleted, true);
assert.equal(successfulDeleteCalls, 1);
assert.equal(await findOwnedChannel('delete-guild', 'delete-ok'), null);

await setChannelEntry('delete-rejoined', trackedDeleteEntry);
let rejoinedDeleteCalls = 0;
const rejoinedDeletion = await deleteTrackedChannel(
  deletionChannel('delete-rejoined', async () => { rejoinedDeleteCalls += 1; }, new Map([['member', {}]])),
  'cleanup',
  { requireEmpty: true }
);
assert.equal(rejoinedDeletion.deleted, false);
assert.equal(rejoinedDeletion.cancelled, true, 'Rejoin direkt vor Cleanup bricht die Löschung ab');
assert.equal(rejoinedDeleteCalls, 0);
assert.ok(await findOwnedChannel('delete-guild', 'delete-rejoined'));

// Ein externes Discord-ChannelDelete ist ein bestätigter Löschbeweis.
await setChannelEntry('delete-external', trackedDeleteEntry);
await tempVoiceFeature.onChannelDelete({ channel: deletionChannel('delete-external', async () => {}) });
assert.equal(await findOwnedChannel('delete-guild', 'delete-external'), null);

// Kanaloperationen laufen pro Guild/Kanal strikt nacheinander.
const operationOrder = [];
let releaseFirstOperation;
const firstOperation = runChannelOperation('queue-guild', 'queue-channel', async () => {
  operationOrder.push('first:start');
  await new Promise((resolve) => { releaseFirstOperation = resolve; });
  operationOrder.push('first:end');
});
const secondOperation = runChannelOperation('queue-guild', 'queue-channel', async () => {
  operationOrder.push('second:start');
});
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(operationOrder, ['first:start']);
releaseFirstOperation();
await Promise.all([firstOperation, secondOperation]);
assert.deepEqual(operationOrder, ['first:start', 'first:end', 'second:start']);

// --- Task 6: Ownership ändert nur den aktiven Kanal, niemals Benutzerprofile ---
const permissionState = new Map([
  ['old-owner', { viewChannel: false, connect: null }],
  ['new-owner', { viewChannel: null, connect: false }]
]);
const ownershipEdits = [];
const ownershipChannel = {
  id: 'ownership-channel',
  guild: { id: 'ownership-guild' },
  isTextBased: () => false,
  permissionOverwrites: {
    cache: new Map([[
      'new-owner',
      {
        allow: { has: () => false },
        deny: { has: (permission) => permission === PermissionFlagsBits.Connect }
      }
    ]]),
    edit: async (id, data, options) => {
      ownershipEdits.push({ id: String(id), data: structuredClone(data), options: structuredClone(options) });
      permissionState.set(String(id), {
        viewChannel: data.ViewChannel,
        connect: data.Connect
      });
    }
  }
};
await setChannelEntry('ownership-channel', {
  guildId: 'ownership-guild',
  ownerId: 'old-owner',
  ownerName: 'Old Owner',
  ownerBaseline: { viewChannel: false, connect: null }
});
await setUserProfile('ownership-guild', 'old-owner', { customName: 'Alt', userLimit: 4, rtcRegion: 'europe' });
await setUserProfile('ownership-guild', 'new-owner', { customName: 'Neu', userLimit: 8, rtcRegion: 'us-east' });
const oldProfileBefore = JSON.stringify(await getUserProfile('ownership-guild', 'old-owner'));
const newProfileBefore = JSON.stringify(await getUserProfile('ownership-guild', 'new-owner'));
const transferred = await transferOwnership({
  channel: ownershipChannel,
  entry: await findOwnedChannel('ownership-guild', 'ownership-channel'),
  expectedOwnerId: 'old-owner',
  nextOwner: { id: 'new-owner', displayName: 'New Owner', user: { username: 'new-owner' } }
});
assert.equal(transferred.ownerId, 'new-owner');
assert.deepEqual(ownershipEdits[0], {
  id: 'new-owner',
  data: { ViewChannel: true, Connect: true },
  options: { type: OverwriteType.Member }
});
assert.deepEqual(ownershipEdits[1], {
  id: 'old-owner',
  data: { ViewChannel: false, Connect: null },
  options: { type: OverwriteType.Member }
});
assert.deepEqual(transferred.ownerBaseline, { viewChannel: null, connect: false }, 'Baseline des neuen Owners wird für den nächsten Wechsel bewahrt');
assert.equal(JSON.stringify(await getUserProfile('ownership-guild', 'old-owner')), oldProfileBefore);
assert.equal(JSON.stringify(await getUserProfile('ownership-guild', 'new-owner')), newProfileBefore);

// Ein Rechtefehler darf den Owner-State nicht umschreiben.
const permissionFailureChannel = {
  ...ownershipChannel,
  id: 'ownership-permission-failure',
  permissionOverwrites: {
    cache: new Map(),
    edit: async () => { throw Object.assign(new Error('Missing Permissions'), { code: 50013 }); }
  }
};
await setChannelEntry('ownership-permission-failure', {
  guildId: 'ownership-guild', ownerId: 'old-owner', ownerName: 'Old Owner', ownerBaseline: { viewChannel: null, connect: null }
});
const permissionFailureEntry = await findOwnedChannel('ownership-guild', 'ownership-permission-failure');
await assert.rejects(() => transferOwnership({
  channel: permissionFailureChannel,
  entry: permissionFailureEntry,
  expectedOwnerId: 'old-owner',
  nextOwner: { id: 'new-owner', displayName: 'New Owner' }
}), /Missing Permissions/);
assert.equal((await findOwnedChannel('ownership-guild', 'ownership-permission-failure')).ownerId, 'old-owner');

// Zwei parallele Übernahmen auf derselben alten Owner-Version haben genau einen Gewinner.
const raceOwnershipEdits = [];
const raceOwnershipChannel = {
  ...ownershipChannel,
  id: 'ownership-race',
  permissionOverwrites: {
    cache: new Map(),
    edit: async (id, data, options) => { raceOwnershipEdits.push({ id: String(id), data, options }); }
  }
};
await setChannelEntry('ownership-race', {
  guildId: 'ownership-guild', ownerId: 'race-old', ownerName: 'Race Old', ownerBaseline: { viewChannel: null, connect: null }
});
const raceEntry = await findOwnedChannel('ownership-guild', 'ownership-race');
const raceTransfers = await Promise.allSettled([
  transferOwnership({ channel: raceOwnershipChannel, entry: raceEntry, expectedOwnerId: 'race-old', nextOwner: { id: 'race-a', displayName: 'Race A' } }),
  transferOwnership({ channel: raceOwnershipChannel, entry: raceEntry, expectedOwnerId: 'race-old', nextOwner: { id: 'race-b', displayName: 'Race B' } })
]);
assert.equal(raceTransfers.filter((result) => result.status === 'fulfilled').length, 1);
assert.equal(raceTransfers.filter((result) => result.status === 'rejected').length, 1);
assert.match(String(raceTransfers.find((result) => result.status === 'rejected').reason?.message), /Besitzer.*geändert/i);

// Nach gespeichertem Owner-State ist ein reiner Interface-Fehler nur noch eine
// Refresh-Warnung und darf die Discord-Rechte nicht vom State abkoppeln.
const refreshFailureEdits = [];
const refreshFailureChannel = {
  id: 'ownership-refresh-failure',
  name: 'Ownership Refresh',
  guild: { id: 'ownership-guild', name: 'Ownership Guild', members: { cache: new Map() } },
  members: new Map(),
  userLimit: 0,
  rtcRegion: null,
  isTextBased: () => true,
  messages: {
    cache: new Map([['refresh-failure-message', { edit: async () => { throw new Error('Interface edit failed'); } }]])
  },
  permissionOverwrites: {
    cache: new Map(),
    edit: async (id, data, options) => { refreshFailureEdits.push({ id: String(id), data, options }); }
  }
};
await setChannelEntry('ownership-refresh-failure', {
  guildId: 'ownership-guild',
  ownerId: 'refresh-old',
  ownerName: 'Refresh Old',
  ownerBaseline: { viewChannel: null, connect: null },
  interfaceMessageId: 'refresh-failure-message',
  interfaceChannelId: 'ownership-refresh-failure'
});
const refreshFailureResult = await transferOwnership({
  channel: refreshFailureChannel,
  entry: await findOwnedChannel('ownership-guild', 'ownership-refresh-failure'),
  expectedOwnerId: 'refresh-old',
  nextOwner: { id: 'refresh-new', displayName: 'Refresh New' }
});
assert.equal(refreshFailureResult.ownerId, 'refresh-new');
assert.equal((await findOwnedChannel('ownership-guild', 'ownership-refresh-failure')).ownerId, 'refresh-new');
assert.equal(refreshFailureEdits.length, 2, 'Refresh-Fehler rollt bereits bestätigte Rechte nicht zurück');

// Startup: Cache-Miss allein bleibt bestehen; nur Discord 10003 räumt auf.
await setChannelEntry('startup-unclear', { guildId: 'startup-guild', ownerId: 'startup-owner' });
const startupGuildUnclear = {
  id: 'startup-guild',
  name: 'Startup Guild',
  channels: {
    cache: new Map(),
    fetch: async () => { throw Object.assign(new Error('Missing Access'), { code: 50001 }); }
  }
};
await tempVoiceFeature.onClientReady({ guild: startupGuildUnclear, cfg: { tempVoice: { enabled: true } } });
assert.ok(await findOwnedChannel('startup-guild', 'startup-unclear'), 'Cache-/Permission-Miss behält den State');

await setChannelEntry('startup-unknown', { guildId: 'startup-unknown-guild', ownerId: 'startup-owner' });
const startupGuildUnknown = {
  id: 'startup-unknown-guild',
  name: 'Startup Unknown Guild',
  channels: {
    cache: new Map(),
    fetch: async () => { throw Object.assign(new Error('Unknown Channel'), { code: 10003 }); }
  }
};
await tempVoiceFeature.onClientReady({ guild: startupGuildUnknown, cfg: { tempVoice: { enabled: true } } });
assert.equal(await findOwnedChannel('startup-unknown-guild', 'startup-unknown'), null);

// Access-Aktionen auf demselben Kanal dürfen ihre unabhängig erfassten Baselines
// nicht gegenseitig mit einem veralteten Channel-Eintrag überschreiben.
const accessRaceChannel = {
  id: 'access-race',
  guild: { id: 'race-mutations-guild' },
  members: new Map(),
  permissionOverwrites: { cache: new Map(), edit: async () => {} }
};
await setChannelEntry('access-race', { guildId: 'race-mutations-guild', ownerId: 'race-owner', ownerName: 'Race Owner' });
const accessRaceEntry = await findOwnedChannel('race-mutations-guild', 'access-race');
await Promise.all([
  applyAccessMode({ channel: accessRaceChannel, entry: accessRaceEntry, userId: 'guest-a', mode: 'allow' }),
  applyAccessMode({ channel: accessRaceChannel, entry: accessRaceEntry, userId: 'guest-b', mode: 'block' })
]);
const accessRaceState = await findOwnedChannel('race-mutations-guild', 'access-race');
assert.deepEqual(Object.keys(accessRaceState.accessBaselines || {}).sort(), ['guest-a', 'guest-b'], 'parallele Access-Mutationen werden auf aktuellem State zusammengeführt');

// Lock und Transfer teilen dieselbe Kanal-Queue. Lock darf nach einem Transfer
// keinen zuvor gelesenen Besitzer zurück in den State schreiben.
let releaseRoleLock;
let roleLockStarted;
const roleLockReady = new Promise((resolve) => { roleLockStarted = resolve; });
const lockTransferChannel = {
  id: 'lock-transfer-race',
  name: 'Race Call',
  guild: { id: 'race-mutations-guild', name: 'Race Guild', members: { cache: new Map() } },
  members: new Map(),
  isTextBased: () => false,
  permissionOverwrites: {
    cache: new Map(),
    edit: async (id, data) => {
      if (String(id) === 'race-mutations-guild' && data.Connect === false) {
        roleLockStarted();
        await new Promise((resolve) => { releaseRoleLock = resolve; });
      }
    }
  }
};
await setChannelEntry('lock-transfer-race', {
  guildId: 'race-mutations-guild', ownerId: 'lock-old', ownerName: 'Lock Old', ownerBaseline: { viewChannel: null, connect: null }
});
const staleLockEntry = await findOwnedChannel('race-mutations-guild', 'lock-transfer-race');
const locking = applyLockMode({ channel: lockTransferChannel, entry: staleLockEntry, locked: true });
await roleLockReady;
const transferringWhileLocked = transferOwnership({
  channel: lockTransferChannel,
  entry: staleLockEntry,
  expectedOwnerId: 'lock-old',
  nextOwner: { id: 'lock-new', displayName: 'Lock New' }
});
releaseRoleLock();
await Promise.all([locking, transferringWhileLocked]);
const lockTransferState = await findOwnedChannel('race-mutations-guild', 'lock-transfer-race');
assert.equal(lockTransferState.ownerId, 'lock-new', 'Lock überschreibt keinen parallel übertragenen Besitzer');
assert.equal(lockTransferState.locked, true);

// Ein fehlgeschlagenes deferUpdate stoppt jede Mutation.
let deferredMutationCalls = 0;
const deferFailureChannel = {
  id: 'defer-failure',
  name: 'Defer Failure',
  guild: { id: 'defer-guild', name: 'Defer Guild', members: { cache: new Map() } },
  members: new Map(),
  isTextBased: () => false,
  permissionOverwrites: { cache: new Map(), edit: async () => { deferredMutationCalls += 1; } }
};
await setChannelEntry('defer-failure', { guildId: 'defer-guild', ownerId: 'defer-owner', ownerName: 'Defer Owner' });
await handleAnyInteraction({
  interaction: {
    customId: PREFIX + 'lock', guildId: 'defer-guild', guild: deferFailureChannel.guild,
    member: { voice: { channel: deferFailureChannel } }, user: { id: 'defer-owner' },
    isButton: () => true, isModalSubmit: () => false, isUserSelectMenu: () => false, isStringSelectMenu: () => false,
    deferUpdate: async () => { throw new Error('Unknown interaction'); },
    reply: async () => {}, followUp: async () => {}
  },
  cfg: { tempVoice: { enabled: true } }
});
assert.equal(deferredMutationCalls, 0, 'fehlgeschlagenes deferUpdate verhindert Discord-Mutationen');

let deferredModalMutationCalls = 0;
await handleAnyInteraction({
  interaction: {
    customId: PREFIX + 'rename:modal', guildId: 'defer-guild', guild: deferFailureChannel.guild,
    member: { voice: { channel: { ...deferFailureChannel, setName: async () => { deferredModalMutationCalls += 1; } } } },
    user: { id: 'defer-owner' }, fields: { getTextInputValue: () => 'Darf nicht passieren' },
    isButton: () => false, isModalSubmit: () => true, isUserSelectMenu: () => false, isStringSelectMenu: () => false,
    deferReply: async () => { throw new Error('Unknown interaction'); },
    reply: async () => {}, editReply: async () => {}
  },
  cfg: { tempVoice: { enabled: true } }
});
assert.equal(deferredModalMutationCalls, 0, 'fehlgeschlagenes deferReply verhindert Modal-Mutationen');

// Delete muss den konkreten handelnden Owner innerhalb der Queue revalidieren.
let releaseDeleteDefer;
let deleteDeferStarted;
const deleteDeferReady = new Promise((resolve) => { deleteDeferStarted = resolve; });
let ownerRaceDeleteCalls = 0;
const ownerRaceDeleteChannel = {
  id: 'delete-owner-race', name: 'Delete Race', members: new Map(), isTextBased: () => false,
  guild: { id: 'delete-owner-race-guild', name: 'Delete Race Guild', members: { cache: new Map() } },
  permissionOverwrites: { cache: new Map(), edit: async () => {} },
  delete: async () => { ownerRaceDeleteCalls += 1; }
};
await setChannelEntry('delete-owner-race', {
  guildId: 'delete-owner-race-guild', ownerId: 'delete-old', ownerName: 'Delete Old', ownerBaseline: { viewChannel: null, connect: null }
});
const deletingAsOldOwner = handleAnyInteraction({
  interaction: {
    customId: PREFIX + 'delete', guildId: 'delete-owner-race-guild', guild: ownerRaceDeleteChannel.guild,
    member: { voice: { channel: ownerRaceDeleteChannel } }, user: { id: 'delete-old' },
    isButton: () => true, isModalSubmit: () => false, isUserSelectMenu: () => false, isStringSelectMenu: () => false,
    deferUpdate: async () => {
      deleteDeferStarted();
      await new Promise((resolve) => { releaseDeleteDefer = resolve; });
    },
    followUp: async () => {}, reply: async () => {}
  },
  cfg: { tempVoice: { enabled: true } }
});
await deleteDeferReady;
await transferOwnership({
  channel: ownerRaceDeleteChannel,
  entry: await findOwnedChannel('delete-owner-race-guild', 'delete-owner-race'),
  expectedOwnerId: 'delete-old',
  nextOwner: { id: 'delete-new', displayName: 'Delete New' }
});
releaseDeleteDefer();
await deletingAsOldOwner;
assert.equal(ownerRaceDeleteCalls, 0, 'alter Owner kann nach Transfer nicht mehr löschen');
assert.equal((await findOwnedChannel('delete-owner-race-guild', 'delete-owner-race')).ownerId, 'delete-new');

// Bereits existierende TempVoice-Kanäle werden auch nach Abschalten des Moduls
// weiter aktualisiert und aufgeräumt.
let disabledCleanupDeletes = 0;
let memberRefreshes = 0;
const lifecycleGuild = { id: 'lifecycle-guild', name: 'Lifecycle Guild', members: { cache: new Map() }, channels: { cache: new Map() } };
const disabledCleanupChannel = {
  id: 'disabled-cleanup', name: 'Empty', guild: lifecycleGuild, members: new Map(), isTextBased: () => false,
  delete: async () => { disabledCleanupDeletes += 1; }
};
lifecycleGuild.channels.cache.set('disabled-cleanup', disabledCleanupChannel);
await setChannelEntry('disabled-cleanup', { guildId: 'lifecycle-guild', ownerId: 'lifecycle-owner', ownerName: 'Owner' });
await handleVoiceStateChange({
  oldState: { guild: lifecycleGuild, channelId: 'disabled-cleanup', channel: disabledCleanupChannel, member: { id: 'member' } },
  newState: { guild: lifecycleGuild, channelId: null, member: { id: 'member' } },
  cfg: { tempVoice: { enabled: false, emptyGraceSeconds: 0 } }
});
await new Promise((resolve) => setTimeout(resolve, 20));
assert.equal(disabledCleanupDeletes, 1, 'Cleanup bestehender Kanäle läuft bei deaktiviertem Modul weiter');

const memberCountChannel = {
  id: 'member-count-live', name: 'Live Count', guild: lifecycleGuild,
  members: new Map([['member', {}]]), userLimit: 0, rtcRegion: null,
  permissionOverwrites: { cache: new Map() }, isTextBased: () => true,
  messages: { cache: new Map([['member-count-message', { edit: async () => { memberRefreshes += 1; } }]]) }
};
lifecycleGuild.channels.cache.set('member-count-live', memberCountChannel);
await setChannelEntry('member-count-live', {
  guildId: 'lifecycle-guild', ownerId: 'lifecycle-owner', ownerName: 'Owner',
  interfaceMessageId: 'member-count-message', interfaceChannelId: 'member-count-live'
});
await handleVoiceStateChange({
  oldState: { guild: lifecycleGuild, channelId: null, member: { id: 'member' } },
  newState: { guild: lifecycleGuild, channelId: 'member-count-live', channel: memberCountChannel, member: { id: 'member' } },
  cfg: { tempVoice: { enabled: false } }
});
assert.equal(memberRefreshes, 1, 'Join aktualisiert den memberCount im Interface');

// Temporäre Discord-Fehler erhalten einen begrenzten Cleanup-Retry.
let retryDeleteCalls = 0;
const retryCleanupChannel = {
  id: 'cleanup-retry', name: 'Retry', guild: lifecycleGuild, members: new Map(), isTextBased: () => false,
  delete: async () => {
    retryDeleteCalls += 1;
    if (retryDeleteCalls === 1) throw Object.assign(new Error('Temporary failure'), { code: 50013 });
  }
};
lifecycleGuild.channels.cache.set('cleanup-retry', retryCleanupChannel);
await setChannelEntry('cleanup-retry', { guildId: 'lifecycle-guild', ownerId: 'lifecycle-owner', ownerName: 'Owner' });
scheduleCleanup(retryCleanupChannel, normalizeTempVoiceConfig({ emptyGraceSeconds: 0 }), { retryBaseMs: 1, maxRetries: 2 });
const cleanupDeadline = Date.now() + 1000;
while (await findOwnedChannel('lifecycle-guild', 'cleanup-retry')) {
  if (Date.now() >= cleanupDeadline) break;
  await new Promise((resolve) => setTimeout(resolve, 10));
}
assert.equal(retryDeleteCalls, 2, 'Cleanup versucht einen temporären Fehler erneut');
assert.equal(await findOwnedChannel('lifecycle-guild', 'cleanup-retry'), null);

// Deaktivierte alte Buttons antworten statt still in Discord auszulaufen.
const disabledButtonReplies = [];
await handleAnyInteraction({
  interaction: {
    customId: PREFIX + 'rename', guildId: 'lifecycle-guild', guild: lifecycleGuild,
    member: { voice: { channel: memberCountChannel } }, user: { id: 'lifecycle-owner' },
    isButton: () => true, isModalSubmit: () => false, isUserSelectMenu: () => false, isStringSelectMenu: () => false,
    reply: async (payload) => { disabledButtonReplies.push(payload); }
  },
  cfg: { tempVoice: { enabled: true, allowRename: false } }
});
assert.match(disabledButtonReplies[0]?.content || '', /deaktiviert/i, 'deaktivierter alter Button erhält eine Antwort');
const legacyThreadReplies = [];
await handleAnyInteraction({
  interaction: {
    customId: PREFIX + 'thread', guildId: 'lifecycle-guild', guild: lifecycleGuild,
    member: { voice: { channel: memberCountChannel } }, user: { id: 'lifecycle-owner' },
    isButton: () => true, isModalSubmit: () => false, isUserSelectMenu: () => false, isStringSelectMenu: () => false,
    reply: async (payload) => { legacyThreadReplies.push(payload); }
  },
  cfg: { tempVoice: { enabled: true } }
});
assert.match(legacyThreadReplies[0]?.content || '', /nicht mehr/i, 'alter Thread-Button wird ehrlich deaktiviert');

const refreshesBeforeConfigUpdate = memberRefreshes;
await tempVoiceFeature.onConfigUpdate({
  guild: lifecycleGuild,
  cfg: { tempVoice: { enabled: true, allowRename: false } },
  patch: { tempVoice: { allowRename: false } }
});
assert.ok(memberRefreshes > refreshesBeforeConfigUpdate, 'Config-Update aktualisiert aktive Interfaces und entfernt alte Buttons');

// Ein Owner-Refresh ohne vorhandene Interface-Nachricht darf beim Neusenden
// nicht dieselbe Kanal-Queue rekursiv blockieren.
let fallbackInterfaceSends = 0;
const fallbackRefreshChannel = {
  id: 'refresh-fallback', name: 'Vorher', userLimit: 0, rtcRegion: null, members: new Map(),
  guild: { id: 'refresh-fallback-guild', name: 'Fallback Guild', members: { cache: new Map() } },
  permissionOverwrites: { cache: new Map() }, isTextBased: () => true,
  messages: { cache: new Map() },
  send: async () => { fallbackInterfaceSends += 1; return { id: 'new-interface-message' }; },
  setName: async (name) => { fallbackRefreshChannel.name = name; }
};
await setChannelEntry('refresh-fallback', {
  guildId: 'refresh-fallback-guild', ownerId: 'refresh-fallback-owner', ownerName: 'Owner'
});
const fallbackInteraction = makeRenameInteraction(fallbackRefreshChannel);
fallbackInteraction.guildId = 'refresh-fallback-guild';
fallbackInteraction.guild = fallbackRefreshChannel.guild;
fallbackInteraction.user = { id: 'refresh-fallback-owner' };
let fallbackTimeout;
const fallbackResult = await Promise.race([
  handleAnyInteraction({ interaction: fallbackInteraction, cfg: { tempVoice: { enabled: true } } }).then(() => 'complete'),
  new Promise((resolve) => { fallbackTimeout = setTimeout(() => resolve('timeout'), 500); })
]);
clearTimeout(fallbackTimeout);
assert.equal(fallbackResult, 'complete', 'Interface-Fallback erzeugt keinen rekursiven Queue-Deadlock');
assert.equal(fallbackInterfaceSends, 1);

console.log('✅ temp-voice-smoke: alle Assertions grün (inkl. Block-Kick + Freigeben)');
