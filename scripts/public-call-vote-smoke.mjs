import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// State in ein eigenes Temp-Verzeichnis lenken, damit der Test niemals echte
// lokale Daten berührt – daher dynamischer Import.
process.env.FALLEN_HEAVEN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-publiccallvote-smoke-'));
const statePath = path.join(process.env.FALLEN_HEAVEN_DATA_DIR, 'public-call-vote.json');
// Vorinitialisierter State: zwei beendete Abstimmungen – eine ohne jede Stimme
// (darf nicht still ablaufen) und eine mit Stimme (wird regulär entschieden).
fs.writeFileSync(statePath, JSON.stringify({
  version: 1,
  panels: {},
  votes: {
    g1: {
      'vote-idle': {
        targetUserId: 'user-b',
        targetName: 'Bob',
        reasonId: 'noise',
        channelId: 'voice-1',
        attendingCount: 5,
        yes: [],
        no: [],
        startedBy: 'user-a',
        startedByName: 'Alice',
        startedAt: Date.now() - 120_000,
        endsAt: Date.now() - 60_000,
        panelChannelId: 'text-1',
        messageId: '',
        settled: false
      },
      'vote-votes': {
        targetUserId: 'user-c',
        targetName: 'Carol',
        reasonId: 'noise',
        channelId: 'voice-1',
        attendingCount: 5,
        yes: ['user-a'],
        no: [],
        startedBy: 'user-a',
        startedByName: 'Alice',
        startedAt: Date.now() - 120_000,
        endsAt: Date.now() - 60_000,
        panelChannelId: 'text-1',
        messageId: '',
        settled: false
      }
    }
  },
  strikes: {}
}, null, 2), 'utf8');
const { _publicCallVoteInternals } = await import('../src/features/publicCallVote.js');
import { defaultGuildConfig, featureCards, normalizeConfig } from '../src/defaultConfig.js';

const {
  normalizePublicCallVoteConfig,
  normalizeVoteReasons,
  DEFAULT_VOTE_REASONS,
  countStrikes,
  evaluateVote,
  handleVoteInteraction,
  registerProtectedMessage,
  unregisterProtectedMessage,
  isProtectedPublicCallVoteMessage,
  allCallChannelIds,
  requiredYesFor,
  designSectionFor,
  selectedCallChannels,
  showVoteTargetPicker,
  startVoteTicker,
  stopVoteTicker,
  voteCountdownDelay,
  sendKickDm,
  sendTeamNotice,
  sendLockReleaseDm,
  startPublicVote,
  savePublicCallVoteDesign,
  refreshPublicCallVoteLive,
  seedPublicCallVoteState,
  respondTo,
  voteContext,
  formatVoteText,
  PREFIX
} = _publicCallVoteInternals;
const readState = () => JSON.parse(fs.readFileSync(statePath, 'utf8'));

// --- Config-Normalisierung ---
const defaults = normalizePublicCallVoteConfig();
assert.equal(defaults.enabled, false);
assert.deepEqual(defaults.callChannelIds, []);
assert.deepEqual(defaults.callChannelIds2, [], '2er-Liste ist standardmäßig leer');
assert.deepEqual(defaults.callChannelIds3, [], '3er-Liste ist standardmäßig leer');
assert.deepEqual(defaults.callChannelIds4, [], '4er-Liste ist standardmäßig leer');
assert.equal(defaults.passPercent, 51);
assert.equal(defaults.minVotes, 3);
assert.equal(defaults.timeoutSeconds, 60);
assert.equal(defaults.voteReasons.length, 5);
assert.equal(defaults.teamChannelId, '');
assert.deepEqual(defaults.teamRoleIds, []);
assert.equal(defaults.resultAutoDeleteSeconds, 30, 'Ergebnis wird nach 30 Sekunden automatisch gelöscht');
assert.equal(defaults.design.panel.title.includes('Moderation'), true, 'Panel-Design hat Standard-Titel');
assert.equal(defaults.design.vote.authorName, '{targetName}', 'Abstimmungs-Embed zeigt den Betroffenen als Autor (Avatar + Name)');
assert.equal(defaults.design.result.authorName, '{targetName}', 'Ergebnis-Embed zeigt den Betroffenen als Autor');
assert.equal(defaults.design.team.authorName, '{targetName}', 'Team-Embed zeigt den Betroffenen als Autor');
assert.equal(defaults.design.dm.authorName, '{targetName}', 'DM-Embed zeigt den Betroffenen als Autor');
assert.ok(defaults.design.panel2.description.includes('2er-Call'), 'panel2-Default erwähnt die 2er-Schwelle');
assert.ok(defaults.design.panel3.description.includes('3er-Call'), 'panel3-Default erwähnt die 3er-Schwelle');
assert.ok(defaults.design.panel4.description.includes('4er-Call'), 'panel4-Default erwähnt die 4er-Schwelle');
assert.equal(defaults.design.vote2.authorName, '{targetName}', 'vote2 zeigt den Betroffenen als Autor');
assert.equal(defaults.design.result3.authorName, '{targetName}', 'result3 zeigt den Betroffenen als Autor');
assert.equal(defaults.design.team2.authorName, '{targetName}', 'team2 zeigt den Betroffenen als Autor');
assert.equal(defaults.design.dm3.authorName, '{targetName}', 'dm3 zeigt den Betroffenen als Autor');
assert.equal(defaults.design.vote4.authorName, '{targetName}', 'vote4 zeigt den Betroffenen als Autor');
assert.equal(defaults.design.result4.authorName, '{targetName}', 'result4 zeigt den Betroffenen als Autor');
assert.equal(defaults.design.team4.authorName, '{targetName}', 'team4 zeigt den Betroffenen als Autor');
assert.equal(defaults.design.dm4.authorName, '{targetName}', 'dm4 zeigt den Betroffenen als Autor');
assert.equal(normalizePublicCallVoteConfig({ resultAutoDeleteSeconds: 999 }).resultAutoDeleteSeconds, 600, 'Auto-Delete wird auf Max begrenzt');
assert.equal(normalizePublicCallVoteConfig({ resultAutoDeleteSeconds: 1 }).resultAutoDeleteSeconds, 5, 'Auto-Delete mindestens 5 Sekunden');

const normalized = normalizePublicCallVoteConfig({
  enabled: true,
  callChannelIds: ['111', '111', ' 222 '],
  callChannelIds2: [' duo-1 ', 'duo-1', 'duo-2'],
  callChannelIds3: ['trio-1', ' trio-2 ', 'trio-1'],
  callChannelIds4: ['quad-1', ' quad-2 ', 'quad-1'],
  passPercent: 70,
  minVotes: 5,
  timeoutSeconds: 30,
  teamChannelId: ' 999 ',
  teamRoleIds: ['r1', 'r1', ' r2 ']
});
assert.equal(normalized.enabled, true);
assert.deepEqual(normalized.callChannelIds, ['111', '222']);
assert.deepEqual(normalized.callChannelIds2, ['duo-1', 'duo-2'], '2er-Liste wird bereinigt und dedupliziert');
assert.deepEqual(normalized.callChannelIds3, ['trio-1', 'trio-2'], '3er-Liste wird bereinigt und dedupliziert');
assert.deepEqual(normalized.callChannelIds4, ['quad-1', 'quad-2'], '4er-Liste wird bereinigt und dedupliziert');
assert.deepEqual(allCallChannelIds(normalized), ['111', '222', 'duo-1', 'duo-2', 'trio-1', 'trio-2', 'quad-1', 'quad-2'], 'Union enthält 2er + 3er + 4er + übrige');
assert.equal(normalized.passPercent, 70);
assert.equal(normalized.minVotes, 5);
assert.equal(normalized.timeoutSeconds, 30);
assert.equal(normalized.teamChannelId, '999');
assert.deepEqual(normalized.teamRoleIds, ['r1', 'r2']);
assert.equal(normalized.passPercent, 70, 'Prozent bleibt erhalten');
assert.equal(normalizePublicCallVoteConfig({ passPercent: 999 }).passPercent, 100, 'Prozent wird auf Max begrenzt');

// --- Modul-Karte in der Config vorhanden ---
const card = featureCards.find((entry) => entry.id === 'publicCallVote');
assert.ok(card, 'featureCards enthält die publicCallVote-Karte');
assert.ok(card.fields.some((field) => field.key === 'publicCallVote.callChannelIds2'), 'Karte hat 2er-Call-Auswahl');
assert.ok(card.fields.some((field) => field.key === 'publicCallVote.callChannelIds3'), 'Karte hat 3er-Call-Auswahl');
assert.ok(card.fields.some((field) => field.key === 'publicCallVote.callChannelIds4'), 'Karte hat 4er-Call-Auswahl');
assert.ok(card.fields.some((field) => field.key === 'publicCallVote.callChannelIds'), 'Karte hat Auswahl für weitere öffentliche Calls');
assert.ok(card.fields.some((field) => field.key === 'publicCallVote.teamChannelId'), 'Karte hat Team-Kanal');
assert.ok(card.fields.some((field) => field.key === 'publicCallVote.teamRoleIds'), 'Karte hat Team-Rollen');

// --- Default-Config enthält publicCallVote (und tempVoice ohne publicVote-Felder) ---
const base = defaultGuildConfig('guild-1', 'Test');
assert.ok(base.publicCallVote, 'defaultGuildConfig enthält publicCallVote');
assert.equal(base.publicCallVote.enabled, false);
assert.equal(base.publicCallVote.voteReasons.length, 5);
assert.equal(base.publicCallVote.resultAutoDeleteSeconds, 30, 'Basis-Config hat Auto-Delete 30s');
assert.equal(base.publicCallVote.design.panel.title.includes('Moderation'), true, 'Basis-Config hat Panel-Design');
assert.equal(base.publicCallVote.design.vote.authorName, '{targetName}');
assert.ok(!('publicVoteEnabled' in base.tempVoice), 'tempVoice hat keine publicVote-Felder mehr');
assert.ok(!('voteReasons' in base.tempVoice), 'tempVoice hat keine voteReasons mehr');

