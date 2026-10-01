import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'fallen-heaven-local-image-security-'));
process.env.FALLEN_HEAVEN_DATA_DIR = dataRoot;

const { _localImageStoreInternals } = await import(`../src/runtime/localImageStore.js?security=${Date.now()}`);
const {
  IMAGE_DIR,
  MAX_IMAGE_BYTES,
  assertPublicHttpUrl,
  fetchImageBuffer,
  purgeOrphanLocalImages
} = _localImageStoreInternals;

assert.equal(typeof MAX_IMAGE_BYTES, 'number', 'MAX_IMAGE_BYTES muss fuer Grenztests verfuegbar sein.');
assert.equal(typeof assertPublicHttpUrl, 'function', 'Die Zielvalidierung muss separat testbar sein.');
assert.equal(typeof fetchImageBuffer, 'function', 'Der sichere Downloader muss separat testbar sein.');

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];
const privateLookup = async () => [{ address: '10.20.30.40', family: 4 }];

for (const url of [
  'http://localhost/image.png',
  'http://localhost./image.png',
  'http://127.0.0.1/image.png',
  'http://10.0.0.1/image.png',
  'http://172.16.0.1/image.png',
  'http://192.168.1.1/image.png',
  'http://169.254.169.254/latest/meta-data',
  'http://0.0.0.0/image.png',
  'http://[::1]/image.png',
  'http://[fe80::1]/image.png',
  'http://[fc00::1]/image.png',
  'http://[::ffff:127.0.0.1]/image.png',
  'ftp://example.com/image.png'
]) {
  await assert.rejects(
    () => assertPublicHttpUrl(url, { lookup: publicLookup }),
    /oeffentlich|HTTP|Ziel/i,
    `${url} muss blockiert werden.`
  );
}

await assert.rejects(
  () => assertPublicHttpUrl('https://internal.example/image.png', { lookup: privateLookup }),
  /oeffentlich|Ziel/i,
  'Ein Hostname, der privat aufloest, muss blockiert werden.'
);
await assert.rejects(
  () => assertPublicHttpUrl('https://mixed.example/image.png', {
    lookup: async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '192.168.1.10', family: 4 }
    ]
  }),
  /oeffentlich|Ziel/i,
  'Auch gemischte oeffentliche/private DNS-Antworten muessen blockiert werden.'
);
await assert.doesNotReject(
  () => assertPublicHttpUrl('https://cdn.discordapp.com/attachments/1/2/image.png', { lookup: publicLookup }),
  'Discord-CDN mit oeffentlicher Aufloesung muss kompatibel bleiben.'
);
await assert.doesNotReject(
  () => assertPublicHttpUrl('https://images.example.com/image.webp', { lookup: publicLookup }),
  'Oeffentliche Bildziele muessen kompatibel bleiben.'
);

const response = ({ status = 200, headers = {}, chunks = [] } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers(headers),
  body: {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    }
  }
});

{
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    return response({ status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } });
  };
  await assert.rejects(
    () => fetchImageBuffer('https://images.example.com/start.png', { fetchImpl, lookup: publicLookup }),
    /oeffentlich|Ziel/i,
    'Redirects auf Metadaten- oder lokale Ziele muessen vor dem zweiten Request blockiert werden.'
  );
  assert.equal(calls.length, 1, 'Das blockierte Redirect-Ziel darf nie angefragt werden.');
}

{
  const fetchImpl = async () => response({ status: 302, headers: { location: '/next.png' } });
  await assert.rejects(
    () => fetchImageBuffer('https://images.example.com/start.png', {
      fetchImpl,
      lookup: publicLookup,
      maxRedirects: 2
    }),
    /Redirect/i,
    'Die Redirect-Anzahl muss klein und strikt begrenzt sein.'
  );
}

await assert.rejects(
  () => fetchImageBuffer('https://images.example.com/not-image', {
    fetchImpl: async () => response({
      headers: { 'content-type': 'text/html', 'content-length': '4' },
      chunks: [Buffer.from('nope')]
    }),
    lookup: publicLookup
  }),
  /Bild|Content-Type/i,
  'Nicht-Bild-Antworten muessen abgewiesen werden.'
);

await assert.rejects(
  () => fetchImageBuffer('https://images.example.com/declared-too-large.png', {
    fetchImpl: async () => response({
      headers: { 'content-type': 'image/png', 'content-length': String(MAX_IMAGE_BYTES + 1) },
      chunks: []
    }),
    lookup: publicLookup
  }),
  /25 MB|gross/i,
  'Zu grosse Content-Length muss vor dem Lesen abgewiesen werden.'
);

await assert.rejects(
  () => fetchImageBuffer('https://images.example.com/stream-too-large.png', {
    fetchImpl: async () => response({
      headers: { 'content-type': 'image/png' },
      chunks: [Buffer.alloc(Math.ceil(MAX_IMAGE_BYTES / 2)), Buffer.alloc(Math.floor(MAX_IMAGE_BYTES / 2) + 1)]
    }),
    lookup: publicLookup
  }),
  /25 MB|gross/i,
  'Auch ohne Content-Length duerfen tatsaechlich gelesene Bytes das Limit nie ueberschreiten.'
);

await assert.rejects(
  () => fetchImageBuffer('https://images.example.com/slow.png', {
    fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }),
    lookup: publicLookup,
    timeoutMs: 20
  }),
  /lange gedauert/i,
  'Ein haengender Download muss durch den Timeout beendet werden.'
);

{
  const expected = Buffer.from('public-image');
  const actual = await fetchImageBuffer('https://cdn.discordapp.com/attachments/1/2/image.png', {
    fetchImpl: async () => response({
      headers: { 'content-type': 'image/png', 'content-length': String(expected.length) },
      chunks: [expected.subarray(0, 4), expected.subarray(4)]
    }),
    lookup: publicLookup
  });
  assert.deepEqual(actual, expected, 'Ein gueltiges oeffentliches Bild muss unveraendert geladen werden.');
}

await fs.mkdir(IMAGE_DIR, { recursive: true });
const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
const storedAsset = path.join(IMAGE_DIR, '11111111-1111-4111-8111-111111111111.png');
const temporaryAsset = path.join(IMAGE_DIR, '22222222-2222-4222-8222-222222222222.png.tmp');
const emptyAsset = path.join(IMAGE_DIR, '33333333-3333-4333-8333-333333333333.webp');
await fs.writeFile(storedAsset, Buffer.from('still-referenced'));
await fs.writeFile(temporaryAsset, Buffer.from('unfinished'));
await fs.writeFile(emptyAsset, Buffer.alloc(0));
await Promise.all([
  fs.utimes(storedAsset, oldDate, oldDate),
  fs.utimes(temporaryAsset, oldDate, oldDate),
  fs.utimes(emptyAsset, oldDate, oldDate)
]);

const purged = await purgeOrphanLocalImages({ retentionDays: 7 });
assert.equal(purged, 2, 'Nur klar temporaere oder ungueltige Reste sollen entfernt werden.');
assert.equal((await fs.readFile(storedAsset, 'utf8')), 'still-referenced', 'Gueltige gespeicherte Assets duerfen trotz Alter nicht geloescht werden.');
await assert.rejects(() => fs.stat(temporaryAsset), { code: 'ENOENT' });
await assert.rejects(() => fs.stat(emptyAsset), { code: 'ENOENT' });

await fs.rm(dataRoot, { recursive: true, force: true });
console.log('Local image security smoke passed.');
