# TempVoice User Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** TempVoice merkt pro Server und Mitglied den letzten Kanalnamen, das Limit und die Region, startet jeden neuen Kanal mit frischen Zugriffsrechten, bietet ein vollstaendig editierbares Interface-Embed mit echten Funktionsbuttons und macht Live-Zustand sowie Profilverwaltung in Discord und der App sichtbar.

**Architecture:** Der vorhandene Kern in `src/features/tempVoice.js` bleibt die Eigentumsgrenze fuer Discord-Events, Interface-Payloads und den atomaren JSON-State. Der State wird transaktional auf Version 4 erweitert; Profilwerte und aktive Kanalwerte bleiben strikt getrennt. Das bestehende Embed Studio speichert nur das visuelle TempVoice-Design, waehrend der Bot die echten Komponenten unabhaengig erzeugt; Dashboard und Renderer konsumieren normalisierte Design- und Statusvertraege.

**Tech Stack:** Node.js ESM, discord.js, Express, Electron-Renderer mit Vanilla JavaScript, atomare JSON-Persistenz, Node-Assert-Smoke-Tests, Electron Builder.

## Global Constraints

- Zielrelease ist exakt `FHCC 3.9.290`.
- Nutzerprofile speichern nur `customName`, `userLimit`, `rtcRegion` und `updatedAt`.
- Sperre, Blockliste, Zulassungen, Besitzer, Transfer und Threads duerfen nie in Nutzerprofile gelangen.
- Bestehende Version-3-State-Dateien muessen ohne Verlust aktiver Kanaele zu Version 4 migrieren.
- Neue Abhaengigkeiten sind nicht erlaubt; vorhandene Node-, discord.js- und Renderer-Helfer werden verwendet.
- Alle Discord-Erfolgsmeldungen duerfen erst nach erfolgreicher Discord-Aktion entstehen.
- Bestehende alte TempVoice-Custom-IDs fuer Blockieren und Freigeben bleiben verarbeitbar.
- Das Studio darf keinen Paket-Platzhalter wie `{tempVoiceBlock}` einfuehren; nur die neun freigegebenen atomaren Live-Platzhalter sind erlaubt.
- TempVoice-Buttons werden immer vom Modul erzeugt und duerfen nie als Studio-/Fake-Komponenten gespeichert werden.
- Die vielen bereits vorhandenen Worktree-Aenderungen duerfen weder verworfen noch pauschal mitgestaged werden.
- Jede Testausfuehrung setzt `FALLEN_HEAVEN_DATA_DIR` auf ein Temp-Verzeichnis und beruehrt keine echten Serverdaten.

## File Map

- `src/features/tempVoice.js`: State-Version 4, Profil-CRUD, Profilprioritaet, Single-Flight-Erstellung, Discord-Interface, Zugang, Cleanup und Snapshot.
- `src/defaultConfig.js`: neues Feld `tempVoice.rememberUserProfiles`, Default und Normalisierung.
- `src/index.js`: Guild-aufgeloester Snapshot sowie Profil-Reset-Handler an das Dashboard reichen.
- `src/dashboard.js`: authentifizierte DELETE-Routen fuer ein Profil und alle Guild-Profile.
- `desktop/renderer/app.js`: erweiterte TempVoice-Live-Ansicht, echter TempVoice-Spezialmodus im Embed Studio, Renderlogik, Profil-Reset und Event-Delegation.
- `desktop/renderer/ui-base.css`: gezielte responsive TempVoice-Zeilen ohne neue globale Designschicht.
- `scripts/temp-voice-smoke.mjs`: State-, Profil-, Discord-, Zugangs-, Single-Flight- und Cleanup-Regressionen.
- `scripts/temp-voice-embed-smoke.mjs`: editierbares Interface-Design, atomare Platzhalter, echte Komponenten und Live-Refresh.
- `scripts/state-restore-smoke.mjs`: reale Migration von Legacy-/Version-3-Dateien.
- `scripts/temp-voice-dashboard-smoke.mjs`: Snapshot-, Reset-Handler- und Dashboard-Quellvertrag.
- `scripts/temp-voice-ui-smoke.mjs`: Renderer-Vertrag, Escaping, Reset-Aktionen und responsive CSS.
- `package.json`: neue Fokus-Smokes in `test:community` und Versionsbump.
- `package-lock.json`: synchroner Versionsbump.
- `bot-changelog.json`: nutzerverstaendlicher Eintrag fuer 3.9.290.
- `PROJEKT-WISSEN.md`: Root Cause, Architektur, Migration, Rechte-Semantik, Tests und Release-Artefakt.

---

### Task 1: State Version 4 und Profil-Konfiguration

**Files:**
- Modify: `scripts/temp-voice-smoke.mjs:13-63`
- Modify: `scripts/state-restore-smoke.mjs:15-84`
- Modify: `src/features/tempVoice.js:55-151`
- Modify: `src/defaultConfig.js:384-421`
- Modify: `src/defaultConfig.js:1973-1990`
- Modify: `src/defaultConfig.js:2777-2808`

**Interfaces:**
- Produces: `normalizeTempVoiceState(raw) -> { version: 4, channels, profiles }`
- Produces: `getUserProfile(guildId, userId) -> Promise<Profile|null>`
- Produces: `setUserProfile(guildId, userId, patch) -> Promise<Profile>`
- Produces: `deleteUserProfile(guildId, userId) -> Promise<boolean>`
- Produces: `clearGuildProfiles(guildId) -> Promise<number>`
- Produces: `resolveChannelSettings(conf, member, profile) -> { name, userLimit, rtcRegion }`

- [ ] **Step 1: Add failing config and profile-schema assertions**

Append focused assertions to `scripts/temp-voice-smoke.mjs` and destructure the new internals:

```js
assert.equal(normalizeTempVoiceConfig({}).rememberUserProfiles, true);
assert.equal(normalizeConfig({ tempVoice: { rememberUserProfiles: false } }).tempVoice.rememberUserProfiles, false);

const migrated = normalizeTempVoiceState({
  version: 3,
  channels: { c1: { guildId: 'g1', ownerId: 'u1' } }
});
assert.equal(migrated.version, 4);
assert.equal(migrated.channels.c1.ownerId, 'u1');
assert.deepEqual(migrated.profiles, {});

await setUserProfile('g1', 'u1', {
  customName: '  Gaming @ Home  ',
  userLimit: 500,
  rtcRegion: 'moon'
});
const storedProfile = await getUserProfile('g1', 'u1');
assert.equal(storedProfile.customName, 'Gaming  Home');
assert.equal(storedProfile.userLimit, 99);
assert.equal(storedProfile.rtcRegion, 'automatic');
assert.match(storedProfile.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
node scripts/temp-voice-smoke.mjs
node scripts/state-restore-smoke.mjs
```

