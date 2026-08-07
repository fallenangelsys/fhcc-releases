import assert from 'node:assert/strict';
import { Collection, PermissionFlagsBits } from 'discord.js';

import { _aiChatInternals } from '../src/features/aiChat.js';

const {
  getAiConfig,
  getEffectiveAnswerLimit,
  getPredictionLimit,
  trimToNaturalEnd,
  sanitizeReply,
  stripGeneratedPromptArtifacts,
  looksLikeIncompleteReply,
  discardIncompleteReplyTail,
  buildAppDiagnosticsAnswer,
  canViewDetailedAppDiagnostics,
  buildDirectDiscordFactAnswer,
  classifyServerKnowledgeIntent,
  findNamedGuildMember,
  buildRoleGroupRankingAnswer,
  buildUnknownMembersAnswer,
  buildDirectServerAnswer,
  buildJoinedMembersAnswer,
  contextualDirectServerIntent,
  rememberDirectServerFact,
  dedupeConversationHistory,
  currentConversationHistory,
  classifyAiKnowledgeRoute,
  canInspectEconomyAccount,
  requesterCanReadChannel,
  findRequestedGuildChannel,
  shouldUseCurrentChannelAsTarget,
  buildSearchQueryFromContext,
  classifySafetyBoundary,
  extractFacts,
  mergeFacts,
  isExplicitGifRequest,
  buildGifSearchQuery,
  polishHumanReply,
  buildActivityRaceRankAnswer,
  buildIndexedMemberActivityAnswer,
  buildMessages
} = _aiChatInternals;

const rememberedFacts = extractFacts('Ich mag Minecraft.', {
  messageId: '123456789012345678',
  channelId: '223456789012345678',
  observedAt: '2026-08-04T10:00:00.000Z'
});
assert.equal(rememberedFacts[0]?.value, 'Minecraft');
assert.equal(rememberedFacts[0]?.sourceMessageId, '123456789012345678');
assert.equal(mergeFacts(['Mag: Minecraft'], rememberedFacts)[0]?.label, 'Mag');

const responseAi = getAiConfig({ aiChat: { responseLength: 'normal', maxResponseChars: 2000 } });
assert.equal(responseAi.maxResponseChars, 2000);
assert.equal(getEffectiveAnswerLimit(responseAi), 2000);
assert.ok(getPredictionLimit(responseAi) >= 1000, 'Ollama braucht ausreichend Generierungsreserve für vollständige 2.000-Zeichen-Antworten.');
const shortStyleAi = getAiConfig({ aiChat: { responseLength: 'kurz', maxResponseChars: 2000, contextTokens: 4096 } });
assert.equal(getEffectiveAnswerLimit(shortStyleAi), 2000, '„Kurz“ ist nur ein Stil und darf das technische Zeichenlimit nicht senken.');
assert.equal(shortStyleAi.contextTokens, 8192, 'Alte 4.096er-Kontexte müssen genug Platz für App-Daten und Antwort erhalten.');
const oversizedAnswer = `${'Ein vollständiger Satz. '.repeat(120)}Dieser Rest darf nicht angeschnitten werden`;
const naturallyTrimmed = trimToNaturalEnd(oversizedAnswer, 2000);
assert.ok(naturallyTrimmed.length <= 2000);
assert.match(naturallyTrimmed, /[.!?…]$/);
const leakedDraft = 'Vorlage: Assistant: Ich finde Superhelden ziemlich cool. Passt zu mir, wenn ich mal drüber nachdenken will oder dir eine Good Answer geben kann.';
assert.equal(stripGeneratedPromptArtifacts(leakedDraft), 'Ich finde Superhelden ziemlich cool. Passt zu mir, wenn ich mal drüber nachdenken will oder dir eine geben kann.');
const cleanedDraft = polishHumanReply(leakedDraft);
assert.equal(cleanedDraft, 'Ich finde Superhelden ziemlich cool.');
assert.doesNotMatch(sanitizeReply(cleanedDraft, 2000), /Assistant|Good Answer|passt zu mir/i);
const danglingList = 'Hier sind zwei Schritte:\n1. Prüfe die Verbindung vollständig.\n2.';
assert.equal(looksLikeIncompleteReply(danglingList), true);
assert.equal(discardIncompleteReplyTail(danglingList), 'Hier sind zwei Schritte:\n1. Prüfe die Verbindung vollständig.');
assert.equal(looksLikeIncompleteReply('Hier sind zwei Schritte:\n1. Prüfe die Verbindung.\n2. Starte den Dienst neu.'), false);
assert.equal(looksLikeIncompleteReply('1. Prüfe die Verbindung.\n2. Starte den'), true);
assert.equal(looksLikeIncompleteReply('Guten Morgen'), false);
assert.equal(looksLikeIncompleteReply('Du gibst aktuell 2 Boosts.'), false);
assert.equal(looksLikeIncompleteReply('```js\nconst ok = true;'), true);

