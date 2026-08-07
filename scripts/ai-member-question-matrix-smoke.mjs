import assert from 'node:assert/strict';

import { classifyAiRequest } from '../src/features/aiRouter.js';
import { _aiChatInternals } from '../src/features/aiChat.js';

const { classifyServerKnowledgeIntent } = _aiChatInternals;

const variants = (question) => {
  const plain = String(question).trim().replace(/[?!.]+$/g, '');
  const lower = plain ? `${plain[0].toLocaleLowerCase('de-DE')}${plain.slice(1)}` : plain;
  const ascii = plain
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue');
  return [...new Set([
    plain,
    `${plain}?`,
    `Bitte ${lower}`,
    `Kannst du mir sagen: ${lower}?`,
    `Sag mir bitte ${lower}`,
    `Ey, ${lower}?`,
    `Bro, ${lower}`,
    `Hey Bot, ${lower}?`,
    `${plain} bitte`,
    plain.toLocaleUpperCase('de-DE'),
    ascii,
    plain.replace(/\s+/g, '  ')
  ])];
};

const structuredFamilies = [
  ['activity', [
    'Was ist meine Tagesaktivität', 'Wie sieht meine Aktivität heute aus', 'Mein heutiger Liga-Stand',
    'Was ist mein Rank', 'Welchen Rang habe ich', 'Auf welchem Platz bin ich heute',
    'Wo stehe ich in der Aktivitäts-Liga', 'Wie viele Nachrichten habe ich heute',
    'Wieviele Messages hab ich heute geschrieben', 'Wie lange war ich heute im VC',
    'Wie viele Minuten bin ich heute im Voice gewesen', 'Was ist mein Chat-Rang',
    'Was ist mein Sprachchat-Ranking', 'Mein VC Platz', 'Meine Chataktivität heute',
    'Meine Voice-Aktivität heute', 'Zeige meine Tagesstatistik', 'Zeige meine Tagesleistung',
    'Was ist mein Wochenranking', 'Mein Liga-Stand der Woche', 'Wie aktiv war ich diese Woche',
    'Wie viele Nachrichten habe ich diese Woche', 'Wie lange war ich diese Woche im Call',
    'Was ist mein Monatsranking', 'Mein Liga-Stand im Monat', 'Wie aktiv war ich diesen Monat',
    'Wie viele Nachrichten habe ich diesen Monat', 'Wie lange war ich diesen Monat im Sprachchat',
    'Wer ist heute Top Chatter', 'Wer ist im Voice am aktivsten', 'Wer hat die meisten Nachrichten',
    'Wer hat die meiste Sprachchatzeit', 'Zeige die Aktivitätsliga', 'Zeige die Tageswertung',
    'Zeige die abgeschlossene Wochenwertung', 'Zeige die abgeschlossene Monatswertung'
  ]],
  ['economy', [
    'Wie viele Heaven Coins habe ich', 'Was ist mein Coin-Stand', 'Welche VIP-Stufe habe ich',
    'Was kostet VIP Diamant', 'Welche VIP-Rollen gibt es', 'Was ist mein Boost-Meilenstein',
    'Wie verdiene ich Heaven Coins', 'Wie funktioniert das VIP-System', 'Bin ich aktuell VIP',
    'Wer hat VIP Gold', 'Welche Mitglieder sind VIP', 'Wie hoch ist mein Guthaben'
  ]],
  ['leveling', [
    'Welches Level habe ich', 'Wie viele XP habe ich', 'Zeige mein Level', 'Wann bekam ich zuletzt XP',
    'Was ist mein Levelrang', 'Wie funktioniert das Levelsystem'
  ]],
  ['tickets', [
    'Habe ich ein offenes Ticket', 'Wo ist mein Support-Ticket', 'Wie viele Tickets hatte ich',
    'Zeige mein Ticket', 'Wo ist das Ticket-Panel', 'Wie funktioniert das Ticketsystem'
  ]],
  ['moderation-self', [
    'Wie viele Verwarnungen habe ich', 'Habe ich aktive Verstöße', 'Läuft bei mir ein Timeout',
    'Wurde ich schon gemutet', 'Zeige meine Moderationsfälle'
  ]],
  ['server-tag', [
    'Trage ich den Server-Tag', 'Was ist mein Server-Tag-Status', 'Welche Rolle bekomme ich für den Guild-Tag',
    'Wer trägt den Server-Tag', 'Wie funktioniert der Tag-Tracker'
  ]]
];