Expected: `temp-voice-smoke` fails because `normalizeTempVoiceState` and profile CRUD are not exported; the existing restore test remains green before its new assertions are added.

- [ ] **Step 3: Add config default, field and normalization**

Add this field after `channelNameTemplate` in the TempVoice feature card:

```js
{
  key: 'tempVoice.rememberUserProfiles',
  label: 'Persoenliche Einstellungen merken',
  type: 'checkbox',
  info: 'Merkt pro Mitglied und Server den letzten Kanalnamen, das Limit und die Region. Sperren und Mitgliederrechte werden nie uebernommen.'
}
```

Add `rememberUserProfiles: true` to the TempVoice defaults and normalize with:

```js
rememberUserProfiles: normalized.tempVoice?.rememberUserProfiles !== false,
```

Mirror the same boolean in `normalizeTempVoiceConfig`:

```js
rememberUserProfiles: conf?.rememberUserProfiles !== false,
```

- [ ] **Step 4: Replace ad-hoc state mutation with a serialized transaction**

In `src/features/tempVoice.js`, define the schema and normalization:

```js
const STATE_VERSION = 4;
const emptyState = () => ({ version: STATE_VERSION, channels: {}, profiles: {} });

const normalizeTempVoiceState = (raw = {}) => {
  const channels = raw?.channels && typeof raw.channels === 'object' && !Array.isArray(raw.channels)
    ? raw.channels
    : {};
  const profiles = {};
  for (const [guildId, guildProfiles] of Object.entries(raw?.profiles || {})) {
    if (!guildProfiles || typeof guildProfiles !== 'object' || Array.isArray(guildProfiles)) continue;
    for (const [userId, candidate] of Object.entries(guildProfiles)) {
      const profile = normalizeStoredProfile(candidate);
      if (profile) (profiles[String(guildId)] ||= {})[String(userId)] = profile;
    }
  }
  return { version: STATE_VERSION, channels, profiles };
};
```

Use a single mutation queue that clones, writes, then publishes the new state:

```js
let mutationQueue = Promise.resolve();
const mutateState = (mutator) => {
  const operation = mutationQueue.catch(() => null).then(async () => {
    const current = await ensureLoaded();
    const next = structuredClone(current);
    const result = await mutator(next);
    await atomicWriteJson(STATE_FILE, next, { spacing: 2 });
    state = next;
    return result;
  });
  mutationQueue = operation;
  return operation;
};
```

Make `ensureLoaded()` call `normalizeTempVoiceState(clean)`. Reimplement `setChannelEntry` and the four profile CRUD helpers through `mutateState`, so a failed disk write cannot publish a false in-memory success.

- [ ] **Step 5: Resolve profile values with explicit precedence**

Add:

```js
const resolveChannelSettings = (conf, member, profile = null) => ({
  name: safeName(profile?.customName || channelNameFor(conf, member)),
  userLimit: Number.isInteger(profile?.userLimit) ? profile.userLimit : conf.defaultUserLimit,
  rtcRegion: String(profile?.rtcRegion || conf.defaultRegion || 'automatic')
});
```

Only pass a profile when `conf.rememberUserProfiles === true`.

- [ ] **Step 6: Extend the restore test with a real version-3 profile migration**

Write the input file with `version: 3`, then after a state mutation assert:

```js
assert.equal(tvFile.version, 4, 'TempVoice-State wird auf Version 4 geschrieben');
assert.deepEqual(tvFile.profiles, {}, 'Migration legt einen leeren Profilbereich an');
assert.equal(tvFile.channels['123456789012345678'].ownerId, 'owner1');
```

- [ ] **Step 7: Run GREEN and inspect the persisted temp file**

Run:

```powershell
node scripts/temp-voice-smoke.mjs
node scripts/state-restore-smoke.mjs
```

Expected: both scripts exit `0`; the restore smoke confirms version 4, preserved channels and no `readJsonWithRecovery` wrapper fields.

- [ ] **Step 8: Commit the isolated task**

```powershell
git diff -- src/features/tempVoice.js src/defaultConfig.js scripts/temp-voice-smoke.mjs scripts/state-restore-smoke.mjs
git add -- src/features/tempVoice.js src/defaultConfig.js scripts/temp-voice-smoke.mjs scripts/state-restore-smoke.mjs
git diff --cached --name-only
git commit -m "feat: add persistent tempvoice profiles"
```

The staged-name check must list only the four paths above. If a path contains pre-existing unrelated hunks, leave the task uncommitted and record that fact instead of staging foreign work.

---

### Task 2: Profilbewusste Erstellung und Single-Flight

**Files:**
- Modify: `scripts/temp-voice-smoke.mjs:362-388`
- Modify: `src/features/tempVoice.js:353-425`
- Modify: `src/features/tempVoice.js:659-716`

**Interfaces:**
- Consumes: `getUserProfile`, `resolveChannelSettings`
- Produces: `runCreationSingleFlight(guildId, userId, task) -> Promise<unknown>`
- Changes: `createTempChannel({ guild, member, conf })` applies profile values

- [ ] **Step 1: Add failing profile-priority creation tests**

Build a fake guild whose `channels.create` captures the payload:

```js
const createPayloads = [];
const profileGuild = makeCreationGuild({
  create: async (payload) => {
    createPayloads.push(payload);
    return makeCreatedVoiceChannel('created-1', payload);
  }
});
await setUserProfile('profile-guild', 'profile-user', {
  customName: 'Night Lounge',
  userLimit: 7,
  rtcRegion: 'europe'
});
await createTempChannel({ guild: profileGuild, member: profileMember, conf: normalizeTempVoiceConfig({ enabled: true }) });
assert.equal(createPayloads[0].name, 'Night Lounge');
assert.equal(createPayloads[0].userLimit, 7);
assert.equal(createPayloads[0].rtcRegion, 'europe');
```

Repeat with `rememberUserProfiles: false` and assert template/default values.

- [ ] **Step 2: Add a failing parallel-event test**

Call `handleVoiceStateChange` twice before the fake `channels.create` promise resolves:

```js
const first = handleVoiceStateChange(context);
const second = handleVoiceStateChange(context);
releaseCreate();
await Promise.all([first, second]);
assert.equal(createCalls, 1, 'parallele Creator-Events erzeugen genau einen Kanal');
```

