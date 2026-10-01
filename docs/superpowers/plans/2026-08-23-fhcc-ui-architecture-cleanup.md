# FHCC UI Architecture Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make FHCC easier to understand, safer to extend, and less likely to leak settings between modules or embed sections.

**Architecture:** Keep behavior stable and extract only proven module interfaces. The first wave builds small adapters around the existing renderer and Activity-Race code instead of rewriting the app shell. Every task adds a regression test before production changes.

**Tech Stack:** Electron 43, Node 24, Discord.js 14, vanilla renderer JavaScript, existing smoke-test scripts.

## Global Constraints

- Do not rewrite the app in React/Vue/Svelte during this cleanup wave.
- Keep `npm run build:win` green before shipping a new EXE.
- Do not remove existing user config or migrate custom embed designs unless a test proves the migration is intentional.
- Keep current module names and Discord custom IDs stable.
- Prefer small files with explicit exports over adding more logic to `desktop/renderer/app.js`.
- Use `apply_patch` for hand edits.

---

### Task 1: Add A Renderer Architecture Guard

**Files:**
- Modify: `scripts/ui-field-audit.mjs`
- Modify: `PROJEKT-WISSEN.md`

**Interfaces:**
- Consumes: current renderer file sizes and existing UI audit.
- Produces: a failing warning gate when `desktop/renderer/app.js` grows without an acknowledged split.

- [x] **Step 1: Write the failing audit assertion**

Add this near the end of `scripts/ui-field-audit.mjs` after existing UI checks:

```js
const appLines = app.split(/\r?\n/).length;
if (appLines > 9850) {
  fail(`desktop/renderer/app.js ist mit ${appLines} Zeilen zu groß. Neue UI-Logik muss in ein eigenes Renderer-Modul.`);
}
```

- [x] **Step 2: Run test to verify current state**

Run:

```powershell
node scripts/ui-field-audit.mjs
```

Expected: PASS while `app.js` stays under the guard. If it fails, lower-risk extraction must happen before new UI work.

- [x] **Step 3: Document the guard**

Append to `PROJEKT-WISSEN.md`:

```md
### Renderer-Wachstumsguard
- `scripts/ui-field-audit.mjs` schützt `desktop/renderer/app.js` vor weiterem unkontrolliertem Wachstum.
- Neue UI-Logik soll in fokussierte Dateien unter `desktop/renderer/` ausgelagert und über `index.html` geladen werden.
```

- [x] **Step 4: Verify**

Run:

```powershell
node scripts/ui-field-audit.mjs
node scripts/workspace-forum-timeline-smoke.mjs
```

Expected: both pass.

---

### Task 2: Extract Activity-Race Studio Adapter From Renderer

**Files:**
- Create: `desktop/renderer/activity-race-studio.js`
- Modify: `desktop/renderer/app.js`
- Modify: `desktop/renderer/index.html`
- Modify: `index.html`
- Test: `scripts/activity-race-smoke.mjs`

**Interfaces:**
- Consumes: existing global renderer helpers from `app.js`: `clone`, `escapeHtml`, `validImageUrl`, `state`.
- Produces: `window.FHCCActivityRaceStudio` with:

```js
{
  completionText(config, section),
  studioTemplate(config, section),
  previewTemplate(template, state),
  rawFields(embed, config),
  resolvePreview(text, state)
}
```

- [x] **Step 1: Write failing smoke assertions**

In `scripts/activity-race-smoke.mjs`, add:

```js
const activityRaceStudioSource = fs.readFileSync(path.join(root, 'desktop/renderer/activity-race-studio.js'), 'utf8');
assert.match(activityRaceStudioSource, /window\.FHCCActivityRaceStudio/, 'Activity-Race-Studio muss ein eigenes Renderer-Modul haben.');
assert.match(rendererHtml, /activity-race-studio\.js\?v=\d+\.\d+\.\d+/, 'Activity-Race-Studio-Modul muss vor app.js geladen werden.');
assert.doesNotMatch(rendererJs, /function activityRaceStudioTemplate\(/, 'Activity-Race-Studio-Template darf nicht mehr direkt in app.js liegen.');
```

- [x] **Step 2: Run test to verify it fails**

Run:

```powershell
node scripts/activity-race-smoke.mjs
```

Expected: FAIL because `desktop/renderer/activity-race-studio.js` does not exist yet.

- [x] **Step 3: Create the adapter file**

Move these functions from `desktop/renderer/app.js` into `desktop/renderer/activity-race-studio.js`:

```js
activityRaceCompletionText
activityRaceStudioDescription
activityRaceStudioTemplate
activityRaceRawFields
activityRaceResolvePreview
activityRacePreviewValue
activityRacePreviewTemplate
```

