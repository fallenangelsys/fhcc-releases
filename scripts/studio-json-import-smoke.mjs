#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const sourcePath = path.join(process.cwd(), 'desktop', 'renderer', 'studio-json-import.js');
assert.equal(fs.existsSync(sourcePath), true, 'Das globale JSON-Importmodul fehlt.');
const context = { window: {} };
vm.createContext(context);
vm.runInContext(fs.readFileSync(sourcePath, 'utf8'), context, { filename: sourcePath });
const importer = context.window.FHCCStudioJsonImport;
assert.ok(importer, 'FHCCStudioJsonImport wurde nicht registriert.');

const discord = importer.parse(`{
  "content": "Hallo",
  "embeds": [{
    "title": "Discord JSON",
    "color": 16711935,
    "author": { "name": "Autor", "icon_url": "https://example.com/a.png" },
    "thumbnail": { "url": "https://example.com/t.png" },
    "image": { "url": "https://example.com/i.png" },
    "footer": { "text": "Footer", "icon_url": "https://example.com/f.png" },
    "timestamp": "2026-08-27T12:00:00.000Z",
    "fields": [{ "name": "A", "value": "B", "inline": true }]
  }]
}`);
assert.equal(discord.content, 'Hallo');
assert.equal(discord.embeds[0].color, '#ff00ff');
assert.equal(discord.embeds[0].authorName, 'Autor');
assert.equal(discord.embeds[0].authorIconUrl, 'https://example.com/a.png');
assert.equal(discord.embeds[0].thumbnailUrl, 'https://example.com/t.png');
assert.equal(discord.embeds[0].imageUrl, 'https://example.com/i.png');
assert.equal(discord.embeds[0].footerText, 'Footer');
assert.equal(discord.embeds[0].footerIconUrl, 'https://example.com/f.png');
assert.equal(discord.embeds[0].timestamp, true);
assert.equal(discord.embeds[0].timestampValue, '2026-08-27T12:00:00.000Z');

const discohook = importer.parse(JSON.stringify({ messages: [{ data: { content: 'Discohook', embeds: [{ description: 'Importiert' }] } }] }));
assert.equal(discohook.content, 'Discohook');
assert.equal(discohook.embeds[0].description, 'Importiert');

const many = importer.parse(JSON.stringify({ embeds: Array.from({ length: 12 }, (_, index) => ({ title: `Embed ${index + 1}` })) }));
assert.equal(many.embeds.length, 10);
assert.equal(many.embeds[9].title, 'Embed 10');

const currentModule = {
  specialTemplate: 'economyPanel',
  channelId: 'channel-1',
  componentSet: 'heavenEconomy',
  studioComponents: [{ protected: true }],
  reactionRoles: [{ protected: true }],
  content: 'Alt',
  embeds: [{ title: 'Alt' }]
};
const mergedModule = importer.merge(many, currentModule);
assert.equal(mergedModule.specialTemplate, 'economyPanel');
assert.equal(mergedModule.channelId, 'channel-1');
assert.equal(mergedModule.componentSet, 'heavenEconomy');
assert.equal(mergedModule.studioComponents[0].protected, true);
assert.equal(mergedModule.reactionRoles[0].protected, true);
assert.equal(mergedModule.embeds.length, 10);

assert.throws(() => importer.parse('{kaputt'), /gültiges JSON/i);
assert.throws(() => importer.parse('{}'), /Embed|Inhalt/i);

console.log('Studio-JSON-Import-Smoke bestanden: FHCC, Discord, Discohook, 10 Embeds und Modulschutz sind konsistent.');
