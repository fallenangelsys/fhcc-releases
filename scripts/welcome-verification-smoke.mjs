import assert from 'node:assert/strict';
import fs from 'node:fs';

import { feature, _welcomeFarewellInternals } from '../src/features/welcomeFarewell.js';

const ROLE_ID = 'verified-gate-role';
const sent = [];
const channel = {
  isTextBased: () => true,
  send: async (payload) => { sent.push(payload); return payload; }
};
const guild = {
  id: 'guild-1',
  name: 'FALLEN HEAVEN',
  channels: {
    cache: new Map([['welcome-channel', channel]]),
    fetch: async () => channel
  },
  roles: { cache: new Map() }
};
const member = (roleIds, options = {}) => ({
  id: 'user-1',
  guild,
  user: {
    id: 'user-1',
    username: 'Aylin',
    bot: options.bot === true,
    toString: () => '<@user-1>'
  },
  roles: { cache: new Map(roleIds.map((id) => [id, { id }])) }
});
const config = (overrides = {}) => ({
  welcomeFarewell: {
    enabled: true,
    welcomeEnabled: true,
    welcomeAfterVerification: true,
    verificationRoleId: ROLE_ID,
    welcomeChannelId: 'welcome-channel',
    welcomeMessage: 'Willkommen {user} auf {guild}!',
    farewellEnabled: false,
    autoRoleEnabled: false,
    ...overrides
  }
});

assert.equal(
  _welcomeFarewellInternals.verificationRoleWasRemoved(member([ROLE_ID]), member([]), ROLE_ID),
  true,
  'Der echte Rollenentzug muss erkannt werden.'
);
assert.equal(
  _welcomeFarewellInternals.verificationRoleWasRemoved(member([]), member([]), ROLE_ID),
  false,
  'Ein beliebiges Member-Update darf keine Begrüßung auslösen.'
);

await feature.onGuildMemberAdd({ member: member([ROLE_ID]), cfg: config() });
assert.equal(sent.length, 0, 'Im Verifizierungsmodus darf beim Join noch nichts gesendet werden.');

await feature.onGuildMemberUpdate({
  oldMember: member([ROLE_ID]),
  newMember: member([]),
  cfg: config()
});
assert.equal(sent.length, 1, 'Nach Entfernung der Unverified-Rolle muss genau eine Begrüßung erscheinen.');
assert.equal(sent[0].content, 'Willkommen <@user-1> auf FALLEN HEAVEN!');
assert.deepEqual(sent[0].allowedMentions, { parse: ['users'], roles: [], repliedUser: false });

await feature.onGuildMemberUpdate({ oldMember: member([]), newMember: member([]), cfg: config() });
await feature.onGuildMemberUpdate({ oldMember: member([ROLE_ID]), newMember: member([], { bot: true }), cfg: config() });
assert.equal(sent.length, 1, 'Folgeupdates und Bots dürfen keine weitere Begrüßung erzeugen.');

await feature.onGuildMemberAdd({
  member: member([]),
  cfg: config({ welcomeAfterVerification: false })
});
assert.equal(sent.length, 2, 'Der bisherige direkte Join-Modus muss weiterhin funktionieren.');

const richPayload = _welcomeFarewellInternals.buildWelcomePayload(guild, {
  id: 'user-1', username: 'aylin', displayName: 'Aylin'
}, config({
  welcomeTemplate: {
    content: '{user}',
    embeds: [{
      title: 'Herzlich Willkommen {nickname}!',
      description: ['Fühl dich hier lieb aufgehoben 🤍', 'Willkommen auf {guild}.'],
      imageUrl: 'https://cdn.discordapp.com/example/welcome.png',
      thumbnailUrl: 'https://cdn.discordapp.com/example/halo.gif',
      footerText: 'Liebe Grüße vom Maskottchen, HALO',
      fields: [{ name: 'Regeln?', value: '<#1278044527168323655>', inline: false }]
    }]
  }
}).welcomeFarewell);
assert.equal(richPayload.content, '<@user-1>');
assert.equal(richPayload.embeds.length, 1);
const richEmbed = richPayload.embeds[0].toJSON();
assert.equal(richEmbed.title, 'Herzlich Willkommen Aylin!');
assert.equal(richEmbed.description, 'Fühl dich hier lieb aufgehoben 🤍\nWillkommen auf FALLEN HEAVEN.');
assert.equal(richEmbed.fields[0].name, 'Regeln?');

const refreshedTemplate = await _welcomeFarewellInternals.refreshWelcomeAssetUrls({
  channels: {
    cache: new Map([['source-channel', {
      messages: { fetch: async () => ({
        embeds: [{ image: { url: 'https://cdn.discordapp.com/fresh-image.png' }, thumbnail: { url: 'https://cdn.discordapp.com/fresh-thumb.gif' } }],
        attachments: new Map()
      }) }
    }]]),
    fetch: async () => null
  }
}, {
  sourceChannelId: 'source-channel',
  sourceMessageId: 'source-message',
  embeds: [{ imageUrl: 'https://cdn.discordapp.com/expired-image.png' }]
});
assert.equal(refreshedTemplate.embeds[0].imageUrl, 'https://cdn.discordapp.com/fresh-image.png');
assert.equal(refreshedTemplate.embeds[0].thumbnailUrl, 'https://cdn.discordapp.com/fresh-thumb.gif');

const appRenderer = fs.readFileSync(new URL('../desktop/renderer/app.js', import.meta.url), 'utf8');
const serverRenderer = fs.readFileSync(new URL('../desktop/renderer/server-management.js', import.meta.url), 'utf8');
assert.match(appRenderer, /data-welcome-open-studio/);
assert.match(appRenderer, /saveWelcomeFarewellStudioTemplate/);
assert.match(serverRenderer, /data-use-welcome-message/);
assert.match(serverRenderer, /welcomeTemplateFromMessage/);
assert.match(serverRenderer, /sourceMessageId/);

console.log('Welcome-Verifizierungs-Smoke bestanden: Rollenentzug, Rich-Embed, Modul-Studio und direkte Nachrichtenübernahme sind verbunden.');