Wrap them in an IIFE:

```js
(function () {
  const ACTIVITY_RACE_LEGACY_DESCRIPTION = 'Die aktivsten Mitglieder im Chat und Sprachchat';
  const sectionKey = (section) => section === 'weekly' ? 'weekly' : section === 'monthly' ? 'monthly' : 'daily';

  function completionText(config, section) {
    // moved body
  }

  window.FHCCActivityRaceStudio = {
    completionText,
    studioTemplate,
    rawFields,
    resolvePreview,
    previewValue,
    previewTemplate
  };
})();
```

- [x] **Step 4: Replace app.js call sites**

In `desktop/renderer/app.js`, replace:

```js
activityRaceStudioTemplate(...)
activityRacePreviewTemplate(...)
activityRaceResolvePreview(...)
activityRaceRawFields(...)
```

with:

```js
window.FHCCActivityRaceStudio.studioTemplate(...)
window.FHCCActivityRaceStudio.previewTemplate(...)
window.FHCCActivityRaceStudio.resolvePreview(...)
window.FHCCActivityRaceStudio.rawFields(...)
```

Keep `state` passed where the adapter needs live renderer state.

- [x] **Step 5: Load the module before app.js**

In both `desktop/renderer/index.html` and root `index.html`, add before `app.js`:

```html
<script src="activity-race-studio.js?v=3.9.285"></script>
```

Use the current package version when this task is executed.

- [x] **Step 6: Verify**

Run:

```powershell
node scripts/activity-race-smoke.mjs
node scripts/ui-field-audit.mjs
node scripts/workspace-forum-timeline-smoke.mjs
```

Expected: all pass.

---

### Task 3: Extract Activity-Race Backend Panel Design Logic

**Files:**
- Create: `src/features/activityRaceDesign.js`
- Modify: `src/features/activityRace.js`
- Modify: `src/defaultConfig.js`
- Test: `scripts/activity-race-smoke.mjs`

**Interfaces:**
- Consumes: existing Activity-Race design functions.
- Produces:

```js
export const defaultPanelDesign = () => ({ ... });
export const normalizePanelDesign = (value = {}) => ({ ... });
export const normalizePanelAttachment = (value) => ({ ... });
export const panelDesignKeyForPeriod = (period) => 'panelDesign' | 'panelDesignWeekly' | 'panelDesignMonthly';
export const stripPanelMessageParts = (design) => ({ ... });
```

- [ ] **Step 1: Write failing import assertion**

In `scripts/activity-race-smoke.mjs`, add:

```js
const designModule = fs.readFileSync(path.join(root, 'src/features/activityRaceDesign.js'), 'utf8');
assert.match(designModule, /export const normalizePanelDesign/, 'Activity-Race-Designlogik muss in activityRaceDesign.js liegen.');
assert.doesNotMatch(activityRaceSource, /const normalizePanelDesign =/, 'activityRace.js soll Design-Normalisierung importieren statt besitzen.');
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node scripts/activity-race-smoke.mjs
```

Expected: FAIL because the new module does not exist.

- [ ] **Step 3: Move design helpers**

Move these functions from `src/features/activityRace.js` into `src/features/activityRaceDesign.js`:

```js
defaultStatusFields
defaultPanelDesign
normalizePanelAttachment
normalizePanelDesign
stripPanelMessageParts
panelDesignKeyForPeriod
```

Also move helper dependencies needed only for design:

```js
finiteInteger
safeText
safeHttpUrl
safeColor
migratePanelFieldValue
```

If `finiteInteger` is still needed elsewhere in `activityRace.js`, keep a local copy there and export a design-local version in `activityRaceDesign.js`.

- [ ] **Step 4: Import helpers in activityRace.js**

At the top of `src/features/activityRace.js`, add:

```js
import {
  defaultPanelDesign,
  normalizePanelAttachment,
  normalizePanelDesign,
  panelDesignKeyForPeriod,
  stripPanelMessageParts
} from './activityRaceDesign.js';
```

- [ ] **Step 5: Keep exports stable**

In `_activityRaceInternals`, keep exposing:

```js
normalizePanelDesign,
buildPeriodPanelPayload,
buildPanelPayload
```

so existing tests and future agents have the same test surface.

- [ ] **Step 6: Verify**

Run:

```powershell
node scripts/activity-race-smoke.mjs
node scripts/verify-bot-imports.mjs
```

Expected: both pass.

---

### Task 4: Introduce Studio Section Adapter Contract

