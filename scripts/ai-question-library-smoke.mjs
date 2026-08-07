import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const temporaryData = await fs.mkdtemp(path.join(os.tmpdir(), 'fhcc-ai-question-library-'));
process.env.FALLEN_HEAVEN_DATA_DIR = temporaryData;

const { _questionLibraryInternals } = await import('../src/ai/knowledge/questionLibrary.js');
const { _aiChatInternals } = await import('../src/features/aiChat.js');

const { matchQuestionLibraryIntent, buildQuestionLibraryAnswer, nextBoostGoal, LIBRARY_ENTRIES } = _questionLibraryInternals;
const { classifyServerKnowledgeIntent, buildDirectServerAnswer } = _aiChatInternals;

let passed = 0;
let failed = 0;
const deepEqual = (left, right) => {
  if (left === right) return true;
  if (typeof left !== 'object' || typeof right !== 'object' || !left || !right) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => deepEqual(left[key], right[key]));
};
const check = (label, actual, expected) => {
  const ok = typeof expected === 'function' ? expected(actual) : deepEqual(actual, expected);
  if (ok) { passed += 1; console.log(`PASS · ${label}`); }
  else { failed += 1; console.log(`FAIL · ${label}\n  erwartet: ${JSON.stringify(expected)}\n  erhalten: ${JSON.stringify(actual)}`); }
};

const guildId = '1276125977805721640';
const memberId = '542068115161350174';
const olderMemberId = '918550968440860723';
const createdAt = new Date('2024-05-14T10:00:00.000Z').toISOString();

const snapshot = {
  guildId,
  name: 'Fallen Heaven',
  description: 'Minecraft- und Gaming-Community mit Levelsystem, VIP-Coins und Events.',
  ownerId: '111111111111111111',
  createdAt,
  memberCount: 42,
  humanCount: 39,
  botCount: 3,
  onlineCount: 12,
  joinedToday: 2,
  joinedYesterday: 1,
  joinedWeek: 5,
  joinedTodayMembers: [],
  joinedYesterdayMembers: [],
  joinedWeekMembers: [
    { id: memberId, displayName: 'Neuling', username: 'neuling', joinedAt: '2026-08-05T12:00:00.000Z' }
  ],
  members: [
    { id: olderMemberId, displayName: 'FALLEN ANGEL', username: 'fallen_angel', joinedAt: '2024-05-14T10:00:00.000Z', boosting: true },
    { id: memberId, displayName: 'Neuling', username: 'neuling', joinedAt: '2026-08-05T12:00:00.000Z', boosting: false }
  ],
  boostCount: 5,
  boosterCount: 2,
  boosters: [
    { id: olderMemberId, displayName: 'FALLEN ANGEL', premiumSinceTimestamp: '2024-05-20T10:00:00.000Z' },
    { id: '222222222222222222', displayName: 'Zweiter', premiumSinceTimestamp: '2025-01-01T10:00:00.000Z' }
  ],
  boostTier: 1,
  roleCount: 9,
  channelCount: 12,
  textChannelCount: 8,
  forumChannelCount: 1,
  announcementChannelCount: 1,
  voiceChannelCount: 2,
  stageChannelCount: 0,
  categoryCount: 3,
  emojiCount: 14,
  animatedEmojiCount: 2,
  stickerCount: 4,
  eventCount: 1,
  events: [],
  guideChannels: [],
  timezone: 'Europe/Berlin',
  capturedAt: new Date().toISOString()
};

const message = {
  guildId,
  channelId: '1524484484236578919',
  id: '1534255511000000001',
  author: { id: memberId, username: 'neuling' },
  channel: { id: '1524484484236578919', name: 'ai-chat', parent: { name: 'Community' } },
  mentions: { members: { first: () => null } }
};

