// E2E-Test für den Edit-Pfad des Top-Booster-Panels:
// Die Panel-Nachricht existiert bereits (ohne Attachment). Der Save lädt sie,
// ruft message.edit(payload) auf – und Discord liefert die AKTUALISIERTE
// Nachricht zurück, die jetzt den hochgeladenen Anhang enthält. Genau dieser
// Rückgabewert muss übernommen werden (message = await message.edit(...)),
// sonst bleibt der Anhang unsichtbar und der Save wirft
// "Das Außenbild wurde nicht als Discord-Anhang bestätigt".
//
// Läuft in einem Temp-Datenverzeichnis, damit keine echten Bot-Daten berührt
// werden. Ausführung: node scripts/boost-top-edit-path-e2e.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const tempDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'boost-top-e2e-'));
process.env.FALLEN_HEAVEN_DATA_DIR = tempDataDir;

// Das Panel existiert bereits im Ledger (messageId gesetzt) – das ist die
// Voraussetzung für den Edit-Pfad (message.edit statt channel.send).
const ledgerPath = path.join(tempDataDir, 'boost-role-ledger.json');
await fs.mkdir(tempDataDir, { recursive: true });
await fs.writeFile(ledgerPath, JSON.stringify({
  version: 8,
  guilds: {
    '1276125977805721640': {
      boostTop: {
        holders: [],
        initialized: true,
        channelId: '1305857962274848818',
        messageId: '1535671655467323403',
        updatedAt: new Date().toISOString()
      }
    }
  }
}), 'utf8');

const { saveBoostTopDesign, normalizeBoostTopConf } = await import(
  pathToFileURL(path.join(scriptDir, '..', 'src', 'features', 'boostRoles.js')).href
);

const attachmentFromUpload = {
  id: 'att-upload-1',
  url: 'https://cdn.discordapp.com/attachments/1305857962274848818/1535671655467323403/boosters.png',
  name: 'fallen-heaven-boosters.png',
  size: 947386
};

// Die Panel-Nachricht VOR dem Edit: kein Attachment (das Panel wurde ohne Bild
// erstellt). Nach dem Edit gibt Discord eine NEUE Nachricht mit Anhang zurück.
const oldMessage = {
  id: '1535671655467323403',
  channelId: '1305857962274848818',
  attachments: { first: () => null }
};
const editedMessage = {
  id: '1535671655467323403',
  channelId: '1305857962274848818',
  attachments: { first: () => attachmentFromUpload }
};

let editCalls = 0;
let sentPayload = null;
// message.edit(payload) delegiert an this.channel.messages.edit(this, options).
oldMessage.edit = async (payload) => {
  editCalls += 1;
  sentPayload = payload;
  return editedMessage;
};

const channel = {
  id: '1305857962274848818',
  type: 0, // GuildText
  name: 'top-booster',
  isTextBased: () => true,
  messages: {
    fetch: async (messageId) => {
      // Der Code holt die bestehende Panel-Nachricht VOR dem Edit.
      assert.equal(messageId, '1535671655467323403');
      return oldMessage;
    }
  },
  send: async () => { throw new Error('send() darf im Edit-Pfad nicht aufgerufen werden'); }
};

const guild = {
  id: '1276125977805721640',
  name: 'FALLEN HEAVEN',
  premiumSubscriptionCount: 0,
  channels: {
    cache: new Map([['1305857962274848818', channel]])
  },
  members: { cache: new Map() },
  emojis: {
    cache: new Map(),
    fetch: async () => new Map()
  },
  roles: { cache: new Map() }
};

// saveBoostTopDesign erwartet die ROH-Konfiguration (boostTopEnabled, nicht
// das normalisierte enabled-Feld).
const conf = {
  boostTopEnabled: true,
  boostTopChannelId: '1305857962274848818',
  boostTopTemplate: {
    content: '',
    outsideImageUrl: '',
    outsideImageAttachment: null,
    embeds: [{
      title: 'Top Booster', description: '{status}', color: '#a596ff',
      authorName: '', authorIconUrl: '', thumbnailUrl: '', imageUrl: '',
      footerText: '', footerIconUrl: '', timestamp: true, fields: []
    }]
  }
};

const template = {
  content: '',
  outsideImageUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  outsideImageName: 'fallen-heaven-boosters.png',
  outsideImageAttachment: null,
  embeds: [{
    title: 'Top Booster', description: '{status}', color: '#a596ff',
    authorName: '', authorIconUrl: '', thumbnailUrl: '', imageUrl: '',
    footerText: '', footerIconUrl: '', timestamp: true, fields: []
  }]
};

let fetchCalls = 0;
let sendCalls = 0;
channel.messages.fetch = async (messageId) => {
  fetchCalls += 1;
  assert.equal(messageId, '1535671655467323403');
  return oldMessage;
};
channel.send = async () => { sendCalls += 1; throw new Error('send() darf im Edit-Pfad nicht aufgerufen werden'); };

const result = await saveBoostTopDesign({ guild, conf, template, channelId: '1305857962274848818' });

// 1. Der Edit-Pfad wurde genutzt (kein channel.send) und die Datei war im
//    Edit-Payload.
assert.equal(editCalls, 1, 'message.edit() muss genau einmal aufgerufen werden');
assert.equal(sendCalls, 0, 'channel.send() darf im Edit-Pfad nicht aufgerufen werden');
assert.ok(Array.isArray(sentPayload?.files) && sentPayload.files.length === 1, 'Datei muss im Edit-Payload sein');
assert.equal(sentPayload.files[0].name, 'fallen-heaven-boosters.png');

// 2. Der Rückgabewert von edit() (Nachricht MIT Anhang) muss übernommen werden.
assert.ok(result.template.outsideImageAttachment, 'Anhang muss nach dem Edit bestätigt werden');
assert.equal(result.template.outsideImageAttachment.id, 'att-upload-1');
assert.match(result.template.outsideImageUrl, /^https:\/\/cdn\.discordapp\.com\//);
assert.ok(result.panel?.outsideImageAttachment, 'Panel muss den Anhang liefern');

// 3. Die gespeicherte Vorlage hält die CDN-URL + Metadaten.
assert.equal(result.template.outsideImageAttachment.name, 'fallen-heaven-boosters.png');
assert.equal(result.template.outsideImageAttachment.size, 947386);

await fs.rm(tempDataDir, { recursive: true, force: true });
console.log('Boost-Top-Edit-Pfad-E2E bestanden: edit()-Rückgabewert wird übernommen, Anhang bestätigt.');