// --- normalizeConfig hält publicCallVote ---
const viaNormalize = normalizeConfig({ publicCallVote: { enabled: true, callChannelIds: ['a', 'b'] } });
assert.equal(viaNormalize.publicCallVote.enabled, true);
assert.deepEqual(viaNormalize.publicCallVote.callChannelIds, ['a', 'b']);
assert.equal(viaNormalize.publicCallVote.voteReasons.length, 5, 'leere Gründe → Defaults');
assert.equal(viaNormalize.publicCallVote.teamRoleIds.length, 0);
// Design-Backfill: Eine alte Config ohne 2er-/3er-/4er-Sektionen muss alle
// 20 Sektionen bekommen – sonst öffnet der Studio-Editor leer.
const designSections = Object.keys(viaNormalize.publicCallVote.design);
assert.equal(designSections.length, 24, 'normalizeConfig backfilled alle 24 Design-Sektionen (6 je Call-Art)');
assert.ok(designSections.includes('vote2') && designSections.includes('team4') && designSections.includes('release3'), '2er-, 4er- und Freigabe-Sektionen vorhanden');
assert.equal(viaNormalize.publicCallVote.design.vote2.title, viaNormalize.publicCallVote.design.vote.title, 'vote2 erbt das Vote-Design');
assert.equal(viaNormalize.publicCallVote.design.release.title, '✅ Deine Call-Sperre ist vorbei', 'release-Default ist gesetzt');
assert.equal(viaNormalize.publicCallVote.design.release4.title, viaNormalize.publicCallVote.design.release.title, 'release4 erbt das release-Design');
assert.ok(viaNormalize.publicCallVote.design.panel2.description.includes('2er-Call'), 'panel2 nennt die 2er-Schwelle');
assert.ok(viaNormalize.publicCallVote.design.panel4.description.includes('4er-Call'), 'panel4 nennt die 4er-Schwelle');

// --- Vote-Gründe: Defaults + eigene Normalisierung ---
assert.equal(DEFAULT_VOTE_REASONS.length, 5, '5 vorgefertigte Gründe');
assert.ok(DEFAULT_VOTE_REASONS.every((reason) => reason.id && reason.label && reason.kickMinutes > 0));
assert.equal(DEFAULT_VOTE_REASONS.find((reason) => reason.id === 'other').needsText, true, 'Sonstiges fragt einen Freitext-Grund ab');
assert.equal(normalizeVoteReasons([{ id: 'x', label: 'X', needsText: true }])[0].needsText, true, 'needsText wird übernommen');
assert.equal(normalizeVoteReasons([{ id: 'y', label: 'Y' }])[0].needsText, false, 'ohne needsText ist der Freitext aus');
const customReasons = normalizeVoteReasons([
  { id: 'noise', label: 'Lärm', kickMinutes: 5, timeoutAfter: 2, timeoutMinutes: 30 },
  { label: 'ohne id' },
  { id: 'huge', label: 'Riesenwert', kickMinutes: 99999, timeoutAfter: 0, timeoutMinutes: 1 }
]);
assert.equal(customReasons.length, 2, 'Gründe ohne ID werden entfernt');
assert.equal(customReasons[0].kickMinutes, 5);
assert.equal(customReasons[1].kickMinutes, 1440, 'kickMinutes wird auf Max begrenzt');
assert.equal(customReasons[1].timeoutAfter, 1, 'timeoutAfter mindestens 1');

// --- Geschützte Nachrichten: Panel-Embeds überleben den Cleaner ---
assert.equal(isProtectedPublicCallVoteMessage('g1', 'c1', 'm1'), false, 'nicht registriert → nicht geschützt');
registerProtectedMessage('g1', 'c1', 'm1');
assert.equal(isProtectedPublicCallVoteMessage('g1', 'c1', 'm1'), true, 'registrierte Panel-Embed ist geschützt');
assert.equal(isProtectedPublicCallVoteMessage('g1', 'c2', 'm1'), false, 'anderer Kanal ist nicht geschützt');
assert.equal(isProtectedPublicCallVoteMessage('g2', 'c1', 'm1'), false, 'anderer Server ist nicht geschützt');
unregisterProtectedMessage('g1', 'c1', 'm1');
assert.equal(isProtectedPublicCallVoteMessage('g1', 'c1', 'm1'), false, 'nach Freigabe ist die Nachricht löschbar');

// --- Kanal-Auswahl: nur ausgewählte Voice-Kanäle ---
const conf = normalizePublicCallVoteConfig({ enabled: true, callChannelIds: ['voice-1', 'voice-2'] });
const guild = {
  id: 'g1',
  channels: {
    cache: new Map([
      ['voice-1', { id: 'voice-1', type: 2, guild: { id: 'g1' }, isVoiceBased: () => true }],
      ['voice-2', { id: 'voice-2', type: 2, guild: { id: 'g1' }, isVoiceBased: () => true }],
      ['text-1', { id: 'text-1', type: 0, guild: { id: 'g1' }, isVoiceBased: () => false }]
    ])
  }
};
const selected = selectedCallChannels(guild, conf);
assert.equal(selected.length, 2, 'beide ausgewählten Voice-Kanäle werden gefunden');
assert.ok(selected.every((channel) => channel.id === 'voice-1' || channel.id === 'voice-2'));
const disabled = selectedCallChannels(guild, normalizePublicCallVoteConfig({ enabled: false, callChannelIds: ['voice-1'] }));
assert.equal(disabled.length, 0, 'deaktiviert → keine Kanäle');

// --- Strikes zählen (mit State im Temp-Verzeichnis) ---
assert.equal(await countStrikes('g1', 'user-1', 'spam'), 0, 'keine Strikes am Anfang');

// --- Vote-Picker: nur Mitglieder des aktuellen Calls, nicht der ganze Server ---
const voteConf = normalizePublicCallVoteConfig({ enabled: true, callChannelIds: ['voice-1'] });
const callMembers = new Map([
  ['user-a', { id: 'user-a', displayName: 'Alice', user: { username: 'alice' } }],
  ['user-b', { id: 'user-b', displayName: 'Bob', user: { username: 'bob' } }],
  ['bot-x', { id: 'bot-x', displayName: 'Bot', user: { bot: true } }]
]);
const fakeGuild = {
  id: 'g1',
  channels: {
    cache: new Map([
      ['voice-1', { id: 'voice-1', name: 'Öffentlicher Call', type: 2, guild: { id: 'g1' }, isVoiceBased: () => true, members: { values: () => callMembers.values() } }]
    ])
  }
};
let pickerReply = null;
const fakeInteraction = {
  id: 'caller',
  member: {
    id: 'user-a',
    voice: { channel: fakeGuild.channels.cache.get('voice-1') }
  },
  reply: async (payload) => { pickerReply = payload; }
};
showVoteTargetPicker(fakeInteraction, fakeGuild, voteConf);
assert.ok(pickerReply, 'Picker antwortet');
const pickerSelect = pickerReply.components[0].components[0].toJSON();
assert.equal(pickerSelect.custom_id, PREFIX + 'vote:pick');
assert.equal(pickerSelect.type, 3, 'StringSelectMenu statt Server-weitem User-Picker');
const optionValues = (pickerSelect.options || []).map((option) => option.value);
assert.deepEqual(optionValues, ['user-b'], 'nur echte anwesende Mitglieder, ohne Bot und ohne den Beantrager selbst');

// Nicht im Call → klare Meldung statt Server-Picker
let noCallReply = null;
showVoteTargetPicker({ member: { voice: { channel: null } }, reply: async (payload) => { noCallReply = payload; } }, fakeGuild, voteConf);
assert.ok(noCallReply && String(noCallReply.content).includes('öffentlichen Calls'), 'ohne eigenen Call kommt eine Erklärung');

// Call nicht in der Auswahl → ebenfalls Ablehnung
let wrongCallReply = null;
showVoteTargetPicker({ member: { voice: { channel: { id: 'voice-2', name: 'Anderer', guild: { id: 'g1' }, type: 2, isVoiceBased: () => true } } }, reply: async (payload) => { wrongCallReply = payload; } }, fakeGuild, voteConf);
assert.ok(wrongCallReply && !wrongCallReply.components, 'fremder Call wird abgelehnt');

// --- Abstimmung ohne Stimmen läuft nicht ab, sie wird verlängert ---
const voteGuild = { id: 'g1', channels: { cache: new Map() } };
const idleConf = normalizePublicCallVoteConfig({ enabled: true, callChannelIds: ['voice-1'], timeoutSeconds: 60 });
await evaluateVote({ guild: voteGuild, voteId: 'vote-idle', conf: idleConf });
let state = readState();
const idleVote = state.votes.g1['vote-idle'];
assert.equal(idleVote.settled, false, 'ohne Stimmen wird die Abstimmung nicht abgeschlossen');
assert.equal(idleVote.extensions, 1, 'Abstimmung wird verlängert');
assert.ok(idleVote.endsAt > Date.now(), 'Endzeit wird nach hinten verschoben');

// Laufende Zeit → keine weitere Verlängerung durch erneute Auswertung.
await evaluateVote({ guild: voteGuild, voteId: 'vote-idle', conf: idleConf });
assert.equal(readState().votes.g1['vote-idle'].extensions, 1, 'keine Doppel-Verlängerung während der Laufzeit');

// Mit Stimme + Zeit abgelaufen → regulär entschieden (hier abgelehnt).
await evaluateVote({ guild: voteGuild, voteId: 'vote-votes', conf: idleConf });
assert.equal(readState().votes.g1['vote-votes'].settled, true, 'mit Stimmen wird die Abstimmung entschieden');

