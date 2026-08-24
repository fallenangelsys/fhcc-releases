# Leveling Balance V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy fast/random leveling model with the approved no-limit `5 XP/message`, `1 XP/voice-minute` progressive balance and automatically recalculate every profile and managed level role.

**Architecture:** `src/features/levels.js` remains the canonical progression service, but receives pure helpers for curve calculation, maximum-level resolution, profile migration, and interval-based voice settlement. `src/defaultConfig.js` migrates old guild settings to a versioned Balance V1 preset and removes dead controls from the visible Leveling card. The existing atomic JSON store records an idempotent migration report; the established managed-role service performs the Discord role reconciliation.

**Tech Stack:** Node.js ESM, discord.js, Electron renderer metadata, assertion-based smoke tests, electron-builder/NSIS.

## Global Constraints

- Every legitimate message awards exactly `5 XP` with no cooldown, daily cap, weekly cap, randomness, or diminishing multiplier.
- Every eligible voice minute awards exactly `1 XP`; invalid intervals must never be back-credited.
- Activity-race, server-tag, and booster systems award no level XP.
- Existing lifetime XP is retained exactly.
- Highest configured level-role mapping is the maximum visible level; compatibility fallback is Level 110.
- Level roles are recalculated and synchronized automatically after migration.
- Existing user changes in the dirty worktree must not be reverted.

---

### Task 1: Lock the approved balance in failing tests

**Files:**
- Create: `scripts/leveling-balance-smoke.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `_levelInternals` from `src/features/levels.js`, `normalizeConfig` from `src/defaultConfig.js`.
- Produces: executable regression contract for `xpForLevel`, `levelFromXp`, `configuredMaxLevel`, `shouldAward`, `recordAwardedFingerprint`, `migrateProfilesForBalance`, and `settleVoiceAccrual`.

- [ ] **Step 1: Write curve and config assertions**

```js
assert.equal(_levelInternals.xpForLevel(1), 300);
assert.equal(_levelInternals.xpForLevel(20), 28_800);
assert.equal(_levelInternals.xpForLevel(110), 1_238_400);
assert.equal(_levelInternals.levelFromXp(1_238_399, 110), 109);
assert.equal(_levelInternals.levelFromXp(9_999_999, 110), 110);

const migrated = normalizeConfig({ levels: { xpPerMessageMin: 6, xpPerMessageMax: 16, cooldownSeconds: 60 } });
assert.equal(migrated.levels.balanceVersion, 'progressive-v1');
assert.equal(migrated.levels.xpPerMessage, 5);
assert.equal(migrated.levels.cooldownSeconds, 0);
assert.equal(migrated.levels.voiceXpPerMinute, 1);
```

- [ ] **Step 2: Write chat qualification assertions**

```js
const first = _levelInternals.shouldAward(message('erste echte nachricht'), cfg, profile, 1_000);
_levelInternals.recordAwardedFingerprint(profile, first.fingerprint, 1_000);
const second = _levelInternals.shouldAward(message('zweite echte nachricht'), cfg, profile, 1_001);
assert.equal(first.ok, true);
assert.equal(second.ok, true);
assert.equal(_levelInternals.shouldAward(message('erste echte nachricht'), cfg, profile, 1_002).reason, 'duplicate');
assert.equal(_levelInternals.shouldAward(attachmentMessage(), cfg, profile, 1_003).ok, true);
```

- [ ] **Step 3: Add focus smoke to the community suite**

```json
"test:community": "node scripts/leveling-balance-smoke.mjs && node scripts/leveling-autoresponder-smoke.mjs && ..."
```

- [ ] **Step 4: Run the focus smoke and verify RED**

Run: `node scripts/leveling-balance-smoke.mjs`  
Expected: FAIL because Balance V1 helpers and thresholds do not exist yet.

### Task 2: Implement the canonical curve and chat awards

**Files:**
- Modify: `src/features/levels.js`
- Modify: `src/defaultConfig.js`

**Interfaces:**
- Consumes: configured `levels.levelRoleMappings`, message objects from the feature dispatcher.
- Produces: `xpForLevel(level)`, `levelFromXp(xp, maxLevel)`, `configuredMaxLevel(conf)`, `recordAwardedFingerprint(profile, fingerprint, now)`.

- [ ] **Step 1: Replace the legacy curve with the approved formula**

```js
const BALANCE_VERSION = 'progressive-v1';
const CURVE_SCALE = 60;
const DEFAULT_MAX_LEVEL = 110;

