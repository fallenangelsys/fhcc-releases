#!/usr/bin/env node
/**
 * Test: Tie-System Fix – NEUE Logik (distinct rank groups)
 */
import assert from 'node:assert/strict';

// NEUE computeRankings: zählt DISTINCT RANG-GRUPPEN
const computeRankings = (rows, limit = 3) => {
  if (!rows?.length) return { ranked: [], visible: [] };
  const boundedLimit = Math.max(3, Math.min(20, Number(limit) || 3));
  const ranked = [];
  let lastValue = null;
  for (const entry of rows) {
    const value = Number(entry?.value || 0);
    const rank = lastValue === null || value !== lastValue ? ranked.length + 1 : ranked[ranked.length - 1].rank;
    ranked.push({ ...entry, rank });
    lastValue = value;
  }
  const visible = [];
  let distinctRanks = 0;
  let lastVisibleRank = null;
  for (const entry of ranked) {
    if (entry.rank !== lastVisibleRank) {
      if (distinctRanks >= boundedLimit) break;
      distinctRanks += 1;
      lastVisibleRank = entry.rank;
    }
    visible.push(entry);
  }
  return { ranked, visible };
};

const computeRankGroups = (visible) => {
  const groups = [];
  let currentRank = null;
  for (const entry of visible) {
    if (entry.rank !== currentRank) {
      groups.push({ rank: entry.rank, members: [], value: entry.value });
      currentRank = entry.rank;
    }
    groups[groups.length - 1].members.push(entry);
  }
  return groups;
};

// ===== TEST 1: Kein Tie =====
console.log('TEST 1: Kein Tie...');
{
  const rows = [
    { userId: 'u1', value: 300 },
    { userId: 'u2', value: 200 },
    { userId: 'u3', value: 100 },
  ];
  const { visible } = computeRankings(rows, 3);
  const groups = computeRankGroups(visible);
  assert.equal(groups.length, 3);
  groups.forEach(g => assert.equal(g.members.length, 1));
  console.log('  ✅ 3 Plätze, je 1 Person');
}

// ===== TEST 2: Zweier-Tie =====
console.log('TEST 2: Zweier-Tie...');
{
  const rows = [
    { userId: 'slashraven', value: 338*60000 },
    { userId: 'yoshinoo', value: 338*60000 },
    { userId: 'kyu', value: 230*60000 },
    { userId: 'nyna', value: 230*60000 },
    { userId: 'finni', value: 203*60000 },
  ];
  const { visible } = computeRankings(rows, 3);
  const groups = computeRankGroups(visible);
  console.log('  visible:', visible.length, 'entries,', groups.length, 'groups');
  // 3 Rang-Gruppen: rank 1 (2 Leute), rank 3 (2 Leute), rank 5 (1 Person)
  assert.equal(groups.length, 3, '3 distinct rank groups');
  assert.equal(groups[0].members.length, 2, 'Platz 1: slashraven + yoshinoo');
  assert.equal(groups[0].rank, 1);
  assert.equal(groups[0].members[0].userId, 'slashraven');
  assert.equal(groups[0].members[1].userId, 'yoshinoo');
  assert.equal(groups[1].members.length, 2, 'Platz 2: kyu + nyna');
  assert.equal(groups[1].rank, 3);
  assert.equal(groups[2].members.length, 1, 'Platz 3: finni');
  assert.equal(groups[2].members[0].userId, 'finni');
  console.log('  ✅ 3 Plätze korrekt geteilt');
}

// ===== TEST 3: Einziger #1, Rest geteilt =====
console.log('TEST 3: Einziger #1, Rest geteilt...');
{
  const rows = [
    { userId: 'u1', value: 500 },
    { userId: 'u2', value: 300 },
    { userId: 'u3', value: 300 },
    { userId: 'u4', value: 100 },
  ];
  const { visible } = computeRankings(rows, 3);
  const groups = computeRankGroups(visible);
  assert.equal(groups.length, 3);
  assert.equal(groups[0].members.length, 1);
  assert.equal(groups[0].members[0].userId, 'u1');
  assert.equal(groups[1].members.length, 2);
  assert.equal(groups[2].members.length, 1);
  assert.equal(groups[2].members[0].userId, 'u4');
  console.log('  ✅ Mixed tie korrekt');
}