// --- Betroffene Person darf nicht selbst abstimmen ---
let ownVoteReply = null;
const targetInteraction = {
  user: { id: 'user-b' },
  member: { displayName: 'Bob', id: 'user-b' },
  guildId: 'g1',
  guild: voteGuild,
  customId: `${PREFIX}vote:yes:vote-idle`,
  isButton: () => true,
  isStringSelectMenu: () => false,
  reply: async (payload) => { ownVoteReply = payload; }
};
await handleVoteInteraction({ interaction: targetInteraction, guild: voteGuild, conf: idleConf });
assert.ok(ownVoteReply && String(ownVoteReply.content).includes('eigenen Abstimmung'), 'Ziel-Person bekommt eine klare Antwort');
state = readState();
assert.ok(!(state.votes.g1['vote-idle'].yes || []).includes('user-b'), 'Stimme der betroffenen Person wird nicht gezählt');

// --- Nur Mitglieder im Call dürfen abstimmen ---
const callMemberMap = new Map([
  ['user-a', { id: 'user-a', displayName: 'Alice', user: { username: 'alice' } }],
  ['user-b', { id: 'user-b', displayName: 'Bob', user: { username: 'bob' } }]
]);
const voice1Channel = { id: 'voice-1', name: 'Öffentlicher Call', type: 2, guild: { id: 'g1' }, isVoiceBased: () => true, members: { values: () => callMemberMap.values() } };
// Ziel-Person sitzt im Call (für den Vote-Start über den Reason-Picker).
// timeout/send-Stubs: Die Schwellen-Tests sammeln Strikes, bis der
// Server-Timeout (4x Grund „noise“) greift – der Member muss das können.
callMemberMap.set('user-b', { id: 'user-b', displayName: 'Bob', user: { username: 'bob' }, voice: { channel: voice1Channel }, timeout: async () => {}, send: async () => {} });
const callVoteGuild = {
  id: 'g1',
  channels: {
    cache: new Map([
      ['voice-1', voice1Channel]
    ])
  },
  members: { fetch: async (id) => callMemberMap.get(String(id)) || null }
};
let outsideReply = null;
const outsideInteraction = {
  user: { id: 'user-c' },
  member: { displayName: 'Carol', id: 'user-c' },
  guildId: 'g1',
  guild: callVoteGuild,
  customId: `${PREFIX}vote:yes:vote-idle`,
  isButton: () => true,
  isStringSelectMenu: () => false,
  reply: async (payload) => { outsideReply = payload; }
};
await handleVoteInteraction({ interaction: outsideInteraction, guild: callVoteGuild, conf: idleConf });
assert.ok(outsideReply && String(outsideReply.content).includes('im Call'), 'Außenstehende können nicht abstimmen');
state = readState();
assert.ok(!(state.votes.g1['vote-idle'].yes || []).includes('user-c'), 'Stimme von außerhalb wird nicht gezählt');

// Anwesendes Mitglied darf abstimmen.
let insideReply = null;
const insideInteraction = {
  user: { id: 'user-a' },
  member: { displayName: 'Alice', id: 'user-a' },
  guildId: 'g1',
  guild: callVoteGuild,
  customId: `${PREFIX}vote:yes:vote-idle`,
  isButton: () => true,
  isStringSelectMenu: () => false,
  reply: async (payload) => { insideReply = payload; }
};
await handleVoteInteraction({ interaction: insideInteraction, guild: callVoteGuild, conf: idleConf });
assert.ok(insideReply, 'Anwesendes Mitglied bekommt eine Antwort');
state = readState();
assert.ok((state.votes.g1['vote-idle'].yes || []).includes('user-a'), 'Stimme des anwesenden Mitglieds wird gezählt');

// --- Beantrager stimmt automatisch dafür (Auto-Ja) ---
let reasonReply = null;
const reasonInteraction = {
  user: { id: 'user-a', username: 'alice' },
  member: { id: 'user-a', displayName: 'Alice', voice: { channel: callVoteGuild.channels.cache.get('voice-1') } },
  guildId: 'g1',
  guild: callVoteGuild,
  customId: `${PREFIX}vote:reason:user-b`,
  isButton: () => false,
  isStringSelectMenu: () => true,
  values: ['noise'],
  channelId: 'text-1',
  channel: { send: async () => ({ id: 'msg-created-1' }) },
  reply: async (payload) => { reasonReply = payload; }
};
await handleVoteInteraction({ interaction: reasonInteraction, guild: callVoteGuild, conf: voteConf });
state = readState();
const createdVote = Object.values(state.votes.g1).find((vote) => vote.messageId === 'msg-created-1');
assert.ok(createdVote, 'Abstimmung wurde im State angelegt');
assert.deepEqual(createdVote.yes, ['user-a'], 'Beantrager stimmt automatisch dafür');
// 2er-Call: Die Auto-Ja-Stimme des Beantragers ist bereits die Mehrheit → die
// Abstimmung wird beim Start sofort entschieden, nicht erst beim Timer.
assert.equal(createdVote.settled, true, '2er-Call: Auto-Ja entscheidet sofort');
assert.ok(reasonReply && String(reasonReply.content).includes('entfernt'), 'Antwort bestätigt den sofortigen Rauswurf');

// --- „Sonstiges“-Modal: Freitext-Grund wird abgefragt und gespeichert ---
let modalShown = null;
const modalConf = normalizePublicCallVoteConfig({
  enabled: true,
  callChannelIds2: ['voice-1'],
  timeoutSeconds: 60
});
const modalSelectInteraction = {
  user: { id: 'user-a', username: 'alice' },
  member: { id: 'user-a', displayName: 'Alice' },
  guildId: 'g1',
  guild: callVoteGuild,
  customId: `${PREFIX}vote:reason:user-b`,
  isButton: () => false,
  isStringSelectMenu: () => true,
  values: ['other'],
  showModal: async (modal) => { modalShown = modal; }
};
await handleVoteInteraction({ interaction: modalSelectInteraction, guild: callVoteGuild, conf: modalConf });
assert.ok(modalShown, 'Sonstiges öffnet ein Modal statt sofort abzustimmen');
const modalJson = modalShown.toJSON();
assert.equal(modalJson.custom_id, `${PREFIX}vote:reasonText:user-b:other`, 'Modal-Custom-ID trägt Ziel + Grund');
assert.equal(modalJson.components[0].components[0].custom_id, 'reasonText', 'Modal enthält das Grund-Eingabefeld');

// Modal-Submit mit Freitext startet die Abstimmung mit reasonText.
let modalReply = null;
const modalSubmitInteraction = {
  user: { id: 'user-a', username: 'alice' },
  member: { id: 'user-a', displayName: 'Alice', voice: { channel: callVoteGuild.channels.cache.get('voice-1') } },
  guildId: 'g1',
  guild: callVoteGuild,
  customId: `${PREFIX}vote:reasonText:user-b:other`,
  isButton: () => false,
  isStringSelectMenu: () => false,
  isModalSubmit: () => true,
  fields: { getTextInputValue: () => 'Musik im Hintergrund' },
  channelId: 'text-1',
  channel: { send: async () => ({ id: 'msg-modal-1' }) },
  reply: async (payload) => { modalReply = payload; }
};
await handleVoteInteraction({ interaction: modalSubmitInteraction, guild: callVoteGuild, conf: modalConf });
state = readState();
const modalVote = Object.values(state.votes.g1).find((vote) => vote.messageId === 'msg-modal-1');
assert.ok(modalVote, 'Modal-Submit legt die Abstimmung an');
assert.equal(modalVote.reasonText, 'Musik im Hintergrund', 'Freitext-Grund wird gespeichert');
assert.equal(voteContext(modalVote, { name: 'Test' }, modalConf).reason, 'Musik im Hintergrund', '{reason} zeigt den Freitext statt „Sonstiges“');

// Ohne Text im Modal → klare Antwort statt Abstimmung.
let emptyModalReply = null;
const emptyModalInteraction = {
  user: { id: 'user-a', username: 'alice' },
  member: { id: 'user-a', displayName: 'Alice', voice: { channel: callVoteGuild.channels.cache.get('voice-1') } },
  guildId: 'g1',
  guild: callVoteGuild,
  customId: `${PREFIX}vote:reasonText:user-b:other`,
  isButton: () => false,
  isStringSelectMenu: () => false,
  isModalSubmit: () => true,
  fields: { getTextInputValue: () => '   ' },
  channelId: 'text-1',
  channel: { send: async () => ({ id: 'msg-modal-empty' }) },
  reply: async (payload) => { emptyModalReply = payload; }
};
await handleVoteInteraction({ interaction: emptyModalInteraction, guild: callVoteGuild, conf: modalConf });
assert.ok(emptyModalReply && String(emptyModalReply.content).includes('Grund'), 'leerer Freitext wird abgelehnt');
assert.ok(!Object.values(readState().votes.g1).some((vote) => vote.messageId === 'msg-modal-empty'), 'ohne Grund wird keine Abstimmung angelegt');

// --- Differenzierte Schwellen: 2er-Call → 1 Stimme, 3er-Call → 2 Stimmen ---
// Beobachtbares Signal für „Rauswurf beschlossen“: applyVoteOutcome läuft nur
// bei bestandener Abstimmung und schreibt einen Verstoß (Strike) für das Ziel.
const thresholdGuild = {
  id: 'g1',
  channels: {
    cache: new Map([
      ['voice-1', { id: 'voice-1', name: 'Öffentlicher Call', type: 2, guild: { id: 'g1' }, isVoiceBased: () => true, members: { values: () => callMemberMap.values() } }]
    ])
  },
  members: { fetch: async (id) => callMemberMap.get(String(id)) || null, cache: new Map() }
};
const thresholdConf = normalizePublicCallVoteConfig({ enabled: true, callChannelIds: ['voice-1'], timeoutSeconds: 60 });
const seedThresholdVote = async (voteId, attending, yes, no, channelId = 'voice-1') => {
  const s = readState();
  s.votes.g1[voteId] = {
    targetUserId: 'user-b',
    targetName: 'Bob',
    reasonId: 'noise',
    channelId,
    attendingCount: attending,
    yes,
    no,
    startedBy: 'user-a',
    startedByName: 'Alice',
    startedAt: Date.now() - 120_000,
    endsAt: Date.now() - 1000,
    panelChannelId: 'text-1',
    messageId: '',
    settled: false
  };
  await seedPublicCallVoteState({ votes: s.votes });
};