for (const [name, helper] of Object.entries({
  classifyServerKnowledgeIntent,
  findNamedGuildMember,
  buildRoleGroupRankingAnswer,
  buildUnknownMembersAnswer,
  buildJoinedMembersAnswer,
  contextualDirectServerIntent,
  rememberDirectServerFact,
  dedupeConversationHistory,
  currentConversationHistory,
  classifyAiKnowledgeRoute,
  canInspectEconomyAccount,
  requesterCanReadChannel,
  findRequestedGuildChannel,
  shouldUseCurrentChannelAsTarget,
  buildSearchQueryFromContext,
  classifySafetyBoundary,
  isExplicitGifRequest,
  buildGifSearchQuery,
  polishHumanReply,
  buildActivityRaceRankAnswer,
  buildMessages
})) {
  assert.equal(typeof helper, 'function', `AI-Regressions-Helper fehlt: ${name}`);
}

// Die sechs gemeldeten Chat-Sätze müssen stabil und ohne Web-Halluzinationen
// in die dafür vorgesehenen lokalen Pfade gelangen.
assert.equal(classifyServerKnowledgeIntent('wurdest du gewickelt?'), null);
assert.deepEqual(classifyServerKnowledgeIntent('wer sind die unbekannt nutzer'), {
  type: 'unknown-members',
  direct: true
});
assert.deepEqual(classifyServerKnowledgeIntent('erzähle was über den server'), {
  type: 'overview',
  direct: true
});
assert.deepEqual(classifyServerKnowledgeIntent('wer hat die meisten geschlecht rollen'), {
  type: 'role-group-ranking',
  direct: true
});
assert.equal(classifyServerKnowledgeIntent('kannst du coden?'), null);
assert.deepEqual(classifyServerKnowledgeIntent('wer hat die meisten Verstöße auf dem Server'), {
  type: 'moderation-ranking',
  direct: true
});
assert.deepEqual(classifyServerKnowledgeIntent('Welche Rollen gibt es?'), { type: 'roles', direct: true });
assert.deepEqual(classifyServerKnowledgeIntent('Was steht in den Pins?'), { type: 'channel-guide', direct: false });
assert.deepEqual(classifyServerKnowledgeIntent('Was ist im Casino?'), { type: 'channel-guide', direct: false });
assert.deepEqual(classifyServerKnowledgeIntent('Wer hat mich gebannt?'), { type: 'moderation-self', direct: false });
assert.deepEqual(classifyServerKnowledgeIntent('Wer hat die meisten Chat-Nachrichten?'), { type: 'activity', direct: false });
assert.deepEqual(classifyServerKnowledgeIntent('Was ist mein Tagesranking?'), { type: 'activity', direct: false });
assert.deepEqual(classifyServerKnowledgeIntent('Welchen VC-Rang habe ich?'), { type: 'activity', direct: false });
assert.deepEqual(classifyServerKnowledgeIntent('Sage mir den Namen vom Mitglied, das heute beigetreten ist'), { type: 'joined-today', direct: true });
assert.deepEqual(classifyServerKnowledgeIntent('top booster?'), { type: 'boost-ranking', direct: false });
assert.equal(classifyServerKnowledgeIntent('Ich rede von Superhelden aus The Boys auf Amazon Prime Video'), null);
assert.deepEqual(classifyServerKnowledgeIntent('Live Status Werte der App?'), { type: 'app-diagnostics', direct: false });

