import assert from 'node:assert/strict';
import fs from 'node:fs';

import { feature, _welcomeFarewellInternals } from '../src/features/welcomeFarewell.js';
import { normalizeConfig } from '../src/defaultConfig.js';

const ROLE_ID = 'verified-gate-role';
const VERIFIED_ROLE_IDS = ['member-role', 'community-role', 'access-role'];
const sent = [];
const roleMutations = [];
const memberRegistry = new Map();
let memberFetchAllCalls = 0;
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
  roles: {
    cache: new Map(VERIFIED_ROLE_IDS.map((id, index) => [id, {
      id,
      name: id,
      managed: false,
      editable: true,
      position: index + 1
    }]))
  },
  members: {
    cache: memberRegistry,
    me: {
      permissions: { has: () => true },
      roles: { highest: { position: 100 } }
    },
    fetch: async (query) => {
      if (query?.user) return memberRegistry.get(String(query.user)) || null;
      memberFetchAllCalls += 1;
      return memberRegistry;
    }
  }
};
const member = (roleIds, options = {}) => {
  const id = String(options.id || 'user-1');
  const result = {
    id,
    guild,
    manageable: options.manageable !== false,
    user: {
      id,
      username: options.username || 'Aylin',
      bot: options.bot === true,
      toString: () => `<@${id}>`
    },
    roles: {
      cache: new Map(roleIds.map((roleId) => [roleId, { id: roleId }])),
      add: async (roleIdsToAdd, reason) => {
        const ids = (Array.isArray(roleIdsToAdd) ? roleIdsToAdd : [roleIdsToAdd]).map(String);
        ids.forEach((roleId) => result.roles.cache.set(roleId, guild.roles.cache.get(roleId) || { id: roleId }));
        roleMutations.push({ userId: id, add: ids, reason });
        return result;
      },
      remove: async () => result
    }
  };
  return result;
};
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
    postVerificationRolesEnabled: false,
    postVerificationRoleIds: [],
    ...overrides
  }
});

const normalizedRoleConfig = normalizeConfig({
  welcomeFarewell: {
    postVerificationRolesEnabled: true,
    verificationRoleId: ' gate-role ',
    postVerificationRoleIds: ['role-a', { id: 'role-b' }, 'role-a', '']
  }
}).welcomeFarewell;
assert.equal(normalizedRoleConfig.verificationRoleId, 'gate-role', 'Unverified-Rollen-ID wird bereinigt.');
assert.deepEqual(normalizedRoleConfig.postVerificationRoleIds, ['role-a', 'role-b'], 'Zielrollen werden bereinigt und dedupliziert.');

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

// Rollen nach Verifizierung sind von der Welcome-Nachricht unabhaengig und
// werden in genau einem gebuendelten Discord-Aufruf vergeben.
const oldRoleMember = member([ROLE_ID], { id: 'verified-live' });
const liveVerifiedMember = member(['member-role'], { id: 'verified-live' });
memberRegistry.set(liveVerifiedMember.id, liveVerifiedMember);
await feature.onGuildMemberUpdate({
  oldMember: oldRoleMember,
  newMember: liveVerifiedMember,
  cfg: config({
    welcomeEnabled: false,
    postVerificationRolesEnabled: true,
    postVerificationRoleIds: VERIFIED_ROLE_IDS
  })
});
assert.deepEqual(
  VERIFIED_ROLE_IDS.filter((roleId) => liveVerifiedMember.roles.cache.has(roleId)),
  VERIFIED_ROLE_IDS,
  'Nach dem Entzug muessen alle ausgewaehlten Rollen vorhanden sein.'
);
assert.deepEqual(
  roleMutations.at(-1)?.add,
  ['community-role', 'access-role'],
  'Bereits vorhandene Rollen werden nicht erneut an Discord gesendet.'
);

