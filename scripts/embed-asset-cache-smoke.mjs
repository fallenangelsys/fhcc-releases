// Smoke-Test: Lokaler Embed-Asset-Cache (data/embed-assets).
// Prüft, dass Bilder einmalig heruntergeladen, lokal abgelegt und beim zweiten
// Abruf aus dem Cache bedient werden – auch wenn die Quell-URL nicht mehr
// erreichbar ist. Läuft komplett offline gegen einen lokalen HTTP-Server.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Isolierter Datenordner – MUSS vor dem Modul-Import gesetzt sein, weil der
// Cache den Datenordner beim Laden festlegt.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-embed-assets-'));
process.env.FALLEN_HEAVEN_DATA_DIR = sandbox;

const { _embedAssetCacheInternals } = await import('../src/runtime/embedAssetCache.js');
const { fetchEmbedAsset, readEmbedAsset, purgeEmbedAssetCache, ASSET_DIR } = _embedAssetCacheInternals;

const problems = [];
const expect = (condition, message) => { if (!condition) problems.push(message); };

// Winziges 1×1-PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);
// Winziges animiertes GIF (1×1).
const GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
  'base64'
);

let requests = 0;
let gifRequests = 0;
const server = http.createServer((req, res) => {
  if (req.url === '/bild.png') {
    requests += 1;
    res.writeHead(200, { 'content-type': 'image/png' });
    res.end(PNG);
    return;
  }
  if (req.url === '/anim.gif') {
    gifRequests += 1;
    res.writeHead(200, { 'content-type': 'image/gif' });
    res.end(GIF);
    return;
  }
  res.writeHead(404);
  res.end('nicht gefunden');
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

try {
  // 1) Erster Abruf: Download + lokale Ablage.
  const first = await fetchEmbedAsset(`${base}/bild.png`);
  expect(first?.buffer?.equals(PNG), 'Erster Abruf muss den Bildinhalt liefern.');
  expect(first?.ext === 'png', 'Extension muss aus dem Content-Type abgeleitet werden (png).');
  expect(first?.cached === false, 'Erster Abruf darf nicht aus dem Cache kommen.');
  const filesAfterFirst = fs.readdirSync(ASSET_DIR);
  expect(filesAfterFirst.length === 1 && /^[a-f0-9]{32}\.png$/.test(filesAfterFirst[0]),
    `Genau eine Cache-Datei erwartet, gefunden: ${filesAfterFirst.join(', ')}`);

  // 2) Zweiter Abruf: kommt aus dem Cache, KEIN weiterer Download.
  const second = await fetchEmbedAsset(`${base}/bild.png`);
  expect(second?.buffer?.equals(PNG), 'Zweiter Abruf muss denselben Bildinhalt liefern (Cache).');
  expect(second?.cached === true, 'Zweiter Abruf muss als Cache-Treffer markiert sein.');
  expect(requests === 1, `Nur ein Download erwartet (Cache ab dem 2. Abruf), tatsächlich: ${requests}`);

  // 3) GIF-URL (Emoji-/animierte Bilder) ebenso cachen.
  const gif = await fetchEmbedAsset(`${base}/anim.gif`);
  expect(gif?.ext === 'gif' && gif?.buffer?.equals(GIF), 'GIF muss mit gif-Extension geliefert werden.');
  expect(fs.readdirSync(ASSET_DIR).some((name) => /\.gif$/.test(name)), 'GIF muss im Cache abgelegt sein.');

  // 4) Kaputte URL → null, kein Fehlerwurf, kein Cache-Eintrag.
  const broken = await fetchEmbedAsset(`${base}/fehlt.png`);
  expect(broken === null, 'Nicht erreichbare URL muss null liefern (kein Fehler).');

  // 5) Keine http(s)-URL → null.
  const notUrl = await fetchEmbedAsset('keine-url');
  expect(notUrl === null, 'Nicht-http(s)-Eingaben müssen null liefern.');

  // 6) readEmbedAsset findet die Datei ohne Download.
  const direct = await readEmbedAsset(`${base}/bild.png`);
  expect(direct?.buffer?.equals(PNG) && direct?.cached === true, 'readEmbedAsset muss die Cache-Kopie liefern.');
  expect(requests === 1, 'readEmbedAsset darf nicht herunterladen.');

  // 7) Purge entfernt nur veraltete Dateien.
  const oldFile = path.join(ASSET_DIR, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png');
  fs.writeFileSync(oldFile, PNG);
  const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  fs.utimesSync(oldFile, old, old);
  const removed = await purgeEmbedAssetCache({ retentionDays: 1 });
  expect(removed >= 1, `Purge muss mindestens eine veraltete Datei entfernen (entfernt: ${removed}).`);
  expect(!fs.existsSync(oldFile), 'Veraltete Datei muss nach dem Purge weg sein.');
  const remaining = fs.readdirSync(ASSET_DIR);
  expect(remaining.length >= 2, 'Frische Cache-Dateien (png+gif) müssen erhalten bleiben.');

  // 8) Cache lebt im Datenordner (da, wo auch Serverindex/Daten liegen).
  expect(path.dirname(ASSET_DIR) === path.resolve(sandbox), 'Asset-Cache muss unter data/ liegen.');
} finally {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(sandbox, { recursive: true, force: true });
}

if (problems.length) {
  console.error('EMBED-ASSET-CACHE-SMOKE FEHLGESCHLAGEN:\n- ' + problems.join('\n- '));
  process.exit(1);
}
console.log('embed-asset-cache-smoke: OK (Download → lokaler Cache → Wiederverwendung, Purge funktioniert)');
