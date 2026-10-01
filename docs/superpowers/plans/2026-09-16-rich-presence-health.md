# Rich Presence Health Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Custom Rich Presence recover from a stuck Discord IPC call and show its real connection state independently from the Discord bot status.

**Architecture:** Keep the bot-process status owned by Electron's supervisor. Give `customRichPresence` its own runtime health snapshot and bound every Discord-RPC operation with a short timeout, so a hung IPC request cannot retain `updateInFlight` forever. Expose that snapshot through an authenticated module endpoint and render it inside the Custom Rich Presence module rather than treating the enabled checkbox as proof that RPC works.

**Tech Stack:** Node.js 24 ESM, `discord-rpc` 4.0.1, discord.js 14, Express 5, Electron renderer JavaScript, existing smoke-test scripts.

## Global Constraints

- Do not change the bot's normal Discord presence (`client.user.setPresence`); this work applies only to desktop Rich Presence IPC.
- `Bot online` means the child process is running and `client.isReady()` is true; it must never be derived from RPC health.
- Do not expose OAuth secrets, tokens, raw IPC socket paths, or full Discord error stacks through the dashboard.
- Every RPC promise (`login`, `setActivity`, `clearActivity`, `destroy`) must settle or be abandoned within 8 seconds.
- Preserve the existing 15–300 second configurable update interval and the two-minute reconnect backoff.
- Add the new smoke tests to the existing release-quality chain before a build.

---

## File Structure

- `src/features/customRichPresence.js`: owns the RPC controller, bounded IPC calls, recovery state and a serializable health snapshot.
- `src/index.js`: injects the live RP snapshot into the dashboard and exposes it in the general live-status response.
- `src/dashboard.js`: adds one authenticated, guild-authorized Rich Presence status route.
- `desktop/renderer/app.js`: renders and refreshes the RP-specific status card while the Custom Rich Presence module is open.
- `desktop/renderer/index.html`: only changes if a stable status host is preferable to the renderer creating it dynamically.
- `scripts/custom-rich-presence-smoke.mjs`: deterministic unit-style smoke coverage using a fake RPC client; no real Discord IPC.
- `scripts/custom-rich-presence-ui-smoke.mjs`: static integration check for endpoint, status labels and refresh wiring.
- `package.json`: appends both smoke tests to `test:quality`.
- `PROJEKT-WISSEN.md`: documents the state model, timeout rule and how to read the UI.

## Runtime Contract

`getCustomRichPresenceStatus()` returns only serializable, non-sensitive data:

```js
{
  enabled: true,
  state: 'connected', // disabled | connecting | connected | degraded | failed
  connected: true,
  activeGuildId: '...',
  lastAttemptAt: '2026-09-16T09:00:00.000Z',
  lastSuccessAt: '2026-09-16T09:00:01.000Z',
  retryAt: null,
  lastError: null,
  lastUpdateDurationMs: 84
}
```

`state: 'degraded'` means the bot remains online but the last RPC operation failed and the scheduled retry is pending. `state: 'failed'` means the module is enabled but no successful RPC connection has been established in the current process.

### Task 1: Make the RPC controller bounded and observable

**Files:**
- Modify: `src/features/customRichPresence.js`
- Create: `scripts/custom-rich-presence-smoke.mjs`

**Interfaces:**
- Produces: `getCustomRichPresenceStatus()`.
- Produces: `createCustomRichPresenceController({ RPC, now, setIntervalFn, clearIntervalFn })` for deterministic tests.
- Consumes: existing feature hook context `{ cfg, guild }`.

- [ ] **Step 1: Write the failing controller smoke test**

Create a fake RPC client whose `login()` resolves, whose first `setActivity()` never resolves, and whose second client succeeds. Assert the controller reports `connecting`, then `degraded` after the 8-second activity timeout, clears the in-flight update, sets a retry timestamp, and can make a later successful update after advancing the fake clock.

```js
const pending = new Promise(() => {});
const controller = createCustomRichPresenceController({ RPC: fakeRpc, now: () => clock });
await controller.update({ cfg: enabledConfig, guild: guildStub });
assert.equal(controller.getStatus().state, 'degraded');
assert.match(controller.getStatus().lastError, /setActivity/i);
clock += 120_000;
await controller.update({ cfg: enabledConfig, guild: guildStub });
assert.equal(controller.getStatus().state, 'connected');
assert.ok(controller.getStatus().lastSuccessAt);
```

- [ ] **Step 2: Run the test to verify the current implementation fails**

Run: `node scripts/custom-rich-presence-smoke.mjs`

Expected: FAIL because the current module has no controller factory/status API and `setActivity()` has no timeout.

- [ ] **Step 3: Extract the singleton state into the controller factory**

Move `rpcClient`, `updateTimer`, `lastSignature`, `lastUpdateAt`, `connecting`, `activeGuildId`, `presenceStartAt`, `nextConnectAttemptAt`, and `updateInFlight` inside `createCustomRichPresenceController`. Create one module-level controller using the real `RPC`, `Date.now`, `setInterval`, and `clearInterval`; keep the existing `feature` object delegating to that singleton.