const diagnosticsAnswer = buildAppDiagnosticsAnswer({
  guildId: 'guild-diagnostics',
  detailed: true,
  diagnostics: {
    measuredAt: '2026-08-04T07:42:00.000Z',
    health: { score: 94 },
    discord: { ready: true, pingMs: 38, guildCount: 1 },
    process: { cpuPercent: 1.4, rssBytes: 100 * 1024 * 1024, uptimeSeconds: 7_560 },
    eventLoop: { p95DelayMs: 4.2, healthy: true },
    jobs: { running: 0, timedOut: 0, sessionCounters: { failed: 0 } },
    index: [{ guildId: 'guild-diagnostics', guildName: 'FALLEN HEAVEN', totalMessages: 127_238, channelCount: 84, userCount: 640, coveragePercent: 100, errorChannels: 0 }]
  },
  liveStatus: {
    ai: { online: true, model: 'qwen2.5:7b' },
    serverTime: '2026-08-04T07:42:00.000Z'
  },
  readiness: { counts: { enabled: 17, ready: 16, attention: 1, blocked: 0 } }
});
assert.match(diagnosticsAnswer, /Live-Status der App.*94\/100/s);
assert.match(diagnosticsAnswer, /38 ms/);
assert.match(diagnosticsAnswer, /127\.238 Nachrichten/);
assert.match(diagnosticsAnswer, /Ollama verbunden.*qwen2\.5:7b/);
assert.match(diagnosticsAnswer, /17 aktiv.*16 bereit.*1 beachten/s);
assert.doesNotMatch(diagnosticsAnswer, /scheint|Benutzer berichtet|Überprüfen Sie/i);

const publicDiagnosticsAnswer = buildAppDiagnosticsAnswer({
  guildId: 'guild-diagnostics',
  detailed: false,
  diagnostics: {
    health: { score: 90 },
    discord: { ready: true, pingMs: 42 },
    process: { uptimeSeconds: 600, cpuPercent: 99, rssBytes: 999_999 },
    index: [{ guildId: 'other-guild', totalMessages: 999_999 }]
  },
  liveStatus: { ai: { online: true, model: 'private-model' } }
});
assert.match(publicDiagnosticsAnswer, /Discord.*verbunden.*42 ms/s);
assert.doesNotMatch(publicDiagnosticsAnswer, /CPU|RAM|private-model|999\.999|Hintergrundjobs/);

const missingDiagnosticsAnswer = buildAppDiagnosticsAnswer({
  guildId: 'guild-diagnostics',
  detailed: true,
  diagnostics: { health: {}, discord: {}, process: {}, eventLoop: {}, jobs: {}, index: [] }
});
assert.match(missingDiagnosticsAnswer, /nicht verfügbar|wird ermittelt|werden noch geladen/);
assert.doesNotMatch(missingDiagnosticsAnswer, /0 % CPU|P95 0|0 MB RAM/);

const ownerDiagnosticsMessage = {
  author: { id: 'owner-user' },
  guild: { ownerId: 'owner-user' },
  member: { id: 'owner-user', permissions: { has: () => false }, roles: { cache: new Collection() } }
};
assert.equal(canViewDetailedAppDiagnostics(ownerDiagnosticsMessage, {}), true);
const regularDiagnosticsMessage = {
  author: { id: 'regular-user' },
  guild: { ownerId: 'owner-user' },
  member: { id: 'regular-user', permissions: { has: () => false }, roles: { cache: new Collection() } }
};
assert.equal(canViewDetailedAppDiagnostics(regularDiagnosticsMessage, {}), false);

const routedDiagnosticsAnswer = await buildDirectDiscordFactAnswer({
  message: {
    ...ownerDiagnosticsMessage,
    content: 'Live Status Werte der App?',
    guild: { id: 'guild-diagnostics', ownerId: 'owner-user' }
  },
  route: { mode: 'server', serverIntent: { type: 'app-diagnostics', direct: false } },
  cfg: {},
  getAiOperationalStatus: async () => ({
    diagnostics: {
      health: { score: 94 },
      discord: { ready: true, pingMs: 38 },
      process: { cpuPercent: 1, rssBytes: 50 * 1024 * 1024, uptimeSeconds: 60 },
      eventLoop: { p95DelayMs: 3, healthy: true },
      jobs: { active: [], timedOut: 0, sessionCounters: { failed: 0 } },
      index: []
    },
    liveStatus: { ai: { online: true, model: 'qwen2.5:7b' } },
    readiness: { counts: { enabled: 17, ready: 17, attention: 0, blocked: 0 } }
  })
});
assert.match(routedDiagnosticsAnswer, /Live-Status der App/);
assert.match(routedDiagnosticsAnswer, /50 MB RAM/);

