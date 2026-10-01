import assert from 'node:assert/strict';

import { defaultGuildConfig } from '../src/defaultConfig.js';
import { buildVipPanelPayload, getVipPanelStatus, resolveVipPanelImagePreservation } from '../src/features/heavenEconomy.js';

// Config-Defaults enthalten das kombinierte VIP-Embed (ein Kanal, alle Stufen).
const base = defaultGuildConfig('111111111111111111', 'FALLEN HEAVEN');
assert.equal(base.heavenEconomy.vipPanelEnabled, false);
assert.equal(base.heavenEconomy.vipPanelChannelId, '');
assert.ok(base.heavenEconomy.vipPanelTemplate?.embeds?.[0]?.authorName.includes('{server}'));
assert.ok(base.heavenEconomy.vipPanelTemplate?.embeds?.[0]?.footerText.includes('{memberCount}'));
assert.ok(base.heavenEconomy.vipPanelTemplate?.embeds?.[0]?.footerText.includes('{tierCount}'));

const cfg = {
  heavenEconomy: {
    enabled: true,
    vipPanelEnabled: true,
    vipRoleMappings: ['500=111111111111111111', '1000=222222222222222222', '4000=333333333333333333'],
    vipPanelChannelId: 'chan-vip'
  }
};

// Payload: Platzhalter werden ersetzt, jede Stufe wird ein eigenes Feld.
const entries = [
  { tier: { price: 500, roleId: '111111111111111111', name: 'VIP' }, rows: [] },
  {
    tier: { price: 1000, roleId: '222222222222222222', name: 'VIP: BRONZE' },
    rows: [{ id: 'u1', displayName: 'Max Muster' }, { id: 'u2', displayName: 'Lina' }]
  },
  {
    tier: { price: 4000, roleId: '333333333333333333', name: 'VIP: GOLD' },
    rows: [{ id: 'u3', displayName: 'Tom' }]
  }
];
const guild = { name: 'FALLEN HEAVEN' };
const payload = buildVipPanelPayload(guild, cfg, entries, new Date('2026-08-08T12:00:00Z').toISOString());
assert.match(payload.embeds[0].data.author?.name || '', /FALLEN HEAVEN/);
assert.match(payload.embeds[0].data.footer?.text || '', /3 VIP-Mitglieder in 3 Stufen/);
assert.equal(payload.embeds[0].data.fields.length, 3);
const bronzeField = payload.embeds[0].data.fields[1];
assert.match(bronzeField.name, /VIP: BRONZE · 2/);
assert.match(bronzeField.value, /<@u1>/);
assert.match(bronzeField.value, /<@u2>/);
assert.match(payload.embeds[0].data.fields[0].value, /Noch keine Mitglieder/);
assert.match(payload.embeds[0].data.fields[2].name, /VIP: GOLD · 1/);

// Rang-Emojis: Der passende hochgeladene Server-Emoji wird je Stufe eingesetzt.
const emojiGuild = {
  name: 'FALLEN HEAVEN',
  emojis: {
    cache: {
      values: () => [
        { id: '1535649303564001290', name: 'VIP_Bronze', animated: false },
        { id: '1535649302259437579', name: 'VIP_Silber', animated: false },
        { id: '1535649300657209395', name: 'VIP_Gold', animated: false },
        { id: '1535649299218571285', name: 'VIP_Diamant', animated: false }
      ]
    }
  }
};
const emojiPayload = buildVipPanelPayload(emojiGuild, cfg, entries, new Date().toISOString());
assert.match(emojiPayload.embeds[0].data.fields[1].name, /<:VIP_Bronze:1535649303564001290> VIP: BRONZE · 2/);
assert.match(emojiPayload.embeds[0].data.fields[2].name, /<:VIP_Gold:1535649300657209395> VIP: GOLD · 1/);
// Die Basis-VIP-Rolle (ohne eigenes Emoji) übernimmt die goldenen Flügel von
// VIP GOLD, statt mit dem generischen 👑-Symbol abzuweichen.
assert.match(emojiPayload.embeds[0].data.fields[0].name, /<:VIP_Gold:1535649300657209395> VIP · 0/);
// Ohne irgendein passendes Emoji fällt die Stufe auf 👑 zurück.
const noEmojiPayload = buildVipPanelPayload({ name: 'FALLEN HEAVEN' }, cfg, entries, new Date().toISOString());
assert.match(noEmojiPayload.embeds[0].data.fields[0].name, /👑 VIP · 0/);