```js
export const createCustomRichPresenceController = (deps = {}) => {
  const now = deps.now || Date.now;
  const Rpc = deps.RPC || RPC;
  // per-controller runtime state lives here
  return { schedule, update, getStatus, clear };
};

const controller = createCustomRichPresenceController();
export const getCustomRichPresenceStatus = () => controller.getStatus();
```

- [ ] **Step 4: Bound every IPC boundary**

Replace the current direct awaits with `runRpcCall(label, operation)`. It must use the existing timeout helper with `RPC_CALL_TIMEOUT_MS = 8_000`, record attempt duration, and convert failures into a short safe message. Apply it to `client.login`, `client.setActivity`, `client.clearActivity`, and `client.destroy`.

```js
const runRpcCall = async (label, operation) => {
  const startedAt = now();
  try {
    return await withTimeout(Promise.resolve().then(operation), RPC_CALL_TIMEOUT_MS, `Discord RPC ${label} reagiert nicht.`);
  } finally {
    status.lastUpdateDurationMs = Math.max(0, now() - startedAt);
  }
};
```

`destroyRpcClient` must use `Promise.allSettled` over bounded `clearActivity` and `destroy` calls. It must clear the local client reference before waiting, so a stuck old client can never block a reconnect.

- [ ] **Step 5: Implement the state transitions**

Set `connecting` immediately before login, `connected` only after a successful `setActivity`, `degraded` after a previously connected client fails, `failed` after an initial connection/activity failure, and `disabled` when the feature is switched off. On `disconnected`, clear the client, signature and timer state, then set `degraded` if enabled. Keep `lastError` truncated to 240 characters and `retryAt` as an ISO timestamp.

- [ ] **Step 6: Run focused verification**

Run: `node scripts/custom-rich-presence-smoke.mjs`

Expected: PASS, including timeout recovery, disabled cleanup, disconnected-event recovery, successful activity update, and no concurrent duplicate update.

- [ ] **Step 7: Commit**

```powershell
git add src/features/customRichPresence.js scripts/custom-rich-presence-smoke.mjs
git commit -m "fix: recover stuck rich presence IPC"
```

### Task 2: Expose real RP health to the authenticated dashboard

**Files:**
- Modify: `src/index.js:46,2982-3023,4763-4762`
- Modify: `src/dashboard.js:1002-1009,1471-1481`
- Modify: `scripts/custom-rich-presence-smoke.mjs`

**Interfaces:**
- Consumes: `getCustomRichPresenceStatus()` from Task 1.
- Produces: `GET /api/guild/:guildId/custom-rich-presence/status`.
- Produces: `liveStatus.richPresence` within `GET /api/live/status`.

- [ ] **Step 1: Extend the failing smoke test with endpoint contract checks**

Add static/handler assertions that the status endpoint requires dashboard authentication and guild access, returns `status`, and does not serialize `applicationId`, tokens, raw stack traces or transport details.

```js
assert.match(dashboardSource, /custom-rich-presence\/status/);
assert.match(dashboardSource, /requireAuth, requireGuildAccess/);
assert.doesNotMatch(JSON.stringify(snapshot), /clientSecret|token|ipcPath/i);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/custom-rich-presence-smoke.mjs`

Expected: FAIL because no endpoint or live-status field exists.

- [ ] **Step 3: Wire the snapshot into `src/index.js`**

Import `getCustomRichPresenceStatus`, add `richPresence: getCustomRichPresenceStatus()` to `getLiveStatus()`, and pass `getCustomRichPresenceStatus` to `mountDashboard`.

```js
richPresence: getCustomRichPresenceStatus()
```

- [ ] **Step 4: Add the restricted route in `src/dashboard.js`**

Accept `getCustomRichPresenceStatus` in `mountDashboard` options. Add the route beside other guild module status routes:

```js
app.get('/api/guild/:guildId/custom-rich-presence/status', requireAuth, requireGuildAccess, (_req, res) => {
  return res.json({ ok: true, status: getCustomRichPresenceStatus?.() || { state: 'disabled', enabled: false } });
});
```

- [ ] **Step 5: Run focused verification**

Run: `node scripts/custom-rich-presence-smoke.mjs && node scripts/diagnostics-access-smoke.mjs`

Expected: PASS. The new endpoint is authenticated, and the existing diagnostics access checks remain green.

- [ ] **Step 6: Commit**

```powershell
git add src/index.js src/dashboard.js scripts/custom-rich-presence-smoke.mjs
git commit -m "feat: expose rich presence health"
```

### Task 3: Show bot and Rich Presence as separate states in FHCC

**Files:**
- Modify: `desktop/renderer/app.js:692-720,3294-3369`
- Modify: `desktop/renderer/index.html` only if a stable `[data-rich-presence-health]` host is added to the module shell
- Create: `scripts/custom-rich-presence-ui-smoke.mjs`

