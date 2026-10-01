import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Regression: readJsonWithRecovery liefert { value, ... } – die Module müssen
// .value lesen. Vor dem Fix wurde das Wrapper-Objekt direkt gespreadet: Nach
// jedem Neustart waren TempVoice-Kanäle und Abstimmungen vergessen („Kanal
// nicht als TempVoice erkannt“, „Abstimmung abgelaufen/existiert nicht mehr“).
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-state-restore-'));
process.env.FALLEN_HEAVEN_DATA_DIR = root;

// Datei im Format, das die alte Version geschrieben hat: echte Daten auf
// oberster Ebene, dazu die Wrapper-Felder von readJsonWithRecovery.
const legacyFile = {
  version: 3,
  channels: {
    '123456789012345678': {
      guildId: 'g1',
      ownerId: 'owner1',
      ownerName: 'Max',
      createdAt: '2026-08-12T10:00:00.000Z',
      interfaceMessageId: 'msg1',
      interfaceChannelId: 'text1'
    }
  },
  votes: {
    g1: {
      'vote-1': {
        targetUserId: 'user-b',
        targetName: 'Bob',
        reasonId: 'noise',
        channelId: 'voice-1',
        attendingCount: 5,
        yes: ['user-a'],
        no: [],
        startedBy: 'user-a',
        startedByName: 'Alice',
        startedAt: Date.now() - 120_000,
        endsAt: Date.now() - 60_000,
        panelChannelId: 'text-1',
        messageId: '',
        settled: false
      }
    }
  },
  panels: {},
  strikes: {},
  value: { version: 1, channels: {}, votes: {}, panels: {}, strikes: {} },
  source: 'primary',
  recovered: false,
  failures: []
};
fs.writeFileSync(path.join(root, 'temp-voice.json'), JSON.stringify(legacyFile, null, 2), 'utf8');
fs.writeFileSync(path.join(root, 'public-call-vote.json'), JSON.stringify(legacyFile, null, 2), 'utf8');

const { _tempVoiceInternals } = await import('../src/features/tempVoice.js');
const { _publicCallVoteInternals } = await import('../src/features/publicCallVote.js');

// 1) TempVoice: Kanal wird nach „Neustart“ wieder als TempVoice erkannt.
const entry = await _tempVoiceInternals.findOwnedChannel('g1', '123456789012345678');
assert.ok(entry && String(entry.ownerId) === 'owner1', 'TempVoice-Kanal wird nach Neustart wiedererkannt');
assert.equal(entry.interfaceMessageId, 'msg1', 'Interface-Referenz wird wiederhergestellt');

// 2) Public-Call-Vote: beendete Abstimmung mit Stimme wird geladen und entschieden.
const conf = _publicCallVoteInternals.normalizePublicCallVoteConfig({ enabled: true, callChannelIds: ['voice-1'], timeoutSeconds: 60 });
const guild = { id: 'g1', channels: { cache: new Map() } };
await _publicCallVoteInternals.evaluateVote({ guild, voteId: 'vote-1', conf });
const voteFile = JSON.parse(fs.readFileSync(path.join(root, 'public-call-vote.json'), 'utf8'));
assert.equal(voteFile.votes.g1['vote-1'].settled, true, 'Abstimmung wird nach Neustart geladen und entschieden');

// 3) Sauberes Schreiben: Der neue Persist erzeugt keine doppelten Daten mehr.
await _tempVoiceInternals.setChannelEntry('123456789012345678', {
  guildId: 'g1',
  ownerId: 'owner1',
  ownerName: 'Max',
  createdAt: '2026-08-12T10:00:00.000Z',
  interfaceMessageId: 'msg1',
  interfaceChannelId: 'text1'
});
const tvFile = JSON.parse(fs.readFileSync(path.join(root, 'temp-voice.json'), 'utf8'));
assert.equal('value' in tvFile, false, 'neues Format ohne readJsonWithRecovery-Wrapper');
assert.equal(tvFile.version, 4, 'TempVoice-State wird auf Version 4 geschrieben');
assert.deepEqual(tvFile.profiles, {}, 'Migration legt einen leeren Profilbereich an');
assert.equal(tvFile.channels['123456789012345678'].ownerId, 'owner1');

fs.rmSync(root, { recursive: true, force: true });
console.log('✅ state-restore-smoke: State wird nach Neustart wiederhergestellt (TempVoice + Abstimmung)');
