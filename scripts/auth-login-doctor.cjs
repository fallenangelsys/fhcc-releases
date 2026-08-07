#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const root = path.resolve(process.argv[2] || process.cwd());
const port = 3000;
const expectedRedirect = `http://127.0.0.1:${port}/api/auth/discord/callback`;
const findings = [];
const ok = [];

function parseEnv(file) {
  if (!fs.existsSync(file)) return {};
  const values = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const text = line.trim();
    if (!text || text.startsWith('#')) continue;
    const index = text.indexOf('=');
    if (index < 1) continue;
    const key = text.slice(0, index).trim();
    let value = text.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[key] = value;
  }
  return values;
}

function inspectSource() {
  const mainPath = path.join(root, 'desktop', 'main.cjs');
  const dashboardPath = path.join(root, 'src', 'dashboard.js');
  if (!fs.existsSync(mainPath) || !fs.existsSync(dashboardPath)) {
    findings.push('Projektdateien desktop/main.cjs oder src/dashboard.js fehlen.');
    return;
  }
  const main = fs.readFileSync(mainPath, 'utf8');
  const dashboard = fs.readFileSync(dashboardPath, 'utf8');
  if (!main.includes("hostname: CANONICAL_DASHBOARD_HOST")) findings.push('Electron-API verwendet nicht den kanonischen IPv4-Loopback-Host.');
  else ok.push('Electron-API verwendet 127.0.0.1 statt mehrdeutigem localhost.');
  if (!dashboard.includes("const LOCAL_OAUTH_HOST = '127.0.0.1'")) findings.push('OAuth-Callback wird nicht auf 127.0.0.1 normalisiert.');
  else ok.push('OAuth-Callback wird auf 127.0.0.1 normalisiert.');
}

function inspectEnv() {
  const env = parseEnv(path.join(root, '.env'));
  if (!Object.keys(env).length) {
    ok.push('Keine .env im Prüfarchiv; verschlüsselte App-Einrichtung wird zur Laufzeit verwendet.');
    return;
  }
  if (!/^\d{15,22}$/.test(String(env.DISCORD_CLIENT_ID || ''))) findings.push('.env: DISCORD_CLIENT_ID fehlt oder ist ungültig.');
  else ok.push('.env: DISCORD_CLIENT_ID ist gesetzt.');
  if (String(env.DISCORD_CLIENT_SECRET || '').length < 20) findings.push('.env: DISCORD_CLIENT_SECRET fehlt oder ist ungültig.');
  else ok.push('.env: DISCORD_CLIENT_SECRET ist gesetzt.');
  if (env.DASHBOARD_DISCORD_REDIRECT_URI && env.DASHBOARD_DISCORD_REDIRECT_URI !== expectedRedirect) {
    findings.push(`.env: Redirect-URI ist ${env.DASHBOARD_DISCORD_REDIRECT_URI}; erwartet wird ${expectedRedirect}.`);
  }
}

function requestJson(apiPath, method = 'GET') {
  return new Promise((resolve) => {
    const request = http.request({ hostname: '127.0.0.1', port, path: apiPath, method, timeout: 5000, headers: { accept: 'application/json' } }, (response) => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { raw += chunk; });
      response.on('end', () => {
        let data = {};
        try { data = raw ? JSON.parse(raw) : {}; } catch {}
        resolve({ status: response.statusCode || 0, data });
      });
    });
    request.once('timeout', () => request.destroy(new Error('Zeitüberschreitung')));
    request.once('error', (error) => resolve({ status: 0, data: { error: error.code || error.message } }));
    request.end();
  });
}

(async () => {
  console.log('FHCC Login Doctor');
  console.log('=================');
  inspectSource();
  inspectEnv();

  const status = await requestJson('/api/auth/status');
  if (!status.status) {
    findings.push(`Lokaler Dienst auf 127.0.0.1:${port} ist nicht erreichbar (${status.data.error || 'unbekannter Fehler'}).`);
  } else if (status.status !== 200) {
    findings.push(`Auth-Status antwortet mit HTTP ${status.status}.`);
  } else {
    if (!status.data.oauthEnabled) findings.push(`OAuth2 ist im laufenden Dienst unvollständig: ${(status.data.missing || []).join(', ') || 'Client-Daten fehlen'}.`);
    else ok.push('OAuth2 ist im laufenden Dienst vollständig konfiguriert.');
    if (status.data.redirectUri !== expectedRedirect) findings.push(`Laufende Redirect-URI ist ${status.data.redirectUri || '(fehlt)'}; erwartet wird ${expectedRedirect}.`);
    else ok.push(`Laufende Redirect-URI stimmt: ${expectedRedirect}`);
  }

  const start = await requestJson('/api/auth/native/start', 'POST');
  if (start.status === 200 && start.data?.authorizeUrl) {
    const authorize = new URL(start.data.authorizeUrl);
    const redirect = authorize.searchParams.get('redirect_uri');
    if (redirect === expectedRedirect) ok.push('Discord-Authorize-URL enthält die richtige Redirect-URI.');
    else findings.push(`Discord-Authorize-URL enthält falsche Redirect-URI: ${redirect || '(fehlt)'}.`);
  } else if (status.status) {
    findings.push(`Login-Start fehlgeschlagen: HTTP ${start.status}${start.data?.error ? ` · ${start.data.error}` : ''}`);
  }

  for (const line of ok) console.log(`✔ ${line}`);
  if (findings.length) {
    for (const line of findings) console.error(`✖ ${line}`);
    console.error(`\nDiscord Developer Portal Redirect: ${expectedRedirect}`);
    process.exitCode = 1;
  } else {
    console.log('\nLogin-Pfad ist vollständig konsistent.');
  }
})();