// Guild-Mock für Kanal-Fragen (createdTimestamp = echte Discord-Kanaldaten)
const channelMock = (id, name, createdTimestamp) => ({ id, name, type: 0, createdTimestamp });
const guild = {
  id: guildId,
  name: 'Fallen Heaven',
  features: ['COMMUNITY'],
  channels: {
    cache: new Map([
      ['111', channelMock('111', 'willkommen', Date.parse('2024-05-14T10:00:00.000Z'))],
      ['112', channelMock('112', 'allgemein', Date.parse('2024-06-01T10:00:00.000Z'))],
      ['113', channelMock('113', 'neu-kanael', Date.parse('2026-08-01T10:00:00.000Z'))]
    ])
  }
};

// --- Boost-Ziel-Berechnung ---
check('nextBoostGoal: 0 Boosts → Stufe 1 bei 2', nextBoostGoal(0), { nextTier: 1, goal: 2, missing: 2 });
check('nextBoostGoal: 5 Boosts → Stufe 2 bei 7', nextBoostGoal(5), { nextTier: 2, goal: 7, missing: 2 });
check('nextBoostGoal: 60+ → null', nextBoostGoal(99), null);

// --- Intent-Erkennung über die Bibliothek ---
const libraryCases = [
  ['wofür ist dieser server da?', 'server-purpose'],
  ['was ist der zweck des servers?', 'server-purpose'],
  ['wer ist das älteste mitglied?', 'oldest-member'],
  ['wer ist am längsten dabei?', 'oldest-member'],
  ['wer ist das neueste mitglied?', 'newest-member'],
  ['wer ist zuletzt beigetreten?', 'newest-member'],
  ['wie viele boosts brauchen wir bis zur nächsten stufe?', 'boost-goal'],
  ['boosts bis zur nächsten stufe?', 'boost-goal'],
  ['wer boosted am längsten?', 'longest-booster'],
  ['wer ist der älteste booster?', 'longest-booster'],
  ['welche farbe hat die rolle?', 'role-color'],
  ['wie viele mitglieder haben die rolle?', 'role-member-count'],
  ['wie viele leute haben die rolle?', 'role-member-count'],
  ['wie hoch ist der slowmode?', 'channel-slowmode'],
  ['was ist das thema des kanals?', 'channel-topic'],
  ['wie spät ist es?', 'server-time'],
  ['welche zeitzone hat der server?', 'server-time'],
  ['ist der server verifiziert?', 'server-features'],
  ['welche kategorien gibt es?', 'category-list'],
  ['welche voice kanäle gibt es?', 'voice-channel-list'],
  ['wann bin ich beigetreten?', 'self-joined-date'],
  ['wann ist er beigetreten?', 'member-joined-date'],
  ['wie lange gibt es diesen server schon?', 'server-age'],
  ['wie lange existiert unser server?', 'server-age'],
  ['wie lange gibt es den kanal schon?', 'channel-age'],
  ['welcher kanal ist der älteste?', 'channel-oldest'],
  ['welcher kanal ist der neueste?', 'channel-newest'],
  ['der wievielte beitritt bin ich?', 'member-join-position']
];
for (const [question, expected] of libraryCases) {
  const intent = matchQuestionLibraryIntent(question);
  check(`Bibliothek: "${question}" → ${expected}`, intent, expected);
}

// --- Einbindung in classifyServerKnowledgeIntent (alle Kategorien) ---
for (const [question, expectedType] of libraryCases) {
  const intent = classifyServerKnowledgeIntent(question);
  check(`classifyServerKnowledgeIntent: "${question}" → ${expectedType}`, intent?.type, expectedType);
}

// --- Antwort-Builder ---
check('Antwort: server-purpose', buildQuestionLibraryAnswer('server-purpose', { snapshot, content: '' }),
  (value) => value.includes('Fallen Heaven') && value.includes('42 Mitglieder'));
check('Antwort: oldest-member', buildQuestionLibraryAnswer('oldest-member', { snapshot }),
  (value) => value.includes('FALLEN ANGEL') && value.includes('<t:'));
check('Antwort: newest-member', buildQuestionLibraryAnswer('newest-member', { snapshot }),
  (value) => value.includes('Neuling'));
check('Antwort: boost-goal', buildQuestionLibraryAnswer('boost-goal', { snapshot }),
  (value) => value.includes('5 Boosts') && value.includes('Stufe **2**') && value.includes('fehlen noch **2'));
