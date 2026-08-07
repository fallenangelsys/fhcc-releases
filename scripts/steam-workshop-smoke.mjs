import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { featureCards, normalizeConfig } from '../src/defaultConfig.js';
import {
  buildSteamWorkshopMessage,
  cleanSteamDescription,
  normalizeSteamWorkshopConfig,
  _steamWorkshopInternals
} from '../src/features/steamWorkshop.js';
import { createModuleReadinessSnapshot } from '../src/runtime/moduleReadiness.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const forumId = '111111111111111111';
const updateId = '222222222222222222';
const workshopId = '3731417846';

const normalized = normalizeConfig({
  guildId: 'guild-workshop',
  guildName: 'FALLEN HEAVEN',
  steamWorkshop: {
    enabled: true,
    forumChannelId: forumId,
    updateChannelId: updateId,
    workshopIds: `${workshopId}\n${workshopId}\nkeine-id`,
    appliedTagNames: ['Mod', 'Projekt Zomboid', 'Mod'],
    syncIntervalMinutes: 1,
    maxDescriptionLength: 99,
    notifyOnUpdate: true
  }
});

assert.equal(normalized.steamWorkshop.enabled, true);
assert.deepEqual(normalized.steamWorkshop.workshopIds, [workshopId], 'Workshop-IDs müssen dedupliziert und validiert werden.');
assert.deepEqual(normalized.steamWorkshop.appliedTagNames, ['Mod', 'Projekt Zomboid'], 'Forum-Tags müssen dedupliziert werden.');
assert.equal(normalized.steamWorkshop.syncIntervalMinutes, 15, 'Steam darf nicht aggressiver als alle 15 Minuten abgefragt werden.');
assert.equal(normalized.steamWorkshop.maxDescriptionLength, 300, 'Discord-sichere Beschreibungslänge wird nicht begrenzt.');
assert.equal(normalized.steamWorkshop.preferSteamPreviewImage, true);
assert.equal(normalized.steamWorkshop.showRating, true);

const runtimeConfig = normalizeSteamWorkshopConfig(normalized.steamWorkshop);
assert.equal(runtimeConfig.forumChannelId, forumId);
assert.equal(runtimeConfig.notifyOnUpdate, true);

const cleaned = cleanSteamDescription('[h1]Titel[/h1]\n[b]Fett[/b]\n[hr][/hr]\n[img]https://example.invalid/a.png[/img]\n@everyone', 500);
assert.match(cleaned, /\*\*Titel\*\*/);
assert.match(cleaned, /\*\*Fett\*\*/);
assert.doesNotMatch(cleaned, /\[img\]|example\.invalid/);
assert.doesNotMatch(cleaned, /\[\/?hr\]/i);
assert.doesNotMatch(cleaned, /@everyone/);

