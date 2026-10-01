#!/usr/bin/env node
import assert from 'node:assert/strict';

// Minimal mock of the key functions to test the fix
const finiteInteger = (value, fallback, minimum, maximum) => {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
};

const computeRankings = (rows, limit = 3) => {
  if (!rows?.length) return { ranked: [], visible: [] };
  const boundedLimit = finiteInteger(limit, 3, 3, 20);
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
};

const formatVoice = (ms) => {
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h} Std. ${m} Min.` : `${m} Min.`;
};
const formatPositionValue = (value, metric) => metric === 'messages'
  ? `${Number(value || 0).toLocaleString('de-DE')} Nachrichten`
  : formatVoice(value);
const trophyEmoji = (guild, rank) => rank === 1 ? ':trophy1:' : rank === 2 ? ':trophy2:' : ':trophy3:';

// NEW buildPositionContext with the fix
const buildPositionContext = (guild, rows, metric, options = {}) => {
  const prefix = metric === 'messages' ? 'chat' : 'voice';
  const lineTemplate = String(options.rankingLineTemplate || '{marker} {mention}\n> **{value}**');
  const displayCount = Math.min(3, finiteInteger(options.rankingDisplayCount, 3, 3, 20));
  const { visible } = computeRankings(rows, options.rankingDisplayCount);
  const entries = visible.slice(0, displayCount);
  const context = {};
  for (let position = 1; position <= 3; position += 1) {
    const entry = entries[position - 1] || null;
    const marker = entry ? trophyEmoji(guild, entry.rank) : '';
    const tiedCount = entry ? visible.filter((e) => e.rank === entry.rank).length : 0;
    const isFirstOfTie = entry ? visible.findIndex((e) => e.rank === entry.rank) === position - 1 : false;
    const tieHint = (tiedCount > 1 && isFirstOfTie) ? ` *(+${tiedCount - 1} weitere)*` : '';
    context[`${prefix}${position}`] = entry ? `<@${entry.userId}>${tieHint}` : '';
    context[`${prefix}Value${position}`] = entry ? formatPositionValue(entry.value, metric) : '';
    context[`${prefix}Marker${position}`] = marker;
    context[`${prefix}Block${position}`] = entry
      ? lineTemplate
          .replaceAll('{marker}', marker)
          .replaceAll('{mention}', `<@${entry.userId}>${tieHint}`)
          .replaceAll('{value}', formatPositionValue(entry.value, metric))
          .replaceAll('{rank}', String(entry.rank))
      : '';
  }
  return context;
};

// Test 1: 3 users, 2 tied at rank 2 → position 3 should still show someone
console.log('Test 1: 3 users, 2 tied at rank 2');
const rows1 = [
  { userId: 'A', value: 100 },
  { userId: 'B', value: 80 },
  { userId: 'C', value: 80 }
];
const ctx1 = buildPositionContext(null, rows1, 'messages', { rankingDisplayCount: 3 });
assert.ok(ctx1.voice1 === undefined, 'No voice prefix');
assert.ok(ctx1.chat1, 'Position 1 filled');
assert.ok(ctx1.chat2, 'Position 2 filled');
assert.ok(ctx1.chat3, 'Position 3 filled (was empty before fix!)');
console.log('  chat1:', ctx1.chat1);
console.log('  chat2:', ctx1.chat2);
console.log('  chat3:', ctx1.chat3);
console.log('  PASS');

// Test 2: 1 user only
console.log('Test 2: 1 user only');
const rows2 = [{ userId: 'A', value: 50 }];
const ctx2 = buildPositionContext(null, rows2, 'voice', { rankingDisplayCount: 3 });
assert.ok(ctx2.voice1, 'Position 1 filled');
assert.ok(!ctx2.voice2, 'Position 2 empty');
assert.ok(!ctx2.voice3, 'Position 3 empty');
console.log('  PASS');

// Test 3: 3 users, all different ranks
console.log('Test 3: 3 users, all different ranks');
const rows3 = [
  { userId: 'A', value: 100 },
  { userId: 'B', value: 80 },
  { userId: 'C', value: 60 }
];
const ctx3 = buildPositionContext(null, rows3, 'voice', { rankingDisplayCount: 3 });
assert.ok(ctx3.voice1, 'Position 1 filled');
assert.ok(ctx3.voice2, 'Position 2 filled');
assert.ok(ctx3.voice3, 'Position 3 filled');
console.log('  PASS');

// Test 4: 3 users, all tied at same rank → all 3 positions should work
console.log('Test 4: 3 users, all tied');
const rows4 = [
  { userId: 'A', value: 100 },
  { userId: 'B', value: 100 },
  { userId: 'C', value: 100 }
];
const ctx4 = buildPositionContext(null, rows4, 'messages', { rankingDisplayCount: 3 });
assert.ok(ctx4.chat1, 'Position 1 filled');
assert.ok(ctx4.chat2, 'Position 2 filled');
assert.ok(ctx4.chat3, 'Position 3 filled');
console.log('  PASS');

// Test 5: 0 users
console.log('Test 5: 0 users');
const ctx5 = buildPositionContext(null, [], 'messages', { rankingDisplayCount: 3 });
assert.ok(!ctx5.chat1, 'Position 1 empty');
assert.ok(!ctx5.chat2, 'Position 2 empty');
assert.ok(!ctx5.chat3, 'Position 3 empty');
console.log('  PASS');

console.log('\n✅ All 5 tests passed!');