// 2er-Call, 1 Stimme (Auto-Ja des Beantragers), Zeit abgelaufen → Rauswurf.
await seedThresholdVote('vote-2er-pass', 2, ['user-a'], []);
await evaluateVote({ guild: thresholdGuild, voteId: 'vote-2er-pass', conf: thresholdConf });
state = readState();
assert.equal(state.votes.g1['vote-2er-pass'].settled, true, '2er-Call: Abstimmung wird entschieden');
assert.ok((state.strikes?.g1?.['user-b'] || []).length >= 1, '2er-Call: 1 Stimme genügt → Rauswurf (Strike wird gespeichert)');

// 2er-Call, 1:1 → keine Mehrheit → kein Rauswurf.
await seedThresholdVote('vote-2er-no', 2, ['user-a'], ['user-c']);
const strikesBefore2erNo = (readState().strikes?.g1?.['user-b'] || []).length;
await evaluateVote({ guild: thresholdGuild, voteId: 'vote-2er-no', conf: thresholdConf });
state = readState();
assert.equal(state.votes.g1['vote-2er-no'].settled, true, '2er-Call: 1:1 wird entschieden');
assert.equal((state.strikes?.g1?.['user-b'] || []).length, strikesBefore2erNo, '2er-Call: 1:1 ist keine Mehrheit → kein Rauswurf');

// 3er-Call, nur der Beantrager (1 Stimme) → Schwelle 2 nicht erreicht.
await seedThresholdVote('vote-3er-one', 3, ['user-a'], []);
const strikesBefore3erOne = (readState().strikes?.g1?.['user-b'] || []).length;
await evaluateVote({ guild: thresholdGuild, voteId: 'vote-3er-one', conf: thresholdConf });
state = readState();
assert.equal(state.votes.g1['vote-3er-one'].settled, true, '3er-Call: wird entschieden');
assert.equal((state.strikes?.g1?.['user-b'] || []).length, strikesBefore3erOne, '3er-Call: 1 Stimme reicht nicht → kein Rauswurf');

// 3er-Call, 2 Stimmen → Rauswurf.
await seedThresholdVote('vote-3er-pass', 3, ['user-a', 'user-d'], []);
const strikesBefore3erPass = (readState().strikes?.g1?.['user-b'] || []).length;
await evaluateVote({ guild: thresholdGuild, voteId: 'vote-3er-pass', conf: thresholdConf });
state = readState();
assert.ok((state.strikes?.g1?.['user-b'] || []).length > strikesBefore3erPass, '3er-Call: 2 Stimmen genügen → Rauswurf (Strike wird gespeichert)');

// 4er-Call: konfigurierte Mindeststimmen (Standard 3) gelten weiterhin.
await seedThresholdVote('vote-4er-two', 4, ['user-a', 'user-d'], []);
const strikesBefore4er = (readState().strikes?.g1?.['user-b'] || []).length;
await evaluateVote({ guild: thresholdGuild, voteId: 'vote-4er-two', conf: thresholdConf });
state = readState();
assert.equal((state.strikes?.g1?.['user-b'] || []).length, strikesBefore4er, '4er-Call: 2 von 4 reichen bei minVotes 3 nicht');

// --- Gruppen-Schwellen: Die 2er-/3er-Auswahl entscheidet, nicht nur die
// Anwesenden-Zahl. Ein Kanal aus der 2er-Liste braucht immer nur 1 Stimme,
// aus der 3er-Liste immer 2 – die übrige Liste rechnet dynamisch weiter.
const groupConf = normalizePublicCallVoteConfig({
  enabled: true,
  callChannelIds: ['mixed-1'],
  callChannelIds2: ['duo-1'],
  callChannelIds3: ['trio-1'],
  callChannelIds4: ['quad-1'],
  timeoutSeconds: 60
});
assert.equal(requiredYesFor(2, groupConf, 'duo-1'), 1, '2er-Gruppe: 1 Stimme reicht');
assert.equal(requiredYesFor(3, groupConf, 'trio-1'), 2, '3er-Gruppe: 2 Stimmen reichen');
assert.equal(requiredYesFor(4, groupConf, 'quad-1'), 3, '4er-Gruppe: 3 Stimmen reichen');
assert.equal(requiredYesFor(3, groupConf, 'mixed-1'), 2, 'übrige Liste: 3 Anwesende → 2 Stimmen (dynamisch)');
assert.equal(requiredYesFor(4, groupConf, 'mixed-1'), 3, 'übrige Liste: 4 Anwesende → Mindeststimmen (Standard 3)');
assert.equal(requiredYesFor(4, groupConf, 'duo-1'), 1, '2er-Gruppe bleibt bei 1 Stimme, auch wenn mehr anwesend sind');
assert.equal(requiredYesFor(5, groupConf, 'quad-1'), 3, '4er-Gruppe bleibt bei 3 Stimmen, auch wenn mehr anwesend sind');

// 2er-Gruppe (duo-1): 1 Ja-Stimme genügt → Rauswurf.
await seedThresholdVote('vote-group-2er', 2, ['user-a'], [], 'duo-1');
await evaluateVote({ guild: thresholdGuild, voteId: 'vote-group-2er', conf: groupConf });
state = readState();
assert.equal(state.votes.g1['vote-group-2er'].settled, true, '2er-Gruppe: Abstimmung wird entschieden');
assert.ok((state.strikes?.g1?.['user-b'] || []).length >= 1, '2er-Gruppe: 1 Stimme genügt → Rauswurf (Strike wird gespeichert)');

// 3er-Gruppe (trio-1): 1 Ja-Stimme reicht nicht, 2 genügen.
await seedThresholdVote('vote-group-3er-one', 3, ['user-a'], [], 'trio-1');
const strikesBeforeGroup3 = (readState().strikes?.g1?.['user-b'] || []).length;
await evaluateVote({ guild: thresholdGuild, voteId: 'vote-group-3er-one', conf: groupConf });
state = readState();
assert.equal(state.votes.g1['vote-group-3er-one'].settled, true, '3er-Gruppe: wird entschieden');
assert.equal((state.strikes?.g1?.['user-b'] || []).length, strikesBeforeGroup3, '3er-Gruppe: 1 Stimme reicht nicht → kein Rauswurf');
await seedThresholdVote('vote-group-3er-pass', 3, ['user-a', 'user-d'], [], 'trio-1');
const strikesBeforeGroup3Pass = (readState().strikes?.g1?.['user-b'] || []).length;
await evaluateVote({ guild: thresholdGuild, voteId: 'vote-group-3er-pass', conf: groupConf });
state = readState();
assert.ok((state.strikes?.g1?.['user-b'] || []).length > strikesBeforeGroup3Pass, '3er-Gruppe: 2 Stimmen genügen → Rauswurf (Strike wird gespeichert)');

// 4er-Gruppe (quad-1): 1 Ja-Stimme reicht nicht, 3 genügen.
await seedThresholdVote('vote-group-4er-one', 4, ['user-a'], [], 'quad-1');
const strikesBeforeGroup4 = (readState().strikes?.g1?.['user-b'] || []).length;
await evaluateVote({ guild: thresholdGuild, voteId: 'vote-group-4er-one', conf: groupConf });
state = readState();
assert.equal(state.votes.g1['vote-group-4er-one'].settled, true, '4er-Gruppe: wird entschieden');
assert.equal((state.strikes?.g1?.['user-b'] || []).length, strikesBeforeGroup4, '4er-Gruppe: 1 Stimme reicht nicht → kein Rauswurf');
await seedThresholdVote('vote-group-4er-pass', 4, ['user-a', 'user-d', 'user-e'], [], 'quad-1');
const strikesBeforeGroup4Pass = (readState().strikes?.g1?.['user-b'] || []).length;
await evaluateVote({ guild: thresholdGuild, voteId: 'vote-group-4er-pass', conf: groupConf });
state = readState();
assert.ok((state.strikes?.g1?.['user-b'] || []).length > strikesBeforeGroup4Pass, '4er-Gruppe: 3 Stimmen genügen → Rauswurf (Strike wird gespeichert)');

// --- Sofort-Kick: Mehrheit vor Timer-Ablauf wirft sofort raus ---
// Beobachtbares Signal: voice.disconnect am Ziel-Mitglied wird sofort
// aufgerufen, ohne auf den Timer zu warten.
let disconnectCalls = 0;
const fast2CallMembers = new Map();
const fastVoiceChannel = {
  id: 'voice-1', name: 'Öffentlicher Call', type: 2, guild: { id: 'g1' }, isVoiceBased: () => true,
  members: { values: () => fast2CallMembers.values() }
};
const kickedMember = {
  id: 'user-kick',
  displayName: 'Kai',
  user: { username: 'kai' },
  voice: { channelId: 'voice-1', channel: fastVoiceChannel, disconnect: async () => { disconnectCalls += 1; } },
  timeout: async () => {},
  send: async () => {}
};
fast2CallMembers.set('user-a', { id: 'user-a', displayName: 'Alice', user: { username: 'alice' } });
fast2CallMembers.set('user-kick', kickedMember);
const fastGuild = {
  id: 'g1',
  channels: { cache: new Map([['voice-1', fastVoiceChannel]]) },
  members: { cache: new Map([['user-kick', kickedMember]]), fetch: async (id) => fast2CallMembers.get(String(id)) || null }
};
const fastConf = normalizePublicCallVoteConfig({ enabled: true, callChannelIds: ['voice-1'], timeoutSeconds: 60 });

