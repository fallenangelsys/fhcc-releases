#!/usr/bin/env node
import { readJsonWithRecovery } from '../src/runtime/atomicJsonStore.js';
import path from 'node:path';

const DATA_ROOT = process.env.FALLEN_HEAVEN_DATA_DIR || path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_ROOT, 'activity-race.json');

const { value } = await readJsonWithRecovery(DATA_FILE, { fallback: { guilds: {} }, backupLimit: 0 });

for (const [guildId, guild] of Object.entries(value?.guilds || {})) {
  console.log(`\n=== Guild ${guildId} ===`);
  
  // Get today's data
  const today = new Date().toISOString().slice(0, 10);
  const todayData = guild.days?.[today];
  if (!todayData) { console.log('No data for today'); continue; }
  
  // Compute voice rankings (same as the bot does)
  const entries = Object.entries(todayData.users || {})
    .map(([userId, data]) => ({ userId, voiceMs: data.voiceMilliseconds || 0 }))
    .filter(e => e.voiceMs > 0)
    .sort((a, b) => b.voiceMs - a.voiceMs);
  
  console.log(`\nVoice entries today: ${entries.length}`);
  
  // Round to minutes for display comparison
  const ranked = entries.map((e, i) => {
    const rounded = Math.round(e.voiceMs / 60000) * 60000;
    return { ...e, roundedMs: rounded, displayMinutes: Math.round(e.voiceMs / 60000) };
  });
  
  // Assign ranks based on rounded values
  let lastRounded = null;
  let rank = 0;
  for (const entry of ranked) {
    if (lastRounded === null || entry.roundedMs !== lastRounded) rank = ranked.indexOf(entry) + 1;
    entry.rank = rank;
    lastRounded = entry.roundedMs;
  }
  
  // Show top 5
  console.log('\nTop 5 (with rounded minutes):');
  for (let i = 0; i < Math.min(5, ranked.length); i++) {
    const e = ranked[i];
    const h = Math.floor(e.displayMinutes / 60);
    const m = e.displayMinutes % 60;
    console.log(`  Rank ${e.rank} | ${e.userId} | ${e.voiceMs}ms | ${e.roundedMs}ms rounded | ${h}h ${m}m`);
  }
  
  // Show all unique ranks
  const uniqueRanks = [...new Set(ranked.map(e => e.rank))];
  console.log(`\nUnique ranks: ${uniqueRanks.join(', ')}`);
  console.log(`Total users with voice: ${ranked.length}`);
  
  // Check: how many at rank 2?
  const rank2 = ranked.filter(e => e.rank === 2);
  console.log(`Users at rank 2: ${rank2.length}`);
  for (const e of rank2) {
    const h = Math.floor(e.displayMinutes / 60);
    const m = e.displayMinutes % 60;
    console.log(`  ${e.userId}: ${e.voiceMs}ms → ${h}h ${m}m`);
  }
}
