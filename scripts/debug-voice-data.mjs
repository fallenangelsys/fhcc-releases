#!/usr/bin/env node
import fs from 'node:fs';

const dataPath = 'C:/Users/pc/AppData/Roaming/FALLEN HEAVEN Control Center/runtime/data/activity-race.json';
const raw = fs.readFileSync(dataPath, 'utf8');
const data = JSON.parse(raw);

const guild = data.guilds?.['1276125977805721640'];
const today = '2026-08-22';
const dayData = guild?.days?.[today];
if (!dayData) { console.log('No data for', today); process.exit(1); }

const users = dayData.users || {};
console.log('=== TODAY VOICE DATA (sorted by voiceMilliseconds desc) ===');
const entries = Object.entries(users)
  .map(([userId, data]) => ({ userId, voiceMilliseconds: data.voiceMilliseconds || 0 }))
  .sort((a, b) => b.voiceMilliseconds - a.voiceMilliseconds);

// Rounded to 60000 (minutes)
const rounded = entries.map(e => ({
  ...e,
  rounded: Math.round(e.voiceMilliseconds / 60000) * 60000,
}));

console.log('Top 10:');
for (let i = 0; i < Math.min(10, rounded.length); i++) {
  const e = rounded[i];
  const min = Math.round(e.voiceMilliseconds / 60000);
  const h = Math.floor(min / 60);
  const m = min % 60;
  const rMin = e.rounded / 60000;
  const rH = Math.floor(rMin / 60);
  const rM = rMin % 60;
  console.log(`  ${i+1}. userId=${e.userId}  raw=${e.voiceMilliseconds}ms  display=${h}h${m}m  rounded=${e.rounded}ms (${rH}h${rM}m)`);
}

// Simulate computeRankings
const ranked = [];
let lastValue = null;
for (const entry of rounded) {
  const r = lastValue === null || entry.rounded !== lastValue ? ranked.length + 1 : ranked[ranked.length - 1].rank;
  ranked.push({ ...entry, rank: r });
  lastValue = entry.rounded;
}

// Limit by distinct ranks (3)
const visible = [];
let distinctRanks = 0;
let lastVisibleRank = null;
for (const entry of ranked) {
  if (entry.rank !== lastVisibleRank) {
    if (distinctRanks >= 3) break;
    distinctRanks++;
    lastVisibleRank = entry.rank;
  }
  visible.push(entry);
}

console.log('\n=== VISIBLE (after limit=3 distinct ranks) ===');
for (const e of visible) {
  const min = Math.round(e.rounded / 60000);
  const h = Math.floor(min / 60);
  const m = min % 60;
  console.log(`  rank=${e.rank} userId=${e.userId} rounded=${e.rounded}ms (${h}h${m}m)`);
}

// Rank groups
const groups = [];
let currentRank = null;
for (const entry of visible) {
  if (entry.rank !== currentRank) {
    groups.push({ rank: entry.rank, members: [], value: entry.rounded });
    currentRank = entry.rank;
  }
  groups[groups.length - 1].members.push(entry);
}

console.log('\n=== RANK GROUPS ===');
for (const g of groups) {
  const min = Math.round(g.value / 60000);
  const h = Math.floor(min / 60);
  const m = min % 60;
  console.log(`  Platz ${g.rank}: ${g.members.length} members [${g.members.map(m => m.userId).join(', ')}] value=${h}h${m}m`);
}