const personalActivityRoute = await classifyAiKnowledgeRoute({
  content: 'Was ist mein Tagesranking?',
  message: {
    author: { id: 'ranking-user' },
    member: { id: 'ranking-user', user: { id: 'ranking-user', bot: false } },
    guild: { members: { cache: new Collection() } },
    mentions: { members: new Collection() },
    client: { user: { id: 'bot-user' } }
  },
  channelMemory: { messages: [] },
  ai: { channelIdleMinutes: 60 }
});
assert.equal(personalActivityRoute.mode, 'server');
assert.equal(personalActivityRoute.serverIntent.type, 'activity');
assert.equal(personalActivityRoute.memberId, 'ranking-user');
assert.doesNotMatch(personalActivityRoute.instruction, /Websuche verwenden/i);

for (const query of [
  'Was ist meine Tagesaktivität?',
  'Was ist mein Rank?',
  'Mein heutiger Liga-Stand',
  'Wie viele Nachrichten habe ich heute?',
  'Wie lange war ich heute im VC?'
]) {
  const routed = await classifyAiKnowledgeRoute({
    content: query,
    message: {
      author: { id: 'ranking-user' },
      member: { id: 'ranking-user', user: { id: 'ranking-user', bot: false } },
      guild: { members: { cache: new Collection() } },
      mentions: { members: new Collection() },
      client: { user: { id: 'bot-user' } }
    },
    channelMemory: { messages: [] },
    ai: getAiConfig({ aiChat: { semanticRoutingEnabled: false } })
  });
  assert.equal(routed.mode, 'server', `${query} muss die strukturierte Aktivitäts-Liga verwenden.`);
  assert.equal(routed.serverIntent.type, 'activity');
  assert.equal(routed.memberId, 'ranking-user');
}

const activityFollowupRoute = await classifyAiKnowledgeRoute({
  content: 'Und im Voice?',
  message: {
    author: { id: 'ranking-user' },
    member: { id: 'ranking-user', user: { id: 'ranking-user', bot: false } },
    guild: { members: { cache: new Collection() } },
    mentions: { members: new Collection() },
    client: { user: { id: 'bot-user' } }
  },
  channelMemory: { messages: [{ role: 'user', authorId: 'ranking-user', content: 'Was ist mein Tagesranking?', createdAt: new Date().toISOString() }] },
  ai: getAiConfig({ aiChat: { semanticRoutingEnabled: false } })
});
assert.equal(activityFollowupRoute.serverIntent.type, 'activity');
assert.equal(activityFollowupRoute.memberId, 'ranking-user');

for (const query of [
  'Wie viele Nachrichten hab ich insgesamt?',
  'Wie viele Nachrichten habe ich auf dem Server insgesamt geschrieben?',
  'Zeig mir meine serverweiten Nachrichten insgesamt.'
]) {
  const routed = await classifyAiKnowledgeRoute({
    content: query,
    message: {
      author: { id: 'message-total-user' },
      member: { id: 'message-total-user', user: { id: 'message-total-user', bot: false } },
      guild: { members: { cache: new Collection() } },
      mentions: { members: new Collection() },
      client: { user: { id: 'bot-user' } }
    },
    channelMemory: { messages: [{ role: 'user', authorId: 'message-total-user', content: 'Wie viele Heaven Coins habe ich?', createdAt: new Date().toISOString() }] },
    ai: getAiConfig({ aiChat: { semanticRoutingEnabled: false } })
  });
  assert.equal(routed.mode, 'personal-memory', `${query} darf nicht den alten Coin-Kontext übernehmen.`);
  assert.equal(routed.memberField, 'messages');
  assert.equal(routed.memberId, 'message-total-user');
}

const appDiagnosticsRoute = await classifyAiKnowledgeRoute({
  content: 'Live Status Werte der App?',
  message: {
    author: { id: 'diagnostics-user' },
    member: { id: 'diagnostics-user', user: { id: 'diagnostics-user', bot: false } },
    guild: { members: { cache: new Collection() } },
    mentions: { members: new Collection() },
    client: { user: { id: 'bot-user' } }
  },
  channelMemory: { messages: [] },
  ai: getAiConfig({ aiChat: { semanticRoutingEnabled: false } })
});
assert.equal(appDiagnosticsRoute.mode, 'server');
assert.equal(appDiagnosticsRoute.serverIntent.type, 'app-diagnostics');
assert.equal(appDiagnosticsRoute.webIntent?.mode || 'none', 'none');

