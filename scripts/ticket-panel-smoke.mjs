import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import { defaultGuildConfig, featureCards, normalizeConfig } from '../src/defaultConfig.js';
import { feature, _ticketInternals } from '../src/features/tickets.js';

assert.deepEqual(feature.commands, [], 'Tickets dürfen keine Slash-Commands benötigen.');
assert.equal(typeof feature.onClientReady, 'function');
assert.equal(typeof feature.onAnyInteraction, 'function');
assert.equal(_ticketInternals.safeChannelName('Hilfe für ÄÖÜ!'), 'hilfe-fur-aou');
assert.equal(_ticketInternals.safeChannelName(''), 'ticket');

const defaults = defaultGuildConfig('guild-ticket', 'Ticket-Test');
assert.equal(defaults.tickets.useThreadMode, false, 'Private Ticket-Kanäle müssen der zuverlässige Standard sein.');
assert.equal(defaults.tickets.oneOpenPerUser, true);
const cfg = normalizeConfig({ guildId: 'guild-ticket', tickets: { panelTitle: ' '.repeat(2), panelButtonLabel: 'Öffnen', oneOpenPerUser: false, closeButtonLabel: 'Schließen' } });
assert.equal(cfg.tickets.panelTitle, defaults.tickets.panelTitle);
assert.equal(cfg.tickets.panelButtonLabel, 'Öffnen');
assert.equal(cfg.tickets.oneOpenPerUser, false);
assert.equal(cfg.tickets.closeButtonLabel, 'Schließen', 'Schließen-Button-Label editierbar');

const card = featureCards.find((entry) => entry.id === 'tickets');
for (const [key, type] of [
  ['tickets.panelChannelId', 'channelSelect'],
  ['tickets.panelButtonEmoji', 'emoji'],
  ['tickets.supportRoleId', 'roleSelect'],
  ['tickets.categoryId', 'channelSelect'],
  ['tickets.logChannelId', 'channelSelect']
]) assert.equal(card.fields.find((field) => field.key === key)?.type, type, `Ticket-Feld ${key} fehlt oder hat den falschen Typ.`);

const source = await fs.readFile(new URL('../src/features/tickets.js', import.meta.url), 'utf8');
assert(!source.includes('SlashCommandBuilder'));
assert(source.includes("setCustomId('fh_ticket:open')"));
assert(source.includes("setCustomId('fh_ticket:create')"));
assert(source.includes("setCustomId('fh_ticket:close')"));
assert(source.includes('ChannelType.PrivateThread'));
assert(source.includes('PermissionFlagsBits.ViewChannel'));
assert(source.includes('atomicWriteJson(TICKET_FILE'));
assert(!/\b(?:interaction\.user|user|member)\.send\s*\(/.test(source), 'Tickets dürfen keine Direktnachrichten senden.');
assert(!source.includes('.createDM('), 'Tickets dürfen keinen DM-Kanal öffnen.');

console.log('Ticket-Panel-Smoke bestanden: Button, Modal, private Kanäle/Threads, Rollenrechte, Ein-Ticket-Schutz und atomarer Verlauf sind aktiv.');
