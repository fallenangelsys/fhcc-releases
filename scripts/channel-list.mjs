#!/usr/bin/env node
import Database from 'better-sqlite3';
import path from 'node:path';

const p = path.join(process.env.USERPROFILE, 'AppData/Roaming/FALLEN HEAVEN Control Center/runtime/data/server-index/fallen-heaven-index.sqlite3');
const db = new Database(p, { readonly: true });

// Get unique channels (by ID, take latest name)
const channels = db.prepare(`
  SELECT channel_id, channel_name, parent_channel_id
  FROM (
    SELECT *, ROW_NUMBER() OVER(PARTITION BY channel_id ORDER BY created_at DESC) as rn
    FROM messages WHERE is_thread = 0
  ) WHERE rn = 1
  ORDER BY parent_channel_id, channel_name
`).all();

// Find which channel_ids are categories (parent of other channels)
const parentIds = new Set(channels.map(c => c.parent_channel_id).filter(Boolean));

// Get category names from the channels table
const catMap = {};
for (const ch of channels) {
  if (parentIds.has(ch.channel_id) && !catMap[ch.channel_id]) {
    catMap[ch.channel_id] = ch.channel_name;
  }
}

// Group channels by category
const grouped = {};
const noCat = [];

for (const ch of channels) {
  if (!ch.parent_channel_id || !catMap[ch.parent_channel_id]) {
    noCat.push(ch);
    continue;
  }
  const catName = catMap[ch.parent_channel_id];
  if (!grouped[catName]) grouped[catName] = [];
  // Dedupe by channel_id
  if (!grouped[catName].find(x => x.channel_id === ch.channel_id)) {
    grouped[catName].push(ch);
  }
}

// Sort categories
const sortedCats = Object.keys(grouped).sort((a, b) => a.localeCompare(b));

for (const cat of sortedCats) {
  const chs = grouped[cat].sort((a, b) => a.channel_name.localeCompare(b.channel_name));
  console.log(`\n=== ${cat} ===`);
  for (const ch of chs) {
    console.log(`<#${ch.channel_id}> ${ch.channel_name}`);
  }
}

if (noCat.length) {
  console.log(`\n=== OHNE KATEGORIE ===`);
  for (const ch of noCat) {
    console.log(`<#${ch.channel_id}> ${ch.channel_name}`);
  }
}

db.close();
