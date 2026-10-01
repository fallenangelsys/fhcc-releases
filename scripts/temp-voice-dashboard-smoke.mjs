import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PermissionFlagsBits } from 'discord.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-tempvoice-dashboard-'));
process.env.FALLEN_HEAVEN_DATA_DIR = dataDir;

await fsp.writeFile(path.join(dataDir, 'temp-voice.json'), JSON.stringify({
  version: 4,
  channels: {
    'voice-1': {
      guildId: 'guild-1',
      ownerId: 'u1',
      ownerName: 'Stored One',
      createdAt: '2026-08-24T12:00:00.000Z'
    },
    'voice-2': {
      guildId: 'guild-1',
      ownerId: 'u2',
      ownerName: 'Stored Two',
      createdAt: '2026-08-24T13:00:00.000Z'
    },
    'voice-other': {
      guildId: 'guild-2',
      ownerId: 'u3',
      createdAt: '2026-08-24T14:00:00.000Z'
    }
  },
  profiles: {
    'guild-1': {
      u1: { customName: 'Night Lounge', userLimit: 6, rtcRegion: 'europe', updatedAt: '2026-08-24T16:00:00.000Z' },
      u2: { customName: 'Quiet Room', userLimit: 2, rtcRegion: 'automatic', updatedAt: '2026-08-24T15:00:00.000Z' }
    }
  }
}, null, 2));

const {
  getTempVoiceSnapshot,
  removeTempVoiceProfile,
  removeAllTempVoiceProfiles,
  _tempVoiceInternals
} = await import('../src/features/tempVoice.js');

let fetchCalls = 0;
const everyoneOverwrite = (locked) => ({
  deny: { has: (permission) => permission === PermissionFlagsBits.Connect && locked }
});
const channels = new Map([
  ['voice-1', {
    id: 'voice-1',
    name: 'Night Lounge',
    members: { size: 3 },
    userLimit: 6,
    rtcRegion: 'europe',
    guild: { id: 'guild-1' },
    permissionOverwrites: { cache: new Map([['guild-1', everyoneOverwrite(true)]]) }
  }],
  ['voice-2', {
    id: 'voice-2',
    name: 'Quiet Room',
    members: { size: 1 },
    userLimit: 0,
    rtcRegion: null,
    guild: { id: 'guild-1' },
    permissionOverwrites: { cache: new Map([['guild-1', everyoneOverwrite(false)]]) }
  }]
]);
const members = new Map([
  ['u1', {
    id: 'u1',
    displayName: 'User One',
    user: { username: 'one', displayAvatarURL: () => 'https://cdn.example/u1.png' },
    displayAvatarURL: () => 'https://cdn.example/member-u1.png'
  }],
  ['u2', {
    id: 'u2',
    displayName: 'User Two',
    user: { username: 'two', displayAvatarURL: () => 'https://cdn.example/u2.png' }
  }]
]);
const guild = {
  id: 'guild-1',
  channels: { cache: channels, fetch: async () => { fetchCalls += 1; } },
  members: { cache: members, fetch: async () => { fetchCalls += 1; } }
};

const snapshot = await getTempVoiceSnapshot('guild-1', guild);
assert.equal(fetchCalls, 0, 'Snapshot darf Discord ausschließlich aus dem Cache lesen.');
assert.equal(snapshot.activeChannelCount, 2);
assert.equal(snapshot.profileCount, 2);
assert.deepEqual(snapshot.channels[0], {
  channelId: 'voice-1',
  ownerId: 'u1',
  ownerName: 'User One',
  name: 'Night Lounge',
  memberCount: 3,
  userLimit: 6,
  rtcRegion: 'europe',
  locked: true,
  createdAt: '2026-08-24T12:00:00.000Z'
});
members.delete('u2');
const cachedFallbackSnapshot = await getTempVoiceSnapshot('guild-1', guild);
assert.equal(cachedFallbackSnapshot.channels[1].ownerName, 'Stored Two', 'Ohne Member-Cache bleibt der gespeicherte Besitzername sichtbar.');
members.set('u2', {
  id: 'u2',
  displayName: 'User Two',
  user: { username: 'two', displayAvatarURL: () => 'https://cdn.example/u2.png' }
});
assert.equal(snapshot.profiles[0].userId, 'u1');
assert.equal(snapshot.profiles[0].memberName, 'User One');
assert.equal(snapshot.profiles[0].avatarUrl, 'https://cdn.example/member-u1.png');
assert.equal(snapshot.profiles[1].userId, 'u2', 'Profile werden absteigend nach updatedAt sortiert.');

for (let index = 0; index < 101; index += 1) {
  await _tempVoiceInternals.setUserProfile('guild-1', `extra-${index}`, { customName: `Call ${index}` });
}
const limitedSnapshot = await getTempVoiceSnapshot('guild-1', guild);
assert.equal(limitedSnapshot.profileCount, 103, 'profileCount bleibt die exakte Gesamtzahl.');
assert.equal(limitedSnapshot.profiles.length, 100, 'Die UI erhält höchstens 100 Profilzeilen.');
assert.ok(
  limitedSnapshot.profiles.every((profile, index, rows) => index === 0 || rows[index - 1].updatedAt >= profile.updatedAt),
  'Profilzeilen sind absteigend nach updatedAt sortiert.'
);

assert.deepEqual(await removeTempVoiceProfile('guild-1', 'u1'), { ok: true, removed: true });
assert.deepEqual(await removeTempVoiceProfile('guild-1', 'u1'), { ok: true, removed: false });
await assert.rejects(() => removeTempVoiceProfile('guild-1', '__proto__'), /ungültig/i);
const clearResult = await removeAllTempVoiceProfiles('guild-1');
assert.deepEqual(clearResult, { ok: true, removedCount: 102 });
assert.deepEqual(await removeAllTempVoiceProfiles('guild-1'), { ok: true, removedCount: 0 });

const dashboardSource = await fsp.readFile(new URL('../src/dashboard.js', import.meta.url), 'utf8');
const indexSource = await fsp.readFile(new URL('../src/index.js', import.meta.url), 'utf8');
const packageJson = JSON.parse(await fsp.readFile(new URL('../package.json', import.meta.url), 'utf8'));

assert.match(
  dashboardSource,
  /app\.delete\('\/api\/guild\/:guildId\/temp-voice\/profiles\/:userId',\s*requireAuth,\s*requireGuildAccess/,
  'Einzel-Reset muss Authentifizierung und Guild-Zugriff erzwingen.'
);
assert.match(
  dashboardSource,
  /app\.delete\('\/api\/guild\/:guildId\/temp-voice\/profiles',\s*requireAuth,\s*requireGuildAccess/,
  'Gesamt-Reset muss Authentifizierung und Guild-Zugriff erzwingen.'
);
assert.match(indexSource, /getTempVoiceSnapshot\(guildId,\s*guild\)/, 'Index muss den Guild-Cache an den Snapshot reichen.');
assert.match(indexSource, /removeTempVoiceProfile:/, 'Index muss den Einzel-Reset bereitstellen.');
assert.match(indexSource, /removeAllTempVoiceProfiles:/, 'Index muss den Gesamt-Reset bereitstellen.');
assert.match(packageJson.scripts['test:community'], /temp-voice-smoke\.mjs && node scripts\/temp-voice-dashboard-smoke\.mjs/);

console.log('TempVoice-Dashboard-Smoke bestanden: Cache-Snapshot, Profilgrenze und sichere Reset-API sind verbunden.');
