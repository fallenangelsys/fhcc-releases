#!/usr/bin/env node
/**
 * Debug: Zeigt den exakten Embed-Inhalt der Heute-Periode an.
 * Läuft OHNE Discord-Login – nur die Serialize-Logik.
 */
import { EmbedBuilder } from 'discord.js';
import { readFileSync } from 'fs';
import path from 'path';

const DATA_DIR = path.join(
  process.env.USERPROFILE,
  'AppData/Roaming/FALLEN HEAVEN Control Center/runtime/data'
);

// Lade Guild-Config
const configRaw = JSON.parse(readFileSync(path.join(DATA_DIR, 'guild-configs.json'), 'utf8'));
const guildId = '1276125977805721640';
const conf = configRaw[guildId] || {};

const activityRaceConf = conf.activityRace || {};
const panelDesign = activityRaceConf.panelDesign || {};

console.log('=== PANEL DESIGN FIELDS ===');
const embed = panelDesign.embed || {};
if (embed.fields) {
  embed.fields.forEach((f, i) => {
    console.log(`\nField ${i}: name="${f.name}" inline=${f.inline}`);
    console.log(`  value: ${f.value}`);
  });
} else {
  console.log('No fields in saved panelDesign – using defaults');
  console.log('Default fields:');
  console.log('  CHAT: {chatBlock1}\\n\\n{chatBlock2}\\n\\n{chatBlock3}');
  console.log('  SPRACHCHAT: {voiceBlock1}\\n\\n{voiceBlock2}\\n\\n{voiceBlock3}');
}

console.log('\n=== PANEL TEXTS ===');
const pt = activityRaceConf.panelTexts || {};
console.log('rankingLineTemplate:', pt.rankingLineTemplate || '{marker} {mention}\\n> **{value}**');
console.log('completionDaily:', pt.completionDaily || '(default)');
console.log('chatFieldName:', pt.chatFieldName || 'CHAT');
console.log('voiceFieldName:', pt.voiceFieldName || 'SPRACHCHAT');

console.log('\n=== DESCRIPTION ===');
console.log('description:', embed.description || '{completion}');

// Test: simulate what happens with real data
const testContext = {
  chatBlock1: '🥇 @Kyu\n> **46 Nachrichten**',
  chatBlock2: '🥈 @Navlis\n> **46 Nachrichten**',
  chatBlock3: '🥉 @自然\n> **39 Nachrichten**',
  voiceBlock1: '🥇 @Fallen-DeviL\n> **14 Std. 50 Min.**',
  voiceBlock2: '🥈 @Yoshinoo<3\n> **14 Std. 50 Min.**',
  voiceBlock3: '🥉 @Fallen-Angel\n> **14 Std. 50 Min.**',
  nextEvaluation: '3 Std. 12 Min.',
  range: '2026-08-21',
  completion: 'Die Tagesrollen zeigen den aktuellen Stand und wechseln automatisch, sobald sich Platz 1 bis 3 verändern.',
  period: 'Heute',
  server: 'FALLEN HEAVEN'
};

// What the field template resolves to with REAL data
const fieldTemplate = '{chatBlock1}\\n\\n{chatBlock2}\\n\\n{chatBlock3}';
let resolved = fieldTemplate;
for (const [key, val] of Object.entries(testContext)) {
  resolved = resolved.split(`{${key}}`).join(val);
}
console.log('\n=== RESOLVED CHAT FIELD (real data) ===');
console.log(resolved);

// What happens when chatBlock3 is EMPTY (only 2 positions)
const ctx2 = { ...testContext, chatBlock3: '' };
let resolved2 = fieldTemplate;
for (const [key, val] of Object.entries(ctx2)) {
  resolved2 = resolved2.split(`{${key}}`).join(val);
}
console.log('\n=== RESOLVED CHAT FIELD (2 positions) ===');
console.log(JSON.stringify(resolved2));
console.log('Chars:', resolved2.length);

// Now test with the new clean template
const newTemplate = '{chatMarker1} {chat1} > **{chatValue1}**\n{chatMarker2} {chat2} > **{chatValue2}**\n{chatMarker3} {chat3} > **{chatValue3}**';
const ctx3 = {
  chatMarker1: '🥇', chat1: '@Kyu', chatValue1: '46 Nachrichten',
  chatMarker2: '🥈', chat2: '@Navlis', chatValue2: '46 Nachrichten',
  chatMarker3: '🥉', chat3: '@自然', chatValue3: '39 Nachrichten',
};
let resolved3 = newTemplate;
for (const [key, val] of Object.entries(ctx3)) {
  resolved3 = resolved3.split(`{${key}}`).join(val);
}
console.log('\n=== NEW TEMPLATE (real data) ===');
console.log(resolved3);

// With empty position 3
const ctx4 = { ...ctx3, chatMarker3: '', chat3: '', chatValue3: '' };
let resolved4 = newTemplate;
for (const [key, val] of Object.entries(ctx4)) {
  resolved4 = resolved4.split(`{${key}}`).join(val);
}
console.log('\n=== NEW TEMPLATE (2 positions, empty cleanup) ===');
console.log(JSON.stringify(resolved4));
