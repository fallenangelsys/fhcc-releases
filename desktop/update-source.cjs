// Reine GitHub-Releases-Logik ohne Electron-Abhängigkeit – damit sie in
// scripts/auto-update-smoke.mjs isoliert testbar bleibt. Der Main-Prozess
// liefert nur die bereits abgerufenen Netzwerkdaten und die Konfiguration.
//
// Warum Releases und kein Git-Branch: der Installer ist über 560 MB groß.
// Als Release-Asset liefert ihn GitHub per CDN aus, ohne dass die
// Git-History der Release-Datenbank je Binary-Blobs aufnimmt.
const { isVersionNewer, parseVersion, parseLatestManifest } = require('./update-check.cjs');

const GITHUB_API = 'https://api.github.com';
const USER_AGENT = 'FALLEN-HEAVEN-Control-Center';
const INSTALLER_PATTERN = /^FHCC-Setup-(\d+\.\d+\.\d+)-x64\.exe$/i;
const MANIFEST_NAMES = new Set(['latest.yml', 'latest.yaml']);
// GitHub erlaubt im Owner-Namen keine Punkte/Slashes, im Repo-Namen keine
// Slashes. Beides wird ABGELEHNT statt bereinigt: ein stillschweigend
// repariertes "owner/name" würde sonst auf ein fremdes Repository zeigen
// ("../../evil" -> Benutzer "evil").
const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;

// Akzeptiert "owner/repo", aber auch die beiden Felder getrennt.
const normalizeRepoTarget = (source = {}) => {
  const input = typeof source === 'string' ? { slug: source } : (source || {});
  let owner = String(input.owner || '').trim();
  let repo = String(input.repo || '').trim();
  const slug = String(input.slug || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');
  if ((!owner || !repo) && slug.includes('/')) {
    const [slugOwner, slugRepo] = slug.split('/');
    if (!owner) owner = slugOwner;
    if (!repo) repo = slugRepo;
  }
  if (!OWNER_PATTERN.test(owner) || !REPO_PATTERN.test(repo)) return null;
  return { owner, repo, slug: `${owner}/${repo}` };
};

const buildReleasesApiUrl = (target, endpoint = 'latest') => {
  const normalized = normalizeRepoTarget(target);
  if (!normalized) return '';
  const base = `${GITHUB_API}/repos/${normalized.owner}/${normalized.repo}/releases`;
  const suffix = String(endpoint || '').replace(/^\/+|\/+$/g, '');
  // Ohne Suffix wird die Sammlung selbst angesprochen (POST /releases). Ein
  // abschliessender Slash waere eine Umleitung – und bei POST verirrt sie den
  // Request-Body, sodass das Release still nicht angelegt wird.
  return suffix ? `${base}/${suffix}` : base;
};

const buildReleasePageUrl = (target, tag) => {
  const normalized = normalizeRepoTarget(target);
  if (!normalized) return '';
  const suffix = String(tag || '').trim();
  return suffix
    ? `https://github.com/${normalized.owner}/${normalized.repo}/releases/tag/${encodeURIComponent(suffix)}`
    : `https://github.com/${normalized.owner}/${normalized.repo}/releases/latest`;
};

// Feingrained Tokens (repo:FALLEN-HEAVEN/private:read) akzeptieren "Bearer",
// klassische PATs verlangen "token". "Bearer" deckt beide ab.
const buildAuthHeaders = (token) => {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': USER_AGENT
  };
  const value = String(token || '').trim();
  if (value) headers.Authorization = `Bearer ${value}`;
  return headers;
};

const pickInstallerAsset = (assets) => (Array.isArray(assets) ? assets : [])
  .find((asset) => INSTALLER_PATTERN.test(String(asset?.name || '')))
  || null;

const pickManifestAsset = (assets) => (Array.isArray(assets) ? assets : [])
  .find((asset) => MANIFEST_NAMES.has(String(asset?.name || '').toLowerCase()))
  || null;