- [ ] **Step 3: Run RED**

Run `node scripts/temp-voice-smoke.mjs`.

Expected: profile values are ignored and `createCalls` is `2`.

- [ ] **Step 4: Apply resolved settings in `createTempChannel`**

Resolve settings before `guild.channels.create`:

```js
const profile = conf.rememberUserProfiles ? await getUserProfile(guild.id, member.id) : null;
const settings = resolveChannelSettings(conf, member, profile);
const channel = await guild.channels.create({
  name: settings.name,
  type: ChannelType.GuildVoice,
  parent: category?.id || null,
  userLimit: settings.userLimit,
  bitrate,
  rtcRegion: settings.rtcRegion === 'automatic' ? null : settings.rtcRegion,
  permissionOverwrites
});
```

Persist the active entry as before; do not copy profile fields into the active entry except values needed for live diagnostics.

- [ ] **Step 5: Serialize creator work per guild and member**

Add:

```js
const creationFlights = new Map();
const runCreationSingleFlight = (guildId, userId, task) => {
  const key = `${String(guildId)}:${String(userId)}`;
  if (creationFlights.has(key)) return creationFlights.get(key);
  const operation = Promise.resolve().then(task).finally(() => creationFlights.delete(key));
  creationFlights.set(key, operation);
  return operation;
};
```

Wrap the existing-channel recheck and `createTempChannel` call inside this function. Recheck ownership inside the flight, not only before it.

- [ ] **Step 6: Make partial creation failure explicit**

If moving the owner fails after creation, try to delete the new channel. Remove the channel-state entry only after that deletion succeeds. Send one DM explaining that creation failed. Preserve the entry if Discord refuses cleanup so startup diagnostics can still see it.

- [ ] **Step 7: Run GREEN**

Run `node scripts/temp-voice-smoke.mjs`.

Expected: profile priority, disabled-profile fallback and the one-create concurrency assertion all pass.

- [ ] **Step 8: Commit**

```powershell
git add -- src/features/tempVoice.js scripts/temp-voice-smoke.mjs
git diff --cached --name-only
git commit -m "fix: serialize tempvoice channel creation"
```

---

### Task 3: Zuverlaessige Einstellungen, Live-Status und Profil-Reset

**Files:**
- Modify: `scripts/temp-voice-smoke.mjs`
- Modify: `src/features/tempVoice.js:198-269`
- Modify: `src/features/tempVoice.js:427-553`
- Modify: `src/features/tempVoice.js:835-875`

**Interfaces:**
- Consumes: profile CRUD from Task 1
- Produces: `parseUserLimit(raw) -> { ok: true, value } | { ok: false, error }`
- Produces: `resetOwnerProfile({ interaction, channel, entry, conf })`
- Changes: `interfaceEmbed(entry, guild, conf, channel)` renders live state

- [ ] **Step 1: Add failing success/failure interaction tests**

Add modal fakes for rename and limit. For a rejected `channel.setName`, assert exactly one error reply and an unchanged profile:

```js
await handleAnyInteraction({ interaction: failingRename, cfg: baseCfg });
assert.equal(failingRename.replies.length, 1);
assert.match(failingRename.replies[0].content, /fehlgeschlagen/i);
assert.equal((await getUserProfile('guild-1', 'owner-1'))?.customName, previousName);
```

For a successful rename, assert the Discord call, stored name and one success reply. Add equivalent tests for limit and region.

- [ ] **Step 2: Add failing modal/default and parser tests**

```js
assert.deepEqual(parseUserLimit('7'), { ok: true, value: 7 });
assert.deepEqual(parseUserLimit('0'), { ok: true, value: 0 });
assert.equal(parseUserLimit('abc').ok, false);
assert.equal(parseUserLimit('100').ok, false);
const limitModal = await captureLimitModal({ userLimit: 6 });
assert.equal(limitModal.components[0].components[0].data.value, '6');
```

- [ ] **Step 3: Run RED**

Run `node scripts/temp-voice-smoke.mjs`.

Expected: the old handlers send false/double success and the limit modal still contains `0`.

- [ ] **Step 4: Make action phases exclusive**

Use this pattern for Rename, Limit and Region:

```js
let discordApplied = false;
try {
  await channel.setName(newName);
  discordApplied = true;
  if (conf.rememberUserProfiles) await setUserProfile(guild.id, entry.ownerId, { customName: newName });
  await refreshInterface(channel, conf);
  await interaction.reply({ content: `Kanal umbenannt in **${newName}**.`, flags: MessageFlags.Ephemeral });
} catch (error) {
  const content = discordApplied
    ? 'Der Name wurde geaendert, konnte aber nicht fuer den naechsten Kanal gespeichert werden.'
    : `Umbenennen fehlgeschlagen: ${String(error?.message || error).slice(0, 300)}`;
  await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => null);
}
```

Do not continue into a success path after a caught Discord error.

- [ ] **Step 5: Prefill and validate current settings**

Change `handleLimit(interaction)` to `handleLimit(interaction, channel)` and use `String(channel.userLimit || 0)`. Implement strict decimal validation with `/^\d{1,2}$/` and range `0..99`; invalid input receives one ephemeral validation message and does not call Discord.

Pass `channel` into `showRegionPicker`, set the matching option's `default: true`, and persist `automatic` while sending `null` to Discord.

- [ ] **Step 6: Render and refresh live status**

Call `interfaceEmbed(entry, voiceChannel.guild, conf, voiceChannel)` from send and refresh paths. Add a field whose value is generated from actual channel properties:

```js
const statusLines = [
  `**Name:** ${safeName(channel?.name || 'Kanal')}`,
  `**Limit:** ${channel?.userLimit ? channel.userLimit : 'Unbegrenzt'}`,
  `**Region:** ${regionLabel(channel?.rtcRegion || 'automatic')}`,
  `**Zugang:** ${isChannelLocked(channel) ? 'Gesperrt' : 'Offen'}`,
  `**Im Kanal:** ${Number(channel?.members?.size || 0)}`
];
```

Refresh after every successful mutable action, Claim and Transfer.

- [ ] **Step 7: Add a confirmed profile reset interaction**

Add a main button `fh_tv:profile-reset`, then an ephemeral confirmation row with `fh_tv:profile-reset:confirm` and `fh_tv:profile-reset:cancel`. On confirm:

1. derive the template name and global limit/region,
2. apply each live value and collect any failure messages,
3. delete only the current owner's profile,
4. refresh the interface,
5. send one summary response.

No access overwrite, lock state or owner field is changed.

