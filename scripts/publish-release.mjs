// Veröffentlicht die gebauten Artefakte aus dist/ als Release in einem
// PRIVATEN GitHub-Repository.
//
// Warum Release-Assets und kein Git-Commit: der Installer ist über 560 MB.
// Ein Commit würde die Git-History dauerhaft aufblähen, ein Release-Asset
// liefert GitHub dagegen per CDN aus – und die Update-Kette der App prüft
// ohnehin nur die Release-API.
//
// Aufruf:
//   node scripts/publish-release.mjs --repo <owner/name> [--token <pat>] [--dry-run]
// Token-Reihenfolge: --token, dann GH_TOKEN, dann GITHUB_TOKEN.
// Das Token braucht auf dem Ziel-Repository "Contents: write" (fine-grained).
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseLatestManifest } from '../desktop/update-check.cjs';
import {
  buildAuthHeaders,
  buildReleasesApiUrl,
  normalizeRepoTarget
} from '../desktop/update-source.cjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(projectRoot, 'dist');

const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? (args[index + 1] ?? '').trim() : '';
};
const has = (name) => args.includes(`--${name}`);

const repoInput = flag('repo') || process.env.FHCC_RELEASE_REPO || '';
const token = flag('token') || process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
const dryRun = has('dry-run');

const fail = (message) => {
  console.error(`\nFEHLER: ${message}\n`);
  process.exit(1);
};

const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;

const target = normalizeRepoTarget(repoInput);
if (!target) fail('Repository fehlt oder ist ungültig. Aufruf: --repo <owner/name>');

// ---------------------------------------------------------------------------
// 1. Artefakte bestimmen und LOKAL prüfen, bevor irgendetwas veröffentlicht wird
// ---------------------------------------------------------------------------
const manifestPath = path.join(distDir, 'latest.yml');
if (!existsSync(manifestPath)) fail(`Keine ${manifestPath} gefunden. Erst "npm run build:win" ausführen.`);

const manifest = parseLatestManifest(readFileSync(manifestPath, 'utf8'));
if (!manifest.version) fail('latest.yml enthält keine Version.');

const installerPath = path.join(distDir, path.basename(manifest.path || `FHCC-Setup-${manifest.version}-x64.exe`));
if (!existsSync(installerPath)) fail(`Installer fehlt: ${installerPath}`);

const blockmapPath = `${installerPath}.blockmap`;
const installerSize = statSync(installerPath).size;

console.log(`\nFALLEN HEAVEN Control Center – Release ${manifest.version}`);
console.log(`Repository: ${target.slug}${dryRun ? '  (Probelauf, es wird nichts veröffentlicht)' : ''}`);
console.log(`Installer:  ${path.basename(installerPath)}  ${mb(installerSize)}`);
console.log(`latest.yml: sha512 vorhanden=${Boolean(manifest.sha512)}  size=${manifest.size || '(fehlt)'}`);

if (!manifest.sha512) {
  fail('latest.yml enthält keinen sha512-Hash. Ohne ihn kann die App den Download nicht prüfen – Veröffentlichung abgebrochen.');
}

// Der Hash wird vor dem Upload gegen die echte Datei geprüft. Sonst würde
// ggf. ein beschädigtes Release veröffentlicht, das die App später als
// "beschädigt" ablehnt – der Nutzer sähe nur einen Abbruch ohne Ursache.
process.stdout.write(`Prüfe SHA-512 lokal … `);
const digest = createHash('sha512').update(readFileSync(installerPath)).digest('base64');
if (digest !== manifest.sha512) {
  console.error('FEHLGESCHLAGEN');
  fail('Der Installer passt nicht zu latest.yml. Bitte neu bauen – vermutlich ist der Build zwischenzeitlich überschrieben worden.');
}
console.log('stimmt.');

if (manifest.size && Number(manifest.size) !== installerSize) {
  console.warn(`WARNUNG: latest.yml nennt ${mb(manifest.size)}, die Datei ist ${mb(installerSize)}. Die App toleriert nur kleine Abweichungen.`);
}

const assets = [
  { path: installerPath, name: path.basename(installerPath), contentType: 'application/vnd.microsoft.portable-executable' },
  { path: manifestPath, name: 'latest.yml', contentType: 'text/yaml' }
];
if (existsSync(blockmapPath)) {
  assets.push({ path: blockmapPath, name: path.basename(blockmapPath), contentType: 'application/octet-stream' });
}

if (dryRun) {
  console.log('\nProbelauf – folgende Assets würden hochgeladen:');
  for (const asset of assets) console.log(`  · ${asset.name}  ${mb(statSync(asset.path).size)}`);
  console.log(`  → https://github.com/${target.slug}/releases/tag/v${manifest.version}\n`);
  process.exit(0);
}

if (!token) fail('Kein Token. --token <pat> setzen oder GH_TOKEN/GITHUB_TOKEN exportieren.');

