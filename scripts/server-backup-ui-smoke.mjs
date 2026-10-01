import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const html = await fs.readFile(new URL('../desktop/renderer/index.html', import.meta.url), 'utf8');
const renderer = await fs.readFile(new URL('../desktop/renderer/server-management.js', import.meta.url), 'utf8');
const styles = await fs.readFile(new URL('../desktop/renderer/ui-base.css', import.meta.url), 'utf8');
const dashboard = await fs.readFile(new URL('../src/dashboard.js', import.meta.url), 'utf8');
const backupSource = await fs.readFile(new URL('../src/features/serverBackup.js', import.meta.url), 'utf8');

for (const id of [
  'backups-count', 'backup-health', 'backup-summary', 'backup-list', 'backup-create', 'backup-refresh',
  'backup-restore-dialog', 'backup-restore-preview', 'backup-restore-ack', 'backup-restore-confirm'
]) assert(html.includes(`id="${id}"`), `Backup-Oberfläche ${id} fehlt.`);
assert(html.includes('data-community-tab="backups"'));
assert(html.includes('data-community-panel="backups"'));
assert(html.includes('ohne Chat-Inhalte'));

for (const token of ['loadServerBackups', 'createServerBackup', 'previewServerRestore', 'restoreServerBackup', '/server-backups']) {
  assert(renderer.includes(token), `Backup-Renderer-Funktion ${token} fehlt.`);
}
assert(!/window\.confirm\([^)]*backup/i.test(renderer), 'Backup-Restore darf keinen nativen Browser-Dialog verwenden.');
assert(styles.includes('.backup-control-panel'));
assert(styles.includes('.backup-restore-options'));

for (const route of [
  "app.get('/api/guild/:guildId/server-backups'",
  "app.post('/api/guild/:guildId/server-backups'",
  "app.post('/api/guild/:guildId/server-backups/:backupId/preview-restore'",
  "app.post('/api/guild/:guildId/server-backups/:backupId/restore'"
]) assert(dashboard.includes(route), `Backup-API ${route} fehlt.`);
assert(dashboard.includes("req.body?.confirm !== true"), 'Restore muss serverseitig eine ausdrückliche Bestätigung verlangen.');
assert(backupSource.includes('chatContentsIncluded: false'), 'Backups müssen Chat-Inhalte ausdrücklich ausschließen.');
assert(backupSource.includes('atomicWriteJson(file, snapshot'), 'Backup-Dateien müssen atomar geschrieben werden.');
assert(backupSource.includes("['icon', source.icon"), 'Server-Icon-Restore fehlt.');

console.log('Server-Backup-UI-Smoke bestanden: sichtbare Zentrale, atomare Sicherung, Vorschau, Bestätigung und kontrollierter Restore sind verbunden.');