**Files:**
- Create: `desktop/renderer/studio-adapters.js`
- Modify: `desktop/renderer/app.js`
- Modify: `desktop/renderer/index.html`
- Modify: `index.html`
- Test: `scripts/embed-design-pipeline-smoke.mjs`

**Interfaces:**
- Produces:

```js
window.FHCCStudioAdapters = {
  register(id, adapter),
  get(id),
  has(id),
  list()
}
```

Adapter shape:

```js
{
  id: 'activityRace',
  label: 'Aktivitäts-Liga',
  makeTemplate(config, section),
  saveTemplate({ guildId, section, template, api, state }),
  previewTemplate(template, state)
}
```

- [ ] **Step 1: Write failing smoke assertion**

In `scripts/embed-design-pipeline-smoke.mjs`, add:

```js
const studioAdapters = fs.readFileSync(path.join(root, 'desktop/renderer/studio-adapters.js'), 'utf8');
assert.match(studioAdapters, /window\.FHCCStudioAdapters/, 'Studio-Adapter-Registry fehlt.');
assert.match(rendererHtml, /studio-adapters\.js\?v=\d+\.\d+\.\d+/, 'Studio-Adapter-Registry muss vor app.js geladen werden.');
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node scripts/embed-design-pipeline-smoke.mjs
```

Expected: FAIL because `studio-adapters.js` does not exist.

- [ ] **Step 3: Create registry**

Create `desktop/renderer/studio-adapters.js`:

```js
(function () {
  const adapters = new Map();
  window.FHCCStudioAdapters = {
    register(id, adapter) {
      const key = String(id || '').trim();
      if (!key) throw new Error('Studio adapter id fehlt.');
      adapters.set(key, { ...adapter, id: key });
    },
    get(id) {
      return adapters.get(String(id || '').trim()) || null;
    },
    has(id) {
      return adapters.has(String(id || '').trim());
    },
    list() {
      return Array.from(adapters.values());
    }
  };
})();
```

- [ ] **Step 4: Load before app.js**

Add before `app.js` in both HTML files:

```html
<script src="studio-adapters.js?v=3.9.285"></script>
```

- [ ] **Step 5: Register Activity-Race adapter**

At the end of `desktop/renderer/activity-race-studio.js`, add:

```js
window.FHCCStudioAdapters?.register?.('activityRace', {
  label: 'Aktivitäts-Liga',
  makeTemplate: studioTemplate,
  previewTemplate
});
```

- [ ] **Step 6: Verify**

Run:

```powershell
node scripts/embed-design-pipeline-smoke.mjs
node scripts/activity-race-smoke.mjs
```

Expected: both pass.

---

### Completed Follow-Up: Extract Imported Studio Components Renderer

**Files:**
- Created: `desktop/renderer/studio-components.js`
- Modified: `desktop/renderer/app.js`
- Modified: `desktop/renderer/index.html`
- Modified: `index.html`
- Test: `scripts/reaction-role-buttons-smoke.mjs`

- [x] **Step 1: Add failing smoke assertions**

`scripts/reaction-role-buttons-smoke.mjs` now requires `window.FHCCStudioComponents`, HTML loading before `app.js`, and no local `function normalizeStudioComponent(...)` inside `app.js`.

- [x] **Step 2: Extract renderer helpers**

Moved imported Discord component normalization and preview rendering into `desktop/renderer/studio-components.js`.

- [x] **Step 3: Replace app.js call sites**

`app.js` now calls `window.FHCCStudioComponents.normalizeRows(...)` and `window.FHCCStudioComponents.renderPreview(...)`.

- [x] **Step 4: Verify**

Run:

```powershell
node scripts/reaction-role-buttons-smoke.mjs
node scripts/ui-field-audit.mjs
```

Expected: both pass.

---

### Task 5: Add Release Share Script

**Files:**
- Create: `scripts/release-share.cjs`
- Modify: `package.json`
- Test: `scripts/auto-update-smoke.mjs`

**Interfaces:**
- Consumes: `dist/FHCC-Setup-<version>-x64.exe`, `dist/latest.yml`, and an explicit target folder argument.
- Produces: copied EXE + `latest.yml` with hash verification.

- [ ] **Step 1: Write failing auto-update smoke assertion**

In `scripts/auto-update-smoke.mjs`, add:

```js
const releaseShareSource = readFileSync(path.join(root, 'scripts', 'release-share.cjs'), 'utf8');
assert.match(releaseShareSource, /FHCC-Setup-\$\{version\}-x64\.exe/, 'Release-Share-Script muss versionierten Installer kopieren.');
assert.match(releaseShareSource, /latest\.yml/, 'Release-Share-Script muss latest.yml kopieren.');
assert.match(releaseShareSource, /sha512/, 'Release-Share-Script muss SHA-512 aus latest.yml pruefen.');
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node scripts/auto-update-smoke.mjs
```

