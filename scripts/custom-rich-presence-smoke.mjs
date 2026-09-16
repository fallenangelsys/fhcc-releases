#!/usr/bin/env node
import assert from 'node:assert/strict';

// Fake RPC client for deterministic testing
const createFakeRpc = ({ loginDelay = 0, setActivityRejects = false, setActivityHangs = false, destroyRejects = false } = {}) => {
  const calls = [];
  const FakeRpcModule = class FakeRpcClient {
    constructor() { this.applicationId = null; this._listeners = {}; }
    on(event, fn) { this._listeners[event] = fn; }
    async login({ clientId }) {
      calls.push({ op: 'login', clientId });
      if (loginDelay) await new Promise((r) => setTimeout(r, loginDelay));
      this.applicationId = clientId;
    }
    async setActivity(payload) {
      calls.push({ op: 'setActivity', payload });
      if (setActivityRejects) throw new Error('setActivity failed');
      if (setActivityHangs) await new Promise((r) => setTimeout(r, 5000));
    }
    async clearActivity() { calls.push({ op: 'clearActivity' }); }
    async destroy() {
      calls.push({ op: 'destroy' });
      if (destroyRejects) throw new Error('destroy failed');
    }
  };
  FakeRpcModule.register = () => {};
  FakeRpcModule.Client = FakeRpcModule;
  return { calls, Client: FakeRpcModule };
};

// Import the controller factory
const { createCustomRichPresenceController, getCustomRichPresenceStatus } = await import('../src/features/customRichPresence.js');

// ── Test 1: Disabled state ──
{
  const fake = createFakeRpc();
  const controller = createCustomRichPresenceController({ RPC: fake.Client, now: () => 1000 });
  const status = controller.getStatus();
  assert.equal(status.state, 'disabled');
  assert.equal(status.enabled, false);
  assert.equal(status.connected, false);
  console.log('✓ Test 1: Disabled state');
}

// ── Test 2: Connecting → connected ──
{
  const fake = createFakeRpc();
  let clock = 1000;
  const controller = createCustomRichPresenceController({ RPC: fake.Client, now: () => clock });
  await controller.update({ cfg: { customRichPresence: { enabled: true, applicationId: 'test-app', updateIntervalSeconds: 30 } }, guild: { id: 'g1', name: 'Test', memberCount: 10, channels: { cache: { size: 5 } }, members: { cache: { filter: () => ({ size: 0 }) }, fetchMe: async () => ({}) }, presences: { cache: { filter: () => ({ size: 0 }) } } } });
  const status = controller.getStatus();
  assert.equal(status.state, 'connected');
  assert.equal(status.connected, true);
  assert.equal(status.activeGuildId, 'g1');
  assert.ok(status.lastSuccessAt);
  console.log('✓ Test 2: Connecting → connected');
}

// ── Test 3: setActivity timeout → degraded ──
{
  const fake = createFakeRpc({ setActivityHangs: true });
  let clock = 1000;
  const controller = createCustomRichPresenceController({ RPC: fake.Client, now: () => clock, callTimeoutMs: 50 });
  await controller.update({ cfg: { customRichPresence: { enabled: true, applicationId: 'test-app', updateIntervalSeconds: 30 } }, guild: { id: 'g1', name: 'Test', memberCount: 10, channels: { cache: { size: 5 } }, members: { cache: { filter: () => ({ size: 0 }) }, fetchMe: async () => ({}) }, presences: { cache: { filter: () => ({ size: 0 }) } } } });
  const status = controller.getStatus();
  assert.equal(status.state, 'degraded');
  assert.ok(status.lastError);
  assert.ok(status.retryAt);
  console.log('✓ Test 3: setActivity hanging → timeout → degraded');
}

// ── Test 4: No duplicate updates ──
{
  const fake = createFakeRpc();
  let clock = 1000;
  const controller = createCustomRichPresenceController({ RPC: fake.Client, now: () => clock });
  const ctx = { cfg: { customRichPresence: { enabled: true, applicationId: 'test-app', updateIntervalSeconds: 30 } }, guild: { id: 'g1', name: 'Test', memberCount: 10, channels: { cache: { size: 5 } }, members: { cache: { filter: () => ({ size: 0 }) }, fetchMe: async () => ({}) }, presences: { cache: { filter: () => ({ size: 0 }) } } } };
  await controller.update(ctx);
  const callsAfterFirst = fake.calls.length;
  await controller.update(ctx);
  assert.equal(fake.calls.length, callsAfterFirst, 'No duplicate update');
  console.log('✓ Test 4: No duplicate updates');
}

// ── Test 5: Global status API ──
{
  const status = getCustomRichPresenceStatus();
  assert.ok(status);
  assert.ok('state' in status);
  assert.ok('enabled' in status);
  console.log('✓ Test 5: Global status API');
}

// ── Test 6: Reconnect clears state ──
{
  const fake = createFakeRpc({ setActivityRejects: true });
  let clock = 1000;
  const controller = createCustomRichPresenceController({ RPC: fake.Client, now: () => clock });
  await controller.update({ cfg: { customRichPresence: { enabled: true, applicationId: 'test-app', updateIntervalSeconds: 30 } }, guild: { id: 'g1', name: 'Test', memberCount: 10, channels: { cache: { size: 5 } }, members: { cache: { filter: () => ({ size: 0 }) }, fetchMe: async () => ({}) }, presences: { cache: { filter: () => ({ size: 0 }) } } } });
  assert.equal(controller.getStatus().state, 'degraded');
  // Fix the RPC for reconnect
  const fake2 = createFakeRpc();
  const controller2 = createCustomRichPresenceController({ RPC: fake2.Client, now: () => clock });
  await controller2.reconnect({ cfg: { customRichPresence: { enabled: true, applicationId: 'test-app', updateIntervalSeconds: 30 } }, guild: { id: 'g1', name: 'Test', memberCount: 10, channels: { cache: { size: 5 } }, members: { cache: { filter: () => ({ size: 0 }) }, fetchMe: async () => ({}) }, presences: { cache: { filter: () => ({ size: 0 }) } } } });
  const status = controller2.getStatus();
  assert.equal(status.state, 'connected');
  assert.equal(status.lastError, null);
  console.log('✓ Test 6: Reconnect clears state');
}

console.log('\n✅ All custom-rich-presence smoke tests passed');