const item = {
  result: 1,
  publishedfileid: workshopId,
  title: 'FALLEN HEAVEN Mod',
  description: '[b]Mehrspieler-Mod[/b]\nMit vielen Details.',
  preview_url: 'https://images.example.test/workshop.png',
  consumer_app_id: 108600,
  creator: '76561198000000000',
  subscriptions: 42318,
  lifetime_subscriptions: 47000,
  favorited: 3842,
  lifetime_favorited: 4000,
  views: 188204,
  file_size: 134637158,
  time_created: 1785830400,
  time_updated: 1785834000,
  visibility: 0,
  revision_change_number: 12,
  ratingValue: 5,
  ratingCount: 21899,
  tags: [{ tag: 'Mod' }, { tag: 'Multiplayer' }]
};
const message = buildSteamWorkshopMessage(item, normalized.steamWorkshop);
const embed = message.embeds[0].toJSON();
assert.equal(embed.title, item.title);
assert.equal(embed.url, `https://steamcommunity.com/sharedfiles/filedetails/?id=${workshopId}`);
assert.match(embed.description, /Mehrspieler-Mod/);
assert.equal(embed.image.url, item.preview_url);
assert.equal(embed.fields.length, 5);
assert.match(embed.fields[0].value, /★★★★★/);
assert.match(embed.fields[0].value, /21\.899/);
assert.match(embed.fields[1].value, /42\.318/);
assert.equal(message.components.length, 1);
assert.deepEqual(message.allowedMentions, { parse: [] }, 'Workshop-Inhalte dürfen keine unerwünschten Pings auslösen.');
const individualConfig = normalizeSteamWorkshopConfig({
  ...normalized.steamWorkshop,
  design: {
    ...normalized.steamWorkshop.design,
    content: 'Nur für Workshop {workshopId}',
    embed: {
      ...normalized.steamWorkshop.design.embed,
      title: 'INDIVIDUELL · {title}',
      description: 'Eigener Text für genau diesen Post.\n\n{description}',
      color: '#66c0f4'
    }
  }
});
const individualMessage = buildSteamWorkshopMessage(item, individualConfig);
assert.equal(individualMessage.content, `Nur für Workshop ${workshopId}`);
assert.match(individualMessage.embeds[0].toJSON().title, /^INDIVIDUELL/);
assert.match(individualMessage.embeds[0].toJSON().description, /Eigener Text für genau diesen Post/);
assert.notEqual(
  _steamWorkshopInternals.itemFingerprint(item, runtimeConfig),
  _steamWorkshopInternals.itemFingerprint(item, individualConfig),
  'Ein individuelles Design muss einen eigenen Fingerprint besitzen und bei späteren Steam-Abgleichen erhalten bleiben.'
);
assert.equal(typeof _steamWorkshopInternals.itemFingerprint(item, runtimeConfig), 'string');
assert.deepEqual(_steamWorkshopInternals.parseSteamCommunityRating('<img src="https://community.cloudflare.steamstatic.com/public/images/sharedfiles/5-star_large.png?v=2"><div class="numRatings">21,899 Bewertungen</div>'), {
  ratingValue: 5,
  ratingCount: 21899
});

const card = featureCards.find((entry) => entry.id === 'steamWorkshop');
assert(card, 'Steam Workshop fehlt in den verfügbaren Modulen.');
assert.deepEqual(card.fields.find((field) => field.key === 'steamWorkshop.forumChannelId')?.channelTypes, [15, 16]);
assert.equal(card.fields.find((field) => field.key === 'steamWorkshop.updateChannelId')?.type, 'channelSelect');
assert.equal(card.fields.find((field) => field.key === 'steamWorkshop.showRating')?.type, 'checkbox');

const readiness = createModuleReadinessSnapshot({
  guildId: 'guild-workshop',
  guildName: 'FALLEN HEAVEN',
  featureCards: [card],
  config: { steamWorkshop: normalized.steamWorkshop },
  channels: [{ id: forumId, name: 'steam-workshop' }, { id: updateId, name: 'mod-updates' }],
  roles: [],
  capabilities: { sendMessages: true, manageThreads: true }
});
assert.equal(readiness.modules[0]?.status, 'ready');

const renderer = fs.readFileSync(path.join(rootDir, 'desktop', 'renderer', 'app.js'), 'utf8');
const dashboard = fs.readFileSync(path.join(rootDir, 'src', 'dashboard.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(rootDir, 'src', 'index.js'), 'utf8');
assert.match(renderer, /openSteamWorkshopStudio/);
assert.match(renderer, /saveSteamWorkshopStudioTemplate/);
assert.match(renderer, /specialStudioPreviewTemplate/);
assert.match(renderer, /local-workshop-banner/);
assert.match(renderer, /data-steam-workshop-edit-item/);
assert.match(renderer, /openSteamWorkshopItemStudio/);
assert.match(renderer, /resetSteamWorkshopItemFromPanel/);
assert.match(dashboard, /steam-workshop\/design/);
assert.match(dashboard, /steam-workshop\/sync/);
assert.match(dashboard, /steam-workshop\/items\/:workshopId\/design/);
assert.match(indexSource, /saveSteamWorkshopDesign/);
assert.match(indexSource, /saveSteamWorkshopBannerAsset/);
assert.match(indexSource, /saveSteamWorkshopItemDesign/);
assert.match(indexSource, /resetSteamWorkshopItemDesign/);

console.log('Steam-Workshop-Smoke: Forum-Katalog, globale und individuelle Designs, Steam-Daten, Bilder und App-Integration bestanden.');
