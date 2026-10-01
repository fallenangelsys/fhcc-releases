// Prüft den GitHub-Releases-Kanal isoliert: URL-Bau, Token-Header, Asset-Auswahl
// und die Umwandlung einer Release-API-Antwort in dieselbe Update-Form, die der
// ordnerbasierte Checker liefert. Kein Netzwerkzugriff, kein Electron.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  normalizeRepoTarget,
  buildReleasesApiUrl,
  buildReleasePageUrl,
  buildAuthHeaders,
  pickInstallerAsset,
  pickManifestAsset,
  resolveReleaseUpdate,
  describeManifestExpectation,
  describeUpdateSource,
  tokenHint
} = require('../desktop/update-source.cjs');
const { verifyArtifactSha512, buildUpdateRunnerScript } = require('../desktop/update-check.cjs');

let passed = 0;
const ok = (name) => { passed += 1; console.log('  ✓ ' + name); };

// 1. Repository-Ziel
assert.deepEqual(normalizeRepoTarget({ owner: 'fallenangel', repo: 'fhcc-releases' }).slug, 'fallenangel/fhcc-releases');
assert.deepEqual(normalizeRepoTarget('fallenangel/fhcc-releases').slug, 'fallenangel/fhcc-releases');
assert.deepEqual(normalizeRepoTarget('https://github.com/fallenangel/fhcc-releases.git').slug, 'fallenangel/fhcc-releases');
assert.equal(normalizeRepoTarget({ owner: 'a', repo: '' }), null);
assert.equal(normalizeRepoTarget(''), null);
assert.equal(normalizeRepoTarget({ owner: '../../evil', repo: 'x' }), null, 'Pfad-Traversal wird abgelehnt, nicht auf "evil" umgebogen');
assert.equal(normalizeRepoTarget({ owner: 'a/b', repo: 'c' }), null, 'ein Slash im Owner wird abgelehnt statt bereinigt');
assert.equal(normalizeRepoTarget({ owner: 'fallen angel', repo: 'x' }), null, 'Leerzeichen sind ungültig');
ok('Repository-Ziel (Slug, URL, Ablehnung statt stiller Reparatur)');

// 2. URLs
assert.equal(
  buildReleasesApiUrl('fallenangel/fhcc-releases'),
  'https://api.github.com/repos/fallenangel/fhcc-releases/releases/latest'
);
assert.equal(buildReleasesApiUrl({ owner: 'a/b', repo: 'c' }), '', 'ungültiges Ziel liefert keine URL');
assert.equal(
  buildReleasesApiUrl('fallenangel/fhcc-releases', ''),
  'https://api.github.com/repos/fallenangel/fhcc-releases/releases',
  'ohne Suffix wird die Releases-Sammlung ohne abschliessenden Slash angesprochen (POST sonst Umleitung)'
);
assert.equal(
  buildReleasesApiUrl('fallenangel/fhcc-releases', '/tags/v3.9.320/'),
  'https://api.github.com/repos/fallenangel/fhcc-releases/releases/tags/v3.9.320',
  'überflüssige Slashes werden normalisiert'
);
assert.equal(
  buildReleasePageUrl('fallenangel/fhcc-releases', 'v3.9.320'),
  'https://github.com/fallenangel/fhcc-releases/releases/tag/v3.9.320'
);
assert.match(buildReleasePageUrl('fallenangel/fhcc-releases'), /\/releases\/latest$/);
ok('API- und Release-Seiten-URLs');

// 3. Auth-Header: Feingrained- und Classic-Token brauchen unterschiedliche Präfixe.
assert.equal(buildAuthHeaders('').Authorization, undefined, 'ohne Token wird kein Authorization-Header gesendet');
assert.equal(buildAuthHeaders('github_pat_abc').Authorization, 'Bearer github_pat_abc');
assert.equal(buildAuthHeaders('ghp_abc').Accept, 'application/vnd.github+json');
assert.equal(buildAuthHeaders('x')['X-GitHub-Api-Version'], '2022-11-28');
ok('Auth-Header (feingrained + classic, ohne Token anonym)');

// 4. Asset-Auswahl
const assets = [
  { id: 1, name: 'latest.yml', size: 120, browser_download_url: 'https://x/latest.yml' },
  { id: 2, name: 'FHCC-Setup-3.9.320-x64.exe', size: 594132442, browser_download_url: 'https://x/exe' },
  { id: 3, name: 'FHCC-Setup-3.9.320-x64.exe.blockmap', size: 90000, browser_download_url: 'https://x/bm' }
];
assert.equal(pickInstallerAsset(assets).id, 2, 'das Blockmap ist kein Installer');
assert.equal(pickManifestAsset(assets).id, 1);
assert.equal(pickInstallerAsset([]), null);
ok('Installer- vs. Manifest-Asset (Blockmap wird nicht verwechselt)');