- [ ] **Step 8: Run GREEN**

Run `node scripts/temp-voice-smoke.mjs`.

Expected: all action paths send exactly one response, profiles update only after Discord success, current values appear in modals/embed and reset removes only the owner profile.

- [ ] **Step 9: Commit**

```powershell
git add -- src/features/tempVoice.js scripts/temp-voice-smoke.mjs
git diff --cached --name-only
git commit -m "feat: restore tempvoice settings safely"
```

---

### Task 4: Vollstaendig editierbares TempVoice-Embed Studio

**Files:**
- Create: `scripts/temp-voice-embed-smoke.mjs`
- Modify: `src/features/tempVoice.js`
- Modify: `src/defaultConfig.js`
- Modify: `src/index.js`
- Modify: `src/dashboard.js`
- Modify: `desktop/renderer/app.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `defaultTempVoiceInterfaceDesign() -> InterfaceDesign`
- Produces: `normalizeTempVoiceInterfaceDesign(value) -> InterfaceDesign`
- Produces: `formatTempVoiceInterfaceText(value, context, maxLength) -> string`
- Produces: `buildTempVoiceInterfacePayload(voiceChannel, entry, conf) -> Promise<MessagePayload>`
- Produces: `saveTempVoiceInterfaceDesign({ guild, conf, template }) -> Promise<{ design }>`
- Produces: `refreshTempVoiceInterfaces(guild, conf) -> Promise<{ updated, failed, errors }>`
- Dashboard option: `saveTempVoiceInterfaceDesign(guildId, payload)`

- [ ] **Step 1: Create failing backend design and placeholder tests**

Create `scripts/temp-voice-embed-smoke.mjs` with a temporary data directory. Import the new TempVoice internals and assert that arbitrary user text and fields survive normalization:

```js
const design = normalizeTempVoiceInterfaceDesign({
  content: 'Eigener Text fuer {owner}',
  embed: {
    title: '{channelName}',
    description: 'Alles hier ist frei editierbar.',
    color: '#15121f',
    fields: [{ name: 'Status', value: '{accessState} · {memberCount}', inline: true }],
    footerText: '{server}',
    timestamp: false
  }
});
assert.equal(design.content, 'Eigener Text fuer {owner}');
assert.equal(design.embed.description, 'Alles hier ist frei editierbar.');
assert.deepEqual(design.embed.fields[0], { name: 'Status', value: '{accessState} · {memberCount}', inline: true });
```

Build a context and verify all exact placeholders:

```js
const source = '{owner}|{ownerName}|{channelName}|{createdAt}|{userLimit}|{region}|{accessState}|{memberCount}|{server}';
assert.equal(
  formatTempVoiceInterfaceText(source, placeholderContext, 2000),
  '<@u1>|Owner|Night Lounge|<t:1787572800:R>|6|Europa|Gesperrt|3|FALLEN HEAVEN'
);
assert.ok(!defaultTempVoiceInterfaceDesign().embed.description.includes('{tempVoiceBlock}'));
```

- [ ] **Step 2: Add failing payload/component and multi-refresh tests**

Build a fake active voice channel and assert:

```js
const payload = await buildTempVoiceInterfacePayload(channel, entry, conf);
assert.equal(payload.embeds[0].data.title, 'Night Lounge');
assert.deepEqual(
  payload.components.flatMap((row) => row.components.map((component) => component.data.custom_id)),
  interfaceRows(conf, entry).flatMap((row) => row.components.map((component) => component.data.custom_id))
);
assert.equal('componentSet' in conf.interfaceDesign, false, 'Studio-Komponenten werden nicht gespeichert');
```

Seed three active channel entries, make one message edit reject, call `refreshTempVoiceInterfaces`, and expect `{ updated: 2, failed: 1 }` while all three channels were attempted.

- [ ] **Step 3: Run RED**

Run:

```powershell
node scripts/temp-voice-embed-smoke.mjs
```

Expected: the design normalizer, formatter, payload builder and refresh export do not exist.

- [ ] **Step 4: Add the default design and strict normalizer**

Define a single editable default design in `src/features/tempVoice.js`:

```js
const defaultTempVoiceInterfaceDesign = () => ({
  content: '',
  outsideImageUrl: '',
  outsideImageAttachment: null,
  embed: {
    title: 'TempVoice · {channelName}',
    url: '',
    description: 'Willkommen {owner}. Du verwaltest diesen temporaeren Sprachkanal mit den Buttons unter dem Embed.',
    color: '#2b2d31',
    authorName: '{server}',
    authorIconUrl: '',
    thumbnailUrl: '',
    imageUrl: '',
    footerText: '{server}',
    footerIconUrl: '',
    timestamp: false,
    fields: [
      { name: 'Besitzer', value: '{owner}', inline: true },
      { name: 'Zugang', value: '{accessState}', inline: true },
      { name: 'Mitglieder', value: '{memberCount} / {userLimit}', inline: true },
      { name: 'Region', value: '{region}', inline: true },
      { name: 'Erstellt', value: '{createdAt}', inline: true }
    ]
  }
});
```

Normalize Discord lengths, color, URLs, up to 25 fields and outside-image metadata. Explicitly discard `components`, `componentSet`, `reactionRoles` and unknown top-level transport fields.

Add `interfaceDesign` to TempVoice defaults and preserve it through `normalizeConfig`; the feature-level `normalizeTempVoiceConfig` calls `normalizeTempVoiceInterfaceDesign`.

- [ ] **Step 5: Replace hardcoded embed construction with atomic placeholders**

Build a context from the live channel and active entry. Replace only these keys:

```js
const TEMP_VOICE_PLACEHOLDERS = Object.freeze([
  'owner', 'ownerName', 'channelName', 'createdAt', 'userLimit',
  'region', 'accessState', 'memberCount', 'server'
]);
```

Apply replacements independently to content, title, description, author name, footer text and every field name/value. Do not synthesize a function/status package block. Empty user-authored fields remain omitted according to Discord limits; normal text is never overwritten.

Use rich values in Content, description and field values (`{owner}` as `<@id>`, `{createdAt}` as `<t:epoch:R>`). Use plain values in author, footer and field names (`{owner}` as owner name, `{createdAt}` as localized date), because Discord does not render mentions or relative timestamps in those positions. The Studio preview must use the same rich/plain distinction.

- [ ] **Step 6: Build one payload with real module components**

Change `sendInterface` and `refreshInterface` to await `buildTempVoiceInterfacePayload`. The payload always obtains components from:

```js
components: interfaceRows(conf, entry)
```

Never read components from `interfaceDesign`. Resolve a local/Data-URL outside image with the existing `resolveOutsideImageFile` and local-image store; image failure logs quietly and still sends the embed plus functional buttons.

- [ ] **Step 7: Save design and refresh every active interface**

`saveTempVoiceInterfaceDesign` accepts exactly one embed, preserves the image state and returns the normalized design. `refreshTempVoiceInterfaces` reads all active entries for the guild, resolves channels from cache, and refreshes in batches of three with `Promise.allSettled`. It returns bounded error messages without rejecting the successful design save.

- [ ] **Step 8: Wire the central pipeline and authenticated route**

Import the save/refresh functions in `src/index.js`. Add a `persistEmbedDesign` option named `saveTempVoiceInterfaceDesign` whose save phase returns:

```js
{
  patch: { tempVoice: { ...cfg.tempVoice, interfaceDesign: result.design } },
  result: { design: result.design }
}
```

Its refresh phase calls `refreshTempVoiceInterfaces(guild, saved.tempVoice)` and includes the refresh counters in the response. Add this exact route in `src/dashboard.js`:

```js
app.put('/api/guild/:guildId/temp-voice/design', requireAuth, requireGuildAccess, async (req, res) => {
  if (typeof saveTempVoiceInterfaceDesign !== 'function') return res.status(501).json({ error: 'Der TempVoice-Embed-Editor ist nicht konfiguriert.' });
  try {
    const result = await saveTempVoiceInterfaceDesign(req.dashboardGuildId, req.body || {});
    return res.json({ ok: true, result });
  } catch (error) {
    return res.status(400).json({ error: error?.message || 'Das TempVoice-Embed konnte nicht gespeichert werden.' });
  }
});
```

- [ ] **Step 9: Add the real TempVoice special mode to the existing Studio**

In `desktop/renderer/app.js` add `tempVoiceInterface` to the accepted `studioSpecialTemplate` list, preview router, special-mode title/detail, save dispatch, toolbar save dispatch and config-reload dispatch.

Implement:

```js
function tempVoiceStudioTemplate(config) {
  const design = config?.interfaceDesign || {};
  return {
    specialTemplate: 'tempVoiceInterface',
    channelId: '',
    content: String(design.content || ''),
    outsideImageUrl: String(design.outsideImageUrl || ''),
    outsideImageAttachment: design.outsideImageAttachment || null,
    embeds: [clone(design.embed || defaultTempVoiceStudioEmbed())],
    componentSet: 'none',
    reactionRoles: []
  };
}
```

The preview replaces all nine placeholders with visible sample values. In special UI rendering, hide the label containing `#studio-channel`, disable component/reaction-role controls, and restore them when leaving this mode.