// Rollennamen mit eigenem Emoji (z. B. „💛 VIP: GOLD“) werden bereinigt – das
// Rang-Emoji kommt ausschließlich aus den Server-Emojis, nie aus dem Rollennamen.
const emojiNameEntries = [
  { tier: { price: 500, roleId: '111111111111111111', name: '👑 VIP' }, rows: [] },
  { tier: { price: 4000, roleId: '333333333333333333', name: '💛 VIP: GOLD' }, rows: [{ id: 'u3', displayName: 'Tom' }] }
];
const emojiNamePayload = buildVipPanelPayload(emojiGuild, cfg, emojiNameEntries, new Date().toISOString());
assert.match(emojiNamePayload.embeds[0].data.fields[1].name, /<:VIP_Gold:1535649300657209395> VIP: GOLD · 1/);
assert.doesNotMatch(emojiNamePayload.embeds[0].data.fields[1].name, /💛/);

// Priorität: Nur Emojis mit vip/wing-Namen gelten als Rang-Emoji. Ein generisches
// „FH_CUTEANIMATEDHEARTGOLD“ (nur „gold“ im Namen, kein vip/wing) darf NICHT
// als Gold-Emoji verwendet werden – die Stufe fällt dann auf 👑 zurück.
const heartGuild = {
  name: 'FALLEN HEAVEN',
  emojis: {
    cache: {
      values: () => [{ id: 'heart-1', name: 'FH_CUTEANIMATEDHEARTGOLD', animated: true }]
    }
  }
};
const heartPayload = buildVipPanelPayload(heartGuild, cfg, emojiNameEntries, new Date().toISOString());
assert.match(heartPayload.embeds[0].data.fields[1].name, /👑 VIP: GOLD · 1/);
assert.doesNotMatch(heartPayload.embeds[0].data.fields[1].name, /HEARTGOLD/);

// Außenbild: Ein hochgeladenes Bild landet als Datei im Payload, eine Bild-URL
// als eigene Zeile im Content, ein persistierter Anhang bleibt erhalten.
const outsideGuild = { name: 'FALLEN HEAVEN' };
const outsideFilePayload = buildVipPanelPayload(outsideGuild, cfg, entries, new Date().toISOString(), { outsideFile: Buffer.from('png'), outsideFileName: 'vip.png' });
assert.ok(Array.isArray(outsideFilePayload.files) && outsideFilePayload.files.length === 1);
assert.equal(outsideFilePayload.files[0].name, 'vip.png');
const urlOnlyCfg = {
  heavenEconomy: {
    ...cfg.heavenEconomy,
    vipPanelTemplate: { content: 'Test', outsideImageUrl: 'https://cdn.example.com/vip.png' }
  }
};
const urlOnlyPayload = buildVipPanelPayload(outsideGuild, urlOnlyCfg, entries, new Date().toISOString());
assert.match(urlOnlyPayload.content, /https:\/\/cdn\.example\.com\/vip\.png/);
const preserveCfg = {
  heavenEconomy: {
    ...cfg.heavenEconomy,
    vipPanelTemplate: { content: 'Test', outsideImageAttachment: { id: 'att-1', url: 'https://cdn.example.com/vip.png' } }
  }
};
const preservePayload = buildVipPanelPayload(outsideGuild, preserveCfg, entries, new Date().toISOString(), { preserveAttachment: true });
assert.ok(Array.isArray(preservePayload.attachments) && preservePayload.attachments.length === 1);
assert.equal(preservePayload.attachments[0].id, 'att-1');
assert.doesNotMatch(preservePayload.content, /cdn\.example/);

// Design-Save-Schutz: Ein bildloser Re-Save (z. B. zweiter Klick) darf das
// bereits hochgeladene Außenbild NIE überschreiben – nur Ersetzen oder
// explizites Entfernen ändert es.
const previousVipImage = { outsideImageUrl: 'https://cdn.discordapp.com/attachments/1/2/vip.png', outsideImageAttachment: { id: 'att-1', url: 'https://cdn.discordapp.com/attachments/1/2/vip.png', name: 'vip.png', size: 500000 } };
const vipKept = resolveVipPanelImagePreservation({ sourceOutsideImage: '', incomingAttachment: null, removeOutsideImage: false, previousTemplate: previousVipImage });
assert.equal(vipKept.preservePrevious, true);
assert.equal(vipKept.outsideImageUrl, previousVipImage.outsideImageUrl);
assert.equal(vipKept.outsideImageAttachment.id, 'att-1');
const vipRemoved = resolveVipPanelImagePreservation({ sourceOutsideImage: '', incomingAttachment: null, removeOutsideImage: true, previousTemplate: previousVipImage });
assert.equal(vipRemoved.preservePrevious, false);
assert.equal(vipRemoved.outsideImageUrl, '');
assert.equal(vipRemoved.outsideImageAttachment, null);
const vipReplaced = resolveVipPanelImagePreservation({ outsideFile: Buffer.from('new'), sourceOutsideImage: 'data:image/png;base64,AA==', incomingAttachment: null, removeOutsideImage: false, previousTemplate: previousVipImage });
assert.equal(vipReplaced.preservePrevious, false);
assert.equal(vipReplaced.outsideImageUrl, '');
assert.equal(vipReplaced.outsideImageAttachment, null);
const vipCarried = resolveVipPanelImagePreservation({ sourceOutsideImage: '', incomingAttachment: { id: 'att-2', url: 'https://cdn.discordapp.com/attachments/3/4/new.png' }, removeOutsideImage: false, previousTemplate: previousVipImage });
assert.equal(vipCarried.outsideImageAttachment.id, 'att-2');

