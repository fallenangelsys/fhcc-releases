import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const previewPath = 'docs/fhcc-command-deck-preview.html';
assert.ok(existsSync(previewPath), 'FHCC Command Deck preview must exist.');

const source = readFileSync(previewPath, 'utf8');
const views = ['overview', 'server', 'modules', 'studio', 'system'];

for (const view of views) {
  assert.match(source, new RegExp(`data-view-target=["']${view}["']`), `Navigation target missing: ${view}`);
  assert.match(source, new RegExp(`data-view=["']${view}["']`), `Workspace missing: ${view}`);
}

assert.match(source, /fallen-heaven-bg\.png/, 'The real Fallen Heaven background asset must be used.');
assert.match(source, /data-aesthetic=["']gothic-luxury["']/, 'The approved Gothic Luxury direction must be explicit.');
assert.match(source, /Bodoni MT/, 'Gothic Luxury display typography is missing.');
assert.match(source, /class=["'][^"']*cathedral-frame/, 'The cathedral workspace frame is missing.');
assert.match(source, /class=["'][^"']*stained-slit/, 'The stained-glass focus signature is missing.');
assert.match(source, /--oxblood:\s*#[0-9a-f]{6}/i, 'Oxblood accent token is missing.');
assert.match(source, /function activateView\(viewId\)/, 'Deterministic view activation is missing.');
assert.match(source, /aria-current/, 'Active navigation must expose aria-current.');
assert.match(source, /id="command-layer"/, 'Command layer is missing.');
assert.match(source, /prefers-reduced-motion/, 'Reduced-motion handling is missing.');
assert.match(source, /@media\s*\(max-width:\s*760px\)/, 'Mobile layout breakpoint is missing.');
assert.doesNotMatch(source, /class=["'][^"']*\borb\b/, 'Decorative orb patterns are rejected.');
assert.doesNotMatch(source, /class=["'][^"']*\bmetric-card\b/, 'Generic metric-card patterns are rejected.');

const domainTerms = [
  'TempVoice', 'Aktivitäts-Liga', 'Counting', 'Server-Tag',
  'Rollen-Buttons', 'Funktionsbuttons', 'Dropdowns',
  'Logs', 'Updates', 'Diagnosen'
];
for (const term of domainTerms) assert.ok(source.includes(term), `Domain content missing: ${term}`);

for (const hook of ['data-atlas-node', 'data-module-row', 'data-server-object', 'data-studio-layer', 'data-system-event']) {
  assert.ok(source.includes(hook), `Interaction hook missing: ${hook}`);
}

assert.match(source, /aria-selected/, 'Context selections must expose aria-selected.');
assert.match(source, /Control|Ctrl/, 'Command palette shortcut hint is missing.');

console.log('FHCC Command Deck Preview Smoke bestanden: fünf Arbeitsbereiche, echte Domain-Inhalte und responsive Interaktionen sind vorhanden.');