Add `TempVoice-Embed bearbeiten` to `tempVoiceOverview`, `openTempVoiceStudio()`, and `saveTempVoiceStudioTemplate()` using `PUT /api/guild/<guildId>/temp-voice/design`. Saving exactly one embed is mandatory; on success reload `state.config.tempVoice` and the normalized studio template.

- [ ] **Step 10: Add renderer contract assertions**

Extend `scripts/temp-voice-embed-smoke.mjs` to read `desktop/renderer/app.js`, `src/index.js` and `src/dashboard.js`, asserting the special-template registration, preview function, save route, central `persistEmbedDesign` use and the absence of `{tempVoiceBlock}`.

Register the smoke after `temp-voice-smoke.mjs` in `test:community`.

- [ ] **Step 11: Run GREEN**

```powershell
node scripts/temp-voice-embed-smoke.mjs
node scripts/temp-voice-smoke.mjs
node scripts/verify-bot-imports.mjs
```

Expected: arbitrary text survives, all placeholders render, active refresh is partial-failure tolerant, Studio wiring exists and every payload contains the real TempVoice custom IDs.

- [ ] **Step 12: Commit**

```powershell
git add -- src/features/tempVoice.js src/defaultConfig.js src/index.js src/dashboard.js desktop/renderer/app.js scripts/temp-voice-embed-smoke.mjs package.json
git diff --cached --name-only
git commit -m "feat: make tempvoice interface fully editable"
```

---

### Task 5: Funktionale Zugangsverwaltung mit Permission-Baselines

**Files:**
- Modify: `scripts/temp-voice-smoke.mjs:276-360`
- Modify: `src/features/tempVoice.js:207-243`
- Modify: `src/features/tempVoice.js:555-631`
- Modify: `src/features/tempVoice.js:744-833`
- Modify: `src/features/tempVoice.js:908-953`

**Interfaces:**
- Produces: `permissionTriState(overwrite, permission) -> true|false|null`
- Produces: `captureAccessBaseline(channel, entry, userId) -> Promise<Entry>`
- Produces: `applyAccessMode({ channel, entry, userId, mode }) -> Promise<{ entry, message }>`
- Produces: `captureLockBaseline(channel, entry) -> Promise<Entry>`
- Modes: exact strings `allow`, `revoke`, `block`, `unblock`

- [ ] **Step 1: Add failing locked-channel allow/revoke tests**

Use a fake channel with `@everyone -> Connect:false`. Assert:

```js
const allowed = await applyAccessMode({ channel, entry, userId: 'guest-1', mode: 'allow' });
assert.deepEqual(permissionEdits.at(-1), {
  id: 'guest-1',
  data: { ViewChannel: true, Connect: true }
});
assert.equal(allowed.entry.accessBaselines['guest-1'].connect, null);

await applyAccessMode({ channel, entry: allowed.entry, userId: 'guest-1', mode: 'revoke' });
assert.deepEqual(permissionEdits.at(-1).data, { ViewChannel: null, Connect: null });
```

Also test an existing member overwrite with `ViewChannel:true, Connect:false`; revoke/unblock must restore those exact tri-state values.

Add lock/open cases for an original `@everyone.Connect` value of `true`, `false` and `null`. Opening must restore the exact original tri-state instead of always applying `null`.

- [ ] **Step 2: Run RED**

Run `node scripts/temp-voice-smoke.mjs`.

Expected: no access-mode functions exist and current unblock cannot grant entry through a locked `@everyone` overwrite.

- [ ] **Step 3: Capture a baseline once per active channel and member**

Store only tri-state permission values in the active channel entry:

```js
accessBaselines: {
  [userId]: {
    viewChannel: permissionTriState(overwrite, PermissionFlagsBits.ViewChannel),
    connect: permissionTriState(overwrite, PermissionFlagsBits.Connect)
  }
}
```

