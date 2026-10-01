import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { featureCards, normalizeConfig } from '../src/defaultConfig.js';
import {
  calculateServerTagDecision,
  evaluateServerTagState,
  normalizeServerTagTrackerConfig,
  _serverTagTrackerInternals
} from '../src/features/serverTagTracker.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const matching = evaluateServerTagState({
  primaryGuild: { identityGuildId: 'guild-1', identityEnabled: true, tag: 'FH', badge: 'badge-hash-123' }
}, 'guild-1');
assert.equal(matching.state, 'wearing', 'Die eigene Server-ID muss als aktiver Server-Tag erkannt werden.');
assert.equal(matching.tag, 'FH');
assert.equal(matching.badge, 'badge-hash-123', 'Das Discord-Badge des Server-Tags muss mitgeführt werden.');

const lookalike = evaluateServerTagState({
  primaryGuild: { identityGuildId: 'guild-2', identityEnabled: true, tag: 'FH' }
}, 'guild-1');
assert.equal(lookalike.state, 'not-wearing', 'Ein gleicher sichtbarer Tag eines anderen Servers darf nicht zählen.');

assert.equal(evaluateServerTagState({ primaryGuild: null }, 'guild-1').state, 'not-wearing');
assert.equal(evaluateServerTagState({}, 'guild-1').state, 'unknown', 'Fehlende Discord-Daten dürfen keinen Rollenentzug auslösen.');
assert.equal(evaluateServerTagState({ primaryGuild: {} }, 'guild-1').state, 'not-wearing', 'Ein leeres Primärserver-Profil ohne Identität darf nicht als unklar zählen.');
assert.equal(evaluateServerTagState({ primaryGuild: { identityGuildId: 'guild-1', identityEnabled: null } }, 'guild-1').state, 'not-wearing');
const incompleteTag = evaluateServerTagState({ primaryGuild: { identityGuildId: 'guild-1', identityEnabled: true, tag: '' } }, 'guild-1');
assert.equal(incompleteTag.state, 'wearing', 'Aktive Identität mit passendem Primärserver zählt als Träger, auch wenn das tag-Feld leer geliefert wurde.');
assert.equal(incompleteTag.reason, 'matching-primary-guild-tag-unreported', 'Leeres tag-Feld wird als unvollständige API-Antwort gekennzeichnet.');
assert.equal(_serverTagTrackerInternals.selectInitialObservation({
  authoritativeUser: null,
  memberUser: { primaryGuild: null },
  guildId: 'guild-1'
}).state, 'not-wearing', 'Ein Vollabgleich ohne Ereignisprofil darf nicht an einem Nullwert abbrechen.');

const directNegative = calculateServerTagDecision({
  state: 'not-wearing', previousMisses: 0, hasRole: true
});
assert.deepEqual(directNegative, { action: 'remove', nextPositiveConfirmations: 0, nextMisses: 1, confirmed: true }, 'Standard: kein passender Server-Tag entfernt die Rolle sofort.');

const heldNegative = calculateServerTagDecision({
  state: 'not-wearing', previousMisses: 0, hasRole: true, removalConfirmations: 2
});
assert.deepEqual(heldNegative, { action: 'none', nextPositiveConfirmations: 0, nextMisses: 1, confirmed: false }, 'Optional konfigurierte Geduld darf weiterhin funktionieren.');

const duplicateNegative = calculateServerTagDecision({
  state: 'not-wearing', previousMisses: 1, hasRole: true, removalConfirmations: 2, allowMissIncrement: false
});
assert.deepEqual(duplicateNegative, { action: 'none', nextPositiveConfirmations: 0, nextMisses: 1, confirmed: false }, 'Doppelte Ereignisse dürfen nicht als neue Bestätigung zählen.');

const secondNegative = calculateServerTagDecision({
  state: 'not-wearing', previousMisses: 1, hasRole: true, removalConfirmations: 2
});
assert.deepEqual(secondNegative, { action: 'remove', nextPositiveConfirmations: 0, nextMisses: 2, confirmed: true });

