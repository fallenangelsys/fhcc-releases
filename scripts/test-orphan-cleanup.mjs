#!/usr/bin/env node
import assert from 'node:assert/strict';

// Simulate formatPanelText with the new orphan cleanup
const formatPanelText = (value, context, maximum) => {
  let result = String(value || '');
  for (const [key, replacement] of Object.entries(context || {})) {
    const token = `{${key}}`;
    if (typeof replacement === 'string' && result.includes(token)) {
      result = result.split(token).join(replacement);
    }
  }
  // Orphan cleanup
  result = result.split('\n').filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return true;
    if (/^[╰╰]\s*\*+\s*$/.test(trimmed)) return false;
    if (/^>\s*\*+\s*$/.test(trimmed)) return false;
    return true;
  }).join('\n');
  return result.slice(0, maximum);
};

// Test 1: Empty chatBlock3 leaves "╰ **" artifact
const fieldTemplate = '{chatMarker1} {chat1}\n╰ **{chatValue1}**\n{chatMarker2} {chat2}\n╰ **{chatValue2}**\n{chatMarker3} {chat3}\n╰ **{chatValue3}**';
const ctx3 = {
  chatMarker1: '🥇', chat1: '@Kyu', chatValue1: '46 Nachrichten',
  chatMarker2: '🥈', chat2: '@Navlis', chatValue2: '46 Nachrichten',
  chatMarker3: '', chat3: '', chatValue3: ''
};
const result = formatPanelText(fieldTemplate, ctx3, 1024);
console.log('=== 3 Positionen ===');
console.log(result);
const hasOrphan = result.split('\n').some(l => /^[╰╰]\s*\*+\s*$/.test(l.trim()));
assert.ok(!hasOrphan, 'No orphaned connector-only lines');
assert.ok(result.includes('🥇 @Kyu'), 'Should have first place');
assert.ok(result.includes('🥈 @Navlis'), 'Should have second place');

// Test 2: All 3 positions
const ctxFull = {
  chatMarker1: '🥇', chat1: '@Kyu', chatValue1: '46 Nachrichten',
  chatMarker2: '🥈', chat2: '@Navlis', chatValue2: '46 Nachrichten',
  chatMarker3: '🥉', chat3: '@自然', chatValue3: '39 Nachrichten',
};
const result2 = formatPanelText(fieldTemplate, ctxFull, 1024);
console.log('\n=== Alle 3 Positionen ===');
console.log(result2);
assert.ok(result2.includes('🥉'), 'Should have trophy3');
assert.ok(result2.includes('自然'), 'Should have 3rd place member');
const hasOrphan2 = result2.split('\n').some(l => /^[╰╰]\s*\*+\s*$/.test(l.trim()));
assert.ok(!hasOrphan2, 'No orphaned connector-only lines in full result');

// Test 3: Blockquote artifact (old template)
const oldTemplate = '{marker} {mention}\n> **{value}**';
const ctxOld = { marker: '🥇', mention: '@Kyu', value: '46 Nachrichten' };
const result3 = formatPanelText(oldTemplate, ctxOld, 1024);
console.log('\n=== Old Template ===');
console.log(result3);
assert.ok(result3.includes('🥇 @Kyu'), 'Should work with old template');

// Test 4: Empty mention but has value
const ctxEmpty = { marker: '🥉', mention: '', value: '39 Nachrichten' };
const result4 = formatPanelText(oldTemplate, ctxEmpty, 1024);
console.log('\n=== Empty mention ===');
console.log(result4);

console.log('\n✅ All tests passed!');
