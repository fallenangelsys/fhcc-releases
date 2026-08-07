import assert from 'node:assert/strict';

import { classifyAiRequest } from '../src/features/aiRouter.js';
import { _aiChatInternals } from '../src/features/aiChat.js';

const { classifyServerKnowledgeIntent } = _aiChatInternals;

const asciiGerman = (value) => String(value)
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue');

const questionVariants = (question) => {
  const plain = String(question).trim().replace(/[?!.]+$/g, '');
  const lowerFirst = plain ? `${plain[0].toLocaleLowerCase('de-DE')}${plain.slice(1)}` : plain;
  return [...new Set([
    question,
    plain,
    `${plain}?`,
    `Bitte ${lowerFirst}`,
    `Kannst du mir sagen: ${lowerFirst}?`,
    `Ey, ${lowerFirst}?`,
    `Bro, ${lowerFirst}`,
    `Hey Bot, ${lowerFirst}?`,
    `${plain} bitte`,
    plain.toLocaleUpperCase('de-DE'),
    asciiGerman(plain),
    plain.replace(/\s+/g, '  ')
  ])];
};

const families = [
  ['server-profile', [
    'Wie heißt dieser Server?', 'Was ist der Servername?', 'Wie lautet die Server-ID?',
    'Wann wurde dieser Server erstellt?', 'Seit wann gibt es diesen Server?', 'Wie alt ist unser Server?',
    'Was ist die Serverbeschreibung?', 'Zeige das Serverprofil', 'Hat der Server ein Icon?',
    'Zeige das Serverlogo', 'Hat der Server einen Banner?', 'Welche Sprache hat der Server?',
    'Was ist die Server-Locale?', 'Welche Verifizierungsstufe hat der Server?'
  ]],
  ['voice-state', [
    'Wer ist im VC?', 'Welche Mitglieder sind im Voice?', 'Wie viele sind im Sprachchat?',
    'Sitzt jemand im Call?', 'Zeige die Voice-Belegung', 'Was ist der VC-Status?',
    'Welche Voice-Kanäle sind besetzt?', 'Wer redet gerade im Sprachchat?',
    'In welchem VC ist Nino?', 'In welchem Voice sitzt Nino?', 'Ist jemand in einem Sprachkanal?',
    'Wie viele Mitglieder sind gerade in einem Call?'
  ]],
  ['channel-info', [
    'Zeige die Kanal-Infos', 'Was sind die Channel-Details?', 'Was ist die Kanalbeschreibung?',
    'Welches Thema hat dieser Kanal?', 'Welche Kategorie hat dieser Channel?', 'Was ist der Kanaltyp?',
    'Wann wurde dieser Kanal erstellt?', 'Wie alt ist dieser Channel?', 'Ist dieser Kanal NSFW?',
    'Wie hoch ist der Slowmode im Kanal?', 'Was ist der Langsammodus im Channel?',
    'Infos zu <#123456789012345678>', 'Details über <#123456789012345678>'
  ]],
  ['channel-permissions', [
    'Welche Rechte habe ich hier?', 'Welche Berechtigungen habe ich in diesem Kanal?',
    'Was darf ich hier machen?', 'Was kann ich in diesem Channel?',
    'Darf ich hier Nachrichten schreiben?', 'Kann ich in <#123456789012345678> Bilder hochladen?',
    'Darf ich hier reagieren?', 'Kann ich in diesem Kanal einen Thread erstellen?',
    'Darf ich diesem Voice-Channel beitreten?', 'Kann ich im Sprachkanal sprechen?',
    'Darf ich hier streamen?', 'Kann ich hier Nachrichten verwalten?'
  ]],
  ['channel-activity', [
    'Wie viele Nachrichten sind hier im Kanal?', 'Wieviele Messages hat dieser Channel?',
    'Wie viele Beiträge sind in <#123456789012345678>?', 'Wie viele Posts hat dieser Kanal?',
    'Wann war die letzte Nachricht hier im Channel?', 'Was war der letzte Beitrag in diesem Kanal?',
    'Wann kam zuletzt eine Message im Kanal?', 'Wie aktiv ist dieser Kanal?',
    'Wie aktiv ist <#123456789012345678>?'
  ]],
  ['server-settings', [
    'Welcher AFK-Kanal ist eingestellt?', 'Wie lang ist der AFK-Timeout?',
    'Welcher Systemkanal ist eingestellt?', 'Was ist der offizielle Regelkanal?',
    'Ist der Community-Modus aktiv?', 'Wie ist der Inhaltsfilter eingestellt?',
    'Was sind die Standard-Benachrichtigungen?', 'Welche MFA-Stufe hat der Server?',
    'Ist der Boost-Fortschrittsbalken aktiv?', 'Welcher Sicherheitskanal ist eingestellt?',
    'Wo erscheinen öffentliche Updates?', 'Zeige die Servereinstellungen'
  ]],
  ['boosts', [
    'Wer hat zuletzt geboostet?', 'wer hat hier als letztes geboostet', 'Wer hat FALLEN HEAVEN zuletzt geboostet',
    'wann war der letzte Boost', 'wer boostet gerade', 'welche Booster sind aktiv', 'liste alle booster',
    'wie viele boosts haben wir', 'wie steht der boost status', 'welche booststufe hat der server',
    'hat heute jemand den server geboostet', 'wer hat einen boost gegeben', 'zeige den boostverlauf',
    'server boost stand?', 'Wer hat kürzlich geboostet?', 'Wer hat vorhin geboostet?'
  ]],
  ['boost-ranking', [
    'top booster?', 'wer ist top booster', 'wer boostet am meisten', 'welches mitglied hat die meisten boosts',
    'wer gibt aktuell die meisten boosts', 'höchste boost anzahl auf dem server', 'boost rangliste',
    'welcher user ist beim boosten platz 1'
  ]],
  ['economy', [
    'wer hat vip gold', 'welche vip rollen gibt es', 'wie viele heaven coins habe ich', 'mein coin stand',
    'wie funktioniert das vip system', 'was kostet vip diamant', 'zeige meinen boost meilenstein',
    'wem gehört vip bronze', 'welche vip stufe habe ich', 'wie kann ich heaven coins verdienen',
    'wie hoch ist mein guthaben', 'wer ist aktuell vip'
  ]],
  ['activity', [
    'was ist mein tagesranking', 'welchen chat rang habe ich', 'wo stehe ich im vc ranking',
    'wer ist top chatter', 'wer war im sprachchat am aktivsten', 'zeige die aktivitäts liga',
    'wochenwertung chat', 'monatsranking voice', 'wer hat die meisten chat nachrichten',
    'wer hat die meiste sprachchatzeit', 'auf welchem platz bin ich heute', 'mein voice platz'
  ]],
  ['joined-today', [
    'wer ist heute beigetreten', 'welches mitglied kam heute dazu', 'wer ist heute neu auf dem server',
    'neue member heute', 'wer ist seit mitternacht gejoint', 'nenne die heutigen beitritte'
  ]],
  ['joined-yesterday', [
    'wer ist gestern beigetreten', 'welche member sind gestern gejoint', 'wer kam gestern neu auf den server',
    'gestrige beitritte', 'nenne die neuen mitglieder von gestern'
  ]],
  ['joined-week', [
    'wer ist diese woche beigetreten', 'neue mitglieder der letzten 7 tage', 'wer kam in den letzten tagen dazu',
    'beitritte diese woche', 'welche member sind diese woche gejoint'
  ]],
  ['member-left', [
    'wer hat heute den server verlassen', 'wer ist gestern vom server gegangen', 'welches mitglied ist geleavt',
    'wer hat zuletzt den server verlassen', 'wer ging heute vom server', 'liste die letzten austritte'
  ]],
  ['channel-created', [
    'welche channels kamen heute neu', 'welche kanäle wurden heute erstellt', 'neu hinzugefügte serverkanäle',
    'welcher channel kam zuletzt dazu', 'zeige neue kanäle', 'was wurde bei den channels neu erstellt'
  ]],
  ['server-history', [
    'was ist heute auf dem server passiert', 'zeige die server chronik', 'welche systemereignisse gab es heute',
    'was hat sich gestern hier geändert', 'discord server timeline', 'was passierte zuletzt bei uns'
  ]],
  ['owner', [
    'wer ist owner', 'wer ist der serverinhaber', 'wem gehört dieser server', 'liste alle owner',
    'wer besitzt fallen heaven', 'welche person ist inhaber vom server'
  ]],
  ['staff', [
    'wer ist im team', 'liste alle staff mitglieder', 'welche admins gibt es', 'wer sind die moderatoren',
    'wer gehört zum support team', 'wer leitet den server', 'zeige mir alle teammitglieder'
  ]],
  ['member-directory', [
    'wer ist alles auf diesem server', 'zeige die vollständige mitgliederliste', 'liste alle member vom server',
    'welche menschen sind hier', 'alle user auf fallen heaven', 'wer ist hier alles drauf'
  ]],
  ['members', [
    'wie viele mitglieder hat der server', 'wieviele member sind hier', 'anzahl user auf fallen heaven',
    'wie viele menschen sind bei uns', 'server mitgliederzahl'
  ]],
  ['bots', [
    'wie viele bots sind auf dem server', 'wieviele bots haben wir hier', 'anzahl bots bei uns'
    , 'welche bots sind auf dem server', 'liste die server bots', 'wer sind die bots hier'
  ]],
  ['online', [
    'wie viele mitglieder sind online', 'wieviele user sind gerade aktiv', 'anzahl member online auf dem server',
    'wer ist online', 'welche mitglieder sind online', 'liste die user die online sind'
  ]],
  ['channels', [
    'wie viele kanäle hat der server', 'wieviele channels gibt es hier', 'anzahl serverkanäle',
    'wie viele voice channels haben wir', 'wie viele foren gibt es auf dem server'
  ]],
  ['roles', [
    'welche rollen gibt es', 'liste alle serverrollen', 'wie viele rollen hat fallen heaven',
    'was für rollen haben wir', 'zeige mir die rollen auf dem server'
  ]],
  ['events', [
    'welche events gibt es auf dem server', 'wann ist das nächste server event', 'anstehende veranstaltungen bei uns',
    'wie viele server events sind eingetragen', 'zeige kommende events hier',
    'wo findet das nächste Serverevent statt', 'wann beginnt das nächste Serverevent',
    'wann endet das kommende Server Event', 'was passiert beim nächsten Serverevent',
    'zeige Details zum Serverevent', 'in welchem Kanal ist das nächste Serverevent'
  ]],
  ['current-channel', [
    'in welchem kanal sind wir', 'welcher channel ist das hier', 'wo sind wir gerade',
    'wie heißt der aktuelle kanal', 'aktueller kanal?'
  ]],
  ['rules', [
    'welche regeln gelten hier', 'wo finde ich das regelwerk', 'was ist auf dem server verboten',
    'darf man hier werbung machen', 'erkläre die serverregeln', 'was ist bei uns erlaubt'
  ]],
  ['unknown-members', [
    'wer sind die unbekannten nutzer', 'welche unknown user gibt es', 'liste unbekannte mitglieder',
    'wer ist als unbekannt gespeichert'
  ]],
  ['moderation-ranking', [
    'wer hat die meisten verstöße auf dem server', 'welcher user hat die meisten verwarnungen',
    'rangliste der moderationsfälle', 'wer fällt bei moderation am meisten auf'
  ]],
  ['moderation-self', [
    'wie viele verwarnungen habe ich', 'habe ich verstöße', 'wurde ich schon gemutet',
    'wer hat mich gebannt', 'läuft bei mir ein timeout', 'zeige meine moderationsfälle'
  ]],
  ['role-group-ranking', [
    'wer hat die meisten rollen', 'welches mitglied hat die meisten geschlecht rollen',
    'wer hat am meisten altersrollen', 'rollen rangliste auf dem server'
  ]],
  ['member-info', [
    'wer ist Max auf diesem server', 'kennst du Nino hier', 'wann ist dieses mitglied beigetreten',
    'welche rollen hat der user auf dem server', 'boostet dieses mitglied bei uns', 'erzähle etwas über den member hier'
  ]],
  ['role-info', [
    'wer hat die rolle vip gold', 'was ist die rolle moderator', 'rolleninfo zu booster',
    'welche mitglieder haben die rolle admin', 'rolle namens engel'
  ]],
  ['emojis', [
    'welche server emojis haben wir', 'wie viele emojis gibt es hier', 'liste alle discord emojis',
    'zeige die animierten server emojis', 'wieviele animierte emojis hat fallen heaven'
  ]],
  ['stickers', [
    'welche sticker haben wir', 'wie viele server sticker gibt es', 'liste alle sticker auf dem server',
    'zeige fallen heaven sticker'
  ]],
  ['server-tag', [
    'trage ich den server tag', 'wer trägt den guild tag', 'wie funktioniert der server-tag',
    'welche rolle bekommt ein tag träger', 'server tag status'
  ]],
  ['leveling', [
    'welches level habe ich', 'wie viele xp habe ich', 'mein levelrang', 'wann bekam ich zuletzt xp',
    'wie funktioniert das level system', 'zeige mein level'
  ]],
  ['tickets', [
    'habe ich ein offenes ticket', 'wo ist mein support ticket', 'wie viele tickets hatte ich',
    'wie funktioniert das ticketsystem', 'zeige mein ticket', 'wo ist das ticket panel'
  ]],
  ['orientation', [
    'wo finde ich den support', 'in welchen kanal muss ich dafür', 'wo kann ich mich vorstellen',
    'welcher kanal ist für ideen', 'wohin mit einer frage', 'orientiere mich auf dem server'
  ]],
  ['overview', [
    'erzähl mir etwas über den server', 'serverübersicht', 'zeige die server statistik',
    'was weißt du über fallen heaven', 'welche serverdaten hast du', 'fass den server zusammen'
  ]],
  ['channel-guide', [
    'was steht in den pins', 'wie funktioniert der casino channel', 'erkläre den fischerei kanal',
    'was kann man in diesem channel machen', 'welche befehle stehen angeheftet', 'anleitung für den kanal'
  ]],
  ['channel-topics', [
    'welche themen wurden heute im hauptchat besprochen', 'worüber wurde heute im serverchat geredet',
    'was wurde im kanal heute diskutiert', 'häufige gespräche im hauptchat heute'
  ]],
  ['app-diagnostics', [
    'live status der app', 'wie ist die bot diagnose', 'ist ollama online', 'wie viel ram verbraucht der bot',
    'wie hoch ist die cpu last', 'event loop status', 'wie viele hintergrundjobs laufen', 'ist der serverindex bereit'
  ]],
  ['module-status', [
    'wie läuft der forum cleaner', 'ist der voice chat cleaner aktiv', 'status der emoji verwaltung',
    'wann lief steam workshop zuletzt', 'ist das tägliche server backup aktiv', 'läuft der moderationsassistent',
    'ist der raid schutz an', 'welche autorollen sind aktiv', 'status vom serverprotokoll'
  ]],
  ['data-capabilities', [
    'welche informationen kannst du auf diesem discord server abrufen', 'welche serverdaten kannst du lesen',
    'worauf hast du in der app zugriff', 'was weißt du alles über fallen heaven',
    'welche datenquellen hast du für diesen server'
  ]]
];

