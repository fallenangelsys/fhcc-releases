# FHCC UI Redesign Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone, clickable HTML prototype that demonstrates the approved Command Deck, Server Atlas, and Operator Console redesign across all major FHCC areas.

**Architecture:** One self-contained document owns markup, styles, mock data, and view-state interactions so it can open directly through `file://`. A separate Node smoke test verifies structure, navigation hooks, responsive rules, accessibility states, and the absence of rejected generic UI patterns.

**Tech Stack:** Semantic HTML5, embedded CSS, vanilla JavaScript, Node.js smoke tests, Playwright visual verification.

## Global Constraints

- Do not modify the production Electron renderer.
- Use `../desktop/renderer/assets/fallen-heaven-bg.png` as the real visual asset.
- Support Overview, Server, Modules, Embed Studio, and System as clickable views.
- Keep radii at 6 px or less and avoid letter tiles, decorative orbs, nested cards, oversized metric cards, and generic gradients.
- Keep navigation and controls keyboard accessible and respect `prefers-reduced-motion`.
- Desktop uses three-column workspaces; narrow layouts become staged views without overlap.

---

### Task 1: Structural Prototype And Navigation

**Files:**
- Create: `docs/fhcc-command-deck-preview.html`
- Create: `scripts/fhcc-command-deck-preview-smoke.mjs`

**Interfaces:**
- Produces: Buttons matching `[data-view-target]`, views matching `[data-view]`, `activateView(viewId)`, command overlay `#command-layer`.

- [ ] **Step 1: Write the failing structural smoke test**

Create assertions that the preview file exists; contains the five required `data-view` values; loads the Fallen Heaven background; defines `activateView`; marks active navigation with `aria-current`; contains `@media (max-width: 760px)` and `prefers-reduced-motion`; and does not contain `.orb`, `.metric-card`, or single-letter navigation labels.

- [ ] **Step 2: Run the structural test and verify RED**

Run: `node scripts/fhcc-command-deck-preview-smoke.mjs`

Expected: FAIL because `docs/fhcc-command-deck-preview.html` does not exist.

- [ ] **Step 3: Implement the shell and all five semantic views**

Create a fixed command bar, view title rail, animated Heaven Line, command overlay, and five sections. Use one `<button data-view-target="overview">` pattern per navigation item and one `<section data-view="overview">` pattern per workspace.

- [ ] **Step 4: Implement deterministic navigation state**

`activateView(viewId)` must hide all nonmatching views, set `aria-current="page"` only on the active navigation button, update the title rail, and move the Heaven Line by reading the active button bounds.

- [ ] **Step 5: Run the smoke test and verify GREEN**

Run: `node scripts/fhcc-command-deck-preview-smoke.mjs`

Expected: PASS with all five views and accessibility hooks present.

### Task 2: Domain-Specific Workspaces

**Files:**
- Modify: `docs/fhcc-command-deck-preview.html`
- Modify: `scripts/fhcc-command-deck-preview-smoke.mjs`

**Interfaces:**
- Consumes: `activateView(viewId)` and `[data-view]` shell.
- Produces: `[data-atlas-node]`, `[data-module-row]`, `[data-server-object]`, `[data-studio-layer]`, and `[data-system-event]` interactions.

- [ ] **Step 1: Extend the smoke test with domain assertions**

Require real labels for TempVoice, Aktivitaets-Liga, Counting, Server-Tag, Rollen-Buttons, Funktionsbuttons, Dropdowns, Logs, Updates, and Diagnostics. Require selected-state attributes and one context-detail host per workspace.

- [ ] **Step 2: Run the test and verify RED**

Run: `node scripts/fhcc-command-deck-preview-smoke.mjs`

Expected: FAIL listing the missing domain workspace hook.

- [ ] **Step 3: Build Server Atlas and Operator Console content**

Overview uses a non-card network of named system nodes and an operational event rail. Server uses object list, working table/message surface, and detail inspector. Modules uses grouped system rows with status text, last activity, and inline selection.

- [ ] **Step 4: Build Studio and System content**

Studio uses editor outline, Discord-like central preview, and property inspector with explicit role/function/dropdown groups. System uses a chronological process rail with source, timestamp, impact, and action.

- [ ] **Step 5: Add interaction state**

Clicking atlas nodes navigates to the matching workspace. Clicking rows and layers updates `aria-selected`, selected styling, and contextual details. The command overlay opens with its toolbar button or `Ctrl+K` and closes with Escape.

- [ ] **Step 6: Run the smoke test and verify GREEN**

Run: `node scripts/fhcc-command-deck-preview-smoke.mjs`

Expected: PASS with all domain labels and interaction hooks present.

### Task 3: Responsive And Visual Verification

**Files:**
- Modify: `docs/fhcc-command-deck-preview.html`
- Create: `docs/fhcc-command-deck-preview-desktop.png`
- Create: `docs/fhcc-command-deck-preview-mobile.png`

**Interfaces:**
- Consumes: Final standalone preview.
- Produces: Verified desktop and mobile screenshots and a browser-openable HTML artifact.

- [ ] **Step 1: Add responsive layout and reduced-motion behavior**

At widths below 1180 px, inspectors become secondary panes. At widths below 760 px, navigation scrolls horizontally, workspaces become one column, large labels wrap, and no fixed-width pane may cause horizontal document overflow.

- [ ] **Step 2: Run Playwright desktop verification**

Open the local file at 1440x1000, click all five navigation items, assert exactly one visible view after each click, assert `document.documentElement.scrollWidth === window.innerWidth`, and save the overview screenshot.

- [ ] **Step 3: Run Playwright mobile verification**

Open at 390x844, repeat navigation assertions, check zero horizontal document overflow, open and close the command overlay, and save the mobile screenshot.

- [ ] **Step 4: Inspect screenshots and revise visual defects**

Check hierarchy, clipping, text fit, active states, contrast, background framing, and absence of nested floating cards. Correct the HTML and repeat both screenshot runs until clean.

- [ ] **Step 5: Run final verification**

Run: `node scripts/fhcc-command-deck-preview-smoke.mjs`

Expected: PASS. Reopen the final local HTML in the Codex browser for user review.
