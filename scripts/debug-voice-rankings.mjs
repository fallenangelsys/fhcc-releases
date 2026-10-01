#!/usr/bin/env node
import { readFileSync } from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.env.USERPROFILE, 'AppData/Roaming/FALLEN HEAVEN Control Center/runtime/data');
const db = await import('better-sqlite3');
const Database = db.default || db;
const sqlite = new Database(path.join(DATA_DIR, 'server-index.db'));

// Get today's voice data
const today = new Date();
const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
const dayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toISOString();

console.log('=== VOICE DATA TODAY ===');
console.log('Day:', dayStart, 'to', dayEnd);

const rows = sqlite.prepare(`
  SELECT author_id, SUM(voice_ms) as total_ms
  FROM messages
  WHERE voice_ms > 0 AND created_at >= ? AND created_at < ?
  GROUP BY author_id
  ORDER BY total_ms DESC
  LIMIT 10
`).all(dayStart, dayEnd);

if (rows.length === 0) {
  console.log('No voice data today!');
  // Check if there's any voice data at all
  const anyVoice = sqlite.prepare(`SELECT COUNT(*) as cnt FROM messages WHERE voice_ms > 0`).get();
  console.log('Total voice entries in DB:', anyVoice.cnt);
  
  // Check recent voice data
  const recent = sqlite.prepare(`
    SELECT author_id, created_at, voice_ms FROM messages 
    WHERE voice_ms > 0 
    ORDER BY created_at DESC LIMIT 5
  `).all();
  console.log('\nRecent voice entries:');
  recent.forEach(r => console.log(`  ${r.author_id}: ${r.voice_ms}ms at ${r.created_at}`));
} else {
  rows.forEach((r, i) => {
    const hours = Math.floor(r.total_ms / 3600000);
    const mins = Math.floor((r.total_ms % 3600000) / 60000);
    console.log(`  #${i+1} ${r.author_id}: ${hours}h ${mins}m (${r.total_ms}ms)`);
  });
}

// Also check computeRankings behavior
console.log('\n=== COMPUTE RANKINGS TEST ===');
function computeRankings(rows, limit = 3) {
  if (!rows?.length) return { ranked: [], visible: [] };
  const boundedLimit = limit;
  const ranked = [];
  let lastValue = null;
  for (const entry of rows) {
    const value = Number(entry?.value || 0);
    const rank = lastValue === null || value !== lastValue ? ranked.length + 1 : ranked[ranked.length - 1].rank;
    ranked.push({ ...entry, rank });
    lastValue = value;
  }
  const visible = [];
  for (const entry of ranked) {
    if (visible.length >= boundedLimit && Number(entry.value) !== Number(visible[visible.length - 1].value)) break;
    visible.push(entry);
  }
  return { ranked, visible };
}

// Test with dummy data
const testRows = [
  { userId: '111', value: 5000 },
  { userId: '222', value: 3000 },
  { userId: '333', value: 2000 },
];
const result = computeRankings(testRows, 3);
console.log('Test rankings:', result.visible.length, 'visible');
result.visible.forEach(e => console.log(`  Rank ${e.rank}: ${e.userId} = ${e.value}`));

sqlite.close();
