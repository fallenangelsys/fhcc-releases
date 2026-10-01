import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { _activityRaceInternals } from '../src/features/activityRace.js';

const {
  normalizeStore,
  isPlacementPingEnabled,
  setPlacementPingPreference,
  buildPingInfoPanelPayload,
  filterPlacementPingLinesByPreference,
  isCurrentPingInfoMessage,
  composePingContent,
  neutralizeOptedOutMentions,
  buildCompletionAnnouncement
} = _activityRaceInternals;

const normalized = normalizeStore({
  guilds: {
    guild: {
      panel: {
        pingInfo: { channelId: 'channel', messageId: 'message' }
      },
      pingOptOuts: {
        optedOut: '2026-09-01T12:00:00.000Z'
      }
    }
  }
});
const guildData = normalized.guilds.guild;

assert.deepEqual(
  guildData.panel.pingInfo,
  { channelId: 'channel', messageId: 'message', fingerprint: '' },
  'Das Ledger des Ping-Info-Panels muss Neustarts ueberstehen.'
);
assert.equal(isPlacementPingEnabled(guildData, 'newMember'), true, 'Liga-Pings sind standardmaessig aktiv.');
assert.equal(isPlacementPingEnabled(guildData, 'optedOut'), false, 'Persistierter Opt-out unterdrueckt Liga-Pings.');

assert.equal(setPlacementPingPreference(guildData, 'newMember', false), false);
assert.equal(isPlacementPingEnabled(guildData, 'newMember'), false, 'Deaktivieren legt nur einen Opt-out ab.');
assert.match(guildData.pingOptOuts.newMember, /^\d{4}-\d{2}-\d{2}T/);
assert.equal(setPlacementPingPreference(guildData, 'newMember', true), true);
assert.equal(isPlacementPingEnabled(guildData, 'newMember'), true, 'Aktivieren entfernt den Opt-out wieder.');
assert.equal(Object.hasOwn(guildData.pingOptOuts, 'newMember'), false);
assert.deepEqual(
  filterPlacementPingLinesByPreference([
    { userId: 'optedOut', scope: 'daily.chat' },
    { userId: 'newMember', scope: 'daily.chat' }
  ], guildData).map((entry) => entry.userId),
  ['newMember'],
  'Opt-outs werden vor Gruppierung und Versand aus einem Ping-Lauf entfernt.'
);
assert.equal(isCurrentPingInfoMessage(guildData, 'message'), true);

// Regression 2026-10-01: Ein Opt-out muss auch fuer Personen greifen, die im
// Text einer fremden Ping-Zeile als "Überholer" (@Mention) auftauchen. Der
// Empfaengerfilter prueft nur line.userId, die eingebettete Mention lief bisher
// ungeprueft durch - dadurch wurden Leute trotz deaktivierter Liga-Pings
// benachrichtigt, sobald sie jemand anderen von einem Platz verdraengten.
const silentOvertaker = '1293907202595356704';
setPlacementPingPreference(guildData, silentOvertaker, false);
assert.equal(isPlacementPingEnabled(guildData, silentOvertaker), false, 'Der Ueberholer hat seine Pings abgestellt.');
const overtakerLeak = [
  {
    userId: 'activeMember',
    scope: 'daily.chat',
    headline: `⚠️ <@${silentOvertaker}> verdraengt dich aus Platz 1 der Tageswertung · Chat.`,
    overtaker: `<@${silentOvertaker}>`
  }
];
const survivingOvertakerLines = filterPlacementPingLinesByPreference(overtakerLeak, guildData);
assert.equal(survivingOvertakerLines.length, 1, 'Der Empfaenger ohne Opt-out behaelt seine Ping-Zeile.');
const overtakerContent = composePingContent('activeMember', survivingOvertakerLines, guildData, () => 'OptOutUser');
assert.equal(
  overtakerContent.includes(`<@${silentOvertaker}>`),
  false,
  'Ein Opt-out muss auch eingebettete @Mentions neutralisieren, nicht nur den Empfaenger.'
);
assert.match(
  overtakerContent,
  /OptOutUser/,
  'Der Satz bleibt lesbar: der Name ersetzt die stummgeschaltete Mention.'
);
const loudOvertaker = '1276125977805721640';
const activeContent = composePingContent('activeMember', [{
  userId: 'activeMember',
  scope: 'daily.chat',
  headline: `⚠️ <@${loudOvertaker}> verdraengt dich aus Platz 1 der Tageswertung · Chat.`
}], guildData, () => 'Jemand');
assert.match(
  activeContent,
  new RegExp(`<@${loudOvertaker}>`),
  'Wer seine Liga-Pings NICHT abgestellt hat, wird weiterhin korrekt erwaehnt.'
);