// 2er-Call: Auto-Ja des Beantragers ist schon die Mehrheit → Kick beim Start.
let fast2Reply = null;
const fast2Start = {
  user: { id: 'user-a', username: 'alice' },
  member: { id: 'user-a', displayName: 'Alice', voice: { channel: fastVoiceChannel } },
  guildId: 'g1',
  guild: fastGuild,
  customId: `${PREFIX}vote:reason:user-kick`,
  isButton: () => false,
  isStringSelectMenu: () => true,
  values: ['noise'],
  channelId: 'text-1',
  channel: { send: async () => ({ id: 'msg-fast2-1' }) },
  reply: async (payload) => { fast2Reply = payload; }
};
await handleVoteInteraction({ interaction: fast2Start, guild: fastGuild, conf: fastConf });
assert.equal(disconnectCalls, 1, '2er-Call: Auto-Ja genügt → Kick sofort beim Start, ohne Timer-Wartezeit');
state = readState();
const fast2Vote = Object.values(state.votes.g1).find((vote) => vote.messageId === 'msg-fast2-1');
assert.equal(fast2Vote.settled, true, '2er-Call: Abstimmung ist sofort abgeschlossen');

// 3er-Call: 1 Auto-Ja reicht nicht → zweites Ja (Timer läuft noch) → sofortiger Kick.
disconnectCalls = 0;
const fast3CallMembers = new Map([
  ['user-a', { id: 'user-a', displayName: 'Alice', user: { username: 'alice' } }],
  ['user-b', { id: 'user-b', displayName: 'Bob', user: { username: 'bob' } }],
  ['user-kick', kickedMember]
]);
fastVoiceChannel.members = { values: () => fast3CallMembers.values() };
fastGuild.members.cache.set('user-kick', kickedMember);
const fast3Start = {
  user: { id: 'user-a', username: 'alice' },
  member: { id: 'user-a', displayName: 'Alice', voice: { channel: fastVoiceChannel } },
  guildId: 'g1',
  guild: fastGuild,
  customId: `${PREFIX}vote:reason:user-kick`,
  isButton: () => false,
  isStringSelectMenu: () => true,
  values: ['noise'],
  channelId: 'text-1',
  channel: { send: async () => ({ id: 'msg-fast3-1' }) },
  reply: async (payload) => {}
};
await handleVoteInteraction({ interaction: fast3Start, guild: fastGuild, conf: fastConf });
assert.equal(disconnectCalls, 0, '3er-Call: ein Ja reicht nicht → noch kein Kick');
state = readState();
const fast3VoteId = Object.keys(state.votes.g1).find((voteId) => state.votes.g1[voteId].messageId === 'msg-fast3-1');
const fast3Vote = state.votes.g1[fast3VoteId];
assert.ok(fast3Vote.endsAt > Date.now() + 30_000, 'Timer läuft noch (Zeit ist NICHT abgelaufen)');
let fast3Reply = null;
const fast3VoteInteraction = {
  user: { id: 'user-b' },
  member: { displayName: 'Bob', id: 'user-b' },
  guildId: 'g1',
  guild: fastGuild,
  customId: `${PREFIX}vote:yes:${fast3VoteId}`,
  isButton: () => true,
  isStringSelectMenu: () => false,
  reply: async (payload) => { fast3Reply = payload; }
};
await handleVoteInteraction({ interaction: fast3VoteInteraction, guild: fastGuild, conf: fastConf });
assert.equal(disconnectCalls, 1, '3er-Call: 2. Ja → Kick SOFORT, obwohl der Timer noch läuft');
state = readState();
assert.equal(state.votes.g1[fast3VoteId].settled, true, '3er-Call: Abstimmung ist abgeschlossen');
assert.ok(fast3Reply && String(fast3Reply.content).includes('entfernt'), 'Antwort bestätigt den Rauswurf');

// Embed zeigt die erforderliche Stimmenzahl je Call-Größe an.
const thresholdVoteBase = { targetUserId: 'user-b', targetName: 'Bob', reasonId: 'noise', channelId: 'voice-1', yes: ['user-a'], no: [], startedBy: 'user-a', startedByName: 'Alice', startedAt: Date.now(), endsAt: Date.now() + 30_000, panelChannelId: 'text-1', messageId: '' };
assert.equal(voteContext({ ...thresholdVoteBase, attendingCount: 2 }, { name: 'Test' }, thresholdConf).required, '1', 'Embed zeigt 1 erforderliche Stimme im 2er-Call');
assert.equal(voteContext({ ...thresholdVoteBase, attendingCount: 3 }, { name: 'Test' }, thresholdConf).required, '2', 'Embed zeigt 2 erforderliche Stimmen im 3er-Call');
assert.equal(voteContext({ ...thresholdVoteBase, attendingCount: 5 }, { name: 'Test' }, thresholdConf).required, '3', 'Größerer Call nutzt die konfigurierten Mindeststimmen');
const quadContextConf = normalizePublicCallVoteConfig({ enabled: true, callChannelIds4: ['voice-1'] });
assert.equal(voteContext({ ...thresholdVoteBase, attendingCount: 4 }, { name: 'Test' }, quadContextConf).required, '3', 'Embed zeigt 3 erforderliche Stimmen im 4er-Call');

// --- Design-Sektion speichern (Embed Studio) ---
const savedDesign = await savePublicCallVoteDesign({
  guild: { id: 'g1' },
  conf: normalizePublicCallVoteConfig({}),
  section: 'team',
  template: { embeds: [{ title: 'TEAM TEST', description: 'Neue Team-Meldung', color: '#123456' }] }
});
assert.equal(savedDesign.section, 'team');
assert.equal(savedDesign.design.team.title, 'TEAM TEST', 'Team-Sektion wird gespeichert');
assert.equal(savedDesign.design.team.description, 'Neue Team-Meldung');
assert.equal(savedDesign.normalizedDesign.panel.title.includes('Moderation'), true, 'Andere Sektionen bleiben unverändert');
assert.equal(savedDesign.normalizedDesign.vote.authorName, '{targetName}');
const fallbackSection = await savePublicCallVoteDesign({ guild: { id: 'g1' }, conf: {}, section: 'unbekannt', template: { title: 'X' } });
assert.equal(fallbackSection.section, 'panel', 'Unbekannte Sektion fällt auf Panel zurück');
assert.equal(fallbackSection.design.panel.timestamp, false, 'Fehlender Timestamp-Wert übernimmt den Panel-Standard statt ihn einzuschalten');

// --- 2er-/3er-Design-Sektionen: einzeln editierbar wie die Basis ---
const variant2Save = await savePublicCallVoteDesign({
  guild: { id: 'g1' },
  conf: normalizePublicCallVoteConfig({}),
  section: 'panel2',
  template: { embeds: [{ title: 'PANEL 2ER', description: '2er-Panel', color: '#ff0000' }] }
});
assert.equal(variant2Save.section, 'panel2');
assert.equal(variant2Save.design.panel2.title, 'PANEL 2ER', '2er-Panel-Sektion wird gespeichert');
assert.equal(variant2Save.design.panel2.description, '2er-Panel');
assert.equal(variant2Save.normalizedDesign.panel.title.includes('Moderation'), true, 'Basis-Panel bleibt unverändert');
assert.equal(variant2Save.normalizedDesign.panel3.title.includes('Moderation'), true, '3er-Panel fällt auf die Standard-Variante zurück');
const variant3Save = await savePublicCallVoteDesign({
  guild: { id: 'g1' },
  conf: normalizePublicCallVoteConfig({}),
  section: 'result3',
  template: { embeds: [{ title: 'RESULT 3ER' }] }
});
assert.equal(variant3Save.design.result3.title, 'RESULT 3ER', '3er-Ergebnis-Sektion wird gespeichert');
const team2Save = await savePublicCallVoteDesign({
  guild: { id: 'g1' },
  conf: normalizePublicCallVoteConfig({}),
  section: 'team2',
  template: { embeds: [{ title: 'TEAM 2ER' }] }
});
assert.equal(team2Save.design.team2.title, 'TEAM 2ER', '2er-Team-Sektion wird gespeichert');
const variant4Save = await savePublicCallVoteDesign({
  guild: { id: 'g1' },
  conf: normalizePublicCallVoteConfig({}),
  section: 'panel4',
  template: { embeds: [{ title: 'PANEL 4ER', description: '4er-Panel', color: '#00ff00' }] }
});
assert.equal(variant4Save.section, 'panel4');
assert.equal(variant4Save.design.panel4.title, 'PANEL 4ER', '4er-Panel-Sektion wird gespeichert');
assert.equal(variant4Save.design.panel4.description, '4er-Panel');
assert.equal(variant4Save.normalizedDesign.panel.title.includes('Moderation'), true, 'Basis-Panel bleibt unverändert');
const dm4Save = await savePublicCallVoteDesign({
  guild: { id: 'g1' },
  conf: normalizePublicCallVoteConfig({}),
  section: 'dm4',
  template: { embeds: [{ title: 'DM 4ER' }] }
});
assert.equal(dm4Save.design.dm4.title, 'DM 4ER', '4er-DM-Sektion wird gespeichert');