const unknown = calculateServerTagDecision({
  state: 'unknown', previousMisses: 1, hasRole: true, removalConfirmations: 2
});
assert.deepEqual(unknown, { action: 'none', nextPositiveConfirmations: 0, nextMisses: 1, confirmed: false });

const directPositive = calculateServerTagDecision({
  state: 'wearing', previousMisses: 2, hasRole: false
});
assert.deepEqual(directPositive, { action: 'add', nextPositiveConfirmations: 1, nextMisses: 0, confirmed: true }, 'Standard: passender Server-Tag vergibt die Rolle sofort.');

const heldPositive = calculateServerTagDecision({
  state: 'wearing', previousMisses: 2, hasRole: false, assignmentConfirmations: 2
});
assert.deepEqual(heldPositive, { action: 'none', nextPositiveConfirmations: 1, nextMisses: 0, confirmed: false }, 'Optional konfigurierte zweite Bestätigung darf weiterhin funktionieren.');

const duplicatePositive = calculateServerTagDecision({
  state: 'wearing', previousPositiveConfirmations: 1, hasRole: false, assignmentConfirmations: 2, allowPositiveIncrement: false
});
assert.deepEqual(duplicatePositive, { action: 'none', nextPositiveConfirmations: 1, nextMisses: 0, confirmed: false });

const secondPositive = calculateServerTagDecision({
  state: 'wearing', previousPositiveConfirmations: 1, hasRole: false, assignmentConfirmations: 2
});
assert.deepEqual(secondPositive, { action: 'add', nextPositiveConfirmations: 2, nextMisses: 0, confirmed: true });

const immediatePositiveEvent = calculateServerTagDecision({
  state: 'wearing', hasRole: false, authoritativeEvent: true
});
assert.deepEqual(immediatePositiveEvent, { action: 'add', nextPositiveConfirmations: 1, nextMisses: 0, confirmed: true });

const immediateNegativeEvent = calculateServerTagDecision({
  state: 'not-wearing', hasRole: true, authoritativeEvent: true
});
assert.deepEqual(immediateNegativeEvent, { action: 'remove', nextPositiveConfirmations: 0, nextMisses: 1, confirmed: true });

const normalized = normalizeServerTagTrackerConfig({
  enabled: true,
  roleIds: [' 123 ', '456', '123'],
  scanIntervalMinutes: 1,
  assignmentConfirmations: 99,
  removalConfirmations: 99,
  maxAssignmentsPerScan: 0,
  excludedRoleIds: ['7', '7', '8']
});
assert.equal(normalized.roleId, '123');
assert.deepEqual(normalized.roleIds, ['123', '456']);
assert.equal(normalized.scanIntervalMinutes, 5);
assert.equal(normalized.assignmentConfirmations, 5);
assert.equal(normalized.removalConfirmations, 5);
assert.equal(normalized.maxAssignmentsPerScan, 1);
assert.deepEqual(normalized.excludedRoleIds, ['7', '8']);
assert.equal(_serverTagTrackerInternals.MIN_NEGATIVE_CONFIRMATION_GAP_MS, 60_000);
assert.equal(_serverTagTrackerInternals.MIN_POSITIVE_CONFIRMATION_GAP_MS, 60_000);

const defaultTracker = normalizeConfig({}).serverTagTracker;
assert.equal(defaultTracker.enabled, false, 'Das neue Modul darf nach einer Migration nicht ungefragt Rollen verändern.');
assert.equal(defaultTracker.monitorOnly, true, 'Neue und migrierte Konfigurationen müssen zuerst ohne Rollenänderungen prüfen.');
assert.equal(defaultTracker.removalConfirmations, 1);
assert.equal(defaultTracker.assignmentConfirmations, 1);
assert.equal(defaultTracker.maxAssignmentsPerScan, 10);
assert.equal(defaultTracker.excludeBots, true);
assert.deepEqual(normalizeConfig({ serverTagTracker: { roleId: '789' } }).serverTagTracker.roleIds, ['789'], 'Eine bestehende Einzelrolle muss automatisch in die Mehrfachauswahl migriert werden.');

