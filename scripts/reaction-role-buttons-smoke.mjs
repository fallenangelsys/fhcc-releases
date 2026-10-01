import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const indexSource = readFileSync('src/index.js', 'utf8');
const dashboardSource = readFileSync('src/dashboard.js', 'utf8');
const rendererSource = readFileSync('desktop/renderer/app.js', 'utf8');
const managementSource = readFileSync('desktop/renderer/server-management.js', 'utf8');
const studioComponentsSource = readFileSync('desktop/renderer/studio-components.js', 'utf8');
const studioHtml = readFileSync('desktop/renderer/index.html', 'utf8');
const reactionRolesSource = readFileSync('src/dashboard/reactionRoles.js', 'utf8');

function loadRoleButtonImportHelpers() {
  const start = managementSource.indexOf('const normalizeRoleButtonText =');
  const end = managementSource.indexOf('const renderMessageComponents =');
  assert.ok(start >= 0 && end > start, 'Role-button import helpers must remain testable as one pure block.');
  const helperSource = managementSource.slice(start, end);
  const createHelpers = new Function('currentManagement', 'state', 'window', `${helperSource}\nreturn { resolveRoleButtonRoleId, extractRoleButtonsFromMessage, importedStudioComponents };`);
  const roles = [
    { id: '111111111111111111', name: 'boost orange' },
    { id: '222222222222222222', name: 'VIP' }
  ];
  return createHelpers({ roles }, { moduleRoles: roles }, { state: { moduleRoles: roles } });
}

const roleButtonHelpers = loadRoleButtonImportHelpers();
const legacyBoostButton = { type: 2, style: 2, customId: 'legacy_boost_orange', label: 'boost orange' };
assert.equal(roleButtonHelpers.resolveRoleButtonRoleId(legacyBoostButton), '111111111111111111', 'Exact legacy boost labels must still resolve to their role.');
assert.equal(roleButtonHelpers.resolveRoleButtonRoleId({ type: 2, style: 5, url: 'https://example.com/vip', label: 'VIP' }), '', 'Link buttons must never be converted into role buttons.');
assert.equal(roleButtonHelpers.resolveRoleButtonRoleId({ type: 2, style: 1, customId: 'open_vip_shop', label: 'VIP-Shop' }), '', 'Ordinary function buttons with only a similar role label must remain functional components.');
const mixedRows = [{ type: 1, components: [
  legacyBoostButton,
  { type: 2, style: 5, url: 'https://example.com/vip', label: 'VIP' },
  { type: 3, customId: 'choose_vip', placeholder: 'VIP auswählen', options: [{ label: 'VIP', value: 'vip' }] }
] }];
const importedRows = roleButtonHelpers.importedStudioComponents({ components: mixedRows });
assert.deepEqual(importedRows[0].components.map((component) => component.type), [2, 3], 'Only the confirmed role button may be removed from mixed imported components.');

assert.match(reactionRolesSource, /export const buildReactionRoleButtonRows = /, 'Backend must build real role-button rows for studio role entries.');
assert.match(reactionRolesSource, /setCustomId\(rule\.componentId\)/, 'Role buttons must use the fh_rr component id handled by the interaction module.');
assert.match(indexSource, /await message\.edit\(\{ components: preservedRows\.concat\(buttonRows\) \}\)/, 'Saving studio role entries must attach functional buttons to the Discord message.');
assert.doesNotMatch(indexSource, /await message\.react\(rule\.emojiId \|\| rule\.emojiName\);/, 'Studio role entries must no longer be sent as native reactions.');