const joinedAnswer = buildDirectServerAnswer(
  { type: 'joined-today', direct: true },
  {
    joinedToday: 1,
    joinedTodayMembers: [{
      id: '400000000000000001',
      displayName: 'Neue Person',
      username: 'neue.person',
      joinedAt: new Date().toISOString(),
      systemMessage: true
    }]
  },
  'Wie viele Leute sind heute beigetreten?'
);
assert.match(joinedAnswer, /Neue Person/);
assert.match(joinedAnswer, /neue\.person/);
assert.match(joinedAnswer, /Systemnachricht/);
assert.doesNotMatch(joinedAnswer, /<@400000000000000001>/, 'Join-Auskunft darf das neue Mitglied nicht anpingen.');

const followupMessage = { guildId: 'guild-join', channelId: 'channel-join', author: { id: 'author-join' } };
rememberDirectServerFact(followupMessage, { type: 'joined-today', direct: true });
assert.deepEqual(contextualDirectServerIntent('Wie heißt die Person?', followupMessage), {
  type: 'joined-today',
  direct: true,
  contextualFollowup: true
});

const role = (id, name, position, members = []) => ({
  id,
  name,
  position,
  managed: false,
  members: new Collection(members.map((member) => [member.id, member]))
});
const member = (id, displayName, roleIds, bot = false) => ({
  id,
  displayName,
  user: { id, username: displayName, globalName: displayName, bot },
  roles: { cache: new Collection(roleIds.map((roleId) => [roleId, { id: roleId }])) }
});

const alice = member('100000000000000001', 'Alice', ['geschlecht-m', 'geschlecht-w']);
const bob = member('100000000000000002', 'Bob', ['geschlecht-w']);
const carol = member('100000000000000003', 'Carol', ['admin', 'alter-18']);
const crawler = member('100000000000000004', 'Crawler', ['geschlecht-m', 'geschlecht-w', 'geschlecht-d'], true);
const rankingGuild = {
  id: 'guild-regression',
  roles: {
    cache: new Collection([
      ['guild-regression', role('guild-regression', '@everyone', 0)],
      ['admin', role('admin', 'Admin', 110)],
      ['geschlecht', role('geschlecht', 'Geschlecht', 100)],
      ['geschlecht-m', role('geschlecht-m', 'Männlich', 99)],
      ['geschlecht-w', role('geschlecht-w', 'Weiblich', 98)],
      ['geschlecht-d', role('geschlecht-d', 'Divers', 97)],
      ['alter', role('alter', 'Alter', 90)],
      ['alter-18', role('alter-18', '18+', 89)]
    ])
  },
  members: { cache: new Collection([alice, bob, carol, crawler].map((entry) => [entry.id, entry])) }
};

const preciseStaffAnswer = buildDirectServerAnswer(
  { type: 'staff', direct: true },
  { staffMembers: [{ id: alice.id, roles: ['Trial-Sup', 'Team', '↪ T E A M 🪽'] }] },
  'Welche Rolle spielt @Alice im Team?',
  { mentions: { members: new Collection([[alice.id, alice]]) } }
);
assert.match(preciseStaffAnswer, /<@100000000000000001>.*\*\*Trial-Sup\*\*/);
assert.doesNotMatch(preciseStaffAnswer, /Aktuell erkannte Teammitglieder|Bob|Carol/);

const genderRanking = buildRoleGroupRankingAnswer(rankingGuild, 'wer hat die meisten geschlecht rollen');
assert.match(genderRanking, /<@100000000000000001>/);
assert.match(genderRanking, /2 Rollen/);
assert.doesNotMatch(genderRanking, /<@100000000000000002>|<@100000000000000003>|Crawler|Admin|18\+/);

const unknownWithoutRole = buildUnknownMembersAnswer(rankingGuild);
assert.match(unknownWithoutRole, /nicht eindeutig/i);
assert.match(unknownWithoutRole, /bestimmten Rolle|fehlenden Angaben/i);

