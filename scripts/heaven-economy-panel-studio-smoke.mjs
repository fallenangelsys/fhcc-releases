#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Collection } from 'discord.js';

const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'fh-economy-panel-'));
process.env.FALLEN_HEAVEN_DATA_DIR = temporaryRoot;

const {
  buildHeavenEconomyPanelPayload,
  normalizeEconomyPanelTemplate,
  refreshHeavenEconomyPanel,
  saveHeavenEconomyPanelDesign
} = await import(`../src/features/heavenEconomy.js?smoke=${Date.now()}`);

const guildId = '111111111111111111';
const channelId = '222222222222222222';
const messages = new Map();
let sendCount = 0;
let editCount = 0;
const channel = {
  id: channelId,
  isTextBased: () => true,
  messages: { fetch: async (id) => messages.get(String(id)) || null },
  async send(payload) {
    sendCount += 1;
    const message = {
      id: `panel-${sendCount}`,
      author: { id: 'bot-1' },
      payload,
      async edit(nextPayload) { editCount += 1; message.payload = nextPayload; return message; }
    };
    messages.set(message.id, message);
    return message;
  }
};
const guild = {
  id: guildId,
  name: 'FALLEN HEAVEN TEST',
  channels: { cache: new Collection([[channelId, channel]]), fetch: async (id) => String(id) === channelId ? channel : null },
  client: { user: { id: 'bot-1' } }
};

const template = {
  content: 'Willkommen bei {server}',
  outsideImageUrl: '',
  outsideImageName: 'vip-aussen.png',
  outsideImageSize: 7,
  outsideImageAttachment: {
    localAsset: true,
    id: 'vip-aussenbild',
    name: 'vip-aussen.png',
    size: 7,
    mime: 'image/png'
  },
  embeds: [{
    title: 'VIP-VORTEILE · {server}',
    url: 'https://fallen-heaven.example/vip',
    description: 'Nutze {coinEmoji} und erhalte pro Boost-Stufe {boostMilestoneReward}.',
    color: '#123456',
    authorName: '{server}',
    imageUrl: 'https://cdn.discordapp.com/attachments/1/2/vip-gross.png',
    footerText: 'Ein gemeinsames Panel',
    timestamp: false,
    fields: [{ name: 'Freier Bereich', value: 'Dieser Text bleibt vollständig editierbar.', inline: true }]
  }, ...Array.from({ length: 11 }, (_, index) => ({
    title: `Zusatz ${index + 2} · {server}`,
    description: `Frei editierbarer Inhalt ${index + 2}`,
    color: '#654321',
    fields: [{ name: `Bereich ${index + 2}`, value: '{coinEmoji}', inline: false }]
  }))]
};
const cfg = { heavenEconomy: {
  enabled: true,
  panelChannelId: channelId,
  coinEmoji: '🪙',
  boostMilestoneReward: 125,
  coinGiftsEnabled: true,
  panelTemplate: template
} };

const imageDependencies = {
  materializeTemplate: async (value) => ({ ...value, outsideImageUrl: `data:image/png;base64,${Buffer.from('outside').toString('base64')}` }),
  fetchAsset: async (url) => String(url).includes('vip-gross.png') ? { buffer: Buffer.from('large'), ext: 'png' } : null
};
const normalizedTemplate = normalizeEconomyPanelTemplate(template);
assert.equal(normalizedTemplate.outsideImageAttachment.id, 'vip-aussenbild', 'Außenbild-Referenz bleibt beim Normalisieren erhalten');
assert.equal(normalizedTemplate.outsideImageName, 'vip-aussen.png');