// Wing-Namen („FH_FALLENANGELWINGVIPGOLD“) werden akzeptiert – ein Herz, das
// zusätzlich „gold“ im Namen trägt, verliert gegen den Wing-Emoji.
const wingGuild = {
  name: 'FALLEN HEAVEN',
  emojis: {
    cache: {
      values: () => [
        { id: 'wing-gold', name: 'FH_FALLENANGELWINGVIPGOLD', animated: false },
        { id: 'heart-gold', name: 'FH_CUTEANIMATEDHEARTGOLD', animated: true }
      ]
    }
  }
};
const wingPayload = buildVipPanelPayload(wingGuild, cfg, emojiNameEntries, new Date().toISOString());
assert.match(wingPayload.embeds[0].data.fields[1].name, /<:FH_FALLENANGELWINGVIPGOLD:wing-gold> VIP: GOLD · 1/);
assert.doesNotMatch(wingPayload.embeds[0].data.fields[1].name, /HEARTGOLD/);

// Status: ein Kanal, eine Nachricht, Stufen mit Emoji und Mitgliederzahlen.
const vipRole = { id: '111111111111111111', name: 'VIP', managed: false };
const bronzeRole = { id: '222222222222222222', name: 'VIP: BRONZE', managed: false };
const goldRole = { id: '333333333333333333', name: 'VIP: GOLD', managed: false };
const member = (id, displayName, roleId) => ({
  id,
  displayName,
  user: { id, username: String(displayName).toLowerCase().replace(/\s/g, ''), bot: false },
  roles: { cache: new Map(roleId ? [[roleId, { id: roleId }]] : []) }
});
const fakeCollection = (entriesList) => {
  const map = new Map(entriesList);
  return {
    get: (key) => map.get(key),
    has: (key) => map.has(key),
    size: map.size,
    keys: () => map.keys(),
    values: () => [...map.values()],
    forEach: (fn) => map.forEach(fn),
    filter: function (predicate) {
      return fakeCollection([...map.entries()].filter(([key, value]) => predicate(value, key, map)));
    },
    map: function (fn) {
      return [...map.values()].map((value, index) => fn(value, value.id || index, map));
    }
  };
};
const statusGuild = {
  id: 'g1',
  name: 'FALLEN HEAVEN',
  roles: {
    cache: new Map([
      ['111111111111111111', vipRole],
      ['222222222222222222', bronzeRole],
      ['333333333333333333', goldRole]
    ])
  },
  members: {
    cache: fakeCollection([
      ['u1', member('u1', 'Max Muster', '222222222222222222')],
      ['u2', member('u2', 'Lina', '333333333333333333')]
    ])
  },
  channels: {
    cache: new Map([
      ['chan-vip', { id: 'chan-vip', name: 'vip' }]
    ])
  }
};
const status = await getVipPanelStatus(statusGuild, cfg);
assert.equal(status.enabled, true);
assert.equal(status.channelId, 'chan-vip');
assert.equal(status.channelName, 'vip');
assert.equal(status.tiers.length, 3);
assert.equal(status.memberCount, 2);
assert.equal(status.tierCount, 3);
assert.equal(status.tiers[1].name, 'VIP: BRONZE');
assert.equal(status.tiers[1].memberCount, 1);
assert.equal(status.tiers[2].name, 'VIP: GOLD');
assert.equal(status.tiers[2].memberCount, 1);
// Ohne Emojis im Cache liefert der Status leere Emoji-Details (UI zeigt 👑).
assert.equal(status.tiers[0].emojiId, '');
assert.equal(status.tiers[0].emoji, '👑');

console.log('VIP-Embed-Smoke bestanden: Ein kombinierter Kanal, alle Stufen mit Rang-Emojis und Mitgliederzahlen sind konsistent.');