const failures = [];
let serverQuestionCount = 0;
for (const [expectedType, questions] of families) {
  for (const sourceQuestion of questions) {
    for (const question of questionVariants(sourceQuestion)) {
      serverQuestionCount += 1;
      const intent = classifyServerKnowledgeIntent(question);
      if (intent?.type !== expectedType) {
        failures.push({ question, sourceQuestion, expected: expectedType, actual: intent?.type || 'null', stage: 'intent' });
        continue;
      }
      const route = classifyAiRequest({ content: question, serverIntentType: intent.type, webEnabled: true });
      if (route.route !== 'server_knowledge') failures.push({ question, sourceQuestion, expected: 'server_knowledge', actual: route.route, stage: 'route' });
    }
  }
}

const conversations = [
  'hallo', 'wie geht es dir', 'danke', 'erzähl einen witz', 'schreib ein gedicht', 'kannst du coden',
  'was hältst du von superhelden', 'übersetze guten morgen ins englische', 'was ist 2+2', 'gute nacht',
  'findest du mich nett', 'formuliere diesen text besser'
];
let conversationQuestionCount = 0;
for (const sourceQuestion of conversations) for (const question of questionVariants(sourceQuestion).slice(0, 5)) {
  conversationQuestionCount += 1;
  const intent = classifyServerKnowledgeIntent(question);
  if (intent) failures.push({ question, sourceQuestion, expected: 'kein Serverintent', actual: intent.type, stage: 'conversation-intent' });
  const route = classifyAiRequest({ content: question, webEnabled: true });
  if (route.route !== 'local_conversation') failures.push({ question, sourceQuestion, expected: 'local_conversation', actual: route.route, stage: 'conversation-route' });
}

