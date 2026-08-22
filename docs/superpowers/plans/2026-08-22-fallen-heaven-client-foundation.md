# FALLEN HEAVEN Client Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the first releasable Discord-client-style shell with complete legacy capability mapping, guild/channel navigation, read-only message browsing, contextual details, and measured renderer performance.

**Architecture:** Keep existing views operational behind compatibility routes while introducing focused files under `desktop/renderer/client/`. A route registry owns the four-pane shell and lazy route loading. Existing authenticated APIs supply guild management and keyset/page message history; no bot token enters the renderer.

**Tech Stack:** Electron 43, vanilla JavaScript ES modules, HTML/CSS, Express 5, discord.js 14, Node smoke scripts.

## Global Constraints

- Use official bot API capabilities only; renderer code never receives the bot token.
- Do not copy DiscordBotClient/Discord/Vencord source or assets.
- Do not remove an old route or control during this wave.
- Preserve current login, window controls, theme, module fields, server management, studios, diagnostics, and system behavior.
- Use full navigation labels and familiar Lucide-derived local icons; no invented abbreviations or decorative numbered sections.
- Keep local fonts and current Three.js/skinview3d lazy loading.
- Target route feedback under 100 ms and no ordinary-navigation long task above 200 ms on the development machine.

---

### Task 1: Generate the renderer capability manifest

**Files:**
- Create: `scripts/ui-capability-manifest.mjs`
- Create: `desktop/renderer/client/capability-manifest.json`
- Create: `scripts/ui-capability-parity-smoke.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `desktop/renderer/index.html`, `desktop/renderer/app.js`, `desktop/renderer/server-management.js`, `src/defaultConfig.js`.
- Produces: `capability-manifest.json` with `{ generatedAt, views, fixedControls, moduleFields }` and a parity command used by every later wave.

- [ ] **Step 1: Write the failing parity smoke**

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync('desktop/renderer/client/capability-manifest.json', 'utf8'));
assert.ok(manifest.views.some((item) => item.id === 'studio'));
assert.ok(manifest.fixedControls.some((item) => item.id === 'send-studio-message'));
assert.ok(manifest.moduleFields.length >= 499);
assert.equal(manifest.unmapped?.length ?? 0, 0);
console.log('ui-capability-parity-smoke: ok');
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node scripts/ui-capability-parity-smoke.mjs`

Expected: FAIL with `ENOENT` for `capability-manifest.json`.

- [ ] **Step 3: Implement deterministic manifest generation**

Create a Node script that extracts `data-view`, fixed element IDs, `bindId(...)` targets, and module schema field keys. Sort every collection before JSON serialization and omit timestamps from comparison output. Generate entries shaped as:

```js
{
  id: 'send-studio-message',
  legacyOwner: 'studio',
  targetRoute: 'studio/free',
  status: 'compatibility'
}
```

Use an explicit route mapping object for non-inferable controls; fail generation when the same ID receives conflicting owners.

- [ ] **Step 4: Add package commands and generate the manifest**

```json
{
  "ui:manifest": "node scripts/ui-capability-manifest.mjs",
  "test:ui-parity": "node scripts/ui-capability-parity-smoke.mjs"
}
```

Run: `npm run ui:manifest && npm run test:ui-parity`

Expected: PASS and manifest contains all current fixed controls plus at least the existing 499 module fields.

- [ ] **Step 5: Commit**

```powershell
git add package.json scripts/ui-capability-manifest.mjs scripts/ui-capability-parity-smoke.mjs desktop/renderer/client/capability-manifest.json
git commit -m "test: inventory renderer capabilities"
```

### Task 2: Establish tokens, icons, and optimized identity assets

**Files:**
- Create: `desktop/renderer/client/client-tokens.css`
- Create: `desktop/renderer/client/client-icons.js`
- Create: `scripts/client-asset-smoke.mjs`
- Create: `desktop/renderer/assets/fallen-heaven-key-art.webp`
- Modify: `desktop/renderer/index.html`
- Modify: `package.json`