const xpForLevel = (level) => {
  const l = Math.max(0, Math.floor(Number(level) || 0));
  return CURVE_SCALE * (l * (l + 4) + Math.max(0, l - 20) ** 2);
};
```

Use integer binary search in `levelFromXp` and clamp the result to `configuredMaxLevel(conf)` at every production call site.

- [ ] **Step 2: Normalize legacy configs into Balance V1 once**

Set first-migration values to `xpPerMessage: 5`, min/max compatibility values `5`, `cooldownSeconds: 0`, `maxXpPerDay: 0`, `voiceXpPerMinute: 1`, disabled activity bonus, zero tag bonus, and disabled/zero booster bonus. Persist `balanceVersion: 'progressive-v1'` so later user edits to the active values survive normalization.

- [ ] **Step 3: Remove the cooldown and random award path**

```js
const xpPerMessage = Math.max(1, Math.floor(Number(conf?.xpPerMessage) || 5));
await awardXp({ guild: message.guild, member: message.member, cfg, conf, amount: xpPerMessage, source: 'message', fallbackChannel: message.channel });
```

- [ ] **Step 4: Implement bounded duplicate history and media messages**

Store the latest 20 `{ fingerprint, at }` records, discard entries older than ten minutes, reject a matching fingerprint, and accept attachments/stickers without text. Block `message.webhookId` and non-default system messages.

- [ ] **Step 5: Run the focus smoke and verify chat/curve GREEN**

Run: `node scripts/leveling-balance-smoke.mjs`  
Expected: curve, config, and chat sections pass; later voice/migration sections remain RED.

### Task 3: Replace Voice catch-up with interval settlement

**Files:**
- Modify: `scripts/leveling-balance-smoke.mjs`
- Modify: `src/features/levels.js`

**Interfaces:**
- Consumes: runtime voice-state map and current eligibility map.
- Produces: `settleVoiceAccrual(state, { now, eligible, xpPerMinute }) -> integer XP` and queued `voiceTick(runtime, cfg, now?)`.

- [ ] **Step 1: Write RED tests for valid accumulation**

```js
const state = { lastSettledAt: 0, voiceXpRemainder: 0 };
assert.equal(settleVoiceAccrual(state, { now: 30_000, eligible: true, xpPerMinute: 1 }), 0);
assert.equal(settleVoiceAccrual(state, { now: 60_000, eligible: true, xpPerMinute: 1 }), 1);
```

- [ ] **Step 2: Write RED test for the old invalid-time bug**

```js
const state = { lastSettledAt: 0, voiceXpRemainder: 0 };
assert.equal(settleVoiceAccrual(state, { now: 900_000, eligible: false, xpPerMinute: 1 }), 0);
assert.equal(settleVoiceAccrual(state, { now: 960_000, eligible: true, xpPerMinute: 1 }), 1);
```

- [ ] **Step 3: Implement settlement and event ordering**

Advance `lastSettledAt` for every state on every settlement. Add elapsed time only while eligible. Before applying `onVoiceStateUpdate`, settle the old runtime state through a serialized `voiceQueue`; then store the new channel/deaf state with the same remainder and the event timestamp.

- [ ] **Step 4: Remove the passive bonus timer**

Do not create `bonusTimer` in `startLevelRuntime`; retain legacy bonus functions only if needed to read old stores, but no runtime path may invoke them.

- [ ] **Step 5: Run Voice regression tests**

Run: `node scripts/leveling-balance-smoke.mjs`  
Expected: valid minute, remainder, alone/deaf transition, and no-back-credit assertions pass.

### Task 4: Migrate profiles and synchronize roles

**Files:**
- Modify: `scripts/leveling-balance-smoke.mjs`
- Modify: `src/features/levels.js`

**Interfaces:**
- Consumes: normalized store, guild config, Discord guild members.
- Produces: `migrateProfilesForBalance(users, conf)`, `ensureBalanceMigration(guild, cfg)`, migration report under `store.balanceMigrations[guildId]`.

- [ ] **Step 1: Write RED migration tests**

```js
const users = {
  a: { xp: 35_200, level: 40 },
  b: { xp: 250_800, level: 110 }
};
const report = migrateProfilesForBalance(users, conf);
assert.equal(users.a.xp, 35_200);
assert.equal(users.a.level, 22);
assert.equal(users.b.xp, 250_800);
assert.equal(users.b.level, 53);
assert.equal(report.lowered, 2);
```

- [ ] **Step 2: Upgrade and normalize the store schema**

Store version 3 includes `balanceMigrations: {}`. Version 2 profile maps remain readable. Profile normalization recalculates neither XP nor level until guild config is available.

- [ ] **Step 3: Implement idempotent startup migration**

On `onClientReady`, migrate profiles, atomically flush, then run `grantLevelRolesToAll`. Record `rolesSynchronizedAt` only when the result has no blocked or failed operations. Suppress announcements throughout this flow.

- [ ] **Step 4: Make every role path derive the level canonically**

Update `grantLevelRolesToAll`, `setMemberLevel`, member rejoin, `/level`, level-up rendering, and ordinary awards to call the new curve with the configured maximum. Always persist recalculated `profile.level`, including downward corrections.

- [ ] **Step 5: Re-run automatic role sync after relevant config changes**

Queue one background reconciliation when Leveling mappings, cumulative-role behavior, or balance settings change. Reuse the existing managed-role backoff and report blocked role IDs in diagnostics.

- [ ] **Step 6: Run focus smoke**

Run: `node scripts/leveling-balance-smoke.mjs`  
Expected: migration is lossless, idempotent, clamps max level, and role reconciliation removes stale roles and assigns the correct role.

### Task 5: Simplify Leveling UI and rules text

**Files:**
- Modify: `src/defaultConfig.js`
- Modify: `src/features/levels.js`
- Modify: `scripts/leveling-autoresponder-smoke.mjs`

**Interfaces:**
- Consumes: generic feature-card renderer and existing Embed Studio templates.
- Produces: concise Leveling field metadata and accurate rules placeholders.

- [ ] **Step 1: Replace obsolete visible controls**

Expose one `levels.xpPerMessage` field, minimum message length, exclusions, Voice XP/minute, Voice minimum participants, mappings, cumulative roles, announcements, panel channel, and editable rules. Remove visible min/max random XP, cooldown, daily cap, curve base, and passive bonus controls.

- [ ] **Step 2: Update standard rules copy**

The default chat field states `5 XP` per legitimate message and explicitly states no cooldown or activity cap. Voice states `1 XP` per eligible minute. Curve copy lists Level 1/10/20/50/110 thresholds and the configured maximum. Bonus fields are omitted when disabled.

- [ ] **Step 3: Preserve custom Studio designs**

Only migrate known legacy default strings. Continue replacing legacy placeholders for saved templates, but never overwrite user-authored field text.

- [ ] **Step 4: Run Leveling and UI smoke tests**

Run: `node scripts/leveling-autoresponder-smoke.mjs`  
Expected: all updated Leveling assertions pass, including editable custom rules.

### Task 6: Document, verify, and release

**Files:**
- Modify: `PROJEKT-WISSEN.md`
- Modify: `src/features/bot-changelog.json`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `desktop/renderer/index.html`
- Modify: `index.html`

**Interfaces:**
- Consumes: passing source tree and release scripts.
- Produces: versioned installer, update manifest, checksum, and detailed agent handoff.

- [ ] **Step 1: Record implementation knowledge**

Document old root causes, exact curve, eligibility rules, store migration, role-sync retry semantics, Voice state machine, tests, runtime data paths, and release artifact in `PROJEKT-WISSEN.md`.

- [ ] **Step 2: Run focused verification**

Run: `node scripts/leveling-balance-smoke.mjs`  
Run: `node scripts/leveling-autoresponder-smoke.mjs`  
Run: `npm run test:community`

- [ ] **Step 3: Run full release verification**

Run: `npm run test:release`  
Expected: all suites pass without Leveling regressions.

- [ ] **Step 4: Bump one patch version and synchronize cache busters**

Use `node scripts/bump-version.cjs patch`, verify `package.json` and `package-lock.json` agree, update the bot changelog, and ensure root/desktop renderer asset query versions match.

- [ ] **Step 5: Build and audit the Windows installer**

Run: `npm run build:win`  
Expected: NSIS installer, `latest.yml`, packaged-runtime smoke, and artifact audit all succeed.

- [ ] **Step 6: Verify artifact identity**

Run `Get-FileHash -Algorithm SHA256` for the new `dist/FHCC-Setup-<version>-x64.exe` and record path, byte size, SHA-256, and test results in `PROJEKT-WISSEN.md`.