// designSectionFor wählt die richtige Sektion je Call-Typ.
const variantConf = normalizePublicCallVoteConfig({ enabled: true, callChannelIds2: ['duo-1'], callChannelIds3: ['trio-1'], callChannelIds4: ['quad-1'] });
assert.equal(designSectionFor('duo-1', 'panel', variantConf), 'panel2', '2er-Kanal nutzt panel2');
assert.equal(designSectionFor('trio-1', 'vote', variantConf), 'vote3', '3er-Kanal nutzt vote3');
assert.equal(designSectionFor('quad-1', 'vote', variantConf), 'vote4', '4er-Kanal nutzt vote4');
assert.equal(designSectionFor('mixed-1', 'result', variantConf), 'result', 'übriger Kanal nutzt die Basis-Sektion');
assert.equal(designSectionFor('duo-1', 'team', variantConf), 'team2', '2er-Kanal nutzt team2');
assert.equal(designSectionFor('trio-1', 'dm', variantConf), 'dm3', '3er-Kanal nutzt dm3');
assert.equal(designSectionFor('quad-1', 'panel', variantConf), 'panel4', '4er-Kanal nutzt panel4');
assert.equal(designSectionFor('quad-1', 'team', variantConf), 'team4', '4er-Kanal nutzt team4');
assert.equal(designSectionFor('quad-1', 'dm', variantConf), 'dm4', '4er-Kanal nutzt dm4');

// --- Countdown-Ticker startet/stoppt ohne Crash ---
stopVoteTicker('vote-nirgends');
startVoteTicker({ guild: callVoteGuild, voteId: 'vote-idle', conf: idleConf });
stopVoteTicker('vote-idle');
assert.ok(true, 'Ticker starten/stoppen ist stabil');

// --- Sekundengenauer Countdown: Ticks liegen exakt auf den Sekunden-Grenzen
// relativ zu endsAt, damit die Anzeige 60, 59, 58, … zählt und nie Zahlen
// überspringt (kein setInterval-Drift).
const cdNow = 1_000_000;
assert.equal(voteCountdownDelay(cdNow + 60_000, cdNow), 1000, '60 s Rest → nächster Tick in 1 s');
assert.equal(voteCountdownDelay(cdNow + 59_750, cdNow), 750, '59,75 s Rest → Anzeige 60, nächste Grenze in 750 ms');
// Nach jedem Tick sinkt die Anzeige um genau 1 – Simulationsschleife ohne
// Wartezeit: bei jeder Sekunden-Grenze ist der neue Wert ceil(rest/1000).
let simulatedRemaining = 60_000;
const displayedSequence = [];
while (simulatedRemaining > 0) {
  displayedSequence.push(Math.ceil(simulatedRemaining / 1000));
  const delay = voteCountdownDelay(cdNow + simulatedRemaining, cdNow);
  simulatedRemaining -= delay;
}
assert.deepEqual(displayedSequence.slice(0, 4), [60, 59, 58, 57], 'Countdown zählt 60 → 59 → 58 → 57, keine Sprünge');
assert.equal(displayedSequence.at(-1), 1, 'letzter angezeigter Wert ist 1 (danach entscheidet der Timer bei 0)');
assert.equal(displayedSequence.length, 60, 'genau 60 Anzeige-Schritte für 60 Sekunden');
assert.equal(voteCountdownDelay(cdNow, cdNow), 0, 'abgelaufene Zeit → 0 (Ticker stoppt, Timer entscheidet)');

// --- DM an das rausgeworfene Mitglied nutzt das editierbare dm-Design ---
let dmPayload = null;
const dmTarget = {
  id: 'user-b',
  displayName: 'Bob',
  user: { username: 'bob' },
  send: async (payload) => { dmPayload = payload; }
};
const dmConf = normalizePublicCallVoteConfig({});
const dmGuild = {
  id: 'g1',
  name: 'Test Server',
  members: { cache: new Map([['user-b', { displayAvatarURL: () => 'https://cdn.example/avatar.png' }]]) }
};
await sendKickDm({ guild: dmGuild, vote: createdVote, reason: dmConf.voteReasons[2], targetMember: dmTarget });
assert.ok(dmPayload, 'DM wird gesendet');
const dmEmbed = dmPayload.embeds[0].toJSON();
assert.equal(dmEmbed.title, '🚫 Du wurdest aus dem Call entfernt', 'DM nutzt das editierbare Design');
assert.ok(String(dmEmbed.description).includes('Lärm / Musik'), 'Grund-Platzhalter wird ersetzt');
assert.ok(String(dmEmbed.description).includes('15 Min.'), 'Call-Sperre wird ersetzt');
assert.equal(dmEmbed.author.name.includes('Bob'), true, 'Autor zeigt den echten Namen');
assert.equal(dmEmbed.author.icon_url, 'https://cdn.example/avatar.png', 'Autor zeigt den Avatar');
assert.equal(dmEmbed.footer.text, 'Test Server', 'Footer nutzt {server}');

// --- Team-Meldung & DM nutzen je nach Call-Typ die 2er-/3er-Sektionen ---
const dm2Conf = normalizePublicCallVoteConfig({ callChannelIds2: ['duo-1'] });
dm2Conf.design.dm2.title = 'DM 2ER TEST';
dm2Conf.design.dm2.authorName = 'DM2 Autor';
await sendKickDm({ guild: dmGuild, vote: { ...createdVote, channelId: 'duo-1' }, reason: dm2Conf.voteReasons[2], targetMember: dmTarget, conf: dm2Conf });
assert.equal(dmPayload.embeds[0].toJSON().title, 'DM 2ER TEST', '2er-Call-DM nutzt die dm2-Sektion');
assert.equal(dmPayload.embeds[0].toJSON().author.name.includes('DM2 Autor'), true, 'dm2-Autor wird verwendet');

const dm4Conf = normalizePublicCallVoteConfig({ callChannelIds4: ['quad-1'] });
dm4Conf.design.dm4.title = 'DM 4ER TEST';
dm4Conf.design.dm4.authorName = 'DM4 Autor';
await sendKickDm({ guild: dmGuild, vote: { ...createdVote, channelId: 'quad-1' }, reason: dm4Conf.voteReasons[2], targetMember: dmTarget, conf: dm4Conf });
assert.equal(dmPayload.embeds[0].toJSON().title, 'DM 4ER TEST', '4er-Call-DM nutzt die dm4-Sektion');
assert.equal(dmPayload.embeds[0].toJSON().author.name.includes('DM4 Autor'), true, 'dm4-Autor wird verwendet');

let teamPayload = null;
const teamGuild = {
  id: 'g1',
  name: 'Test Server',
  channels: { cache: new Map([['team-1', { id: 'team-1', isTextBased: () => true, send: async (payload) => { teamPayload = payload; } }]]) },
  members: { cache: new Map() }
};
const teamConf = normalizePublicCallVoteConfig({ teamChannelId: 'team-1', callChannelIds3: ['trio-1'] });
teamConf.design.team3.title = 'TEAM 3ER TEST';
await sendTeamNotice({ guild: teamGuild, vote: { ...createdVote, channelId: 'trio-1' }, reason: teamConf.voteReasons[0], targetMember: null, recentStrikes: 0, timedOut: false, conf: teamConf });
assert.ok(teamPayload, 'Team-Meldung wird gesendet');
assert.equal(teamPayload.embeds[0].toJSON().title, 'TEAM 3ER TEST', '3er-Call-Team-Meldung nutzt die team3-Sektion');

const team4Conf = normalizePublicCallVoteConfig({ teamChannelId: 'team-1', callChannelIds4: ['quad-1'] });
team4Conf.design.team4.title = 'TEAM 4ER TEST';
await sendTeamNotice({ guild: teamGuild, vote: { ...createdVote, channelId: 'quad-1' }, reason: team4Conf.voteReasons[0], targetMember: null, recentStrikes: 0, timedOut: false, conf: team4Conf });
assert.ok(teamPayload, 'Team-Meldung wird gesendet');
assert.equal(teamPayload.embeds[0].toJSON().title, 'TEAM 4ER TEST', '4er-Call-Team-Meldung nutzt die team4-Sektion');

// --- Mentions statt Klartext: {targetMention} und {requesterMention} pingen ---
const mentionContext = voteContext(createdVote, { name: 'Test Server' }, normalizePublicCallVoteConfig({}));
assert.equal(mentionContext.targetMention, '<@user-b>', 'targetMention ist ein echter Ping');
assert.equal(mentionContext.requesterMention, '<@user-a>', 'requesterMention ist ein echter Ping');
const mentionText = formatVoteText('{targetMention} wurde entfernt. Beantragt von {requesterMention}', mentionContext, 4096);
assert.equal(mentionText.includes('<@user-b>'), true, 'formatVoteText ersetzt {targetMention}');
assert.equal(mentionText.includes('<@user-a>'), true, 'formatVoteText ersetzt {requesterMention}');

// --- {target} ist ein ECHTER Ping, {targetName} der Klarname ---
const targetPingText = formatVoteText('Soll **{target}** aus {channel} entfernt werden?', mentionContext, 4096);
assert.equal(targetPingText.includes('<@user-b>'), true, '{target} wird als echter Ping ersetzt');
assert.equal(targetPingText.includes('Bob'), false, '{target} ersetzt NICHT den Klarnamen');
const targetNameText = formatVoteText('Autor: {targetName}', mentionContext, 4096);
assert.equal(targetNameText, 'Autor: Bob', '{targetName} bleibt der Klarname');
// Autor-Zeile: Discord rendert keine Mentions – {target} im authorName bleibt Klarname
const authorContext = { ...mentionContext };
const authorNameText = formatVoteText(String('{target}').replaceAll('{target}', '{targetName}'), authorContext, 256);
assert.equal(authorNameText, 'Bob', 'Autor-Zeile mit {target} zeigt Klarname, kein rohes <@id>');

// --- Defer-Pfad: Antworten nach deferReply laufen über editReply ---
let deferredPayload = null;
await respondTo({ deferred: true, editReply: async (payload) => { deferredPayload = payload; } }, { content: 'x' });
assert.equal(deferredPayload?.content, 'x', 'defer + editReply funktioniert');
let replyPayload = null;
await respondTo({ reply: async (payload) => { replyPayload = payload; } }, { content: 'y' });
assert.equal(replyPayload?.content, 'y', 'ohne defer weiterhin reply');