const unknownOne = member('200000000000000001', 'Nebel', ['unknown']);
const unknownTwo = member('200000000000000002', 'Schatten', ['unknown']);
const unknownRole = role('unknown', 'Unbekannt', 50, [unknownOne, unknownTwo]);
const unknownGuild = {
  id: 'guild-unknown',
  roles: { cache: new Collection([['unknown', unknownRole]]) },
  members: { cache: new Collection([[unknownOne.id, unknownOne], [unknownTwo.id, unknownTwo]]) }
};
const unknownAnswer = buildUnknownMembersAnswer(unknownGuild);
assert.match(unknownAnswer, /2 Mitglieder/);
assert.match(unknownAnswer, /<@200000000000000001>/);
assert.match(unknownAnswer, /<@200000000000000002>/);

const mei = member('300000000000000001', 'Mei', []);
const meister = member('300000000000000002', 'Meister', []);
const namedGuild = { members: { cache: new Collection([[mei.id, mei], [meister.id, meister]]) } };
assert.equal(findNamedGuildMember(namedGuild, 'wer ist Mei?')?.id, mei.id);
assert.equal(findNamedGuildMember(namedGuild, 'wer sind unbekannte Nutzer?'), null);

const activitySnapshot = {
  enabled: true,
  periods: {
    daily: {
      start: '2026-08-04',
      end: '2026-08-04',
      fullChat: [
        { userId: meister.id, rank: 1, value: 12 },
        { userId: mei.id, rank: 2, value: 7 },
        { userId: bob.id, rank: 3, value: 2 }
      ],
      fullVoice: [
        { userId: mei.id, rank: 1, value: 3_660_000 },
        { userId: meister.id, rank: 2, value: 1_800_000 },
        { userId: bob.id, rank: 3, value: 0 }
      ]
    },
    weekly: { fullyTracked: false },
    monthly: { fullyTracked: false }
  }
};
const selfRanking = buildActivityRaceRankAnswer({
  snapshot: activitySnapshot,
  guild: namedGuild,
  userId: mei.id,
  requesterId: mei.id,
  query: 'Was ist mein Tagesranking?'
});
assert.match(selfRanking, /Dein heutiges Ranking/);
assert.match(selfRanking, /Chat:\*\* Platz \*\*2 von 3\*\*/);
assert.match(selfRanking, /Sprachchat:\*\* Platz \*\*1 von 3\*\*/);
assert.match(selfRanking, /61 gewertete Min\./);
const unfinishedWeeklyRanking = buildActivityRaceRankAnswer({
  snapshot: activitySnapshot,
  guild: namedGuild,
  userId: mei.id,
  requesterId: mei.id,
  query: 'Was ist mein Wochenranking?'
});
assert.match(unfinishedWeeklyRanking, /keinen vollständig erfassten, abgeschlossenen Zeitraum/);
assert.doesNotMatch(unfinishedWeeklyRanking, /Platz \*\*/);

const lastIndexedMessage = buildIndexedMemberActivityAnswer({
  profile: {
    analyzedMessages: 42,
    activeChannels: 3,
    lastMessageAt: '2026-08-04T20:15:00.000Z',
    evidence: [{
      channelId: '500000000000000003',
      createdAt: '2026-08-04T20:15:00.000Z',
      content: 'Das ist meine letzte belegte Nachricht.'
    }]
  },
  self: true,
  query: 'Was habe ich zuletzt geschrieben?'
});
assert.match(lastIndexedMessage, /letzte sichtbare indexierte Nachricht/);
assert.match(lastIndexedMessage, /Das ist meine letzte belegte Nachricht\./);
assert.doesNotMatch(lastIndexedMessage, /Minecraft|nicht verfügbar/i);