**Interfaces:**
- Consumes: `GET /api/guild/:guildId/custom-rich-presence/status`.
- Consumes: current `state.authenticated`, `state.selectedGuildId`, and `state.activeFeatureId`.
- Produces: `refreshCustomRichPresenceStatus()` and `customRichPresenceOverview(config)`.

- [ ] **Step 1: Write the failing UI smoke test**

Assert that the module renders a dedicated health card, calls the specific status endpoint only when Custom Rich Presence is selected, and contains distinct copy for bot status and RPC status.

```js
assert.match(appSource, /data-rich-presence-health/);
assert.match(appSource, /custom-rich-presence\/status/);
assert.match(appSource, /Rich Presence.*verbunden/s);
assert.match(appSource, /Bot.*online/s);
assert.doesNotMatch(appSource, /moduleEnabled\('customRichPresence'\).*ONLINE/s);
```

- [ ] **Step 2: Run the UI test to verify it fails**

Run: `node scripts/custom-rich-presence-ui-smoke.mjs`

Expected: FAIL because the existing module header only maps its enabled checkbox to `AKTIV`.

- [ ] **Step 3: Render an explicit health card**

For `customRichPresence`, add an unframed module status section below the module header. It must show a compact label and neutral copy for each state:

```text
DISABLED  Rich Presence ist ausgeschaltet.
CONNECTING Verbindung zu Discord Desktop wird aufgebaut …
CONNECTED Rich Presence ist verbunden · letztes Update 10:56
DEGRADED  Bot online · Rich Presence wird um 10:58 erneut verbunden.
FAILED    Bot online · Rich Presence konnte nicht verbunden werden: …
```

Include a `Neu verbinden` button. It must call a new `POST /api/guild/:guildId/custom-rich-presence/reconnect` route only after an explicit confirmation, and it must never restart the bot.

- [ ] **Step 4: Add the reconnect server action**

In Task 1's controller expose `reconnect({ cfg, guild })`, which clears the old client, clears the retry gate, and performs one immediate bounded update. Wire it through `src/index.js` and a guild-authorized dashboard route. Return the new status snapshot whether the reconnect succeeds or fails.

- [ ] **Step 5: Refresh without contaminating global bot status**

Call `refreshCustomRichPresenceStatus()` when the module opens and every 15 seconds only while it remains selected and the renderer is visible. Keep `setStatus()` unchanged: it must continue to display the supervisor's bot state, never the Rich Presence state.

- [ ] **Step 6: Run UI verification**

Run: `node scripts/custom-rich-presence-ui-smoke.mjs && node scripts/ui-status-consistency-smoke.mjs && npx electron . --headless-document-check`

Expected: PASS. The document loads, normal bot status remains independent, and the RP card uses the dedicated endpoint.

- [ ] **Step 7: Commit**

```powershell
git add desktop/renderer/app.js desktop/renderer/index.html scripts/custom-rich-presence-ui-smoke.mjs src/index.js src/dashboard.js
git commit -m "feat: show rich presence health separately"
```

### Task 4: Release integration and project knowledge

**Files:**
- Modify: `package.json`
- Modify: `PROJEKT-WISSEN.md`

**Interfaces:**
- Consumes: both smoke scripts from Tasks 1–3.
- Produces: a release chain that rejects a stuck-RPC regression.

- [ ] **Step 1: Add both tests to `test:quality`**

Append them near existing UI and runtime diagnostics tests:

```json
"test:quality": "... && node scripts/custom-rich-presence-smoke.mjs && node scripts/custom-rich-presence-ui-smoke.mjs && ..."
```

- [ ] **Step 2: Document the operational model**

Add a dated Project Knowledge section with: the five RP states, the distinction from bot online, the 8-second IPC bound, two-minute automatic retry, manual reconnect behavior, and the two smoke-test commands.

- [ ] **Step 3: Run the no-build release checks**

Run:

```powershell
node scripts/custom-rich-presence-smoke.mjs
node scripts/custom-rich-presence-ui-smoke.mjs
npm run test:quality
npm run test:community
```

Expected: all pass. Do not create an installer during this task.

- [ ] **Step 4: Commit**

```powershell
git add package.json PROJEKT-WISSEN.md
git commit -m "test: cover rich presence health"
```

## Self-Review

- Bot status and RP status are distinct in Tasks 2 and 3.
- Every currently unbounded Discord-RPC call is bounded in Task 1.
- A stuck `setActivity` is reproducibly tested before the fix, then verified to recover.
- The dashboard endpoint is authenticated and guild-authorized, with no secret fields.
- The UI has a visible error/retry state instead of interpreting the enabled setting as live health.
- No installer build is included; Task 4 deliberately stops at test verification.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-16-rich-presence-health.md`.

Two execution options:

1. Subagent-Driven (recommended) - I dispatch a fresh subagent per task, review between tasks, fast iteration.

2. Inline Execution - Execute tasks in this session using executing-plans, batch execution with checkpoints.
