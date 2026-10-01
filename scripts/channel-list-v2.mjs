#!/usr/bin/env node
/**
 * Listet alle Kategorien und Channels vom laufenden Bot ab.
 * Verbindet sich zum Bot-Index und liest die Guild-Channels.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const dataDir = path.join(process.env.USERPROFILE, 'AppData/Roaming/FALLEN HEAVEN Control Center/runtime/data');
const dbPath = path.join(dataDir, 'server-index', 'fallen-heaven-index.sqlite3');
const db = new Database(dbPath, { readonly: true });

// Alle Channels aus dem Index holen
const channels = db.prepare(`
  SELECT channel_id, channel_name, parent_channel_id
  FROM messages WHERE is_thread = 0
  GROUP BY channel_id
  ORDER BY parent_channel_id, channel_name
`).all();

// Parent-IDs sammeln
const parentIds = [...new Set(channels.filter(c => c.parent_channel_id).map(c => c.parent_channel_id))];

// Versuche Kategorienamen aus dem Channel-Namen-Pattern zu erraten
// Channels haben typischerweise Emojis + Prefix die auf Kategorie hindeuten
const catGuesses = {
  '1278042629946343506': 'COMMUNITY',
  '1278041731274768416': 'MODERATION / LOGS',
  '1278043607764434995': 'SICHERHEIT',
  '1278074999823142944': 'TEMP VOICE / SPRACHKANÄLE',
  '1305629533642297385': 'TEAM',
  '1276125977805721644': 'PUBLIC CALLS',
  '1278085748897087508': 'INFORMATIONEN',
  '1278071701883719762': 'TICKETS / SUPPORT',
  '1305845627988742205': 'AKTIVITÄTEN',
  '1307687822521794651': 'SPIELE',
  '1308144988563181608': 'VIP BEREICH',
  '1314573069058314310': 'LIVE',
  '1305932694655598592': 'STRAFE',
};

// Gruppiere nach Kategorie
const grouped = {};
for (const ch of channels) {
  const pid = ch.parent_channel_id || 'NULL';
  if (!grouped[pid]) grouped[pid] = [];
  if (!grouped[pid].find(x => x.channel_id === ch.channel_id)) {
    grouped[pid].push(ch);
  }
}

// Output
for (const pid of parentIds.sort()) {
  const name = catGuesses[pid] || `Kategorie ${pid}`;
  const chs = (grouped[pid] || []).sort((a, b) => a.channel_name.localeCompare(b.channel_name));
  console.log(`\n=== ${name} (${pid}) ===`);
  for (const ch of chs) {
    console.log(`<#${ch.channel_id}> ${ch.channel_name}`);
  }
}

db.close();
