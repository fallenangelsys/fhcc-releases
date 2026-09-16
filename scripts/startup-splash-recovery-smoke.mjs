#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appSource = await readFile(new URL('../desktop/renderer/app.js', import.meta.url), 'utf8');

assert.match(appSource, /const STARTUP_STAGE_TIMEOUT_MS = 12_000;/, 'Der Start hat eine feste Obergrenze statt unendlich auf einer Sitzung zu warten.');
assert.match(appSource, /function withStartupStageTimeout\(promise, stage\)/, 'Der Startschutz kapselt hängende IPC- und API-Aufrufe.');
assert.match(appSource, /await withStartupStageTimeout\(api\.getInfo\(\), 'App-Informationen'\)/, 'Auch der erste IPC-Aufruf kann den Splash nicht dauerhaft sperren.');
assert.match(appSource, /await withStartupStageTimeout\(refreshAuth\(\{ startup: true \}\), 'Sitzungsprüfung'\)/, 'Eine festgefahrene Sitzungsprüfung gibt die Oberfläche wieder frei.');
assert.match(appSource, /path: '\/api\/auth\/me', timeoutMs: 8000/, 'Die Sitzungs-API hat einen kurzen lokalen Timeout.');
assert.match(appSource, /path: '\/api\/dashboard\/schema', timeoutMs: 8000/, 'Die Schema-API kann den Workspace-Start nicht ungebremst blockieren.');

console.log('Startup-Splash-Recovery-Smoke bestanden: ein hängender Startschritt hält die App nicht dauerhaft verborgen.');