// Regression 2026-10-01 (zweiter Pfad): Die Wochen-/Monats-Abschluss-
// Ankuendigung wurde ohne allowedMentions gesendet und hat dadurch JEDEN
// Gewinner der Top 3 gepingt - auch die mit deaktivierten Liga-Pings.
const winner = '1293907202595356705';
setPlacementPingPreference(guildData, winner, false);
const quietGuild = {
  members: { cache: { get: (id) => ({ displayName: id === winner ? 'StilleGewinnerin' : 'LauterGewinner' }) } },
  iconURL: () => undefined
};
const completionText = buildCompletionAnnouncement(
  { guild: quietGuild },
  {
    periods: {
      weekly: {
        fullyTracked: true,
        start: '2026-09-21',
        end: '2026-09-27',
        chat: [{ userId: winner, value: 1000 }, { userId: loudOvertaker, value: 500 }],
        voice: []
      }
    }
  },
  'weekly'
);
assert.ok(completionText && completionText.includes(`<@${winner}>`), 'Die Ankuendigung erwaehnt die Gewinner mit echter Mention.');
const safeCompletion = neutralizeOptedOutMentions(completionText, guildData, (id) => id === winner ? 'StilleGewinnerin' : '');
assert.equal(safeCompletion.includes(`<@${winner}>`), false, 'Ein stillgelegter Gewinner darf durch die Abschluss-Ankuendigung nicht gepingt werden.');
assert.match(safeCompletion, /StilleGewinnerin/, 'Der Name des stillgelegten Gewinners bleibt sichtbar.');
assert.match(safeCompletion, new RegExp(`<@${loudOvertaker}>`), 'Aktive Gewinner werden in der Ankuendigung weiterhin gepingt.');

const raceSource = await readFile(new URL('../src/features/activityRace.js', import.meta.url), 'utf8');
assert.match(
  raceSource,
  /await channel\.send\(\{ content: safeAnnouncement \}\)/,
  'Die Abschluss-Ankuendigung muss die gefilterte Variante senden.'
);
assert.match(
  raceSource,
  /const mention = isPlacementPingEnabled\(data, m\.userId\)/,
  'Die Gleichstands-Anzeige muss den Opt-out je Mitglied pruefen.'
);


assert.equal(isCurrentPingInfoMessage(guildData, 'copied-or-old-message'), false, 'Alte oder kopierte Buttons werden abgewiesen.');

const payload = await buildPingInfoPanelPayload({ name: 'FALLEN HEAVEN' }, {
  pingToggleButtonLabel: 'LIGA-PINGS EIN/AUS',
  pingInfoDesign: {
    content: '',
    embeds: [
      {
        title: 'Liga-Benachrichtigungen',
        description: 'Du entscheidest selbst auf {server}.',
        color: '#6fd8ff',
        fields: []
      },
      {
        title: 'Datenschutz',
        description: 'Gespeichert wird nur deine Auswahl.',
        color: '#57d9a3',
        fields: []
      }
    ]
  }
});
assert.equal(payload.embeds.length, 2, 'Das Info-Panel unterstuetzt bis zu zehn Studio-Embeds.');
assert.equal(payload.components.length, 1);
assert.equal(payload.components[0].components.length, 1, 'Der Server haengt genau einen echten Button an.');
assert.equal(payload.components[0].components[0].data.custom_id, 'fh-activity-race:ping-toggle');
assert.equal(payload.components[0].components[0].data.label, 'LIGA-PINGS EIN/AUS');
assert.deepEqual(payload.allowedMentions, { parse: [] });
assert.match(payload.embeds[0].data.description, /FALLEN HEAVEN/);

const [studioSource, appSource, backendSource] = await Promise.all([
  readFile(new URL('../desktop/renderer/activity-race-studio.js', import.meta.url), 'utf8'),
  readFile(new URL('../desktop/renderer/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/index.js', import.meta.url), 'utf8')
]);
assert.match(studioSource, /ping-info/, 'Das Liga-Studio braucht eine eigene Ping-Info-Sektion.');
assert.match(studioSource, /data-activity-race-open-studio="ping-info"/, 'Die Moduloberflaeche muss das Ping-Info-Studio oeffnen koennen.');
assert.match(appSource, /body:\s*\{\s*section:\s*raceSection,\s*template\s*\}/, 'Die gewaehlte Liga-Sektion muss an das Backend gesendet werden.');
assert.match(backendSource, /pingInfoDesign/, 'Das Backend muss das Ping-Info-Design getrennt speichern.');

console.log('activity race ping preferences smoke: ok');