const requester = { id: 'requester' };
const channel = (id, name, readable) => ({
  id,
  name,
  rawPosition: Number(id.slice(-1)),
  isTextBased: () => true,
  isThread: () => false,
  permissionsFor: () => ({
    has: (flag) => readable && [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory].includes(flag)
  })
});
const publicCasino = channel('500000000000000001', 'casino', true);
const privateStaff = channel('500000000000000002', 'staff-geheim', false);
const currentChannel = channel('500000000000000003', 'ai-chat', true);
const channelGuild = { channels: { cache: new Collection([[publicCasino.id, publicCasino], [privateStaff.id, privateStaff], [currentChannel.id, currentChannel]]) } };
assert.equal(requesterCanReadChannel(publicCasino, requester), true);
assert.equal(requesterCanReadChannel(privateStaff, requester), false);
assert.equal(findRequestedGuildChannel(channelGuild, 'Wie funktioniert Casino?', { requester })?.id, publicCasino.id);
assert.equal(findRequestedGuildChannel(channelGuild, 'Was steht in staff-geheim?', { requester }), null);
assert.equal(findRequestedGuildChannel(channelGuild, `<#${privateStaff.id}>`, { requester }), null);
assert.equal(shouldUseCurrentChannelAsTarget('Was steht in den Pins?'), true);
assert.equal(findRequestedGuildChannel(channelGuild, 'Was steht in den Pins?', {
  requester,
  fallbackChannelId: currentChannel.id,
  allowFallback: true
})?.id, currentChannel.id);

const moderationAnswer = buildDirectServerAnswer(
  { type: 'moderation-ranking', direct: true },
  {},
  'wer hat die meisten Verstöße auf dem Server'
);
assert.match(moderationAnswer, /vertraulich|keine Namensrangliste/i);
assert.doesNotMatch(moderationAnswer, /Mei|<@\d+>/i);

const overviewAnswer = buildDirectServerAnswer(
  { type: 'overview', direct: true },
  {
    name: 'FALLEN HEAVEN',
    memberCount: 640,
    humanCount: 621,
    botCount: 19,
    channelCount: 84,
    roleCount: 52,
    boostCount: 53,
    boostTier: 3,
    eventCount: 2,
    description: 'Eine Community für gemeinsame Projekte.'
  },
  'erzähle was über den server'
);
assert.match(overviewAnswer, /FALLEN HEAVEN/);
assert.match(overviewAnswer, /640 Mitglieder/);
assert.match(overviewAnswer, /84 Kanäle/);
assert.match(overviewAnswer, /52 Rollen/);
assert.match(overviewAnswer, /53 aktive Boosts/);

const now = Date.now();
const history = [
  { exchangeId: 'alt', role: 'user', authorId: 'user-a', content: 'Welche Emojis magst du?', createdAt: new Date(now - 130 * 60_000).toISOString() },
  { exchangeId: 'neu', role: 'user', authorId: 'user-a', content: 'wurdest du gewickelt?', createdAt: new Date(now - 2 * 60_000).toISOString() },
  { exchangeId: 'neu', role: 'assistant', authorId: 'bot', content: 'alte doppelte Antwort', createdAt: new Date(now - 90_000).toISOString() },
  { exchangeId: 'neu', role: 'assistant', authorId: 'bot', content: 'aktuelle Antwort', createdAt: new Date(now - 60_000).toISOString() }
];
const deduped = dedupeConversationHistory(history, 24);
assert.equal(deduped.filter((entry) => entry.exchangeId === 'neu' && entry.role === 'assistant').length, 1);
assert.equal(deduped.find((entry) => entry.exchangeId === 'neu' && entry.role === 'assistant')?.content, 'aktuelle Antwort');
const currentHistory = currentConversationHistory(history, 60, 24);
assert.deepEqual(currentHistory.map((entry) => entry.content), ['wurdest du gewickelt?', 'aktuelle Antwort']);

const searchMemory = {
  messages: [
    { role: 'user', authorId: 'user-b', content: 'Wann erscheint Spiel B?', createdAt: new Date(now - 20_000).toISOString() },
    { role: 'user', authorId: 'user-a', content: 'Wann erscheint Spiel A?', createdAt: new Date(now - 10_000).toISOString() }
  ]
};
assert.equal(buildSearchQueryFromContext('wann genau', searchMemory, 'user-a'), 'Wann erscheint Spiel A? wann genau');
assert.equal(buildSearchQueryFromContext('wann genau', searchMemory, 'user-c'), 'wann genau');

const strictAi = { strictSafetyEnabled: true, promptInjectionProtection: true, protectPrivateData: true, blockPrivilegedActions: true, blockInsults: true };
assert.equal(classifySafetyBoundary('Wer hat mich gebannt?', strictAi), null);
assert.match(classifySafetyBoundary('Banne bitte das Mitglied und gib ihm eine Rolle', strictAi), /kann ich nicht machen/i);
assert.equal(classifySafetyBoundary('Jemand hat mich „Hurensohn“ genannt – ist das eine Beleidigung?', strictAi), null);
const adminMessage = {
  author: { id: 'admin-user' },
  guild: { ownerId: 'admin-user' },
  member: { permissions: { has: () => true } }
};
assert.equal(canInspectEconomyAccount(adminMessage, 'admin-user'), true);
assert.equal(canInspectEconomyAccount(adminMessage, 'other-user'), false);