assert.match(managementSource, /componentReactionRoles/, 'Copying a Discord message must inspect existing message components.');
assert.match(managementSource, /customId\.match\(\/*\^fh_rr:/, 'Copying must recognize fh_rr role-button custom IDs.');
assert.match(managementSource, /componentReactionRoles\.length \? componentReactionRoles :/, 'Functional copied buttons must take precedence over reaction fallback.');
assert.match(managementSource, /extractRoleButtonsFromMessage/, 'Server management should use one shared extractor for copied fh_rr buttons.');
assert.match(managementSource, /data-copy-embed[\s\S]*reactionRoles: extractRoleButtonsFromMessage\(message\)/, 'Opening a single embed in Studio must keep functional role buttons.');
assert.match(managementSource, /resolveRoleButtonRoleId/, 'Copied Discord buttons must resolve roles beyond the fh_rr Studio format.');
assert.match(managementSource, /customId\.match\([^)]*\\d\{17,20\}/, 'Copied buttons must recover role IDs embedded in custom IDs from older modules.');
assert.match(managementSource, /findRoleByButtonLabel/, 'Copied boost/color buttons must map their label, e.g. "boost orange", back to a Discord role.');
assert.match(managementSource, /component\.label/, 'Copied button labels must be used as a role mapping fallback.');
assert.match(managementSource, /renderMessageComponents/, 'Channel view must render Discord message components so copied buttons are visible before opening Studio.');
assert.match(managementSource, /\$\{embeds\}\$\{components\}/, 'Rendered channel messages must place component buttons directly under embeds.');
assert.match(managementSource, /hydrateMessageComponents/, 'Opening a copied embed must live-hydrate only the selected message when cached components are missing.');
assert.match(managementSource, /studioComponents: importedStudioComponents\(message\)/, 'Opening a single embed in Studio must pass non-role Discord components into the Studio.');
assert.match(managementSource, /studioComponents: importedStudioComponents\(message\)/, 'Opening all embeds in Studio must pass non-role Discord components into the Studio.');
assert.match(managementSource, /filter\(\(component\) => !resolveRoleButtonRoleId\(component\)\)/, 'Copied role buttons must be excluded from imported components so they never appear twice.');
assert.match(dashboardSource, /messageId:\s*req\.query\.messageId/, 'Channel message API must support targeted live message hydration.');
assert.doesNotMatch(indexSource, /indexed\.rows\.map[\s\S]{0,350}channel\.messages\.fetch\(\{ message:/, 'Indexed channel pages must not perform one Discord fetch per rendered row.');

assert.match(rendererSource, /renderStudioReactionPreview[\s\S]*class="function-button style-/, 'Studio preview must show role entries as button chips, not reaction counters.');
assert.match(studioComponentsSource, /window\.FHCCStudioComponents/, 'Imported Discord component handling must live in a dedicated renderer module.');
assert.match(studioHtml, /studio-components\.js\?v=\d+\.\d+\.\d+/, 'Studio components module must be loaded before app.js.');
assert.match(rendererSource, /state\.studioComponents = window\.FHCCStudioComponents\.normalizeRows/, 'Studio must keep raw Discord components in state through the shared module.');
assert.match(rendererSource, /studioComponents: clone\(state\.studioComponents\)/, 'Current Studio template must include raw Discord components for send/edit.');
assert.match(rendererSource, /window\.FHCCStudioComponents\.renderPreview/, 'Studio preview must render imported functional components through the shared module.');
assert.doesNotMatch(rendererSource, /function normalizeStudioComponent\(/, 'Raw Discord component normalization must not live directly in app.js.');
assert.match(indexSource, /normalizeStudioTemplateComponents/, 'Backend must sanitize raw Studio components before sending/editing Discord messages.');
assert.match(indexSource, /template\.studioComponents/, 'Backend send/edit path must preserve imported functional components.');
assert.match(studioHtml, /<b>Rollen-Buttons<\/b>/, 'Embed Studio should label the feature as Rollen-Buttons.');
assert.match(studioHtml, /<button id="add-studio-reaction-role"[^>]*>Button hinzufügen<\/button>/, 'Add button copy should match the button behavior.');

console.log('Reaction-Role-Button-Smoke bestanden: Studio erzeugt funktionale fh_rr-Rollenbuttons und kopiert bestehende Button-Panels.');
