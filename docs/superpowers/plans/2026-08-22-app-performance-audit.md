# FHCC App Performance Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use test-driven-development and verification-before-completion for every behavioral change.

**Goal:** Audit the complete FHCC application, fix evidence-backed defects and bottlenecks, and leave reproducible verification plus honest residual-risk documentation.

**Architecture:** Measure the Electron renderer, Express/Discord runtime, persistence, event dispatcher, and release pipeline separately. Keep fixes scoped to established boundaries and require a red regression test before each production behavior change.

**Tech Stack:** Electron 43, Node.js 24, Express 5, discord.js 14, better-sqlite3, plain JavaScript/CSS/HTML.

## Global Constraints

- Preserve unrelated user changes in the dirty worktree.
- Do not mutate real Discord guild data during automated tests.
- Keep production behavior changes covered by smoke tests.
- Record completed fixes and operational findings in `PROJEKT-WISSEN.md`.

---

### Task 1: Establish the baseline

**Files:** Read-only audit of `src/`, `desktop/`, `public/`, `scripts/`, runtime diagnostics, and package scripts.

- [x] Measure source/resource sizes and identify critical-path assets.
- [x] Run quality gate, UI audit, index optimization smoke, and interaction timing checks.
- [x] Read both current project diagnostics and historical desktop runtime diagnostics.

### Task 2: Repair renderer cache consistency

**Files:** `desktop/renderer/index.html`, `index.html`, `scripts/server-management-ui-smoke.mjs`.

- [x] Reproduce stale cache-buster failure against package version `3.9.271`.
- [x] Synchronize CSS/JS query versions to `3.9.271`.
- [x] Verify `server-management-ui-smoke.mjs` passes.

### Task 3: Remove the renderer font network dependency

**Files:** `desktop/renderer/ui-base.css`, `scripts/ui-recovery-layout-smoke.mjs`.

- [x] Add a failing assertion for external startup font stylesheets.
- [x] Remove Google Fonts `@import` and use bundled Inter/Space Grotesk WOFF2 files.
- [x] Verify the UI recovery test passes.

### Task 4: Isolate feature queues by Guild

**Files:** `src/runtime/featureDispatcher.js`, `scripts/feature-dispatcher-smoke.mjs`.

- [x] Add a failing cross-Guild concurrency assertion.
- [x] Include Guild identity in dispatcher queue keys while preserving per-Guild ordering.
- [x] Verify the dispatcher smoke passes.

### Task 5: Repair Public-Call timestamp fallback

**Files:** `src/features/publicCallVote.js`, `scripts/public-call-vote-smoke.mjs`.

- [x] Reproduce omitted timestamp turning a no-timestamp panel into `timestamp: true`.
- [x] Use the section fallback only when the editor omitted the value.
- [x] Verify the Public-Call smoke passes.

### Task 6: Restore release import integrity

**Files:** Remove obsolete `src/features/inactive-reminder-smoke.mjs`.

- [x] Confirm the file is an unreferenced old duplicate of the canonical `scripts/` smoke.
- [x] Remove the stale production-tree copy.
- [x] Verify the case-sensitive/ASAR import audit passes.

### Task 7: Full verification and handoff

**Files:** `PROJEKT-WISSEN.md`.

- [x] Run `npm run test:release` from the beginning and require exit code 0.
- [x] Run focused performance/index checks and inspect the final diff/status.
- [x] Record the final scores, residual risks, and exact verification evidence.