Persist this entry before the first access edit. Never copy `accessBaselines` into `profiles`.

Capture `lockBaseline.connect` once before the first lock operation. This active-channel-only baseline is restored by Open; a private category whose original `@everyone.Connect` is `false` must therefore remain private.

- [ ] **Step 4: Implement all four access modes**

Apply exact payloads:

```js
const accessPayloads = {
  allow: { ViewChannel: true, Connect: true },
  block: { Connect: false }
};
```

For `revoke` and `unblock`, restore the captured tri-state values. `block` disconnects an affected member after the permission edit. `unblock` reports whether the channel remains generally locked and must not promise entry when no explicit allow exists.

- [ ] **Step 5: Replace two main buttons with one access menu**

Keep the old `fh_tv:block:*` and `fh_tv:unblock:*` handlers as compatibility aliases. The refreshed main interface uses one `fh_tv:access` button. It opens a string select with the four modes, followed by a `UserSelectMenuBuilder` whose custom ID is `fh_tv:access:<mode>:pick`.

Bind every picker custom ID to the originating channel ID. On submit, resolve that exact channel and require a tracked entry from the same guild plus the expected owner. Switching calls between opening and submitting a picker must never mutate the newly joined channel. Use an explicit member overwrite type for raw user IDs that are not cached.

The full main interface remains at most two rows of five buttons by combining Access and Profile Reset with the existing setting, owner and delete actions.

- [ ] **Step 6: Refresh status after access and lock actions**

After `allow`, `revoke`, `block`, `unblock`, `lock` and `open`, call `refreshInterface(channel, conf)`. Preserve owner `ViewChannel:true` and `Connect:true` while locked.

- [ ] **Step 7: Run GREEN**

Run `node scripts/temp-voice-smoke.mjs`.

Expected: allow works through an everyone deny; revoke and unblock restore exact baselines; block still kicks; compatibility IDs still pass.

- [ ] **Step 8: Commit**

```powershell
git add -- src/features/tempVoice.js scripts/temp-voice-smoke.mjs
git diff --cached --name-only
git commit -m "feat: add safe tempvoice access controls"
```

---

### Task 6: Besitz und Cleanup ohne verwaiste Kanaele

**Files:**
- Modify: `scripts/temp-voice-smoke.mjs`
- Modify: `src/features/tempVoice.js:450-488`
- Modify: `src/features/tempVoice.js:633-657`
- Modify: `src/features/tempVoice.js:793-813`
- Modify: `src/features/tempVoice.js:954-1007`

**Interfaces:**
- Consumes: profile CRUD and access baseline helpers
- Produces: `deleteTrackedChannel(channel, reason) -> Promise<{ deleted: boolean, error?: string }>`
- Produces: `transferOwnership({ channel, entry, nextOwner }) -> Promise<Entry>`
- Produces: `runChannelOperation(guildId, channelId, task) -> Promise<unknown>`

- [ ] **Step 1: Add failing deletion-state tests**

Create one fake channel whose `delete()` rejects and one that resolves:

```js
await setChannelEntry('delete-fails', entry);
const failed = await deleteTrackedChannel(failingChannel, 'test');
assert.equal(failed.deleted, false);
assert.ok(await findOwnedChannel('g1', 'delete-fails'), 'State bleibt bei Discord-Fehler erhalten');

await setChannelEntry('delete-ok', entry);
const removed = await deleteTrackedChannel(successChannel, 'test');
assert.equal(removed.deleted, true);
assert.equal(await findOwnedChannel('g1', 'delete-ok'), null);
```

- [ ] **Step 2: Add failing Claim/Transfer profile-isolation tests**

Seed different profiles for old and new owner, transfer the active channel, and assert both profiles remain byte-for-byte equal. Also assert the new owner receives explicit `ViewChannel:true, Connect:true` permissions.

Capture the old owner's original `ViewChannel`/`Connect` baseline at channel creation. Transfer and Claim must restore that baseline after the new owner has been authorized. Add parallel Claim/Transfer tests proving that exactly one revalidated channel operation wins.

- [ ] **Step 3: Run RED**

Run `node scripts/temp-voice-smoke.mjs`.

Expected: deletion failure still removes state, and ownership changes do not guarantee new-owner access.

- [ ] **Step 4: Centralize tracked deletion**

Implement `deleteTrackedChannel` so `setChannelEntry(channel.id, null)` happens only after `channel.delete(reason)` resolves or Discord explicitly returns Unknown Channel (`10003`). A cache miss alone is not proof of deletion. Return permission and network errors without pretending success. Use this helper from scheduled cleanup, manual delete and partial-creation cleanup. Add an external `onChannelDelete` cleanup hook.

Serialize cleanup, manual deletion, Claim and Transfer per `guildId:channelId`. Recheck immediately before deletion that the channel is still empty; a rejoin during asynchronous cleanup cancels deletion. Do not remove the interface message or timer state before Discord channel deletion is confirmed.

- [ ] **Step 5: Centralize owner transfer**

`transferOwnership` must:

1. edit the new owner to `{ ViewChannel: true, Connect: true }`,
2. restore the old owner's captured pre-owner permission baseline,
3. revalidate the current owner inside the serialized channel operation,
4. update only active `ownerId` and `ownerName`,
5. preserve both users' profiles,
6. refresh the interface after persistence.

Claim and explicit transfer both call this helper. They do not write name, limit or region profiles.

- [ ] **Step 6: Run GREEN and state restore**

```powershell
node scripts/temp-voice-smoke.mjs
node scripts/state-restore-smoke.mjs
```

Expected: deletion errors preserve tracking, successful deletes clear it, transfer access is valid and profiles are isolated.

- [ ] **Step 7: Commit**

```powershell
git add -- src/features/tempVoice.js scripts/temp-voice-smoke.mjs scripts/state-restore-smoke.mjs
git diff --cached --name-only
git commit -m "fix: keep tempvoice ownership and cleanup consistent"
```

---

### Task 7: Snapshot und authentifizierte Profil-Reset-API

**Files:**
- Create: `scripts/temp-voice-dashboard-smoke.mjs`
- Modify: `src/features/tempVoice.js:1068-1109`
- Modify: `src/index.js:113`
- Modify: `src/index.js:4891-4906`
- Modify: `src/dashboard.js:461-510`
- Modify: `src/dashboard.js:1245-1255`
- Modify: `package.json:90-110`