const githubFetch = async (url, init = {}) => fetch(url, {
  ...init,
  headers: { ...buildAuthHeaders(token), ...(init.headers || {}) }
});

// ---------------------------------------------------------------------------
// 2. Release anlegen (oder ein vorhandenes mit gleichem Tag wiederverwenden)
// ---------------------------------------------------------------------------
const tag = `v${manifest.version}`;
console.log(`\nLege Release ${tag} an …`);

const existing = await githubFetch(buildReleasesApiUrl(target, `tags/${encodeURIComponent(tag)}`));
let release;
if (existing.status === 200) {
  release = await existing.json();
  console.log(`  Release ${tag} existiert bereits (ID ${release.id}) – Assets werden ersetzt.`);
} else if (existing.status === 404) {
  const created = await githubFetch(buildReleasesApiUrl(target, ''), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tag_name: tag,
      name: `FALLEN HEAVEN Control Center ${manifest.version}`,
      body: `Automatisch veröffentlicht aus \`dist/\`.\n\n- Installer: ${path.basename(installerPath)} (${mb(installerSize)})\n- SHA-512: \`${manifest.sha512}\``,
      draft: false,
      prerelease: false
    })
  });
  if (!created.ok) {
    const body = await created.text().catch(() => '');
    // GitHub liefert hier die eigentliche Ursache im Feld errors[].message.
    // Ohne sie rät man leicht und beschuldigt den Token, obwohl z. B. ein
    // leeres Repository der Grund ist.
    let detail = '';
    try {
      const parsed = JSON.parse(body);
      detail = (parsed?.errors || []).map((entry) => entry.message).filter(Boolean).join(' / ')
        || parsed?.message || '';
    } catch {
      detail = body.slice(0, 200);
    }
    let hint = '';
    if (/Repository is empty/i.test(detail)) {
      hint = '\n\nDas Repository hat noch keinen Commit. Lege eine erste Datei an (z. B. eine README) – GitHub erlaubt in einem leeren Repository kein Release.';
    } else if (/not accessible|Resource not accessible/i.test(detail)) {
      hint = '\n\nDem Token fehlt "Contents: write" für genau dieses Repository.';
    }
    fail(`Release konnte nicht angelegt werden (HTTP ${created.status}).\nGitHub sagt: ${detail}${hint}`);
  }
  release = await created.json();
  console.log(`  Release angelegt (ID ${release.id}).`);
} else {
  const body = await existing.text().catch(() => '');
  fail(`Tag-Abfrage fehlgeschlagen (HTTP ${existing.status}).\n${body.slice(0, 400)}`);
}

// Vorhandene Assets mit gleichem Namen entfernen, damit ein wiederholter
// Lauf nicht an "already_exists" scheitert.
const currentAssets = Array.isArray(release.assets) ? release.assets : [];
for (const asset of currentAssets) {
  const wanted = assets.some((candidate) => candidate.name === asset.name);
  if (!wanted) continue;
  const removed = await githubFetch(`https://api.github.com/repos/${target.owner}/${target.repo}/releases/assets/${asset.id}`, { method: 'DELETE' });
  if (removed.status === 204 || removed.ok) console.log(`  Altes Asset entfernt: ${asset.name}`);
  else console.warn(`  Altes Asset konnte nicht entfernt werden: ${asset.name} (HTTP ${removed.status})`);
}

// ---------------------------------------------------------------------------
// 3. Assets hochladen – gestreamt, damit 566 MB nicht im Speicher landen
// ---------------------------------------------------------------------------
const uploadUrl = String(release.upload_url || '').replace(/\{.*$/, '');

for (const asset of assets) {
  const size = statSync(asset.path).size;
  process.stdout.write(`Lade ${asset.name} (${mb(size)}) … `);
  const response = await githubFetch(`${uploadUrl}?name=${encodeURIComponent(asset.name)}`, {
    method: 'POST',
    headers: {
      'Content-Type': asset.contentType,
      // Nur Content-Length. Content-Length UND Transfer-Encoding zusammen
      // lehnt undici mit "invalid transfer-encoding header" ab – der Upload
      // bricht dann ab, bevor ein einziges Byte ankommt.
      'Content-Length': String(size)
    },
    body: createReadStream(asset.path),
    duplex: 'half'
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.error('FEHLGESCHLAGEN');
    fail(`${asset.name} konnte nicht hochgeladen werden (HTTP ${response.status}).\n${body.slice(0, 400)}`);
  }
  const uploaded = await response.json();
  console.log(`fertig (${mb(uploaded.size || size)}).`);
}

console.log(`\n✓ Release ${manifest.version} veröffentlicht: https://github.com/${target.slug}/releases/tag/${tag}`);
console.log('  Update-Kanal prüfen: in der App "Release-Repository" auf dieses Repository setzen und "Verbindung testen" klicken.\n');