Expected: FAIL because the script does not exist.

- [ ] **Step 3: Create script**

Create `scripts/release-share.cjs`:

```js
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const target = process.argv[2] ? path.resolve(process.argv[2]) : '';
if (!target) {
  console.error('Usage: node scripts/release-share.cjs <update-folder>');
  process.exit(1);
}

const installerName = `FHCC-Setup-${version}-x64.exe`;
const dist = path.join(root, 'dist');
const installer = path.join(dist, installerName);
const manifest = path.join(dist, 'latest.yml');
if (!fs.existsSync(installer)) throw new Error(`Installer fehlt: ${installer}`);
if (!fs.existsSync(manifest)) throw new Error(`latest.yml fehlt: ${manifest}`);

const manifestText = fs.readFileSync(manifest, 'utf8');
const expectedSha = /^sha512:\s*(.+)$/m.exec(manifestText)?.[1]?.trim();
if (!expectedSha) throw new Error('latest.yml enthaelt keinen sha512-Wert.');
const actualSha = crypto.createHash('sha512').update(fs.readFileSync(installer)).digest('base64');
if (actualSha !== expectedSha) throw new Error('Installer passt nicht zum sha512-Wert in latest.yml.');

fs.mkdirSync(target, { recursive: true });
fs.copyFileSync(installer, path.join(target, installerName));
fs.copyFileSync(manifest, path.join(target, 'latest.yml'));
console.log(`Freigabe aktualisiert: ${target}`);
console.log(`${installerName}`);
```

- [ ] **Step 4: Add package script**

In `package.json`, add:

```json
"release:share": "node scripts/release-share.cjs"
```

- [ ] **Step 5: Verify**

Run:

```powershell
node scripts/auto-update-smoke.mjs
npm run release:share -- C:\FHCC-Updates-Test
```

Expected: smoke passes and the target folder contains exactly the current installer plus `latest.yml`.

---

### Task 6: First Visual UI Pass For Navigation

**Files:**
- Modify: `desktop/renderer/ui-base.css`
- Modify: `desktop/renderer/ui-aurora.css`
- Modify: `desktop/renderer/index.html`
- Modify: `index.html`
- Test: `scripts/ui-recovery-layout-smoke.mjs`

**Interfaces:**
- Consumes: existing app shell and module navigation.
- Produces: clearer left navigation and module grouping without changing feature IDs.

- [ ] **Step 1: Write smoke assertions for non-generic nav**

In `scripts/ui-recovery-layout-smoke.mjs`, add checks:

```js
expect(css.includes('.app-nav-rail'), 'Neue App-Navigation braucht eine klare Rail-Klasse.');
expect(css.includes('.app-nav-section-label'), 'Navigation braucht sichtbare Bereichslabels statt reine Icon-Kacheln.');
expect(!css.includes('border-radius: 999px') || css.includes('.pill-allowed'), 'Keine generischen Pillen in der Hauptnavigation.');
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node scripts/ui-recovery-layout-smoke.mjs
```

Expected: FAIL until nav CSS is added.

- [ ] **Step 3: Implement only shell/nav styling**

Add classes to the existing nav markup without renaming `data-view` or `data-feature` hooks:

```html
<nav class="app-nav-rail">
  <span class="app-nav-section-label">Systeme</span>
</nav>
```

CSS direction:

```css
.app-nav-rail {
  border-right: 1px solid rgba(180, 198, 255, .16);
  background: linear-gradient(180deg, rgba(3, 6, 11, .96), rgba(8, 10, 16, .98));
}
.app-nav-section-label {
  font: 700 10px/1.2 var(--font-ui, Inter, sans-serif);
  letter-spacing: .08em;
  color: rgba(190, 205, 230, .58);
  text-transform: uppercase;
}
```

- [ ] **Step 4: Verify**

Run:

```powershell
node scripts/ui-recovery-layout-smoke.mjs
node scripts/ui-field-audit.mjs
```

Expected: both pass.

---

## Self-Review

- Spec coverage: The plan covers the highest-risk areas found in the scan: renderer size, Activity-Race coupling, Studio section coupling, release sharing, and navigation clarity.
- Placeholder scan: No `TBD`, `TODO`, or vague “write tests” steps remain.
- Type consistency: The plan names stable interfaces for `FHCCActivityRaceStudio`, `FHCCStudioAdapters`, and Activity-Race design helpers before later tasks consume them.