const mutationsAfterLiveGrant = roleMutations.length;
await feature.onGuildMemberUpdate({
  oldMember: member([], { id: 'verified-live' }),
  newMember: liveVerifiedMember,
  cfg: config({ welcomeEnabled: false, postVerificationRolesEnabled: true, postVerificationRoleIds: VERIFIED_ROLE_IDS })
});
assert.equal(roleMutations.length, mutationsAfterLiveGrant, 'Ein Folgeupdate ohne Rollenentzug darf nichts doppelt vergeben.');

// Bot war beim Verify offline: Beim Start werden nur verifizierte Menschen mit
// fehlenden Zielrollen angefasst. Unverified-Mitglieder und Bots bleiben aus.
const offlineVerified = member([], { id: 'verified-offline' });
const stillUnverified = member([ROLE_ID], { id: 'still-unverified' });
const verifiedBot = member([], { id: 'verified-bot', bot: true });
const alreadyComplete = member(VERIFIED_ROLE_IDS, { id: 'already-complete' });
memberRegistry.set(offlineVerified.id, offlineVerified);
memberRegistry.set(stillUnverified.id, stillUnverified);
memberRegistry.set(verifiedBot.id, verifiedBot);
memberRegistry.set(alreadyComplete.id, alreadyComplete);
await feature.onClientReady({
  guild,
  cfg: config({ welcomeEnabled: false, postVerificationRolesEnabled: true, postVerificationRoleIds: VERIFIED_ROLE_IDS })
});
assert.equal(VERIFIED_ROLE_IDS.every((roleId) => offlineVerified.roles.cache.has(roleId)), true, 'Startabgleich holt Offline-Verifizierungen nach.');
assert.equal(roleMutations.some((entry) => entry.userId === stillUnverified.id), false, 'Noch unverifizierte Mitglieder werden uebersprungen.');
assert.equal(roleMutations.some((entry) => entry.userId === verifiedBot.id), false, 'Bots werden uebersprungen.');
assert.equal(roleMutations.some((entry) => entry.userId === alreadyComplete.id), false, 'Vollstaendige Mitglieder erzeugen keinen API-Aufruf.');

const fetchesAfterStartup = memberFetchAllCalls;
await feature.onConfigUpdate({
  guild,
  cfg: config({ welcomeEnabled: false, postVerificationRolesEnabled: true, postVerificationRoleIds: VERIFIED_ROLE_IDS }),
  patch: { welcomeFarewell: { welcomeMessage: 'Nur Text geaendert' } }
});
assert.equal(memberFetchAllCalls, fetchesAfterStartup, 'Unveraenderte Rollenregeln duerfen keinen erneuten Vollabgleich starten.');

await feature.onConfigUpdate({
  guild,
  cfg: config({ enabled: false, welcomeEnabled: false, postVerificationRolesEnabled: true, postVerificationRoleIds: VERIFIED_ROLE_IDS }),
  patch: { welcomeFarewell: { enabled: false } }
});
const verifiedWhileDisabled = member([], { id: 'verified-while-disabled' });
memberRegistry.set(verifiedWhileDisabled.id, verifiedWhileDisabled);
await feature.onConfigUpdate({
  guild,
  cfg: config({ enabled: true, welcomeEnabled: false, postVerificationRolesEnabled: true, postVerificationRoleIds: VERIFIED_ROLE_IDS }),
  patch: { welcomeFarewell: { enabled: true } }
});
assert.equal(
  VERIFIED_ROLE_IDS.every((roleId) => verifiedWhileDisabled.roles.cache.has(roleId)),
  true,
  'Nach erneutem Aktivieren muss der Offline-Abgleich trotz unveraenderter Rollenauswahl laufen.'
);

await feature.onGuildMemberAdd({
  member: member([]),
  cfg: config({ welcomeAfterVerification: false })
});
assert.equal(sent.length, 2, 'Der bisherige direkte Join-Modus muss weiterhin funktionieren.');

