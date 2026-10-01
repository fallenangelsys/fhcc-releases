import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-debug-'));
const health = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, serviceReady: true, ready: true, measuredAt: new Date().toISOString(), uptimeMs: 300000, pingMs: 20, guildCount: 1 }));
});
await new Promise((r) => health.listen(0, '127.0.0.1', r));
const port = health.address().port;

fs.writeFileSync(path.join(tmpDir, 'config.json'), JSON.stringify({ webhookUrl: '', healthUrl: `http://127.0.0.1:${port}/health`, downAfterMs: 1000, serverName: 'TEST' }));

const env = { ...process.env,
  FHCC_WATCHDOG_CONFIG: path.join(tmpDir, 'config.json'),
  FHCC_WATCHDOG_STATE: path.join(tmpDir, 'state.json'),
  FHCC_WATCHDOG_LOG: path.join(tmpDir, 'log.txt'),
  FHCC_WATCHDOG_NO_PS: '1',
};
const script = path.join(__dirname, 'server-watchdog.mjs');
const r = spawnSync(process.execPath, [script, '--once'], { env, encoding: 'utf8' });
console.log('exit:', r.status);
console.log('stdout:', r.stdout);
console.log('stderr:', r.stderr);
console.log('state exists:', fs.existsSync(path.join(tmpDir, 'state.json')));
if (fs.existsSync(path.join(tmpDir, 'state.json'))) console.log('state:', fs.readFileSync(path.join(tmpDir, 'state.json'), 'utf8'));
console.log('log:', fs.readFileSync(path.join(tmpDir, 'log.txt'), 'utf8'));
health.close();
fs.rmSync(tmpDir, { recursive: true, force: true });
