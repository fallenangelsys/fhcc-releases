// Smoke-Test: Boost-Benachrichtigungs-Embed (Außenbild wird gespeichert und beim
// Versand als echter Discord-Anhang angehängt – wie bei der Aktivitäts-Liga).
// Prüft den kompletten Pfad:
//   • lokale Studio-Datei (localAsset) → payload.files mit Bildinhalt
//   • HTTP-URL → Download + Anhang (kein „hässlicher Link“ im Nachrichtentext)
//   • {boostcount}-Platzhalter wird ersetzt
//   • Regressionsschutz: Der Renderer-Save verwirft das Außenbild nicht mehr.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Isolierter Datenordner – MUSS vor dem Modul-Import gesetzt sein, weil
// localImageStore den Datenordner beim Laden festlegt.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-boost-announce-'));
process.env.FALLEN_HEAVEN_DATA_DIR = sandbox;

const { _localImageStoreInternals } = await import('../src/runtime/localImageStore.js');
const { saveLocalImage } = _localImageStoreInternals;
const { buildBoostAnnouncementPayload } = await import('../src/features/boostRoles.js');

// Winziges 1×1-PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

const guild = { id: 'guild-1', name: 'FALLEN HEAVEN' };
const member = {
  id: 'user-1',
  user: { id: 'user-1', username: 'Aylin', bot: false, toString: () => '<@user-1>' },
  displayName: 'Aylin'
};

const template = (extra = {}) => ({
  content: '{usermention}',
  outsideImageUrl: '',
  embeds: [{
    title: 'Danke für den Boost, {boostcount}×! 🚀',
    description: 'Du boostest jetzt **{boostcount}×** und gibst {guildname} extra Power!',
    color: '#a596ff',
    fields: []
  }],
  ...extra
});

try {
  // 1) Lokale Studio-Datei (localAsset) → echter Anhang im Payload.
  const localRef = await saveLocalImage({
    dataUrl: `data:image/png;base64,${PNG.toString('base64')}`,
    name: 'boost-herz.png'
  });
  assert.ok(localRef?.localAsset === true && localRef.id, 'saveLocalImage muss eine lokale Referenz liefern.');
  const localPayload = await buildBoostAnnouncementPayload(guild, member, {
    boostAnnounceTemplate: template({ outsideImageAttachment: localRef })
  }, 2);
  assert.ok(Array.isArray(localPayload?.files) && localPayload.files.length === 1,
    'Lokales Außenbild muss als Datei-Anhang im Boost-Payload landen.');
  assert.ok(localPayload.files[0].attachment.equals(PNG), 'Der Anhang muss den Bildinhalt enthalten.');
  assert.equal(localPayload.files[0].name, 'boost-herz.png', 'Anhang-Name muss erhalten bleiben.');
  assert.equal(localPayload.embeds[0].toJSON().title, 'Danke für den Boost, 2×! 🚀', '{boostcount} muss ersetzt werden.');

  // 2) HTTP-URL → wird heruntergeladen und als Anhang angehängt.
  let requests = 0;
  const server = http.createServer((req, res) => {
    requests += 1;
    res.writeHead(200, { 'content-type': 'image/png' });
    res.end(PNG);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const urlPayload = await buildBoostAnnouncementPayload(guild, member, {
    boostAnnounceTemplate: template({ outsideImageUrl: `${base}/bild.png`, outsideImageName: 'extern.png' })
  }, 1);
  await new Promise((resolve) => server.close(resolve));
  assert.ok(Array.isArray(urlPayload?.files) && urlPayload.files.length === 1,
    'HTTP-Außenbild muss als Anhang mitgesendet werden.');
  assert.ok(urlPayload.files[0].attachment.equals(PNG), 'Download-Inhalt muss im Anhang stecken.');
  assert.equal(urlPayload.files[0].name, 'extern.png');
  assert.ok(requests >= 1, 'Die HTTP-URL muss heruntergeladen worden sein.');
  assert.ok(!String(urlPayload.content || '').includes(`${base}/bild.png`),
    'Die URL darf nicht als sichtbarer Link im Nachrichtentext landen.');

  // 3) Ohne Außenbild: kein files-Feld, aber Payload bleibt gültig.
  const plainPayload = await buildBoostAnnouncementPayload(guild, member, {
    boostAnnounceTemplate: template()
  }, 3);
  assert.equal(plainPayload?.files, null, 'Ohne Außenbild darf kein Anhang kommen.');
  assert.equal(plainPayload.embeds[0].toJSON().title, 'Danke für den Boost, 3×! 🚀');

  // 4) Regressionsschutz Renderer: Boost-Save speichert das Außenbild.
  const appRenderer = fs.readFileSync(path.join(root, 'desktop', 'renderer', 'app.js'), 'utf8');
  assert.match(appRenderer,
    /outsideImageAttachment: normalizeOutsideImageAttachment\(template\.outsideImageAttachment\)/,
    'saveBoostAnnounceStudioTemplate muss das Außenbild-Attachment speichern.');
  assert.match(appRenderer,
    /outsideImageName: String\(design\.outsideImageAttachment\?\.name \|\| design\.outsideImageName \|\| ''\)/,
    'boostAnnounceStudioTemplate muss das gespeicherte Außenbild laden.');
  assert.match(appRenderer,
    /outsideImageAttachment: design\.outsideImageAttachment && typeof design\.outsideImageAttachment === 'object' \? clone\(design\.outsideImageAttachment\) : null/,
    'boostAnnounceStudioTemplate muss die Attachment-Referenz laden.');
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}

console.log('boost-announce-embed-smoke: OK (localAsset + URL → echter Anhang, {boostcount}, Renderer-Save bewahrt das Außenbild)');