const payload = await buildHeavenEconomyPanelPayload(guild, cfg, imageDependencies);
assert.equal(payload.content, 'Willkommen bei FALLEN HEAVEN TEST');
assert.equal(payload.embeds[0].data.title, 'VIP-VORTEILE · FALLEN HEAVEN TEST');
assert.equal(payload.embeds[0].data.url, 'https://fallen-heaven.example/vip');
assert.ok(payload.embeds[0].data.description.includes('125 Coins'));
assert.match(payload.embeds[0].data.image.url, /^attachment:\/\/fh-asset-1\.png$/, 'Discord-CDN-Großbild wird über den gemeinsamen Studio-Builder als echter Anhang gesendet');
assert.equal(payload.files.length, 2, 'Großbild und Außenbild werden beide hochgeladen');
assert.equal(payload.files[0].name, 'fh-asset-1.png');
assert.equal(payload.files[1].name, 'vip-aussen.png');
assert.deepEqual(payload.attachments, [], 'alte Anhänge werden beim Live-Edit kontrolliert ersetzt');
assert.deepEqual(payload.embeds[0].data.fields, [{ name: 'Freier Bereich', value: 'Dieser Text bleibt vollständig editierbar.', inline: true }]);
assert.equal(payload.embeds.length, 10, 'eine Panel-Nachricht darf bis zu zehn Embeds enthalten');
assert.equal(payload.embeds[9].data.title, 'Zusatz 10 · FALLEN HEAVEN TEST');
assert.equal(payload.embeds[9].data.fields[0].value, '🪙');
assert.deepEqual(payload.components.flatMap((row) => row.components.map((button) => button.data.custom_id)), [
  'fh_coin:account', 'fh_coin:shop', 'fh_coin:gift', 'fh_coin:coin-gift', 'fh_coin:buy', 'fh_coin:progress', 'fh_coin:admin'
]);

const storedMedia = await saveHeavenEconomyPanelDesign({
  guild,
  cfg: { heavenEconomy: { ...cfg.heavenEconomy, enabled: false } },
  channelId,
  template
});
assert.equal(storedMedia.template.outsideImageAttachment.id, 'vip-aussenbild', 'Economy-Save behält die Außenbild-Referenz');
assert.equal(storedMedia.template.embeds[0].imageUrl, 'https://cdn.discordapp.com/attachments/1/2/vip-gross.png', 'Economy-Save behält das große Embed-Bild');

const refreshCfg = {
  heavenEconomy: {
    ...cfg.heavenEconomy,
    panelTemplate: {
      ...template,
      outsideImageAttachment: null,
      outsideImageName: '',
      outsideImageSize: 0,
      embeds: template.embeds.map((embed) => ({ ...embed, imageUrl: '' }))
    }
  }
};

const [firstRefresh, parallelRefresh] = await Promise.all([
  refreshHeavenEconomyPanel({ guild, cfg: refreshCfg }),
  refreshHeavenEconomyPanel({ guild, cfg: refreshCfg })
]);
assert.equal(sendCount, 1, 'parallele Refreshes erzeugen nur ein Panel');
assert.equal(firstRefresh.messageId, 'panel-1');
assert.equal(parallelRefresh.messageId, 'panel-1');
assert.ok(editCount >= 1, 'zweiter Refresh editiert das kanonische Panel');

messages.delete('panel-1');
const repaired = await refreshHeavenEconomyPanel({ guild, cfg: refreshCfg });
assert.equal(sendCount, 2, 'geloeschtes Panel wird einmal neu erstellt');
assert.equal(repaired.messageId, 'panel-2');

const saved = await saveHeavenEconomyPanelDesign({
  guild,
  cfg: refreshCfg,
  channelId,
  template: { embeds: Array.from({ length: 10 }, (_, index) => ({ title: `NEUER TITEL ${index + 1}`, description: 'Neue Vorteile', fields: [{ name: 'A', value: 'B' }] })) }
});
assert.equal(saved.template.embeds.length, 10);
assert.equal(saved.template.embeds[0].title, 'NEUER TITEL 1');
assert.equal(saved.liveUpdated, true);
assert.equal(saved.messageId, 'panel-2');
assert.equal(messages.get('panel-2').payload.embeds.length, 10);
assert.equal(messages.get('panel-2').payload.embeds[9].data.title, 'NEUER TITEL 10');

const disabledPayload = await buildHeavenEconomyPanelPayload(guild, { heavenEconomy: { ...refreshCfg.heavenEconomy, coinGiftsEnabled: false } }, imageDependencies);
assert.equal(disabledPayload.components.flatMap((row) => row.components).length, 6);

const panelState = JSON.parse(await fs.readFile(path.join(temporaryRoot, 'heaven-economy-panels.json'), 'utf8'));
assert.equal(panelState[guildId], 'panel-2');

await fs.rm(temporaryRoot, { recursive: true, force: true });
console.log('Heaven-Economy-Panel-Studio-Smoke bestanden: Außenbild, Bildlinks, zehn Embeds, sieben Buttons, Reparatur und Parallelitaet sind konsistent.');