const personalFamilies = [
  ['boosting', [
    'Booste ich den Server', 'Wie oft booste ich', 'Wie viele Boosts gebe ich', 'Seit wann booste ich',
    'Bin ich aktiver Booster', 'Was ist mein Boosterstatus'
  ]],
  ['join', [
    'Wann bin ich dem Server beigetreten', 'Seit wann bin ich hier', 'Wann bin ich gejoint',
    'Was ist mein Beitrittsdatum', 'Wie lange bin ich schon auf dem Server'
  ]],
  ['roles', [
    'Welche Rollen habe ich', 'Wie viele Rollen habe ich', 'Was sind meine Serverrollen',
    'Welche Rechte habe ich', 'Zeige meine Rollen'
  ]],
  ['voice', [
    'In welchem VC bin ich', 'Bin ich gerade im Voice', 'In welchem Sprachchat sitze ich',
    'Bin ich in einem Call', 'Zeige meinen Voice-Kanal'
  ]],
  ['status', [
    'Bin ich online', 'Was ist mein Discord Status', 'Bin ich für andere offline',
    'Zeige meinen Anwesenheitsstatus', 'Was spiele ich gerade',
    'Welche Discord-Aktivität habe ich', 'Bin ich am Handy online',
    'Über welches Gerät bin ich verbunden', 'Was höre ich gerade'
  ]],
  ['activity', [
    'Wie aktiv bin ich allgemein', 'Wann war ich zuletzt aktiv',
    'Bin ich auf dem Server aktiv'
  ]],
  ['messages', [
    'Wie viele Nachrichten habe ich insgesamt geschrieben', 'Wie viele Messages sind von mir indexiert',
    'Was habe ich zuletzt geschrieben', 'Wann habe ich zuletzt geschrieben', 'In wie vielen Kanälen habe ich geschrieben'
  ]],
  ['timeline', [
    'Zeige meine Timeline', 'Was steht in meiner Chronik', 'Welche Serverereignisse habe ich',
    'Zeige meinen Verlauf auf dem Server'
  ]],
  ['interests', [
    'Was weißt du über meine Interessen', 'Was mag ich', 'Welche Hobbys sind von mir belegt',
    'Was habe ich über mich erzählt'
  ]],
  ['profile', [
    'Zeige mein Profil', 'Wann wurde mein Discord Account erstellt', 'Was ist mein Accountdatum',
    'Welchen Avatar habe ich', 'Erzähl etwas über mein Serverprofil'
  ]]
];

const failures = [];
let checked = 0;

for (const [expectedIntent, questions] of structuredFamilies) {
  for (const question of questions) for (const candidate of variants(question)) {
    checked += 1;
    const intent = classifyServerKnowledgeIntent(candidate);
    if (intent?.type !== expectedIntent) {
      failures.push({ candidate, expected: expectedIntent, actual: intent?.type || 'null', stage: 'structured-intent' });
      continue;
    }
    const route = classifyAiRequest({ content: candidate, serverIntentType: intent.type, webEnabled: true });
    if (route.route !== 'server_knowledge') failures.push({ candidate, expected: 'server_knowledge', actual: route.route, stage: 'structured-route' });
  }
}

for (const [expectedField, questions] of personalFamilies) {
  for (const question of questions) for (const candidate of variants(question)) {
    checked += 1;
    const route = classifyAiRequest({
      content: candidate,
      webEnabled: true
    });
    if (route.route !== 'personal_discord' || route.memberField !== expectedField) {
      failures.push({ candidate, expected: `personal_discord/${expectedField}`, actual: `${route.route}/${route.memberField}`, stage: 'personal-field' });
    }
  }
}

const referencedFamilies = personalFamilies.filter(([field]) => ['boosting', 'join', 'roles', 'voice', 'status', 'activity', 'messages', 'timeline', 'profile'].includes(field));
for (const [expectedField, questions] of referencedFamilies) {
  for (const question of questions.slice(0, 3)) {
    const converted = question
      .replace(/\bich\b/gi, '<@123456789012345678>')
      .replace(/\bmein(?:e|er|en|em|es)?\b/gi, 'sein');
    checked += 1;
    const route = classifyAiRequest({ content: converted, hasMention: true, webEnabled: true });
    if (route.route !== 'server_member' || route.memberField !== expectedField) {
      failures.push({ candidate: converted, expected: `server_member/${expectedField}`, actual: `${route.route}/${route.memberField}`, stage: 'referenced-member' });
    }
  }
}

if (failures.length) {
  console.error(JSON.stringify({ checked, failures }, null, 2));
  assert.fail(`${failures.length} von ${checked} Mitgliederfragen wurden falsch geroutet.`);
}

console.log(`AI-Mitgliederfragenmatrix bestanden: ${checked} Formulierungen für Aktivität, Liga, Boosts, VIP, Level, Tickets, Moderation, Rollen, Profil, Timeline und Interessen.`);