check('Antwort: longest-booster', buildQuestionLibraryAnswer('longest-booster', { snapshot }),
  (value) => value.includes('FALLEN ANGEL'));
check('Antwort: server-time', buildQuestionLibraryAnswer('server-time', { snapshot }),
  (value) => value.includes('Europe/Berlin') && value.includes('Uhr'));
check('Antwort: self-joined-date', buildQuestionLibraryAnswer('self-joined-date', { snapshot, message }),
  (value) => value.includes('beigetreten'));
check('Antwort: server-age', buildQuestionLibraryAnswer('server-age', { snapshot }),
  (value) => value.includes('Fallen Heaven') && value.includes('<t:1715680800:D>') && value.includes('Jahr'));
check('Antwort: channel-age', buildQuestionLibraryAnswer('channel-age', { guild, content: 'wie alt ist der kanal allgemein?' }),
  (value) => value.includes('<#112>') && value.includes('<t:1717236000:D>'));
check('Antwort: channel-oldest', buildQuestionLibraryAnswer('channel-oldest', { guild }),
  (value) => value.includes('<#111>') && value.includes('willkommen'));
check('Antwort: channel-newest', buildQuestionLibraryAnswer('channel-newest', { guild }),
  (value) => value.includes('<#113>') && value.includes('neu-kanael'));
check('Antwort: member-join-position', buildQuestionLibraryAnswer('member-join-position', { snapshot, message }),
  (value) => value.includes('zweite') && value.includes('2'));
check('Antwort: member-join-position (User fehlt) → leer', buildQuestionLibraryAnswer('member-join-position', { snapshot, message: { ...message, author: { id: '999999999999999999' } } }), '');
check('Antwort: role-color (ohne Guild) → leer', buildQuestionLibraryAnswer('role-color', { snapshot }), '');
check('Antwort: unbekannter Typ → leer', buildQuestionLibraryAnswer('gibtsnicht', { snapshot }), '');

// --- Screenshot-Fall: „wie lange gibt es diesen Discord Server schon?“ ---
const screenshotIntent = classifyServerKnowledgeIntent('wie lange gibt es diesen discord server schon?');
check('Screenshot-Fall: Intent ist faktenbasiert (server-age)', screenshotIntent?.type, 'server-age');
check('Screenshot-Fall: buildDirectServerAnswer nutzt echtes createdAt',
  buildDirectServerAnswer(screenshotIntent, snapshot, 'wie lange gibt es diesen discord server schon?', message),
  (value) => value.includes('Fallen Heaven') && value.includes('<t:1715680800:D>') && !value.includes('14. Mai 2026, als er'));

// --- buildDirectServerAnswer End-to-End ---
check('buildDirectServerAnswer: boost-goal', buildDirectServerAnswer({ type: 'boost-goal', direct: true }, snapshot, 'wie viele boosts bis zur nächsten stufe?', message),
  (value) => value.includes('5 Boosts') && value.includes('Stufe **2**') && value.includes('fehlen noch **2'));
check('buildDirectServerAnswer: oldest-member', buildDirectServerAnswer({ type: 'oldest-member', direct: true }, snapshot, 'wer ist am längsten dabei?', message),
  (value) => value.includes('FALLEN ANGEL'));
check('buildDirectServerAnswer: server-purpose', buildDirectServerAnswer({ type: 'server-purpose', direct: true }, snapshot, 'wofür ist dieser server da?', message),
  (value) => value.includes('Fallen Heaven'));

// --- Kategorien-Abdeckung: keine leeren Patterns ---
for (const entry of LIBRARY_ENTRIES) {
  check(`Kategorie ${entry.type}: Patterns vorhanden`, entry.patterns.length > 0, true);
  check(`Kategorie ${entry.type}: Build-Funktion`, typeof entry.build === 'function', true);
}

console.log(`\n=== Ergebnis: ${passed} bestanden, ${failed} fehlgeschlagen ===`);
process.exit(failed ? 1 : 0);