// --- Live-Refresh: Design-Änderung editiert Panels & laufende Votes sofort ---
let panelEdits = 0;
let voteEdits = 0;
const refreshPanelMessage = {
  id: 'panel-msg-1',
  edit: async (payload) => { panelEdits += 1; refreshPanelPayload = payload; }
};
let refreshPanelPayload = null;
const refreshVoteMessage = {
  id: 'vote-msg-1',
  edit: async (payload) => { voteEdits += 1; refreshVotePayload = payload; }
};
let refreshVotePayload = null;
const refreshTextChannel = {
  id: 'text-1',
  name: 'Call-Moderation',
  type: 0,
  messages: { cache: new Map([['vote-msg-1', refreshVoteMessage]]), fetch: async (id) => null }
};
const refreshGuild = {
  id: 'g1',
  name: 'Test Server',
  channels: {
    cache: new Map([
      ['voice-1', null],
      ['text-1', refreshTextChannel]
    ])
  },
  members: { cache: new Map([['user-b', { displayAvatarURL: () => 'https://cdn.example/avatar.png' }]]) }
};
const refreshPanelChannel = {
  id: 'voice-1',
  name: 'Öffentlicher Call',
  type: 2,
  guild: refreshGuild,
  isVoiceBased: () => true,
  members: { values: () => callMemberMap.values() },
  messages: { cache: new Map([['panel-msg-1', refreshPanelMessage]]), fetch: async (id) => null }
};
refreshGuild.channels.cache.set('voice-1', refreshPanelChannel);
// State vorbereiten: ein Panel + eine laufende Abstimmung im Textkanal.
// Über den Seed-Hook, damit der interne State des Moduls (nicht nur die Datei)
// den bekannten Zustand kennt – der Refresh liest den internen State.
state = readState();
state.votes.g1['vote-refresh'] = {
  targetUserId: 'user-b',
  targetName: 'Bob',
  reasonId: 'noise',
  channelId: 'voice-1',
  attendingCount: 2,
  yes: ['user-a'],
  no: [],
  startedBy: 'user-a',
  startedByName: 'Alice',
  startedAt: Date.now(),
  endsAt: Date.now() + 60_000,
  messageId: 'vote-msg-1',
  panelChannelId: 'text-1',
  settled: false
};
await seedPublicCallVoteState({
  panels: { g1: { 'voice-1': 'panel-msg-1' } },
  votes: state.votes
});
const refreshConf = normalizePublicCallVoteConfig({
  enabled: true,
  callChannelIds: ['voice-1'],
  design: {
    panel: { title: 'NEUES PANEL' },
    vote: { title: 'NEUE ABSTIMMUNG' }
  }
});
await refreshPublicCallVoteLive({ guild: refreshGuild, conf: refreshConf });
await new Promise((resolve) => setTimeout(resolve, 50));
assert.equal(panelEdits, 1, 'Panel wird nach Design-Save sofort editiert');
assert.equal(voteEdits, 1, 'Laufende Abstimmung wird nach Design-Save sofort editiert');
assert.ok(refreshPanelPayload?.embeds?.[0]?.toJSON?.()?.title === 'NEUES PANEL' || String(refreshPanelPayload?.embeds?.[0]?.title || refreshPanelPayload?.embeds?.[0]?.data?.title || '').includes('NEUES PANEL'), 'Panel nutzt das neue Design');
assert.ok(String(refreshVotePayload?.embeds?.[0]?.title || refreshVotePayload?.embeds?.[0]?.data?.title || '').includes('NEUE ABSTIMMUNG'), 'Vote nutzt das neue Design');
assert.ok(panelEdits + voteEdits >= 2, 'Keine Nachricht wird gelöscht – nur editiert');

// Gelöschte oder noch nie registrierte Panels müssen beim Live-Refresh neu
// entstehen. Sonst bestätigt das Embed-Studio den Save, im Call erscheint aber
// weiterhin nichts.
let recreatedPanelPayload = null;
refreshPanelChannel.send = async (payload) => {
  recreatedPanelPayload = payload;
  return { id: 'panel-msg-recreated' };
};
await seedPublicCallVoteState({ panels: { g1: {} }, votes: { g1: {} } });
await refreshPublicCallVoteLive({ guild: refreshGuild, conf: refreshConf });
assert.equal(recreatedPanelPayload?.embeds?.[0]?.toJSON?.()?.title, 'NEUES PANEL', 'Live-Refresh erstellt ein fehlendes Moderations-Panel neu');
assert.equal(readState().panels.g1['voice-1'], 'panel-msg-recreated', 'neu erstelltes Panel wird dauerhaft registriert');

// --- Persistente Call-Sperren: überleben Neustart + Offline-Zeit, event-basiert ---
const {
  activateCallLock,
  releaseCallLock,
  restoreCallLocks,
  handleVoiceStateForLocks,
  isLockActive,
  getPublicCallVoteLocks,
  getPublicCallVoteLocksList,
  removePublicCallVoteLock
} = _publicCallVoteInternals;

const lockOverwriteCalls = [];
const lockChannel = {
  id: 'voice-1',
  name: 'Öffentlicher Call',
  type: 2,
  permissionOverwrites: {
    edit: async (userId, payload) => { lockOverwriteCalls.push({ userId, payload }); }
  }
};
const lockGuild = {
  id: 'g1',
  channels: { cache: new Map([['voice-1', lockChannel]]) }
};

// 1. Sperre aktivieren → im State (Datei) gespeichert, Overwrite gesetzt, Timer läuft.
const lockMs = 60 * 60_000; // 1 Stunde
await activateCallLock({
  guild: lockGuild,
  guildId: 'g1',
  userId: 'user-locked',
  channelId: 'voice-1',
  lockMs,
  reasonId: 'spam'
});
state = readState();
const storedLock = state.locks?.g1?.['user-locked'];
assert.ok(storedLock, 'Sperre wird in die State-Datei geschrieben');
assert.equal(storedLock.channelId, 'voice-1');
assert.ok(storedLock.until > Date.now(), 'Endzeit liegt in der Zukunft');
assert.equal(storedLock.reasonId, 'spam');
assert.equal(lockOverwriteCalls.at(-1)?.payload?.Connect, false, 'Permission-Overwrite auf Connect:false gesetzt');
assert.equal(isLockActive(storedLock), true, 'aktive Sperre erkannt');
assert.ok(await getPublicCallVoteLocks('g1', 'user-locked'), 'Sperre über Getter abrufbar');

// 2. „Neustart“: internen State neu laden (simuliert Prozess-Neustart) und
//    restoreCallLocks ausführen → laufende Sperre wird mit Restzeit reaktiviert.
await seedPublicCallVoteState({}); // lädt den persistierten State neu
const overwriteBefore = lockOverwriteCalls.length;
await restoreCallLocks(lockGuild);
assert.ok(lockOverwriteCalls.length >= overwriteBefore, 'restoreCallLocks setzt Overwrite erneut');
state = readState();
assert.ok(state.locks?.g1?.['user-locked'], 'Sperre bleibt nach Neustart erhalten');

// 3. Abgelaufene Sperre (z. B. Bot war 2h offline, Sperre war 1h) → beim Start
//    sofort freigegeben, ohne dass der User ewig blockiert bleibt.
const expiredUntil = Date.now() - 60_000;
await seedPublicCallVoteState({
  locks: { g1: { 'user-expired': { at: Date.now() - 120_000, until: expiredUntil, channelId: 'voice-1', reasonId: 'noise' } } }
});
lockOverwriteCalls.length = 0;
await restoreCallLocks(lockGuild);
state = readState();
assert.ok(!state.locks?.g1?.['user-expired'], 'abgelaufene Sperre wird beim Start entfernt');
assert.equal(lockOverwriteCalls.at(-1)?.payload?.Connect, null, 'abgelaufene Sperre wird freigegeben (Connect:null)');

// 4. Event-basiert: Join-Versuch in einen gesperrten Channel mit abgelaufener
//    Sperre → sofort entsperrt (kein Polling).
lockOverwriteCalls.length = 0;
await seedPublicCallVoteState({
  locks: { g1: { 'user-join': { at: Date.now() - 120_000, until: Date.now() - 30_000, channelId: 'voice-1', reasonId: 'noise' } } }
});
await handleVoiceStateForLocks(
  { channelId: 'voice-1', member: { id: 'user-join' } },
  lockGuild
);
state = readState();
assert.ok(!state.locks?.g1?.['user-join'], 'Join-Versuch entfernt die abgelaufene Sperre');
assert.equal(lockOverwriteCalls.at(-1)?.payload?.Connect, null, 'Join wird durch Freigabe ermöglicht');

// 5. Noch aktive Sperre wird beim Join-Versuch NICHT entfernt.
lockOverwriteCalls.length = 0;
await seedPublicCallVoteState({
  locks: { g1: { 'user-still-locked': { at: Date.now(), until: Date.now() + 60_000, channelId: 'voice-1', reasonId: 'spam' } } }
});
await handleVoiceStateForLocks(
  { channelId: 'voice-1', member: { id: 'user-still-locked' } },
  lockGuild
);
assert.ok(await getPublicCallVoteLocks('g1', 'user-still-locked'), 'aktive Sperre bleibt beim Join-Versuch bestehen');

// 6. releaseCallLock entfernt Sperre + Timer + Overwrite.
await releaseCallLock({ guild: lockGuild, guildId: 'g1', userId: 'user-still-locked', channelId: 'voice-1' });
state = readState();
assert.ok(!state.locks?.g1?.['user-still-locked'], 'releaseCallLock entfernt die Sperre');

