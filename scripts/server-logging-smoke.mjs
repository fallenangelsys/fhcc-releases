import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import { defaultGuildConfig, featureCards, normalizeConfig } from '../src/defaultConfig.js';
import { feature, _loggingInternals } from '../src/features/logging.js';

assert.deepEqual(feature.commands, []);
for (const hook of [
  'onMessageDelete', 'onMessageBulkDelete', 'onMessageUpdate', 'onGuildMemberAdd', 'onGuildMemberRemove',
  'onGuildMemberUpdate', 'onChannelCreate', 'onChannelUpdate', 'onChannelDelete',
  'onRoleCreate', 'onRoleUpdate', 'onRoleDelete', 'onVoiceStateUpdate'
]) assert.equal(typeof feature[hook], 'function', `Protokoll-Hook ${hook} fehlt.`);

assert.equal(_loggingInternals.text('', 50), '—');
assert.equal(_loggingInternals.text('123456', 5), '1234…');
assert.equal(_loggingInternals.roleMentions(['1', '2']), '<@&1>, <@&2>');
assert.equal(_loggingInternals.ignoredChannel('100', { logging: { channelId: '100', ignoredChannelIds: [] } }), true);
assert.equal(_loggingInternals.ignoredChannel('200', { logging: { channelId: '100', ignoredChannelIds: ['200'] } }), true);

const defaults = defaultGuildConfig('guild-log', 'Log-Test');
assert.equal(defaults.logging.includeMessageContent, false, 'Nachrichteninhalte müssen standardmäßig deaktiviert sein.');
assert.equal(defaults.logging.logVoice, false, 'Voice-Protokollierung darf nicht ungefragt Log-Spam erzeugen.');
const cfg = normalizeConfig({ guildId: 'guild-log', logging: { ignoredChannelIds: '1\n1\n2', includeMessageContent: true } });
assert.deepEqual(cfg.logging.ignoredChannelIds, ['1', '2']);
assert.equal(cfg.logging.includeMessageContent, true);

const definition = featureCards.find((entry) => entry.id === 'logging');
for (const key of ['logging.includeMessageContent', 'logging.logChannels', 'logging.logVoice', 'logging.ignoredChannelIds']) {
  assert(definition.fields.some((field) => field.key === key), `App-Feld ${key} fehlt.`);
}

const indexSource = await fs.readFile(new URL('../src/index.js', import.meta.url), 'utf8');
for (const event of ['Events.ChannelCreate', 'Events.ChannelDelete', 'Events.GuildRoleCreate', 'Events.GuildRoleUpdate', 'Events.GuildRoleDelete', 'Events.MessageBulkDelete']) {
  assert(indexSource.includes(event), `Discord-Ereignis ${event} ist nicht verdrahtet.`);
}

console.log('Serverprotokoll-Smoke bestanden: Datenschutzstandard, Events, Rollen, Kanäle, Bulk-Löschung und Voice-Option sind vollständig verbunden.');
