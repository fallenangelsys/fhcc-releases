import assert from 'node:assert/strict';
import fs from 'node:fs';

import { _levelInternals } from '../src/features/levels.js';
import { _autoResponderInternals } from '../src/features/autoResponder.js';
import { defaultGuildConfig, normalizeConfig, featureCards } from '../src/defaultConfig.js';

assert.equal(_levelInternals.levelFromXp(100), 1);
assert.equal(_levelInternals.levelFromXp(400), 2);
assert.deepEqual(_levelInternals.parseMappings(['1=123', '5=456']), [{ level: 1, roleId: '123' }, { level: 5, roleId: '456' }]);
assert.equal(_levelInternals.fingerprint(' Hallo   <@123> '), 'hallo');

const cfg = normalizeConfig({ levels: { xpPerMessageMin: 20, xpPerMessageMax: 5, ignoredChannelIds: ['12', '12'], excludedRoleIds: ['34'], levelRoleMappings: ['1=56'] } });
assert.equal(cfg.levels.xpPerMessageMin, 20);
assert.equal(cfg.levels.xpPerMessageMax, 20);
assert.deepEqual(cfg.levels.ignoredChannelIds, ['12']);
assert.deepEqual(cfg.levels.excludedRoleIds, ['34']);
assert.deepEqual(cfg.levels.levelRoleMappings, ['1=56']);
assert.ok(featureCards.find((feature) => feature.id === 'levels').fields.some((field) => field.key === 'levels.levelRoleMappings' && field.type === 'roleMappingSelect'));

const rules = _autoResponderInternals.parseRules([{ trigger: 'hi', response: 'Hallo', mode: 'word' }]);
assert.equal(rules[0].mode, 'word');
assert.equal(_autoResponderInternals.matchesRule('hi freund', 'hi', 'word'), true);
assert.equal(_autoResponderInternals.matchesRule('himmel', 'hi', 'word'), false);
assert.equal(_autoResponderInternals.matchesRule('himmel', 'hi', 'contains'), true);
assert.equal(_autoResponderInternals.claimMessage('message-1'), true);
assert.equal(_autoResponderInternals.claimMessage('message-1'), false);
assert.equal(_autoResponderInternals.formatResponse('Hi {username} auf {guild}', { author: { id: '1', username: 'Mira' }, member: { displayName: 'Mira' }, guild: { name: 'FALLEN HEAVEN' }, channelId: '2' }), 'Hi Mira auf FALLEN HEAVEN');

const appSource = fs.readFileSync(new URL('../desktop/renderer/app.js', import.meta.url), 'utf8');
assert.match(appSource, /Benötigtes Level/);
assert.match(appSource, /Level-Belohnungen/);
assert.ok(defaultGuildConfig('1').autoresponder.rules.every((rule) => rule.mode === 'word'));

console.log('Leveling-/Autoresponder-Smoke bestanden: Tageslimit, Duplikatschutz, Rollenauswahl, Wortgrenzen und Einzelantwort sind verbunden.');