const card = featureCards.find((entry) => entry.id === 'serverTagTracker');
assert.ok(card, 'Die Modulkarte für den Server-Tag-Tracker fehlt.');
const fields = new Map(card.fields.map((field) => [field.key, String(field.type || '').toLowerCase()]));
assert.equal(fields.get('serverTagTracker.roleIds'), 'multiroleselect');
assert.equal(fields.get('serverTagTracker.monitorOnly'), 'checkbox');
assert.equal(fields.get('serverTagTracker.excludedRoleIds'), 'multiroleselect');
assert.equal(fields.get('serverTagTracker.logChannelId'), 'channelselect');

const indexSource = read('src/index.js');
const dashboardSource = read('src/dashboard.js');
const rendererSource = read('desktop/renderer/app.js');
const trackerSource = read('src/features/serverTagTracker.js');
assert.match(indexSource, /Events\.UserUpdate/);
assert.match(indexSource, /return queueServerTagReconcile\(/, 'Der manuelle Abgleich muss sofort antworten und im Hintergrund laufen.');
assert.match(dashboardSource, /\/server-tag-tracker\/sync/);
assert.match(rendererSource, /data-sync-server-tags/);
assert.match(trackerSource, /users\.fetch\(userId, \{ cache: true, force: true \}\)/, 'Positive oder rollenrelevante Prüfungen müssen das Discord-Profil ohne Cache neu laden.');
assert.match(trackerSource, /guild-tag-badges\/\$\{guildId\}\/\$\{hash\}/, 'Die Badge-CDN-URL des echten Discord-Server-Tags muss gebaut werden.');
assert.match(trackerSource, /\|\| observation\.state === 'unknown'/, 'Unklare Profile müssen beim nächsten Abgleich frisch von Discord geprüft werden.');
assert.match(trackerSource, /badgeUrl/, 'Das Badge-Bild des Server-Tags muss im Mitgliedersatz mitgeliefert werden.');
assert.match(rendererSource, /server-tag-chip/, 'Die Oberfläche muss den echten Discord-Server-Tag als Badge-Chip darstellen.');
const trackerUiSlice = rendererSource.slice(rendererSource.indexOf('function serverTagTrackerOverview'), rendererSource.indexOf('function boostAutomationOverview'));
assert.match(trackerUiSlice, /TRÄGT UNSEREN TAG/);
assert.match(trackerUiSlice, /TRÄGT IHN NICHT/);
assert.match(trackerUiSlice, /DISCORD-DATEN FEHLEN/);
assert.doesNotMatch(trackerUiSlice, /PRÜFUNG OFFEN|BESTÄTIGUNG OFFEN|mehrfach geprüft|zweite frische Prüfung/, 'Die Tracker-Oberfläche darf keine zweite Bestätigungsrunde mehr suggerieren.');
assert.match(trackerSource, /ASSIGNMENT_SAFETY_WINDOW_MS/, 'Ein Schutz gegen ungewöhnlich viele Rollenvergaben fehlt.');
assert.match(trackerSource, /authoritativeEvent: true[\s\S]{0,180}authoritativeUser: newUser/, 'Discord-Profilereignisse müssen unmittelbar als autoritative Einzelprüfung verarbeitet werden.');
assert.doesNotMatch(trackerSource, /\.sendDM\s*\(|\.createDM\s*\(|member\.send\s*\(/, 'Der Tracker darf keine DMs senden.');
assert.equal((trackerSource.match(/Ã|Â|â€/g) || []).length, 0, 'Der Tracker enthält fehlerhaft kodierte Umlaute.');
assert.equal((trackerUiSlice.match(/Ã|Â|â€/g) || []).length, 0, 'Die Tracker-Oberfläche enthält fehlerhaft kodierte Umlaute.');

console.log('Server-Tag-Tracker-Smoke: Identität, Sicherheitslogik, Konfiguration, API und UI geprüft.');