const richPayload = await _welcomeFarewellInternals.buildWelcomePayload(guild, {
  id: 'user-1', username: 'aylin', displayName: 'Aylin'
}, config({
  welcomeTemplate: {
    content: '{user}',
    embeds: [{
      title: 'Herzlich Willkommen {nickname}!',
      description: ['Fühl dich hier lieb aufgenommen 🤍', 'Willkommen auf {guild}.'],
      authorName: '{user}',
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
assert.equal(richEmbed.description, 'Fühl dich hier lieb aufgenommen 🤍\nWillkommen auf FALLEN HEAVEN.');
assert.equal(richEmbed.fields[0].name, 'Regeln?');
// Autor-Zeile: {user} wird als Klarname gerendert (Discord zeigt dort keine Mentions),
// während Beschreibung/Felder echte Mentions behalten.
assert.equal(richEmbed.author.name, 'Aylin', 'Autor-Zeile zeigt Klarname statt rohem <@id>');
// Discord-CDN-URLs dürfen NIE als image/thumbnail im Embed landen (hässlicher Link).
assert.equal(richEmbed.image, undefined, 'CDN-URL darf nicht als Embed-Bild landen.');
assert.equal(richEmbed.thumbnail, undefined, 'CDN-URL darf nicht als Embed-Thumbnail landen.');

// Regression: Discord-Avatar-URLs sind KEIN hässlicher Link und dürfen als
// Thumbnail ins Embed – nur andere CDN-URLs bleiben blockiert.
const avatarEmbed = await _welcomeFarewellInternals.buildWelcomePayload(guild, {
  id: 'user-2',
  username: 'Avatar',
  displayName: 'Avatar',
  toString: () => '<@user-2>'
}, config({
  welcomeTemplate: {
    content: '',
    embeds: [{ title: 'Avatar-Test', thumbnailUrl: 'https://cdn.discordapp.com/avatars/1234567890/abcdef0123456789abcdef0123456789.png?size=256' }]
  }
}).welcomeFarewell);
const avatarJson = avatarEmbed.embeds[0].toJSON();
assert.ok(avatarJson.thumbnail, 'Avatar-Thumbnail muss im Embed bleiben.');
assert.ok(avatarJson.thumbnail.url.includes('cdn.discordapp.com/avatars/'), 'Avatar-URL muss als Thumbnail gesetzt sein.');

const { _localImageStoreInternals } = await import('../src/runtime/localImageStore.js');
assert.equal(_localImageStoreInternals.isAllowedEmbedImageUrl('https://cdn.discordapp.com/avatars/1/abc.png?size=256'), true, 'Avatar-CDN-URL erlaubt.');
assert.equal(_localImageStoreInternals.isAllowedEmbedImageUrl('https://cdn.discordapp.com/guilds/9/users/1/avatars/abc.png?size=256'), true, 'Guild-Avatar-CDN-URL erlaubt.');
assert.equal(_localImageStoreInternals.isAllowedEmbedImageUrl('https://cdn.discordapp.com/embed/avatars/5.png?size=256'), true, 'Standard-Avatar (kein eigenes Profilbild) ist auch ein gültiges Profilbild – darf als Thumbnail erscheinen.');
assert.equal(_localImageStoreInternals.isAllowedEmbedImageUrl('https://cdn.discordapp.com/embed/avatars/0.png'), true, 'Standard-Avatar ohne Query erlaubt.');
assert.equal(_localImageStoreInternals.isAllowedEmbedImageUrl('https://cdn.discordapp.com/attachments/1/2/image.png'), false, 'Attachment-CDN-URL bleibt blockiert.');
assert.equal(_localImageStoreInternals.isAllowedEmbedImageUrl('https://example.com/bild.png'), true, 'Externe URL erlaubt.');
assert.equal(_localImageStoreInternals.isAllowedEmbedImageUrl(''), false, 'Leere URL nicht erlaubt.');

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