**Interfaces:**
- Consumes: local Inter/Space Grotesk/JetBrains Mono fonts and supplied PNG key art.
- Produces: CSS custom properties, `icon(name, options)` returning trusted local SVG markup, and a route-lazy WebP identity asset.

- [ ] **Step 1: Write the failing asset smoke**

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync('desktop/renderer/client/client-tokens.css', 'utf8');
const icons = fs.readFileSync('desktop/renderer/client/client-icons.js', 'utf8');
const html = fs.readFileSync('desktop/renderer/index.html', 'utf8');
assert.match(css, /--fh-surface-canvas:\s*#0[0-9a-f]{5}/i);
assert.doesNotMatch(css, /https?:\/\//);
assert.match(icons, /export function icon/);
assert.doesNotMatch(html, /fallen-heaven-key-art\.webp/);
console.log('client-asset-smoke: ok');
```

The final assertion enforces that key art is not eagerly referenced by the shell HTML.

- [ ] **Step 2: Run the test and verify RED**

Run: `node scripts/client-asset-smoke.mjs`

Expected: FAIL because token/icon files do not exist.

- [ ] **Step 3: Implement the compact token and icon modules**

Define semantic tokens for canvas, guild rail, context pane, workspace, inspector, hover, selected, focus, text, muted text, success, warning, danger, and Discord embed geometry. Export only icons used by the new shell: home, server, hash, voice, forum, thread, modules, studio, skin, activity, settings, search, bell, chevron, plus, and close.

- [ ] **Step 4: Produce the local optimized WebP**

Use the bundled image tooling or ImageMagick to create a maximum 1920px-wide WebP from `E:\SSD NEW\Bilder\file_0000000050c871f4ae43434149bbd119.png`, retaining the original source outside the package. Verify the WebP is below 650 KB and visually inspect it with `view_image`.

- [ ] **Step 5: Register CSS without loading artwork**

Add `client-tokens.css?v=3.9.271` before route styles in `index.html`. Add the asset smoke to `test:quality`.

Run: `node scripts/client-asset-smoke.mjs && node scripts/server-management-ui-smoke.mjs`

Expected: both PASS.

- [ ] **Step 6: Commit**

```powershell
git add package.json desktop/renderer/index.html desktop/renderer/client/client-tokens.css desktop/renderer/client/client-icons.js desktop/renderer/assets/fallen-heaven-key-art.webp scripts/client-asset-smoke.mjs
git commit -m "feat: add fallen heaven client design primitives"
```

### Task 3: Build the four-pane shell as an isolated compatibility layer

**Files:**
- Create: `desktop/renderer/client/client-shell.js`
- Create: `desktop/renderer/client/client-shell.css`
- Create: `scripts/client-shell-smoke.mjs`
- Modify: `desktop/renderer/index.html`

**Interfaces:**
- Consumes: `icon(name)`, existing `setView(view)`, current guild list/state through a narrow adapter.
- Produces: `createClientShell({ mount, onNavigate, onGuildSelect })`, `setShellState(nextState)`, and four stable pane elements.

- [ ] **Step 1: Write the failing shell smoke**

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('desktop/renderer/client/client-shell.js', 'utf8');
assert.match(source, /export function createClientShell/);
assert.match(source, /data-client-pane="guilds"/);
assert.match(source, /data-client-pane="context"/);
assert.match(source, /data-client-pane="workspace"/);
assert.match(source, /data-client-pane="inspector"/);
assert.doesNotMatch(source, /innerHTML\s*\+=/);
console.log('client-shell-smoke: ok');
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node scripts/client-shell-smoke.mjs`

Expected: FAIL with missing file.

- [ ] **Step 3: Implement stable shell creation**

Create DOM nodes once with `document.createElement`, semantic buttons, full labels/tooltips, and delegated click handling. Mount the existing `.main-stage` inside the workspace compatibility slot; do not clone or reconstruct legacy views.

Use this state contract:

```js
{
  activeGuildId: '',
  activeRoute: 'home/activity',
  guilds: [],
  contextItems: [],
  inspectorOpen: true,
  connection: { status: 'offline', latencyMs: null }
}
```

- [ ] **Step 4: Implement responsive pane rules**

At widths below 1180px hide inspector behind a button; below 860px collapse contextual navigation to an overlay; below 640px show one navigation/workspace layer at a time. Add visible focus and `prefers-reduced-motion` rules.

- [ ] **Step 5: Load the shell module and preserve legacy access**

Add `<div id="client-shell-root"></div>` and a module bootstrap script. Keep current view nodes and IDs intact inside the compatibility workspace. Existing login/access screens remain outside the authenticated shell.

Run: `node scripts/client-shell-smoke.mjs && node scripts/ui-recovery-layout-smoke.mjs`

Expected: both PASS.

- [ ] **Step 6: Commit**

```powershell
git add desktop/renderer/index.html desktop/renderer/client/client-shell.js desktop/renderer/client/client-shell.css scripts/client-shell-smoke.mjs
git commit -m "feat: add discord-style client shell"
```

### Task 4: Introduce route registry and lazy compatibility routes

**Files:**
- Create: `desktop/renderer/client/client-router.js`
- Create: `desktop/renderer/client/routes/compatibility-route.js`
- Create: `scripts/client-router-smoke.mjs`
- Modify: `desktop/renderer/app.js`

**Interfaces:**
- Consumes: existing `setView(view)` through `window.fallenHeavenLegacyNavigate`.
- Produces: `createRouter({ routes, onChange })`, `navigate(routeId, params)`, `getRouteState()`, and route cleanup via `AbortController`.

- [ ] **Step 1: Write the failing router smoke**

```js
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const { createRouter } = await import(pathToFileURL(process.cwd() + '/desktop/renderer/client/client-router.js'));
const calls = [];
const router = createRouter({ routes: { home: async () => ({ mount: () => calls.push('home'), cleanup: () => calls.push('clean') }) } });
await router.navigate('home');
await router.navigate('home');
assert.deepEqual(calls, ['home']);
console.log('client-router-smoke: ok');
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node scripts/client-router-smoke.mjs`

Expected: FAIL with missing module.

- [ ] **Step 3: Implement route lifecycle and history state**

Routes return `{ mount(container, context), cleanup() }`. Navigation aborts the previous route's requests, calls cleanup exactly once, stores `{ routeId, guildId, selection, scrollTop }` in `history.replaceState`, and restores it after reload/session restore.

- [ ] **Step 4: Register compatibility routes**

Map `legacy/center`, `legacy/community`, `legacy/modules`, `legacy/studio`, `legacy/skin`, and `legacy/system` to the current `setView` implementation. Expose a one-line adapter from `app.js` without moving existing route logic yet:

```js
window.fallenHeavenLegacyNavigate = setView;
```

- [ ] **Step 5: Verify navigation and current smoke suites**

Run: `node scripts/client-router-smoke.mjs && node scripts/workspace-forum-timeline-smoke.mjs && node scripts/server-management-ui-smoke.mjs`

Expected: all PASS.

- [ ] **Step 6: Commit**

```powershell
git add desktop/renderer/app.js desktop/renderer/client/client-router.js desktop/renderer/client/routes/compatibility-route.js scripts/client-router-smoke.mjs
git commit -m "feat: add client route lifecycle"
```

### Task 5: Add normalized guild and channel navigation models

**Files:**
- Create: `desktop/renderer/client/client-api.js`
- Create: `desktop/renderer/client/routes/guild-navigation.js`
- Create: `scripts/client-navigation-smoke.mjs`
- Modify: `desktop/renderer/client/client-shell.js`

**Interfaces:**
- Consumes: `/api/guilds`, `/api/guild/:guildId/management`, existing Electron `apiRequest` bridge.
- Produces: `loadGuildNavigation(guildId, { signal, fresh })` returning `{ guild, categories, channels, permissions }` with stable IDs/order.

- [ ] **Step 1: Write the failing normalization test**

```js
import assert from 'node:assert/strict';
import { normalizeGuildNavigation } from '../desktop/renderer/client/routes/guild-navigation.js';

const result = normalizeGuildNavigation({ channels: [
  { id: '3', name: 'voice', type: 2, position: 2, parentId: '10' },
  { id: '2', name: 'chat', type: 0, position: 1, parentId: '10' },
  { id: '10', name: 'Community', type: 4, position: 0 }
] });
assert.deepEqual(result.categories[0].channels.map((item) => item.id), ['2', '3']);
assert.equal(result.categories[0].channels[1].kind, 'voice');
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node scripts/client-navigation-smoke.mjs`

Expected: FAIL because the navigation module does not exist.

- [ ] **Step 3: Implement API wrapper and normalization**

The API wrapper accepts `{ path, method, body, signal }`, converts Electron bridge failures into `{ code, message, retryable }`, and never logs authorization material. Normalize channel types into `text`, `announcement`, `forum`, `voice`, `stage`, `category`, or `unsupported`.

- [ ] **Step 4: Render guild icons and channel tree**

Use real guild icons/names and familiar icons for channel kinds. Preserve expanded categories and selected channel per guild in memory/localStorage. Unsupported channel kinds remain visible only when they contain relevant child context and cannot be falsely opened as text channels.

- [ ] **Step 5: Verify**

Run: `node scripts/client-navigation-smoke.mjs && node scripts/channel-order-smoke.mjs && node scripts/workspace-forum-timeline-smoke.mjs`

Expected: all PASS.

- [ ] **Step 6: Commit**

```powershell
git add desktop/renderer/client/client-api.js desktop/renderer/client/client-shell.js desktop/renderer/client/routes/guild-navigation.js scripts/client-navigation-smoke.mjs
git commit -m "feat: add guild and channel client navigation"
```

### Task 6: Build the read-only message workspace and inspector

**Files:**
- Create: `desktop/renderer/client/routes/channel-messages.js`
- Create: `desktop/renderer/client/routes/channel-messages.css`
- Create: `scripts/client-message-surface-smoke.mjs`
- Modify: `desktop/renderer/client/client-router.js`

**Interfaces:**
- Consumes: `/api/guild/:guildId/channel/:channelId/messages` with `limit`, `page`, `before`, and `after`.
- Produces: channel route with `mount`, `cleanup`, `loadOlder`, `selectMessage`; inspector view model `{ author, timestamps, embeds, attachments, reactions, capabilities }`.

- [ ] **Step 1: Write the failing renderer contract test**

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('desktop/renderer/client/routes/channel-messages.js', 'utf8');
assert.match(source, /export function createChannelMessagesRoute/);
assert.match(source, /pagination/);
assert.match(source, /AbortController|signal/);
assert.doesNotMatch(source, /botToken|Authorization/);
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node scripts/client-message-surface-smoke.mjs`

Expected: FAIL with missing route file.

- [ ] **Step 3: Implement stable message DOM**

Render grouped author rows, timestamps, replies, content, safe links, embeds, attachments, stickers, reactions, and supported component snapshots from normalized API data. Use `DocumentFragment` for page insertion and stable `data-message-id` nodes; do not replace the full list when loading older messages.

- [ ] **Step 4: Implement pagination and scroll anchoring**

When older content is prepended, measure scroll height before/after and preserve the visible anchor. Disable duplicate requests while one cursor/page request is active. Route cleanup aborts in-flight requests and removes observers.

- [ ] **Step 5: Implement contextual inspector**

Selecting a message populates the right pane with complete metadata and only currently supported read-only actions. Do not show send/reaction/edit controls until Wave B capability endpoints exist.

- [ ] **Step 6: Verify**

Run: `node scripts/client-message-surface-smoke.mjs && node scripts/workspace-forum-timeline-smoke.mjs && node scripts/embed-link-preview-smoke.mjs`

Expected: all PASS.

- [ ] **Step 7: Commit**

```powershell
git add desktop/renderer/client/client-router.js desktop/renderer/client/routes/channel-messages.js desktop/renderer/client/routes/channel-messages.css scripts/client-message-surface-smoke.mjs
git commit -m "feat: add channel message workspace"
```

### Task 7: Bridge live Gateway events into bounded client updates

**Files:**
- Create: `desktop/renderer/client/client-events.js`
- Create: `scripts/client-events-smoke.mjs`
- Modify: `desktop/renderer/client/routes/channel-messages.js`
- Modify: `desktop/renderer/client/client-shell.js`

**Interfaces:**
- Consumes: existing `bot:event` preload subscription and current live event payloads.
- Produces: `createClientEventStore({ maxEvents, flushMs })` with `push`, `subscribe`, `selectGuild`, `selectChannel`, `destroy`.

- [ ] **Step 1: Write a fake-timer batching test**

```js
import assert from 'node:assert/strict';
import { createClientEventStore } from '../desktop/renderer/client/client-events.js';

const flushes = [];
const store = createClientEventStore({ maxEvents: 3, schedule: (fn) => fn() });
store.subscribe((batch) => flushes.push(batch));
store.push({ type: 'messageCreate', guildId: 'g', channelId: 'c', id: '1' });
assert.equal(flushes.length, 1);
assert.equal(store.snapshot().length, 1);
store.destroy();
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node scripts/client-events-smoke.mjs`

Expected: FAIL with missing module.

- [ ] **Step 3: Implement bounded batching and route selectors**

Coalesce repeated updates by entity ID, cap retained events, flush at most once per animation frame in the renderer, and expose filtered subscriptions. Never rerender inactive channel routes.

- [ ] **Step 4: Integrate connection and message updates**

Update connection status in the shell. Append/update/delete visible message nodes only when an event belongs to the active guild/channel; otherwise update unread/actionable counts.

- [ ] **Step 5: Verify**

Run: `node scripts/client-events-smoke.mjs && node scripts/interaction-timing-telemetry-smoke.mjs && node scripts/server-watchdog-smoke.mjs`

Expected: all PASS.

- [ ] **Step 6: Commit**

```powershell
git add desktop/renderer/client/client-events.js desktop/renderer/client/client-shell.js desktop/renderer/client/routes/channel-messages.js scripts/client-events-smoke.mjs
git commit -m "feat: bridge live discord events to client routes"
```

### Task 8: Add performance and visual release gates for the foundation

**Files:**
- Create: `scripts/client-performance-smoke.mjs`
- Create: `scripts/client-visual-smoke.mjs`
- Modify: `scripts/ui-recovery-layout-smoke.mjs`
- Modify: `package.json`
- Modify: `PROJEKT-WISSEN.md`

**Interfaces:**
- Consumes: Chromium/Electron performance marks emitted by client router and message preview.
- Produces: repeatable route timing report and overlap/layout assertions for wide, medium, and narrow window sizes.

- [ ] **Step 1: Add failing performance assertions**

The smoke loads the local renderer fixture, performs 30 route changes and 200 incremental message inserts, and fails when p95 route feedback exceeds 100 ms or a synthetic long task exceeds 200 ms. Store only summary metrics, not machine-specific snapshots.

- [ ] **Step 2: Add visual assertions**

At 1440x900, 1100x760, and 760x720 verify that visible pane rectangles do not overlap, workspace width stays positive, text controls remain inside parents, and the inspector/context collapse rules activate at specified widths. Capture screenshots under `harness/screenshots/client-foundation/` for manual review but exclude transient screenshots from packaging.

- [ ] **Step 3: Run focused gates and fix only measured regressions**

Run:

```powershell
node scripts/client-performance-smoke.mjs
node scripts/client-visual-smoke.mjs
npm run test:ui-parity
npm run test:quality
```

Expected: all PASS and capability manifest has zero unmapped controls.

- [ ] **Step 4: Run full release verification**

Run: `npm run test:release`

Expected: exit code 0. Existing non-blocking signing/Node patch warnings may remain documented but no new warning is accepted.

- [ ] **Step 5: Document the wave**

Append to `PROJEKT-WISSEN.md`: files/interfaces, compatibility-route behavior, capability counts, performance measurements, visual sizes, commands, known exclusions, and the next Wave B boundaries.

- [ ] **Step 6: Commit**

```powershell
git add package.json PROJEKT-WISSEN.md scripts/client-performance-smoke.mjs scripts/client-visual-smoke.mjs scripts/ui-recovery-layout-smoke.mjs
git commit -m "test: verify client foundation release gates"
```
