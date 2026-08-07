import assert from 'node:assert/strict';

import { classifyAiRequest } from '../src/features/aiRouter.js';
import { _aiChatInternals } from '../src/features/aiChat.js';

const { classifyServerKnowledgeIntent } = _aiChatInternals;

const localCases = [
  ['Wer hat zuletzt geboostet?', 'boosts'],
  ['Wie viele Boosts hat der Server?', 'boosts'],
  ['Wer ist Top-Booster?', 'boost-ranking'],
  ['Wer ist heute neu beigetreten?', 'joined-today'],
  ['Wer hat heute den Server verlassen?', 'member-left'],
  ['Welche Channels kamen heute neu dazu?', 'channel-created'],
  ['Was ist heute auf dem Server passiert?', 'server-history'],
  ['Wer ist Owner auf dem Server?', 'owner'],
  ['Wer gehört zum Team?', 'staff'],
  ['Welche Rollen gibt es?', 'roles'],
  ['Wie viele Mitglieder sind auf dem Server?', 'members'],
  ['Zeige die vollständige Mitgliederliste von unserem Server', 'member-directory'],
  ['Welche Server-Emojis haben wir?', 'emojis'],
  ['Welche Sticker haben wir?', 'stickers'],
  ['Wo finde ich den Support?', 'orientation'],
  ['Welche Regeln gelten hier?', 'rules'],
  ['Was steht in den Pins vom Casino?', 'channel-guide'],
  ['Was ist mein Tagesranking?', 'activity'],
  ['Welches Level habe ich?', 'leveling'],
  ['Habe ich ein offenes Ticket?', 'tickets'],
  ['Trage ich den Server-Tag?', 'server-tag'],
  ['Wer hat VIP Gold?', 'economy'],
  ['Wie läuft der Forum-Cleaner?', 'module-status'],
  ['Ist das tägliche Server-Backup aktiv?', 'module-status'],
  ['Wie ist der Live-Status der App?', 'app-diagnostics'],
  ['Welche Informationen kannst du auf diesem Discord-Server abrufen?', 'data-capabilities'],
  ['Erzähl mir etwas über den Server', 'overview'],
  ['Wer hat die meisten Verstöße auf dem Server?', 'moderation-ranking']
];

for (const [question, expectedType] of localCases) {
  const intent = classifyServerKnowledgeIntent(question);
  assert.equal(intent?.type, expectedType, `Lokale Serverfrage falsch klassifiziert: ${question}`);
  const route = classifyAiRequest({
    content: question,
    serverIntentType: intent?.type || '',
    webEnabled: true
  });
  assert.equal(route.route, 'server_knowledge', `Serverfrage darf niemals ins Web: ${question}`);
}

const externalCases = [
  'Wie wird morgen das Wetter in Köln?',
  'Wer ist aktuell Bundeskanzler?',
  'Fass die heutigen Deutschland-News zusammen',
  'Wann erscheint das nächste Minecraft-Update?'
];
for (const question of externalCases) {
  assert.equal(classifyServerKnowledgeIntent(question), null, `Externe Frage fälschlich als Serverwissen erkannt: ${question}`);
  assert.equal(classifyAiRequest({ content: question, webEnabled: true }).route, 'web_research');
}

console.log(`AI-Universal-Routing bestanden: ${localCases.length} App-/Serverbereiche bleiben lokal, ${externalCases.length} externe Aktualitätsfragen nutzen gezielt das Web.`);