// Version bevorzugt aus dem Installer-Dateinamen, weil der Tag je nach
// Publishing-Schema "v3.9.320" oder "3.9.320" heißen kann.
const versionFromTag = (tag) => parseVersion(tag)?.raw || '';

const resolveReleaseUpdate = ({ release, currentVersion, target } = {}) => {
  const normalizedTarget = normalizeRepoTarget(target);
  const current = String(currentVersion || '');
  const base = {
    source: 'github-release',
    checked: true,
    current,
    available: false,
    repo: normalizedTarget?.slug || '',
    releaseUrl: ''
  };
  if (!normalizedTarget) return { ...base, reason: 'no-repo' };
  const tag = String(release?.tag_name || '');
  base.releaseUrl = buildReleasePageUrl(normalizedTarget, tag) || buildReleasePageUrl(normalizedTarget);
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const installer = pickInstallerAsset(assets);
  if (!installer) {
    return { ...base, reason: 'no-installer', releaseUrl: base.releaseUrl };
  }
  const version = parseVersion(installer.name)?.raw || versionFromTag(tag);
  if (!version) return { ...base, reason: 'no-version', releaseUrl: base.releaseUrl };
  const manifest = pickManifestAsset(assets);
  const size = Number(installer.size) || 0;
  const available = isVersionNewer(version, current);
  return {
    ...base,
    available,
    reason: available ? 'ready' : 'up-to-date',
    version,
    artifactName: String(installer.name),
    artifactUrl: String(installer.browser_download_url || ''),
    assetId: Number(installer.id) || 0,
    manifestName: manifest ? String(manifest.name) : '',
    manifestUrl: manifest ? String(manifest.browser_download_url || '') : '',
    size,
    tag
  };
};

// Das Manifest ist die Integritätsquelle: sha512 + Größe des Installers.
// Es wird VOR dem Download gelesen, damit die 560 MB nicht umsonst fließen.
const describeManifestExpectation = (manifestText, expected = {}) => {
  const manifest = parseLatestManifest(manifestText);
  const version = manifest.version || String(expected.version || '');
  const sha512 = String(manifest.sha512 || '').trim();
  const declaredSize = Number(manifest.size) || 0;
  const remoteSize = Number(expected.size) || 0;
  if (!version) return { ok: false, reason: 'manifest-ohne-version' };
  if (!sha512) return { ok: false, reason: 'manifest-ohne-sha512', version };
  // GitHub und electron-builder dürfen in der Byte-Zahl um 1 abweichen
  // (Manifest wird vor dem Packen geschrieben) - nur ein harter Sprung
  // deutet auf einen vertauschten Download hin.
  if (declaredSize && remoteSize && Math.abs(declaredSize - remoteSize) > 1024 * 1024) {
    return { ok: false, reason: 'groesse-weicht-ab', version, sha512, size: declaredSize };
  }
  return { ok: true, version, sha512, size: declaredSize || remoteSize };
};

// Kurze, nicht geheime Kennzeichnung für die Oberfläche, damit der Nutzer
// sieht WHICH Token hinterlegt ist, ohne dass der Klartext gespeichert wird.
const tokenHint = (token) => {
  const value = String(token || '').trim();
  if (!value) return '';
  if (value.length <= 8) return '•'.repeat(value.length);
  return `${value.slice(0, 4)}${'•'.repeat(6)}${value.slice(-4)}`;
};

const describeUpdateSource = (settings = {}) => {
  // Die Einstellungen heißen repoOwner/repoRepo (klarer als owner/repo,
  // weil updateFolder ebenfalls in derselben Datei liegt).
  const target = normalizeRepoTarget({
    owner: settings.repoOwner || settings.owner,
    repo: settings.repoRepo || settings.repo,
    slug: settings.repoSlug
  });
  return {
    type: target ? 'github-release' : (settings.updateFolder ? 'folder' : 'none'),
    repo: target?.slug || '',
    releaseUrl: target ? buildReleasePageUrl(target) : '',
    tokenHint: tokenHint(settings.__token || ''),
    hasToken: Boolean(String(settings.__token || '').trim())
  };
};

module.exports = {
  GITHUB_API,
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
};
