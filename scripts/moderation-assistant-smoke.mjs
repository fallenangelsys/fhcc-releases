import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import { defaultGuildConfig, featureCards, normalizeConfig } from '../src/defaultConfig.js';
import { feature, _moderationInternals } from '../src/features/moderation.js';

const { normalizeText, containsTerm, detectContentViolation, highestSeverity } = _moderationInternals;

assert.equal(normalizeText('W3RBUNG'), 'werbung', 'Einfache Leetspeak-Schreibweisen müssen normalisiert werden.');
assert.equal(normalizeText('Hallo!'), 'hallo!', 'Normale Satzzeichen dürfen den Inhalt nicht verfälschen.');
assert.equal(containsTerm(normalizeText('Antispamsoftware'), 'spam'), false, 'Begriffe innerhalb harmloser längerer Wörter dürfen nicht anschlagen.');
assert.equal(containsTerm(normalizeText('Antispamsoftware, aber danach spam.'), 'spam'), true, 'Ein späterer eigenständiger Treffer muss erkannt werden.');
assert.equal(containsTerm(normalizeText('Das ist W3RBUNG!'), 'werbung'), true, 'Normalisierte exakte Treffer müssen erkannt werden.');
assert.equal(highestSeverity('medium', 'critical'), 'critical');
assert.equal(highestSeverity('high', 'light'), 'high');

const cfg = normalizeConfig({
  guildId: 'guild-1',
  guildName: 'Testserver',
  moderation: {
    enabled: true,
    mode: 'enforce',
    badWords: ['spam'],
    highRiskTerms: ['schwerer ausdruck'],
    criticalTerms: ['kritischer ausdruck'],
    antiSpamThreshold: 999,
    antiSpamWindowSeconds: 1,
    mentionSpamThreshold: 999,
    maxWarnings: 999,
    warningDeleteSeconds: 0,
    retentionDays: 9999
  }
});
assert.equal(cfg.moderation.antiSpamThreshold, 50, 'Grenzwerte müssen serverseitig begrenzt werden.');
assert.equal(cfg.moderation.antiSpamWindowSeconds, 3);
assert.equal(cfg.moderation.mentionSpamThreshold, 50);
assert.equal(cfg.moderation.maxWarnings, 20);
assert.equal(cfg.moderation.warningDeleteSeconds, 3);
assert.equal(cfg.moderation.retentionDays, 365);

const message = {
  content: 'Das ist ein kritischer Ausdruck.',
  mentions: { users: new Map(), roles: new Map() }
};
assert.deepEqual(detectContentViolation(message, cfg), {
  type: 'critical-content',
  severity: 'critical',
  reason: 'Kritischer Ausdruck: kritischer ausdruck'
});

const defaults = defaultGuildConfig('guild-2', 'Sicherer Start');
assert.equal(defaults.moderation.mode, 'observe', 'Neue und migrierte Konfigurationen müssen sicher im Beobachtungsmodus starten.');
assert.deepEqual(feature.commands, [], 'Der Moderationsassistent darf keine Slash-Commands voraussetzen.');
for (const hook of ['onMessageCreate', 'onMessageUpdate', 'onAutoModerationActionExecution', 'onGuildMemberUpdate', 'onAnyInteraction']) {
  assert.equal(typeof feature[hook], 'function', `Hook ${hook} fehlt.`);
}

const definition = featureCards.find((entry) => entry.id === 'moderation');
assert(definition, 'Moderationsmodul fehlt in der App-Konfiguration.');
const fieldKeys = new Set(definition.fields.map((field) => field.key));
for (const key of [
  'moderation.mode',
  'moderation.logChannelId',
  'moderation.highRiskTerms',
  'moderation.criticalTerms',
  'moderation.muteRoleId',
  'moderation.exemptRoleIds',
  'moderation.ignoredChannelIds'
]) assert(fieldKeys.has(key), `App-Feld ${key} fehlt.`);

const source = await fs.readFile(new URL('../src/features/moderation.js', import.meta.url), 'utf8');
const indexSource = await fs.readFile(new URL('../src/index.js', import.meta.url), 'utf8');
assert(!source.includes('SlashCommandBuilder'), 'Das Modul enthält unerwartete Slash-Commands.');
assert(!/\bmember\.send\s*\(/.test(source), 'Moderationshinweise dürfen nicht per DM gesendet werden.');
assert(!/\bmember\.(?:kick|ban)\s*\(/.test(source), 'Der Assistent darf nicht automatisch kicken oder bannen.');
assert(indexSource.includes('GatewayIntentBits.AutoModerationExecution'), 'Discord-AutoMod-Intent fehlt.');
assert(indexSource.includes('Events.AutoModerationActionExecution'), 'Discord-AutoMod-Ereignis fehlt.');

console.log('Moderationsassistent-Smoke bestanden: sichere Modi, robuste Wortgrenzen, Eskalation, App-Felder und Discord-AutoMod sind verbunden.');