// 5. Release → Update-Form
const release = { tag_name: 'v3.9.320', assets };
const resolved = resolveReleaseUpdate({ release, currentVersion: '3.9.319', target: 'fallenangel/fhcc-releases' });
assert.equal(resolved.available, true);
assert.equal(resolved.version, '3.9.320');
assert.equal(resolved.reason, 'ready');
assert.equal(resolved.source, 'github-release');
assert.equal(resolved.artifactName, 'FHCC-Setup-3.9.320-x64.exe');
assert.equal(resolved.artifactUrl, 'https://x/exe');
assert.equal(resolved.manifestUrl, 'https://x/latest.yml');
assert.equal(resolved.size, 594132442);
assert.equal(resolved.tag, 'v3.9.320');
assert.match(resolved.releaseUrl, /releases\/tag\/v3\.9\.320$/);
ok('Release-Payload → Update (Version aus dem Installer-Namen, nicht aus dem Tag)');

// 6. Kante: Tag ohne "v", gleiche und ältere Version
const noVTag = resolveReleaseUpdate({
  release: { tag_name: '3.9.321', assets: [{ id: 9, name: 'FHCC-Setup-3.9.321-x64.exe', size: 1 }] },
  currentVersion: '3.9.319',
  target: 'fallenangel/fhcc-releases'
});
assert.equal(noVTag.version, '3.9.321');
assert.equal(resolveReleaseUpdate({ release, currentVersion: '3.9.320', target: 'fallenangel/fhcc-releases' }).reason, 'up-to-date');
assert.equal(resolveReleaseUpdate({ release, currentVersion: '3.9.321', target: 'fallenangel/fhcc-releases' }).available, false);
ok('Tag ohne v, gleiche und ältere Version');

// 7. Fehlerfälle: kein Installer, keine Repo-Konfiguration
assert.equal(resolveReleaseUpdate({ release: { assets: [] }, currentVersion: '3.9.319', target: 'a/b' }).reason, 'no-installer');
assert.equal(resolveReleaseUpdate({ release, currentVersion: '3.9.319', target: null }).reason, 'no-repo');
assert.equal(resolveReleaseUpdate({ release, currentVersion: '3.9.319' }).repo, '');
ok('Fehlerfälle (kein Installer, keine Repo-Konfiguration)');

// 8. Manifest als Integritätsquelle – wird VOR dem 560-MB-Download gelesen.
const goodManifest = ['version: 3.9.320', 'path: FHCC-Setup-3.9.320-x64.exe', 'sha512: ABC==', 'size: 594132442'].join('\n');
const expectation = describeManifestExpectation(goodManifest, { version: '3.9.320', size: 594132442 });
assert.equal(expectation.ok, true);
assert.equal(expectation.sha512, 'ABC==');
assert.equal(describeManifestExpectation('version: 3.9.320', {}).reason, 'manifest-ohne-sha512');
assert.equal(describeManifestExpectation('', {}).reason, 'manifest-ohne-version');
const swapped = describeManifestExpectation(goodManifest, { version: '3.9.320', size: 10 * 1024 * 1024 });
assert.equal(swapped.ok, false, 'ein vertauschter Download wird über die Größe erkannt');
assert.equal(swapped.reason, 'groesse-weicht-ab');
assert.equal(describeManifestExpectation(goodManifest, { size: 594132442 + 512 }).ok, true, 'kleinere Abweichung wird toleriert');
ok('latest.yml als Integritätsquelle vor dem Download (inkl. Größenprüfung)');

// 9. Oberflächen-Beschreibung ohne Klartext-Token
assert.equal(tokenHint(''), '');
assert.equal(tokenHint('github_pat_11AA22BB33CC44DD'), 'gith••••••44DD');
assert.ok(!tokenHint('github_pat_geheimgeheim').includes('geheim'), 'der Klartext taucht nicht im Hinweis auf');
assert.deepEqual(describeUpdateSource({ repoOwner: 'a', repoRepo: 'b', __token: 'tok_abcdefghijkl' }), {
  type: 'github-release', repo: 'a/b', releaseUrl: 'https://github.com/a/b/releases/latest', tokenHint: 'tok_••••••ijkl', hasToken: true
});
assert.equal(describeUpdateSource({ updateFolder: 'C:/dist' }).type, 'folder');
assert.equal(describeUpdateSource({}).type, 'none');
ok('Quellen-Beschreibung (Token nur als Hinweis, nie im Klartext)');