// ===== TEST 4: Alle gleich =====
console.log('TEST 4: Alle gleich...');
{
  const rows = [
    { userId: 'u1', value: 100 },
    { userId: 'u2', value: 100 },
    { userId: 'u3', value: 100 },
  ];
  const { visible } = computeRankings(rows, 3);
  const groups = computeRankGroups(visible);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].members.length, 3);
  console.log('  ✅ Alle gleich → 1 Platz');
}

// ===== TEST 5: Nur 1 Person =====
console.log('TEST 5: Nur 1 Person...');
{
  const { visible } = computeRankings([{ userId: 'u1', value: 100 }], 3);
  const groups = computeRankGroups(visible);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].members.length, 1);
  console.log('  ✅ OK');
}

// ===== TEST 6: Leere Daten =====
console.log('TEST 6: Leere Daten...');
{
  const groups = computeRankGroups([]);
  assert.equal(groups.length, 0);
  console.log('  ✅ OK');
}

// ===== TEST 7: 3 verschiedene Ränge =====
console.log('TEST 7: 3 Plätze, kein Tie...');
{
  const rows = [
    { userId: 'u1', value: 300 },
    { userId: 'u2', value: 200 },
    { userId: 'u3', value: 100 },
    { userId: 'u4', value: 50 },
  ];
  const { visible } = computeRankings(rows, 3);
  const groups = computeRankGroups(visible);
  assert.equal(groups.length, 3);
  groups.forEach(g => assert.equal(g.members.length, 1));
  console.log('  ✅ 3 Plätze korrekt');
}

// ===== TEST 8: User-Szenario =====
console.log('TEST 8: User-Szenario...');
{
  const rows = [
    { userId: 'slashraven', value: 5*3600000 + 38*60000 },
    { userId: 'yoshinoo', value: 5*3600000 + 38*60000 },
    { userId: 'kyu', value: 3*3600000 + 50*60000 },
    { userId: 'nyna', value: 3*3600000 + 50*60000 },
    { userId: 'finni', value: 3*3600000 + 23*60000 },
  ];
  const { visible } = computeRankings(rows, 3);
  const groups = computeRankGroups(visible);
  
  console.log('  Display:');
  groups.forEach((g, i) => {
    const pos = ['🥇','🥈','🥉'][i] || `#${i+1}`;
    const names = g.members.map(m => m.userId).join(' / ');
    const tie = g.members.length > 1 ? ` (+${g.members.length-1} weitere)` : '';
    const mins = g.value / 60000;
    console.log(`  ${pos} ${names}${tie} → ${Math.floor(mins/60)} Std. ${mins%60} Min.`);
  });
  
  // KEIN user doppelt als separate Position
  const allIds = groups.flatMap(g => g.members.map(m => m.userId));
  const unique = new Set(allIds);
  assert.equal(allIds.length, unique.size, 'Keine doppelten Members');
  
  assert.equal(groups[0].members.length, 2, 'Platz 1 = 2 Leute');
  assert.equal(groups[1].members.length, 2, 'Platz 2 = 2 Leute');
  assert.equal(groups[2].members.length, 1, 'Platz 3 = 1 Person');
  console.log('  ✅ Korrekt! Keine doppelten Einträge!');
}

// ===== TEST 9: 4er Call mit 2er Tie =====
console.log('TEST 9: 4er Call...');
{
  const rows = [
    { userId: 'u1', value: 600 },
    { userId: 'u2', value: 500 },
    { userId: 'u3', value: 500 },
    { userId: 'u4', value: 400 },
  ];
  const { visible } = computeRankings(rows, 3);
  const groups = computeRankGroups(visible);
  console.log('  visible:', visible.length, 'entries,', groups.length, 'groups');
  // 3 groups: rank1(1), rank2(2), rank4(1)
  assert.equal(groups.length, 3);
  assert.equal(groups[0].members.length, 1);
  assert.equal(groups[0].members[0].userId, 'u1');
  assert.equal(groups[1].members.length, 2);
  assert.equal(groups[2].members.length, 1);
  console.log('  ✅ 3 Plätze korrekt');
}

console.log('\nAlle Tests bestanden! ✅');