const webQuestions = [
  'wie wird morgen das wetter in köln', 'news von heute', 'wer ist aktuell bundeskanzler',
  'wie hoch ist der bitcoin kurs', 'wann erscheint das nächste minecraft update', 'wie steht die bundesliga tabelle',
  'was kostet die playstation heute', 'welche neue discord version gibt es', 'wer ist der ceo von microsoft',
  'suche online nach aktuellen nvidia treibern', 'wann ist die nächste bundestagswahl', 'aktueller dax stand'
];
let webQuestionCount = 0;
for (const sourceQuestion of webQuestions) for (const question of questionVariants(sourceQuestion).slice(0, 6)) {
  webQuestionCount += 1;
  const intent = classifyServerKnowledgeIntent(question);
  if (intent) failures.push({ question, sourceQuestion, expected: 'kein Serverintent', actual: intent.type, stage: 'web-intent' });
  const route = classifyAiRequest({ content: question, webEnabled: true });
  if (route.route !== 'web_research') failures.push({ question, sourceQuestion, expected: 'web_research', actual: route.route, stage: 'web-route' });
}

if (failures.length) {
  console.error(JSON.stringify({ serverQuestionCount, failures }, null, 2));
  assert.fail(`${failures.length} von ${serverQuestionCount + conversationQuestionCount + webQuestionCount} Fragen wurden falsch geroutet.`);
}

console.log(`AI-Fragenmatrix bestanden: ${serverQuestionCount} Server-/App-Fragen, ${conversationQuestionCount} Gespräche und ${webQuestionCount} Webfragen korrekt getrennt.`);