**Interfaces:**
- Produces: `getTempVoiceSnapshot(guildId, guild) -> Promise<TempVoiceSnapshot>`
- Produces: `removeTempVoiceProfile(guildId, userId) -> Promise<{ ok, removed }>`
- Produces: `removeAllTempVoiceProfiles(guildId) -> Promise<{ ok, removedCount }>`
- Dashboard options: `removeTempVoiceProfile`, `removeAllTempVoiceProfiles`

- [ ] **Step 1: Create a failing dashboard smoke**

The script imports TempVoice internals, seeds two active entries and two profiles, supplies a fake guild cache, then asserts the snapshot contract:

```js
assert.equal(snapshot.activeChannelCount, 2);
assert.equal(snapshot.profileCount, 2);
assert.deepEqual(snapshot.channels[0], {
  channelId: 'voice-1',
  ownerId: 'u1',
  ownerName: 'User One',
  name: 'Night Lounge',
  memberCount: 3,
  userLimit: 6,
  rtcRegion: 'europe',
  locked: true,
  createdAt: '2026-08-24T12:00:00.000Z'
});
assert.equal(snapshot.profiles[0].userId, 'u1');
```

Read `src/dashboard.js` as text and assert both exact DELETE paths include `requireAuth, requireGuildAccess`.

- [ ] **Step 2: Run RED**

Run `node scripts/temp-voice-dashboard-smoke.mjs`.

Expected: snapshot lacks profile/live fields and DELETE routes do not exist.

- [ ] **Step 3: Enrich the snapshot from cache only**

Change signature to `getTempVoiceSnapshot(guildId, guild = null)`. Resolve channel/member names, avatar, member count, limit, region and lock from `guild.channels.cache` and `guild.members.cache`; do not call `fetch()`.

Sort profiles descending by `updatedAt`, return at most 100 profile rows, and keep exact `profileCount` for the whole guild.

- [ ] **Step 4: Export reset handlers through index**

Import the two reset functions and wire:

```js
getTempVoiceStatus: async (guildId) => {
  const guild = client.guilds.cache.get(String(guildId || '')) || null;
  return getTempVoiceSnapshot(guildId, guild);
},
removeTempVoiceProfile: async (guildId, userId) => removeTempVoiceProfile(guildId, userId),
removeAllTempVoiceProfiles: async (guildId) => removeAllTempVoiceProfiles(guildId),
```

Alias imports if necessary to avoid option-name shadowing.

- [ ] **Step 5: Add authenticated routes**

Destructure both handlers in `mountDashboard` and add:

```js
app.delete('/api/guild/:guildId/temp-voice/profiles/:userId', requireAuth, requireGuildAccess, async (req, res) => {
  if (typeof removeTempVoiceProfile !== 'function') return res.status(501).json({ error: 'TempVoice-Profile sind nicht konfiguriert.' });
  try {
    const result = await removeTempVoiceProfile(req.dashboardGuildId, String(req.params.userId || ''));
    return res.json({ ok: true, result });
  } catch (error) {
    return res.status(400).json({ error: error?.message || 'TempVoice-Profil konnte nicht zurueckgesetzt werden.' });
  }
});

app.delete('/api/guild/:guildId/temp-voice/profiles', requireAuth, requireGuildAccess, async (req, res) => {
  if (typeof removeAllTempVoiceProfiles !== 'function') return res.status(501).json({ error: 'TempVoice-Profile sind nicht konfiguriert.' });
  try {
    const result = await removeAllTempVoiceProfiles(req.dashboardGuildId);
    return res.json({ ok: true, result });
  } catch (error) {
    return res.status(400).json({ error: error?.message || 'TempVoice-Profile konnten nicht zurueckgesetzt werden.' });
  }
});
```

Register `node scripts/temp-voice-dashboard-smoke.mjs` directly after `temp-voice-smoke.mjs` in `test:community`.

- [ ] **Step 6: Run GREEN and import verification**

```powershell
node scripts/temp-voice-dashboard-smoke.mjs
node scripts/verify-bot-imports.mjs
```

Expected: snapshot/reset assertions pass and all index/dashboard imports resolve.

- [ ] **Step 7: Commit**

```powershell
git add -- src/features/tempVoice.js src/index.js src/dashboard.js scripts/temp-voice-dashboard-smoke.mjs package.json
git diff --cached --name-only
git commit -m "feat: expose tempvoice profiles in dashboard"
```

---

### Task 8: App-Live-Ansicht und sichere Reset-Bedienung

**Files:**
- Create: `scripts/temp-voice-ui-smoke.mjs`
- Modify: `desktop/renderer/app.js:2690-2753`
- Modify: `desktop/renderer/app.js:5498-5502`
- Modify: `desktop/renderer/ui-base.css:494-773`
- Modify: `package.json:90-110`

**Interfaces:**
- Consumes: snapshot and DELETE routes from Task 7
- Produces: `renderTempVoiceStatus(status)` renders summary, active channels and profiles
- Produces: `resetTempVoiceProfile(userId)` and `resetAllTempVoiceProfiles()`

- [ ] **Step 1: Create failing static UI contract tests**

`scripts/temp-voice-ui-smoke.mjs` reads renderer source and CSS, then asserts:

```js
assert.match(appSource, /data-temp-voice-profiles/);
assert.match(appSource, /data-temp-voice-channels/);
assert.match(appSource, /data-temp-voice-reset-profile/);
assert.match(appSource, /data-temp-voice-reset-all/);
assert.match(appSource, /showAppConfirm\(/);
assert.match(appSource, /escapeHtml\(profile\.customName/);
assert.match(cssSource, /\.temp-voice-list/);
assert.match(cssSource, /@media \(max-width: 720px\)/);
```

Also assert both reset paths use `method: 'DELETE'` and call `refreshTempVoiceStatus()` after success.

- [ ] **Step 2: Run RED**

Run `node scripts/temp-voice-ui-smoke.mjs`.

Expected: list containers and reset actions are absent.

- [ ] **Step 3: Extend the overview markup**

Add a profile summary tile and two unframed list sections inside the existing TempVoice panel:

```html
<div class="temp-voice-lists">
  <section>
    <header><span><small>AKTIVE KANAELE</small><strong>Live-Zustand</strong></span></header>
    <div class="temp-voice-list" data-temp-voice-channels></div>
  </section>
  <section>
    <header><span><small>PROFILE</small><strong>Gemerktes Setup</strong></span><button type="button" data-temp-voice-reset-all>Alle zuruecksetzen</button></header>
    <div class="temp-voice-list" data-temp-voice-profiles></div>
  </section>
</div>
```

Use the existing panel, not nested cards. Each repeated row may be framed.

- [ ] **Step 4: Render escaped live rows**

