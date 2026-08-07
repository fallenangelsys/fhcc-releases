import assert from 'node:assert/strict';
import net from 'node:net';

import cookieParser from 'cookie-parser';
import express from 'express';
import jwt from 'jsonwebtoken';

async function reserveFreePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const address = probe.address();
  const port = address.port;
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return port;
}

const originalEnvironment = {
  DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID,
  DISCORD_CLIENT_SECRET: process.env.DISCORD_CLIENT_SECRET,
  DASHBOARD_SESSION_SECRET: process.env.DASHBOARD_SESSION_SECRET,
  DASHBOARD_DISCORD_REDIRECT_URI: process.env.DASHBOARD_DISCORD_REDIRECT_URI,
  DASHBOARD_JWT_TTL: process.env.DASHBOARD_JWT_TTL
};
const originalFetch = globalThis.fetch;

const port = await reserveFreePort();
const origin = `http://127.0.0.1:${port}`;
const redirectUri = `${origin}/api/auth/discord/callback`;
const sessionSecret = 'auth-smoke-session-secret-with-more-than-sixty-four-characters-123456789';
process.env.DISCORD_CLIENT_ID = '123456789012345678';
process.env.DISCORD_CLIENT_SECRET = 'auth-smoke-client-secret';
process.env.DASHBOARD_SESSION_SECRET = sessionSecret;
process.env.DASHBOARD_DISCORD_REDIRECT_URI = `http://localhost:${port}/api/auth/discord/callback`;
process.env.DASHBOARD_JWT_TTL = '30d';

const { mountDashboard } = await import('../src/dashboard.js');
const app = express();
app.use(express.json());
app.use(cookieParser());
mountDashboard(app);

const server = await new Promise((resolve, reject) => {
  const listener = app.listen(port, '127.0.0.1', () => resolve(listener));
  listener.once('error', reject);
});

try {
  const startResponse = await fetch(`${origin}/api/auth/native/start`, { method: 'POST' });
  assert.equal(startResponse.status, 200);
  const start = await startResponse.json();
  assert.equal(start.ok, true);
  assert.match(start.transactionId, /^[a-f0-9]{48}$/);
  assert.match(start.verifier, /^[a-f0-9]{64}$/);

  const authorizeUrl = new URL(start.authorizeUrl);
  assert.equal(authorizeUrl.hostname, 'discord.com');
  assert.equal(authorizeUrl.searchParams.get('redirect_uri'), redirectUri);
  assert.equal(authorizeUrl.searchParams.has('prompt'), false);

  const advertisedCallback = new URL(authorizeUrl.searchParams.get('redirect_uri'));
  assert.equal(advertisedCallback.hostname, '127.0.0.1');
  assert.equal(Number(advertisedCallback.port), port);
  assert.equal(advertisedCallback.pathname, '/api/auth/discord/callback');

  const signedState = authorizeUrl.searchParams.get('state');
  const statePayload = jwt.verify(signedState, sessionSecret, {
    issuer: 'fallen-heaven-control-center',
    audience: 'discord-oauth'
  });
  assert.equal(statePayload.purpose, 'native-discord-login');
  assert.equal(statePayload.transactionId, start.transactionId);

  const wrongVerifierResponse = await fetch(`${origin}/api/auth/native/status`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ transactionId: start.transactionId, verifier: '0'.repeat(64) })
  });
  assert.equal(wrongVerifierResponse.status, 403);

  const pendingResponse = await fetch(`${origin}/api/auth/native/status`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ transactionId: start.transactionId, verifier: start.verifier })
  });
  assert.equal(pendingResponse.status, 200);
  assert.equal((await pendingResponse.json()).status, 'pending');

  globalThis.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === 'https://discord.com/api/oauth2/token') {
      const body = new URLSearchParams(String(init?.body || ''));
      assert.equal(body.get('redirect_uri'), redirectUri, 'Token-Tausch muss dieselbe Redirect-URI wie der Authorize-Schritt verwenden.');
      return new Response(JSON.stringify({ access_token: 'smoke-access-token' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    if (url === 'https://discord.com/api/users/@me') {
      return new Response(JSON.stringify({ id: '999999999999999999', username: 'Login Smoke', avatar: null, discriminator: '0' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    if (url.startsWith('https://discord.com/api/users/@me/guilds')) {
      return new Response(JSON.stringify([{ id: '888888888888888888', name: 'Smoke Guild', owner: true, permissions: '8' }]), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    return originalFetch(input, init);
  };

  // Entscheidend: Der Test ruft exakt die an Discord übergebene Callback-Adresse auf.
  advertisedCallback.searchParams.set('code', 'smoke-code');
  advertisedCallback.searchParams.set('state', signedState);
  const callbackResponse = await fetch(advertisedCallback, { redirect: 'manual' });
  assert.equal(callbackResponse.status, 200);

  const completedResponse = await fetch(`${origin}/api/auth/native/status`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ transactionId: start.transactionId, verifier: start.verifier })
  });
  assert.equal(completedResponse.status, 200);
  const completed = await completedResponse.json();
  assert.equal(completed.status, 'complete');
  assert.equal(completed.user.discordId, '999999999999999999');
  const sessionPayload = jwt.verify(completed.sessionToken, sessionSecret);
  assert.equal(sessionPayload.accessVersion, 2);
  assert.ok(sessionPayload.exp - sessionPayload.iat >= 30 * 24 * 60 * 60 - 2);

  const consumeResponse = await fetch(`${origin}/api/auth/native/consume`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ transactionId: start.transactionId, verifier: start.verifier })
  });
  assert.equal(consumeResponse.status, 200);

  console.log(`Login-Smoke-Test bestanden: echter Callback ${redirectUri}, identischer Token-Redirect und 30-Tage-Sitzung sind aktiv.`);
} finally {
  globalThis.fetch = originalFetch;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
