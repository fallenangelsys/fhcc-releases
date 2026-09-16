import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const tmpDir = join(process.cwd(), 'data', '.test-voice-log-events');
const indexDir = join(tmpDir, 'server-index');
try { mkdirSync(indexDir, { recursive: true }); } catch {}

process.env.FALLEN_HEAVEN_DATA_DIR = tmpDir;
process.env.FALLEN_HEAVEN_SMOKE_TEST = '1';

const { getVoiceLogEventsPage, parseVoiceLogRecord, _voiceLogImportInternals } = await import('../src/features/voiceLogImport.js');
const voiceLogEventsPage = _voiceLogImportInternals.getVoiceLogEventsPage;

// --- Test 1: parseVoiceLogRecord erkennt Join/Leave/Move ---
{
  const joinRecord = {
    embeds: [{
      title: 'Joined Voice Channel',
      description: '**TestUser** joined #Gaming',
      timestamp: '2026-09-16T10:00:00.000Z',
      footer: { text: 'ID: 123456789012345678' }
    }]
  };
  const parsed = parseVoiceLogRecord(joinRecord);
  assert.equal(parsed.type, 'join');
  assert.equal(parsed.userId, '123456789012345678');
  assert.equal(parsed.channelName, 'Gaming');
}

// --- Test 2: parseVoiceLogRecord erkennt Leave ---
{
  const leaveRecord = {
    embeds: [{
      title: 'Left Voice Channel',
      description: '**TestUser** left #Gaming',
      timestamp: '2026-09-16T10:05:00.000Z',
      footer: { text: 'ID: 123456789012345678' }
    }]
  };
  const parsed = parseVoiceLogRecord(leaveRecord);
  assert.equal(parsed.type, 'leave');
  assert.equal(parsed.userId, '123456789012345678');
}

// --- Test 3: parseVoiceLogRecord erkennt Move ---
{
  const moveRecord = {
    embeds: [{
      title: 'Changed Voice Channel',
      description: '**Before:** #Gaming\n**+After:** #Music',
      timestamp: '2026-09-16T10:10:00.000Z',
      footer: { text: 'ID: 123456789012345678' }
    }]
  };
  const parsed = parseVoiceLogRecord(moveRecord);
  assert.equal(parsed.type, 'move');
  assert.equal(parsed.beforeChannel, 'Gaming');
  assert.equal(parsed.afterChannel, 'Music');
}

// --- Test 4: getVoiceLogEventsPage liefert leere Ergebnisse bei fehlendem Index ---
{
  const result = voiceLogEventsPage('nonexistent-guild', 'nonexistent-channel');
  assert.deepEqual(result.events, []);
  assert.equal(result.cursor, null);
  assert.equal(result.hasMore, false);
}

// --- Test 5: parseVoiceLogRecord gibt null bei ungültigem Record ---
{
  const invalidRecord = { embeds: [] };
  const parsed = parseVoiceLogRecord(invalidRecord);
  assert.equal(parsed, null);
}

// --- Test 6: parseVoiceLogRecord gibt null bei fehlenden Embeds ---
{
  const noEmbeds = {};
  const parsed = parseVoiceLogRecord(noEmbeds);
  assert.equal(parsed, null);
}

// Cleanup
try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}

console.log('✓ Voice-Log-Events-Smoke: Parse, Join/Leave/Move-Erkennung, leere Ergebnisse und Fehlerbehandlung OK');
