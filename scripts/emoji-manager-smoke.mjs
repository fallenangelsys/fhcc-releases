import fs from 'node:fs';
import path from 'node:path';
import { strict as assert } from 'node:assert';
import { fileURLToPath } from 'node:url';
import { Collection, PermissionFlagsBits } from 'discord.js';

import { featureCards, normalizeConfig } from '../src/defaultConfig.js';
import { createEmojiRenamePreview, _emojiManagerInternals } from '../src/features/emojiManager.js';

const emoji = (id, name, animated = false, managed = false) => ({
  id,
  name,
  animated,
  managed,
  available: true,
  imageURL: () => `https://cdn.discordapp.com/emojis/${id}.${animated ? 'gif' : 'png'}`
});

const guildEmojis = new Collection([
  ['1', emoji('1', 'vl_catwave')],
  ['2', emoji('2', 'vl_catdance', true)],
  ['3', emoji('3', 'other_name')]
]);
const guild = {
  id: 'guild',
  name: 'FALLEN HEAVEN',
  members: { me: { permissions: { has: (permission) => permission === PermissionFlagsBits.ManageGuildExpressions } } },
  emojis: { fetch: async () => guildEmojis }
};

const preview = await createEmojiRenamePreview({
  guild,
  conf: { enabled: true, oldPrefix: 'vl_', newPrefix: 'fh_', includeStatic: true, includeAnimated: true }
});
assert.equal(preview.matchedCount, 2, 'Statische und animierte vl_-Emojis werden nicht gemeinsam erkannt.');
assert.equal(preview.staticCount, 1, 'Statische Emoji-Anzahl ist falsch.');
assert.equal(preview.animatedCount, 1, 'Animierte Emoji-Anzahl ist falsch.');
assert.equal(preview.changes[0].targetName.startsWith('fh_'), true, 'Das Zielpräfix wird nicht korrekt ersetzt.');
assert.equal(preview.safeToApply, true, 'Fehlerfreie Vorschau wird unnötig blockiert.');
assert.match(preview.previewToken, /^[a-f0-9]{64}$/, 'Vorschau-Token fehlt oder ist nicht stabil gehasht.');

guildEmojis.set('4', emoji('4', 'fh_catwave'));
const collision = await createEmojiRenamePreview({ guild, conf: { enabled: true, oldPrefix: 'vl_', newPrefix: 'fh_' } });
assert.equal(collision.safeToApply, false, 'Vorhandener Zielname muss die Umbenennung blockieren.');
assert.equal(collision.blockedCount, 1, 'Kollision wird nicht exakt ausgewiesen.');
assert.equal(_emojiManagerInternals.isValidEmojiName('fh_ok'), true, 'Gültiger Discord-Emoji-Name wird abgelehnt.');
assert.equal(_emojiManagerInternals.isValidEmojiName('fh-nicht-ok'), false, 'Ungültiger Discord-Emoji-Name wird akzeptiert.');

const normalized = normalizeConfig({ guildId: 'guild', emojiManager: { oldPrefix: 'vl_', newPrefix: 'fh_' } });
assert.equal(normalized.emojiManager.includeStatic, true, 'Statische Emojis müssen standardmäßig aktiv sein.');
assert.equal(normalized.emojiManager.includeAnimated, true, 'Animierte Emojis müssen standardmäßig aktiv sein.');
const card = featureCards.find((entry) => entry.id === 'emojiManager');
assert(card, 'Emoji-Verwaltung fehlt in der Modulübersicht.');
assert(card.fields.some((field) => field.key === 'emojiManager.oldPrefix'), 'Präfix-Eingabe fehlt.');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const renderer = fs.readFileSync(path.join(root, 'desktop', 'renderer', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'desktop', 'renderer', 'index.html'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'desktop', 'renderer', 'styles.css'), 'utf8');
const dashboard = fs.readFileSync(path.join(root, 'src', 'dashboard.js'), 'utf8');
assert(renderer.includes('previewEmojiRenameFromPanel') && renderer.includes('applyEmojiRenameFromPanel'), 'Professioneller Vorschau-/Bestätigungsablauf fehlt in der App.');
assert(renderer.includes('await showEmojiRenameConfirmation(preview)'), 'Emoji-Umbenennung verwendet nicht das app-interne Bestätigungsfenster.');
assert(html.includes('id="emoji-rename-confirm-dialog"'), 'Gestaltetes Emoji-Bestätigungsfenster fehlt im App-DOM.');
assert(styles.includes('.emoji-rename-confirm-dialog') && styles.includes('.emoji-rename-confirm-dialog::backdrop'), 'Gestaltung oder Hintergrund des Emoji-Bestätigungsfensters fehlt.');
assert(dashboard.includes('/emoji-manager/preview') && dashboard.includes('/emoji-manager/apply'), 'Emoji-API ist nicht vollständig eingebunden.');
assert(!html.includes('data-view="editor"') && !html.includes('id="editor-view"') && !html.includes('data-public-target="editor"'), 'App Editor ist noch sichtbar eingebunden.');

console.log('Emoji-Manager-Smoke: Vorschau, Animationen, Kollisionen, Bestätigungspfad und App-Editor-Entfernung bestanden.');
