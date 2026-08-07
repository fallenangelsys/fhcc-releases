import assert from 'node:assert/strict';

import { createModuleReadinessSnapshot } from '../src/runtime/moduleReadiness.js';

const existingChannelId = '111111111111111111';
const missingChannelId = '222222222222222222';
const blockedRoleId = '333333333333333333';
const missingRoleId = '444444444444444444';

const featureCards = [
  { id: 'forumCleaner', title: 'Foren Cleaner', fields: [{ key: 'forumCleaner.channelIds', type: 'multichannelselect' }] },
  { id: 'logging', title: 'Server-Protokoll', fields: [{ key: 'logging.channelId', type: 'channelselect' }] },
  { id: 'autoRole', title: 'Auto-Rollen', fields: [{ key: 'autoRole.roleIds', type: 'multiroleselect' }] },
  { id: 'serverTagTracker', title: 'Server-Tag', fields: [{ key: 'serverTagTracker.roleIds', type: 'multiroleselect' }] },
  { id: 'moderation', title: 'Moderation', fields: [] },
  { id: 'botProfile', title: 'Bot-Profil', fields: [] }
];

const readiness = createModuleReadinessSnapshot({
  guildId: '555555555555555555',
  guildName: 'FALLEN HEAVEN',
  featureCards,
  config: {
    forumCleaner: { enabled: true, channelIds: [existingChannelId], dryRun: true },
    logging: { enabled: true, channelId: missingChannelId },
    autoRole: { enabled: true, roleIds: [blockedRoleId] },
    serverTagTracker: { enabled: false, roleIds: [missingRoleId] },
    moderation: { enabled: true, actionMode: 'observe', logChannelId: '' },
    botProfile: { enabled: true }
  },
  channels: [{ id: existingChannelId, name: 'vorstellung' }],
  roles: [{ id: blockedRoleId, name: 'VIP', assignable: false }],
  capabilities: {
    manageRoles: false,
    manageThreads: false,
    manageMessages: true,
    manageChannels: true,
    manageExpressions: true,
    createPrivateThreads: true
  },
  runtimeSnapshot: {
    features: [{ featureId: 'botProfile', lastError: 'Discord-Verbindung wurde kurz getrennt.' }]
  }
});

const byId = (id) => readiness.modules.find((entry) => entry.id === id);

assert.equal(readiness.version, 1);
assert.equal(readiness.guildName, 'FALLEN HEAVEN');
assert.equal(readiness.modules.length, featureCards.length);
assert.equal(byId('forumCleaner').status, 'ready', 'Der Prüfmodus benötigt keine Löschberechtigung.');
assert.equal(byId('forumCleaner').canEnable, true);
assert(byId('forumCleaner').issues.some((entry) => entry.code === 'safe-mode'));
assert.equal(byId('logging').status, 'blocked');
assert(byId('logging').issues.some((entry) => entry.code === 'missing-channel'));
assert.equal(byId('autoRole').status, 'blocked');
assert(byId('autoRole').issues.some((entry) => entry.code === 'role-hierarchy'));
assert(byId('autoRole').issues.some((entry) => entry.code === 'missing-permission'));
assert.equal(byId('serverTagTracker').status, 'disabled');
assert.equal(byId('serverTagTracker').canEnable, false, 'Ein inaktives Modul mit veralteter Rolle darf nicht blind aktiviert werden.');
assert.equal(byId('moderation').status, 'ready');
assert.equal(byId('botProfile').status, 'attention');
assert(byId('botProfile').issues.some((entry) => entry.code === 'runtime-error'));
assert.equal(readiness.counts.blocked, 2);
assert.equal(readiness.counts.disabled, 1);
assert(readiness.score >= 0 && readiness.score <= 100);

console.log(`Modul-Bereitschaft bestanden: ${readiness.modules.length} Module, ${readiness.counts.blocked} Blockaden korrekt erkannt.`);
