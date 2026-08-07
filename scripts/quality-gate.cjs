const { existsSync, readFileSync, readdirSync, statSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const extensions = new Set(['.js', '.cjs', '.mjs', '.json', '.html', '.css']);
const ignored = new Set(['node_modules', '.desktop-runtime', 'dist', 'release', 'runtime', 'data']);
const brokenEncoding = /(?:[\u00c2\u00c3][\u0080-\u00bf\u00a0-\u00ff]|\u00e2[\u0080-\uffff]{2}|\u00f0[\u0080-\uffff]{3}|\u00ef[\u0080-\uffff]{2}|\uFFFD)/;
const problems = [];

function walk(directory) {
  for (const name of readdirSync(directory)) {
    if (ignored.has(name)) continue;
    const target = path.join(directory, name);
    const stat = statSync(target);
    if (stat.isDirectory()) walk(target);
    else if (extensions.has(path.extname(name).toLowerCase())) inspect(target);
  }
}

function inspect(file) {
  const source = readFileSync(file, 'utf8');
  source.split(/\r?\n/).forEach((line, index) => {
    if (brokenEncoding.test(line)) problems.push(`${path.relative(root, file)}:${index + 1} enthält beschädigte UTF-8-Zeichen.`);
  });
  const extension = path.extname(file).toLowerCase();
  if (['.js', '.cjs', '.mjs'].includes(extension)) {
    const checked = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', windowsHide: true });
    if (checked.status !== 0) {
      const detail = String(checked.stderr || checked.stdout || 'Unbekannter Syntaxfehler').trim().split(/\r?\n/).slice(0, 6).join(' ');
      problems.push(`${path.relative(root, file)} enthält einen Syntaxfehler: ${detail}`);
    }
  }
  if (extension === '.json') {
    try { JSON.parse(source.replace(/^\uFEFF/, '')); }
    catch (error) { problems.push(`${path.relative(root, file)} enthält ungültiges JSON: ${error.message}`); }
  }
}

const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const resources = pkg.build?.extraResources || [];
for (const entry of resources) {
  if (['.env', 'data'].includes(entry?.from)) problems.push(`package.json paketiert den vertraulichen Pfad ${entry.from}.`);
}
const packagedFiles = pkg.build?.files || [];
for (const requiredRule of ['!**/.env', '!**/.env.*', '!data/**', '!runtime/**']) {
  if (!packagedFiles.includes(requiredRule)) problems.push(`package.json enthält nicht die erforderliche Ausschlussregel ${requiredRule}.`);
}

// The public home screen is removed by the current renderer before app.js
// starts. Direct DOM writes to its old status node would break Discord login
// immediately after workspace data has loaded. Keep this regression covered by
// the normal quality command used for every installer build.
const rendererSource = readFileSync(path.join(root, 'desktop', 'renderer', 'app.js'), 'utf8');
const desktopMainSource = readFileSync(path.join(root, 'desktop', 'main.cjs'), 'utf8');
const preloadSource = readFileSync(path.join(root, 'desktop', 'preload.cjs'), 'utf8');
const dashboardSource = readFileSync(path.join(root, 'src', 'dashboard.js'), 'utf8');
const botSource = readFileSync(path.join(root, 'src', 'index.js'), 'utf8');
const aiChatSource = readFileSync(path.join(root, 'src', 'features', 'aiChat.js'), 'utf8');
const supervisorSource = readFileSync(path.join(root, 'desktop', 'process-supervisor.cjs'), 'utf8');
const economySource = readFileSync(path.join(root, 'src', 'features', 'heavenEconomy.js'), 'utf8');
if (/document\.getElementById\(['"](?:home-service|module-count)['"]\)\.textContent\s*=/.test(rendererSource)) {
  problems.push('app.js schreibt unsicher in ein entferntes Hauptmenü-Element und kann dadurch die Discord-Anmeldung abbrechen.');
}
if (/setView\(['"]modules['"]\);\s*renderModules\(\)/.test(rendererSource)) {
  problems.push('app.js rendert die Modulansicht beim Öffnen doppelt und verursacht sichtbares Flackern.');
}
if (/renderModules\(\);\s*renderModuleConfig\(\)/.test(rendererSource)) {
  problems.push('app.js baut Modulraster und Konfiguration unmittelbar doppelt auf.');
}
if (/state\.activeFeatureId\s*=\s*card\.dataset\.module;\s*renderModules\(\)/.test(rendererSource)) {
  problems.push('app.js ersetzt beim Modulwechsel noch das vollständige Kartenraster.');
}
if (/await loadModuleResources\(guildId\);[\s\S]{0,240}await loadStudioChannels\(guildId\)/.test(rendererSource)) {
  problems.push('app.js lädt die Kanalliste beim Serverwechsel weiterhin doppelt.');
}
if (/window\.(?:confirm|alert|prompt)\s*\(/.test(rendererSource)) {
  problems.push('app.js verwendet wieder einen ungestylten nativen Windows-Dialog.');
}
if (/beforeunload[\s\S]{0,180}returnValue\s*=/.test(rendererSource)) {
  problems.push('app.js erzeugt beim Schließen wieder einen nativen Browser-Bestätigungsdialog.');
}
if (!rendererSource.includes('showAppConfirm') || !rendererSource.includes('onCloseRequested')
  || !preloadSource.includes('window:close-response') || !desktopMainSource.includes('app:close-requested')) {
  problems.push('Der einheitliche App-Dialog deckt Navigation, Wiederherstellung oder das sichere Schließen nicht vollständig ab.');
}
if (!desktopMainSource.includes('dashboardSessionGeneration') || !desktopMainSource.includes('requestGeneration !== dashboardSessionGeneration')) {
  problems.push('main.cjs schützt parallele API-Anfragen nicht gegen einen gleichzeitig erneuerten Discord-Login.');
}
if (/Token invalid or expired|Unauthenticated/.test(dashboardSource)) {
  problems.push('dashboard.js liefert weiterhin unverständliche englische Sitzungsfehler.');
}
if (/await guild\.roles\.fetch\(\)/.test(botSource)) {
  problems.push('index.js blockiert das Öffnen von Modulen weiterhin mit einem vollständigen Discord-Rollenabruf.');
}
if (!aiChatSource.includes("fs.open(claimFile, 'wx')") || !aiChatSource.includes('claimDiscordMessage(message.id)')) {
  problems.push('AI Chat besitzt keinen prozessübergreifenden Schutz gegen Doppelantworten.');
}
if (!supervisorSource.includes("path: '/api/ping'") || !supervisorSource.includes('Kein zweiter Discord-Client wurde gestartet.')) {
  problems.push('Die Desktop-App erkennt einen bereits laufenden Bot nicht sicher und könnte einen Doppelstart auslösen.');
}
if (!supervisorSource.includes('const runtimeExecutable = this.isPackaged') || !supervisorSource.includes("FALLEN_HEAVEN_NODE_EXECUTABLE || 'node'") || !supervisorSource.includes("this.isPackaged ? { ELECTRON_RUN_AS_NODE: '1' } : {}")) {
  problems.push('Der Bot-Prozess trennt Entwicklungs-Node und gepackte Electron-ABI nicht zuverlässig.');
}
for (const requiredEconomyControl of ['fh_coin:account', 'fh_coin:shop', 'fh_coin:gift', 'fh_coin:buy', 'fh_coin:progress', 'fh_coin:admin']) {
  if (!economySource.includes(requiredEconomyControl)) problems.push(`Heaven-Economy-Panel ist unvollständig: ${requiredEconomyControl} fehlt.`);
}
if (!economySource.includes('rewardedBoostLevels') || !economySource.includes("type: 'vip-refund'")) {
  problems.push('Heaven Economy schützt Boost-Meilensteine oder fehlgeschlagene VIP-Rollenvergaben nicht ausreichend.');
}
if (!economySource.includes('progressEmbed') || !economySource.includes('Aktuell aktiv') || !economySource.includes('async onMessageCreate')) {
  problems.push('Heaven Economy besitzt keinen vollständigen Live-Boost-Embed oder reagiert nicht auf neue Boost-Systemereignisse.');
}
if (/\bmember\.send\s*\(/.test(economySource)) {
  problems.push('Heaven Economy sendet unerwünschte Direktnachrichten statt privater Panel-Antworten.');
}
if (!rendererSource.includes("componentSet:") || !rendererSource.includes("'heavenEconomy'") || !botSource.includes('buildHeavenEconomyComponents')) {
  problems.push('Das Embed Studio kann das vollständige Heaven-VIP-Funktionsset nicht dauerhaft an eine Nachricht hängen.');
}
const defaultConfigSource = readFileSync(path.join(root, 'src', 'defaultConfig.js'), 'utf8');
if (!/key:\s*'autoRole\.roleIds'[\s\S]{0,180}type:\s*'multiRoleSelect'/.test(defaultConfigSource)) {
  problems.push('AutoRole verwendet noch eine veraltete Rollen-ID-Eingabe statt der Discord-Rollenauswahl.');
}
for (const requiredSkinAsset of ['skin-editor.js', 'skin-editor.css']) {
  if (!existsSync(path.join(root, 'desktop', 'renderer', requiredSkinAsset))) {
    problems.push(`Minecraft Skin Studio fehlt: ${requiredSkinAsset}.`);
  }
}
const envFile = path.join(root, '.env');
if (!existsSync(envFile)) console.warn('Hinweis: Keine lokale .env vorhanden. Die App erwartet verschlüsselte Laufzeit-Secrets.');
for (const activeRoot of ['desktop', 'src', 'scripts']) {
  const directory = path.join(root, activeRoot);
  if (existsSync(directory)) walk(directory);
}
if (problems.length) {
  console.error(`Qualitätsprüfung fehlgeschlagen (${problems.length}):`);
  problems.slice(0, 100).forEach((problem) => console.error(`- ${problem}`));
  process.exit(1);
}
console.log('Qualitätsprüfung bestanden: Syntax, UTF-8 und Paket-Sicherheit sind sauber.');