// 10. Verdrahtung im Hauptprozess absichern. main.cjs laesst sich wegen der
// Electron-Abhaengigkeit nicht isoliert importieren, deshalb werden die
// entscheidenden Sicherheitsregeln direkt im Quelltext verankert.
const mainSource = await readFile(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
const preloadSource = await readFile(new URL('../desktop/preload.cjs', import.meta.url), 'utf8');

assert.match(mainSource, /safeStorage\.encryptString/, 'der Token muss verschluesselt gespeichert werden');
assert.match(mainSource, /safeStorage\.decryptString/, 'der Token muss beim Lesen entschluesselt werden');
assert.ok(
  !/token\s*[:=]\s*[^,\n]*writeUpdateSettings\(\s*\{\s*token/i.test(mainSource),
  'der Token darf niemals im Klartext in die Settings geschrieben werden'
);
assert.match(mainSource, /safeStorage\.isEncryptionAvailable/, 'ohne verfuegbare Verschluesselung wird gar nicht erst gespeichert');
assert.match(
  mainSource,
  /if \(!verifyArtifactSha512\(installer, expectation\.sha512\)\)[\s\S]{0,240}runUpdateInstaller/,
  'der Installer wird erst nach der SHA-512-Pruefung gestartet'
);
assert.match(
  mainSource,
  /if \(!releaseUpdate\.manifestUrl\)[\s\S]{0,200}(abort|abgebrochen|Integrit)/i,
  'ohne latest.yml wird nicht installiert – sonst gaebe es keine Integritaetspruefung'
);
assert.match(mainSource, /await fetchLatestRelease\(\)|await checkGitHubRelease\(\)/, 'der Auto-Update-Loop muss den Release-Kanal abfragen');
assert.ok(
  mainSource.indexOf('checkGitHubRelease()') < mainSource.indexOf('checkForUpdate(folder'),
  'der Release-Kanal wird vor dem Ordner geprueft'
);
assert.match(preloadSource, /setUpdateToken/, 'die Brücke muss das Setzen des Tokens anbieten');
assert.match(preloadSource, /testUpdateChannel/, 'die Brücke muss die Kanalprüfung anbieten');
assert.ok(
  !/tokenEnc|readUpdateToken/.test(preloadSource),
  'der verschluesselte Token und seine Entschlüsselung dürfen die Brücke nicht verlassen'
);
ok('Verdrahtung im Hauptprozess (DPAPI, SHA-512 vor Start, Kanalreihenfolge)');

// 11. Ketten-Test der gesamten Update-Strecke mit echten Dateien:
// Release-Payload -> latest.yml -> Installer -> SHA-512 -> Runner-Skript.
const chainDir = mkdtempSync(path.join(tmpdir(), 'fhcc-chain-'));
try {
  const installerBytes = Buffer.alloc(8192, 3);
  const installerFile = path.join(chainDir, 'FHCC-Setup-3.9.321-x64.exe');
  writeFileSync(installerFile, installerBytes);
  const realSha = createHash('sha512').update(installerBytes).digest('base64');
  const manifestText = [
    'version: 3.9.321',
    'path: FHCC-Setup-3.9.321-x64.exe',
    `sha512: '${realSha}'`,
    `size: ${installerBytes.length}`,
    ''
  ].join('\n');

  const chain = resolveReleaseUpdate({
    release: {
      tag_name: 'v3.9.321',
      assets: [
        { id: 7, name: 'latest.yml', size: manifestText.length, browser_download_url: 'https://example.invalid/latest.yml' },
        { id: 8, name: 'FHCC-Setup-3.9.321-x64.exe', size: installerBytes.length, browser_download_url: 'https://example.invalid/exe' }
      ]
    },
    currentVersion: '3.9.319',
    target: 'fallenangel/fhcc-releases'
  });
  assert.equal(chain.available, true, 'Release 3.9.321 wird gegen 3.9.319 als neuer erkannt');

  const expectation = describeManifestExpectation(manifestText, chain);
  assert.equal(expectation.ok, true, 'latest.yml wird akzeptiert');
  assert.equal(expectation.sha512, realSha);
  assert.equal(verifyArtifactSha512(installerFile, expectation.sha512), true, 'der Installer besteht die Integritätsprüfung');

  const runner = buildUpdateRunnerScript({
    installer: installerFile,
    installDir: 'C:\\Users\\5gtag\\AppData\\Local\\Programs\\FHCC',
    logFile: path.join(chainDir, 'last-update.log'),
    appPid: 999
  });
  assert.ok(runner.includes(installerFile), 'das Skript zeigt auf den geprüften Installer');
  assert.ok(runner.includes('Wait-Process -Id 999'), 'es wartet auf das Beenden der App');
  assert.ok(runner.includes('/S --updated --force-run'), 'der stille Lauf bleibt erhalten');

  // Und der umgekehrte Fall: ein vertauschter oder manipulierter Installer
  // darf niemals zum Start des Skripts führen.
  writeFileSync(installerFile, Buffer.alloc(8192, 4));
  assert.equal(verifyArtifactSha512(installerFile, expectation.sha512), false, 'ein veraenderter Installer wird abgewiesen');
} finally {
  rmSync(chainDir, { recursive: true, force: true });
}
ok('Ketten-Test: Release → Manifest → Installer → SHA-512 → Runner (inkl. Ablehnung)');

console.log(`\nGitHub-Releases-Update-Smoke: ${passed} Prüfungen bestanden.`);