For every channel show escaped name/owner and compact metadata for members, limit, region and lock. For every profile show escaped member/name, limit, region, updated time and an icon button with `title`, `aria-label` and `data-temp-voice-reset-profile="USER_ID"`.

All snapshot strings pass through `escapeHtml` or `escapeAttr`; no API string is interpolated raw.

- [ ] **Step 5: Implement confirmation and DELETE flows**

Use `showAppConfirm` with specific copy. Single reset:

```js
const accepted = await showAppConfirm({
  tone: 'warning',
  eyebrow: 'TEMPVOICE · PROFIL',
  title: 'Persoenliches Setup zuruecksetzen?',
  message: 'Beim naechsten Kanal gelten wieder Name, Limit und Region aus den Modul-Standards.',
  confirmLabel: 'Profil zuruecksetzen'
});
```

After acceptance, call the encoded single-profile DELETE route. The all-profile action uses the collection DELETE route, reports `removedCount`, and has a stronger confirmation message. Disable the clicked button while awaiting the API.

- [ ] **Step 6: Add focused responsive CSS**

Use a two-column `temp-voice-lists` grid, stable row tracks, ellipsis for long names and a one-column mobile breakpoint. Buttons must have fixed minimum dimensions; text must wrap or truncate without overlapping metadata.

Do not add gradients, decorative orbs, new global color tokens or another panel-inside-panel visual language.

- [ ] **Step 7: Wire event delegation**

Before the generic TempVoice refresh branch, detect `[data-temp-voice-reset-profile]` and `[data-temp-voice-reset-all]`, call the matching function and return.

- [ ] **Step 8: Run UI GREEN and visual audit**

```powershell
node scripts/temp-voice-ui-smoke.mjs
python scripts/ui-visual-audit.py
```

Expected: static contract passes; visual audit reports no TempVoice overflow/overlap regression. Capture desktop and mobile screenshots through the existing local app/browser harness and inspect long names, empty lists and 100-profile scrolling.

- [ ] **Step 9: Commit**

```powershell
git add -- desktop/renderer/app.js desktop/renderer/ui-base.css scripts/temp-voice-ui-smoke.mjs package.json
git diff --cached --name-only
git commit -m "feat: add tempvoice profile management ui"
```

---

### Task 9: Breite Regression, Projektwissen und Release 3.9.290

**Files:**
- Modify: `PROJEKT-WISSEN.md`
- Modify: `bot-changelog.json`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `desktop/renderer/app.js`
- Modify: `desktop/renderer/index.html`
- Generated: `dist/FHCC-Setup-3.9.290-x64.exe`
- Generated: `dist/latest.yml`

**Interfaces:**
- Consumes: all completed TempVoice tasks
- Produces: verified installer and SHA-256 release record

- [ ] **Step 1: Run all TempVoice and community regressions before versioning**

```powershell
node scripts/temp-voice-smoke.mjs
node scripts/temp-voice-embed-smoke.mjs
node scripts/state-restore-smoke.mjs
node scripts/temp-voice-dashboard-smoke.mjs
node scripts/temp-voice-ui-smoke.mjs
npm run test:community
```

Expected: every command exits `0`. Fix failures at their root before continuing.

- [ ] **Step 2: Add the exact project-knowledge section**

Document in `PROJEKT-WISSEN.md`:

- root cause: version-3 state contained only active `channels`, while Rename changed Discord only;
- editierbares `tempVoice.interfaceDesign`, neun atomare Platzhalter und bewusst kein Paket-Platzhalter;
- echte Modul-Komponenten bleiben vom Studio-Design getrennt und werden bei jedem Payload neu gebaut;
- version-4 shape and migration;
- precedence `profile -> module default`;
- exact non-persisted security fields;
- Claim/Transfer profile isolation;
- access baselines and locked-channel allow behavior;
- cleanup only after confirmed Discord deletion;
- API routes and app reset behavior;
- all executed commands and outcomes.

- [ ] **Step 3: Bump exactly once from 3.9.289 to 3.9.290**

Run:

```powershell
node scripts/bump-version.cjs
node -p "require('./package.json').version"
```

Expected output ends with `3.9.290`. Do not run the bump script a second time.

- [ ] **Step 4: Add the release changelog entry**

Ensure `bot-changelog.json` has version `3.9.290`, date `2026-08-24`, and concrete changes covering remembered profile values, fresh access rights, fixed locked-call allow, truthful action feedback, live App/Discord status, single-flight creation and orphan-safe cleanup.

- [ ] **Step 5: Run the full release gate**

```powershell
npm run test:release
```

Expected: all auth, economy, security, backup, role, community, intelligence, design and quality suites exit `0`.

- [ ] **Step 6: Build and validate the Windows installer**

```powershell
npm run build:win
Get-FileHash -Algorithm SHA256 -LiteralPath 'dist\FHCC-Setup-3.9.290-x64.exe'
Get-Item -LiteralPath 'dist\FHCC-Setup-3.9.290-x64.exe' | Select-Object FullName,Length,LastWriteTime
```

Expected: installer exists, package/artifact audits pass, `latest.yml` targets 3.9.290, and a SHA-256 hash is printed.

- [ ] **Step 7: Append release evidence to project knowledge**

Record installer path, byte size, SHA-256, release-gate result and build result in `PROJEKT-WISSEN.md`. Do not claim release success unless every command from Steps 5 and 6 completed successfully.

- [ ] **Step 8: Commit only owned release changes when isolation is possible**

```powershell
git diff -- PROJEKT-WISSEN.md bot-changelog.json package.json package-lock.json desktop/renderer/app.js desktop/renderer/index.html
git add -- PROJEKT-WISSEN.md bot-changelog.json package.json package-lock.json desktop/renderer/app.js desktop/renderer/index.html
git diff --cached --name-only
git commit -m "release: ship tempvoice profiles in 3.9.290"
```

If any listed tracked file still contains inseparable pre-existing user changes, do not create a misleading release commit. Leave the verified working tree intact and report the exact reason.

## Self-Review Result

- Spec coverage: all profile, migration, creation, editable Embed Studio, Discord UI, access, transfer, cleanup, API, App UI, documentation and release requirements map to Tasks 1-9.
- Placeholder scan: no unresolved marker, deferred implementation instruction or unnamed helper remains.
- Interface consistency: profile CRUD names, access modes, snapshot signature and dashboard handler names are identical in producing and consuming tasks.
- Scope: no independent subsystem was split out because Discord behavior, persistence and App management share one state contract and must ship together to be testable.