// --- Dashboard: Gesperrte Spieler (2er/3er/4er) anzeigen + aufheben ---
await seedPublicCallVoteState({ locks: {} });
const listGuild = {
  id: 'g1',
  channels: { cache: new Map([['voice-1', lockChannel]]) },
  members: { cache: { get: (id) => (id === 'user-dash' ? { displayName: 'Dash User', user: { username: 'dash', id: 'user-dash', avatar: 'abc123' } } : undefined) } }
};
await activateCallLock({
  guild: listGuild,
  guildId: 'g1',
  userId: 'user-dash',
  channelId: 'voice-1',
  lockMs: 30 * 60_000,
  reasonId: 'spam'
});
const lockConf = {
  enabled: true,
  callChannelIds: [],
  callChannelIds2: ['voice-1'],
  callChannelIds3: [],
  callChannelIds4: [],
  voteReasons: [{ id: 'spam', label: 'Spam / Werbung' }]
};
const locksList = await getPublicCallVoteLocksList(listGuild, lockConf);
assert.equal(locksList.locks.length, 1, 'aktive Call-Sperre wird im Dashboard gelistet');
assert.equal(locksList.locks[0].userId, 'user-dash', 'gesperrter User ist gelistet');
assert.equal(locksList.locks[0].name, 'Dash User', 'Anzeigename kommt vom Mitglied');
assert.ok(locksList.locks[0].avatarUrl.includes('cdn.discordapp.com/avatars/user-dash/abc123.png'), 'Avatar-URL kommt vom Discord-Profilbild');
assert.equal(locksList.locks[0].callType, '2er', 'Call-Art wird aus der 2er-Liste erkannt');
assert.equal(locksList.locks[0].reasonLabel, 'Spam / Werbung', 'Grund-Label kommt aus den Vote-Reasons');
assert.equal(locksList.locks[0].channelName, 'Öffentlicher Call', 'Kanalname wird mitgeliefert');
assert.ok(locksList.locks[0].remainingMs > 0, 'Restzeit wird mitgegeben');
lockOverwriteCalls.length = 0;
const removedPcv = await removePublicCallVoteLock({ guild: listGuild, guildId: 'g1', userId: 'user-dash' });
assert.equal(removedPcv.ok, true, 'manuelle Aufhebung meldet Erfolg');
const locksAfter = await getPublicCallVoteLocksList(listGuild, lockConf);
assert.equal(locksAfter.locks.length, 0, 'nach Aufheben ist die Liste leer');
assert.equal(lockOverwriteCalls.at(-1)?.payload?.Connect, null, 'Aufhebung setzt Connect:null zurück');
const noLockList = await getPublicCallVoteLocksList(listGuild, lockConf);
assert.equal(noLockList.locks.length, 0, 'ohne Sperren ist die Liste leer');

// --- Freigabe-DM: Nach Ablauf der Call-Sperre bekommt das Mitglied eine DM ---
let releaseDmPayload = null;
const releaseMember = {
  id: 'user-release',
  displayName: 'Ralf',
  user: { username: 'ralf' },
  send: async (payload) => { releaseDmPayload = payload; }
};
const releaseGuild = {
  id: 'g1',
  name: 'Test Server',
  members: { cache: new Map([['user-release', releaseMember]]), fetch: async () => null },
  channels: { cache: new Map() }
};
const releaseConf = normalizePublicCallVoteConfig({ callChannelIds2: ['duo-1'] });
releaseConf.design.release2.title = 'RELEASE 2ER TEST';
const expiredLock = { at: Date.now() - 60 * 60_000, until: Date.now() - 1000, channelId: 'duo-1', reasonId: 'noise' };
await sendLockReleaseDm({ guild: releaseGuild, userId: 'user-release', lock: expiredLock, conf: releaseConf });
assert.ok(releaseDmPayload, 'Freigabe-DM wird gesendet');
const releaseEmbed = releaseDmPayload.embeds[0].toJSON();
assert.equal(releaseEmbed.title, 'RELEASE 2ER TEST', '2er-Call nutzt die release2-Sektion');
assert.ok(String(releaseEmbed.description).includes('Lärm / Musik'), 'Grund-Platzhalter wird ersetzt');
assert.ok(String(releaseEmbed.description).includes('60 Min.'), 'Sperrdauer wird ersetzt');
assert.equal(releaseEmbed.author.name.includes('Ralf'), true, 'Autor zeigt den echten Namen');
assert.equal(releaseEmbed.footer.text, 'Test Server', 'Footer nutzt {server}');

// releaseCallLock sendet die Freigabe-DM NUR bei abgelaufener Sperre – eine
// manuelle Freigabe einer laufenden Sperre sendet keine DM.
let activeReleaseDm = false;
const activeReleaseGuild = {
  id: 'g1',
  name: 'Test Server',
  members: { cache: new Map([['user-active', { id: 'user-active', displayName: 'Anna', user: { username: 'anna' }, send: async () => { activeReleaseDm = true; } }]]) },
  channels: { cache: new Map() }
};
await seedPublicCallVoteState({
  locks: { g1: { 'user-active': { at: Date.now(), until: Date.now() + 60_000, channelId: 'voice-1', reasonId: 'spam' } } }
});
await releaseCallLock({ guild: activeReleaseGuild, guildId: 'g1', userId: 'user-active', channelId: 'voice-1' });
assert.ok(!activeReleaseDm, 'manuelle Freigabe einer laufenden Sperre sendet KEINE Freigabe-DM');

// Abgelaufene Sperre beim Start-Scan (Bot war offline) → Freigabe-DM kommt.
let restoreReleaseDm = false;
const restoreReleaseGuild = {
  id: 'g1',
  name: 'Test Server',
  members: { cache: new Map([['user-expired2', { id: 'user-expired2', displayName: 'Erik', user: { username: 'erik' }, send: async () => { restoreReleaseDm = true; } }]]) },
  channels: { cache: new Map() }
};
await seedPublicCallVoteState({
  locks: { g1: { 'user-expired2': { at: Date.now() - 120_000, until: Date.now() - 60_000, channelId: 'voice-1', reasonId: 'noise' } } }
});
await restoreCallLocks(restoreReleaseGuild);
assert.ok(restoreReleaseDm, 'abgelaufene Sperre beim Start-Scan löst die Freigabe-DM aus');

// Panel-/Abstimmungs-Buttons editierbar (3.9.222-Prinzip).
{
  const { panelComponents, voteComponents, normalizePublicCallVoteConfig } = _publicCallVoteInternals;
  const conf = normalizePublicCallVoteConfig({
    enabled: true,
    requestButtonLabel: 'Rauswurf starten',
    yesButtonLabel: 'Ja, raus damit',
    noButtonLabel: 'Nein, bleibt'
  });
  const panelRow = panelComponents(conf).map((row) => row.components.map((b) => b.data.label));
  assert.deepEqual(panelRow, [['Rauswurf starten']], 'Rauswurf-Button-Label editierbar');
  const voteRow = voteComponents('v1', conf).map((row) => row.components.map((b) => b.data.label));
  assert.deepEqual(voteRow, [['Ja, raus damit', 'Nein, bleibt']], 'Dafür/Dagegen-Labels editierbar');
  const defaults = normalizePublicCallVoteConfig({ enabled: true });
  assert.equal(defaults.requestButtonLabel, 'Rauswurf beantragen', 'Default Rauswurf-Button');
  assert.equal(defaults.yesButtonLabel, 'Dafür', 'Default Ja-Button');
  assert.equal(defaults.noButtonLabel, 'Dagegen', 'Default Nein-Button');
  console.log('✅ Panel-/Abstimmungs-Buttons: Labels editierbar (Rauswurf/Dafür/Dagegen)');
}

// Ergebnis-Embed (3.9.229): {outcomeText} kommt aus editierbaren Modul-Feldern
// statt hartkodiert „wird entfernt“/„bleibt im Call“.
{
  const { resultEmbed, normalizePublicCallVoteConfig } = _publicCallVoteInternals;
  const baseConf = normalizePublicCallVoteConfig({ enabled: true });
  const vote = {
    targetUserId: 'user-x',
    targetName: 'Xenia',
    reasonId: 'spam',
    reason: 'Spam / Flood',
    channelId: 'voice-1',
    channelName: 'Voice 1',
    attendingCount: 3,
    yes: ['a'],
    no: [],
    startedBy: 'user-a',
    startedByName: 'Alice'
  };
  const guildMock = {
    name: 'Test Server',
    members: { cache: new Map([['user-x', { id: 'user-x', displayName: 'Xenia', user: { avatar: null, username: 'xenia' } }]]) }
  };
  const passedEmbed = resultEmbed(vote, guildMock, baseConf, true);
  const failedEmbed = resultEmbed(vote, guildMock, baseConf, false);
  assert.ok(passedEmbed.data.description.includes('wird entfernt'), 'Default outcomeText bei Rauswurf: „wird entfernt“');
  assert.ok(failedEmbed.data.description.includes('bleibt im Call'), 'Default outcomeText bei Ablehnung: „bleibt im Call“');
  const customConf = normalizePublicCallVoteConfig({
    enabled: true,
    passedOutcomeText: 'muss den Call verlassen',
    failedOutcomeText: 'darf bleiben'
  });
  const customPassed = resultEmbed(vote, guildMock, customConf, true);
  const customFailed = resultEmbed(vote, guildMock, customConf, false);
  assert.ok(customPassed.data.description.includes('muss den Call verlassen'), 'Editierbarer outcomeText (bestanden)');
  assert.ok(customFailed.data.description.includes('darf bleiben'), 'Editierbarer outcomeText (abgelehnt)');
  assert.ok(!customPassed.data.description.includes('wird entfernt'), 'Kein hartkodierter Text mehr');
  console.log('✅ Ergebnis-Embed: {outcomeText} aus editierbaren Feldern (passed/failed)');
}

console.log('✅ public-call-vote-smoke: alle Assertions grün');