assert.equal(isExplicitGifRequest('wurdest du gewickelt?'), false);
assert.equal(isExplicitGifRequest('kannst du coden?'), false);
assert.equal(isExplicitGifRequest('Schick mir bitte ein Katzen-GIF'), true);
assert.equal(buildGifSearchQuery('Schick mir bitte ein Katzen-GIF', ''), 'cute cat');

const polished = polishHumanReply('Ich kann indeed coden! 😊');
assert.equal(polished, 'Ich kann tatsächlich coden! 😊');
assert.doesNotMatch(polished, /\bind[e]?ed\b/i);

const ai = getAiConfig({
  aiChat: {
    memoryScope: 'user-channel',
    maxHistoryMessages: 24,
    channelIdleMinutes: 60,
    useServerEmojis: true
  }
});
const testEmoji = {
  id: '400000000000000001',
  name: 'fallen_wave',
  animated: false,
  available: true,
  toString: () => '<:fallen_wave:400000000000000001>'
};
const messageGuild = {
  id: 'guild-message',
  name: 'FALLEN HEAVEN',
  memberCount: 640,
  emojis: { cache: new Collection([[testEmoji.id, testEmoji]]) }
};
const messageMember = { id: 'user-a' };
const baseMessage = {
  content: 'wurdest du gewickelt?',
  aiContent: 'wurdest du gewickelt?',
  aiPromptContent: 'wurdest du gewickelt?',
  author: { id: 'user-a', username: 'Alice' },
  member: messageMember,
  guild: messageGuild
};
const userMemory = {
  userId: 'user-a',
  facts: [],
  messages: [
    { exchangeId: 'stale-user', role: 'user', authorId: 'user-a', content: 'Erkläre mir den Emoji-Code.', createdAt: new Date(now - 140 * 60_000).toISOString() }
  ]
};
const channelMemory = {
  messages: [
    { exchangeId: 'other', role: 'user', authorId: 'user-b', content: 'Fremder Gesprächskontext', createdAt: new Date(now - 30_000).toISOString() },
    { exchangeId: 'current', role: 'assistant', authorId: 'bot', conversationUserId: 'user-a', content: 'Aktueller Kontext für Alice', createdAt: new Date(now - 20_000).toISOString() }
  ]
};
const plainMessages = buildMessages({
  ai,
  userMemory,
  channelMemory,
  message: baseMessage,
  serverContext: 'AUTORITATIVER LIVE-SERVERKONTEXT\nPERSISTENTER SERVERINDEX'
});
const plainText = plainMessages.map((entry) => entry.content).join('\n');
assert.doesNotMatch(plainText, /VERTRAUENSWÜRDIGE SERVER-EMOJIS FÜR DIE FERTIGE CHAT-ANTWORT/);
assert.doesNotMatch(plainText, /Fremder Gesprächskontext|Erkläre mir den Emoji-Code/);
assert.match(plainText, /Aktueller Kontext für Alice/);
assert.match(plainText, /AUTORITATIVER LIVE-SERVERKONTEXT/);
assert.match(plainText, /PERSISTENTER SERVERINDEX/);

const emojiMessages = buildMessages({
  ai,
  userMemory: { userId: 'user-a', facts: [], messages: [] },
  channelMemory: { messages: [] },
  message: {
    ...baseMessage,
    content: 'Welche Server-Emojis gibt es?',
    aiContent: 'Welche Server-Emojis gibt es?',
    aiPromptContent: 'Welche Server-Emojis gibt es?'
  }
});
assert.match(
  emojiMessages.map((entry) => entry.content).join('\n'),
  /VERTRAUENSWÜRDIGE SERVER-EMOJIS FÜR DIE FERTIGE CHAT-ANTWORT:[\s\S]*fallen_wave/
);

console.log('AI-Chat-Regressions-Smoke bestanden: Screenshot-Fälle, lokale Serverdaten, Rollengruppen, Gesprächstrennung, GIFs, Emojis und Sprachreinheit sind abgesichert.');
