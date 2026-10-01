#!/usr/bin/env node
// Verify the formatVoice fix: display now matches ranking rounding

// OLD formatVoice (broken)
const formatVoiceOld = (ms) => {
  const totalMinutes = Math.floor(Math.max(0, Number(ms || 0)) / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours} Std. ${minutes} Min.` : `${minutes} Min.`;
};

// NEW formatVoice (fixed)
const formatVoiceNew = (ms) => {
  const totalMinutes = Math.round(Math.max(0, Number(ms || 0)) / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours} Std. ${minutes} Min.` : `${minutes} Min.`;
};

// Simulate the problematic case:
// User A: 20,339,000 ms = 338.98 min
// User B: 20,280,000 ms = 338.00 min
const userA = 20_339_000;
const userB = 20_280_000;

// Ranking rounds to nearest minute
const rankA = Math.round(userA / 60_000) * 60_000; // 339 * 60000 = 20340000
const rankB = Math.round(userB / 60_000) * 60_000; // 338 * 60000 = 20280000

console.log('=== BUG DEMONSTRATION ===');
console.log(`User A: ${userA}ms → Rank value: ${rankA/60000} min`);
console.log(`User B: ${userB}ms → Rank value: ${rankB/60000} min`);
console.log(`Same rank? ${rankA === rankB ? 'YES (tie)' : 'NO (different ranks!)'}`);
console.log();
console.log('OLD formatVoice (broken):');
console.log(`  User A: ${formatVoiceOld(userA)}`);
console.log(`  User B: ${formatVoiceOld(userB)}`);
console.log(`  Both show same time but have DIFFERENT ranks!`);
console.log();
console.log('NEW formatVoice (fixed):');
console.log(`  User A: ${formatVoiceNew(userA)}`);
console.log(`  User B: ${formatVoiceNew(userB)}`);
console.log(`  Now shows DIFFERENT times = DIFFERENT ranks (correct!)`);

// Another case: truly equal values (both round to same minute)
const userC = 20_300_000; // 338.33 min → rounds to 338
const userD = 20_330_000; // 338.83 min → rounds to 339

console.log('\n=== TRULY DIFFERENT VALUES ===');
console.log(`User C: ${userC}ms = ${formatVoiceNew(userC)} (rank: ${Math.round(userC/60000)} min)`);
console.log(`User D: ${userD}ms = ${formatVoiceNew(userD)} (rank: ${Math.round(userD/60000)} min)`);
console.log(`Correctly shows different times: ${formatVoiceNew(userC) !== formatVoiceNew(userD)}`);

// Case where both are truly equal
const userE = 20_300_000;
const userF = 20_310_000;

console.log('\n=== TRULY EQUAL (both round to 338 min) ===');
console.log(`User E: ${userE}ms = ${formatVoiceNew(userE)} (rank: ${Math.round(userE/60000)} min)`);
console.log(`User F: ${userF}ms = ${formatVoiceNew(userF)} (rank: ${Math.round(userF/60000)} min)`);
console.log(`Same rank? ${Math.round(userE/60000) === Math.round(userF/60000) ? 'YES' : 'NO'}`);
console.log(`Display same? ${formatVoiceNew(userE) === formatVoiceNew(userF) ? 'YES' : 'NO'}`);
