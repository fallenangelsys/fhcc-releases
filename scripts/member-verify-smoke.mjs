#!/usr/bin/env node
/**
 * Smoke-Test: Mitglieder-Verifizierung (memberVerify).
 * Prüft das Profil-Screening (Ziffern/Links/verbotene Begriffe), die
 * Aufgaben-Palette (10 Typen, PNG-Captcha, Antwort-Prüfung), die
 * Custom-Fragen, die Team-Rechte-Prüfung und die Reminder-Logik
 * (5-min-Erinnerungen, max. 3, dann Kick) – ohne Discord-Verbindung
 * (reine Logik via _memberVerifyInternals).
 */
import assert from 'node:assert/strict';
import { _memberVerifyInternals } from '../src/features/memberVerify.js';

let passed = 0;
const ok = (name) => { passed += 1; console.log(`  ✅ ${name}`); };

const cfg = (patch = {}) => ({
  memberVerify: {
    enabled: true,
    digitRatioPercent: 40,
    maxDigitRun: 6,
    flaggedTerms: 'scammer\ntroll\nnitro',
    autoBanFlaggedNames: false,
    requireTeamApproval: true,
    kickOnFailedVerify: true,
    reminderEnabled: true,
    reminderDelayMinutes: 5,
    maxReminders: 3,
    reminderChannelId: '',
    reminderPhrases: '',
    ...patch
  }
});

const member = (name) => ({ user: { username: name, globalName: name, avatar: 'abc' }, id: '111' });
const moduleCfg = (patch = {}) => cfg(patch).memberVerify;

console.log('Profil-Screening:');
{
  const clean = _memberVerifyInternals.screenProfile(member('MaxMustermann'), moduleCfg());
  assert.equal(clean.length, 0, 'sauberer Name darf keine Flags haben');
  ok('sauberer Name → 0 Flags');

  const digits = _memberVerifyInternals.screenProfile(member('gamer123456789012'), moduleCfg());
  assert.ok(digits.length >= 1, 'Ziffern-Flut muss geflaggt werden');
  assert.equal(digits[0].hard, false, 'Ziffern-Flag ist Warnung, kein Hard-Flag');
  ok(`Ziffern-Flut erkannt (${digits[0].label})`);

  const link = _memberVerifyInternals.screenProfile(member('discord.gg/free-nitro'), moduleCfg());
  assert.ok(link.some((flag) => flag.hard), 'Link im Namen ist Hard-Flag');
  ok('Link im Namen → Hard-Flag');

  const term = _memberVerifyInternals.screenProfile(member('FreeNitroGiveaway'), moduleCfg());
  assert.ok(term.some((flag) => flag.hard), 'verbotener Begriff ist Hard-Flag');
  ok('verbotener Begriff → Hard-Flag');

  const disabled = _memberVerifyInternals.screenProfile(member('gamer123456789012'), moduleCfg({ digitRatioPercent: 0, maxDigitRun: 0 }));
  assert.ok(!disabled.some((flag) => flag.label.includes('Ziffer')), 'deaktivierte Schwellen dürfen nicht flaggen');
  ok('deaktivierte Schwellen (0) ignorieren Ziffern');

  const youngMember = { user: { username: 'MaxMustermann', globalName: 'Max', avatar: 'abc', createdAt: new Date(Date.now() - 2 * 86400000) }, id: '222' };
  const young = _memberVerifyInternals.screenProfile(youngMember, moduleCfg({ minAccountAgeDays: 7 }));
  assert.ok(young.some((flag) => flag.key === 'young-account'), 'junges Konto wird geflaggt');
  assert.equal(young.find((flag) => flag.key === 'young-account').hard, false, 'ohne autoBanYoungAccounts ist die Alters-Warnung soft');
  const youngHard = _memberVerifyInternals.screenProfile(youngMember, moduleCfg({ minAccountAgeDays: 7, autoBanYoungAccounts: true }));
  assert.equal(youngHard.find((flag) => flag.key === 'young-account').hard, true, 'mit autoBanYoungAccounts ist die Alters-Warnung hard');
  const oldEnough = _memberVerifyInternals.screenProfile({ user: { username: 'MaxMustermann', globalName: 'Max', avatar: 'abc', createdAt: new Date(Date.now() - 30 * 86400000) }, id: '333' }, moduleCfg({ minAccountAgeDays: 7 }));
  assert.ok(!oldEnough.some((flag) => flag.key === 'young-account'), 'altes Konto wird nicht geflaggt');
  assert.equal(_memberVerifyInternals.screenProfile(member('MaxMustermann'), moduleCfg({ minAccountAgeDays: 7 })).some((flag) => flag.key === 'young-account'), false, 'ohne createdAt keine Alters-Warnung');
  ok('Konto-Alter-Prüfung (jung/alt/soft/hard/deaktiviert)');
}

console.log('Aufgaben-Palette + Antwort-Prüfung:');
{
  // Vielfalt: über viele Ziehungen müssen (fast) alle Typen auftauchen
  const seen = new Set();
  for (let i = 0; i < 150; i += 1) seen.add(_memberVerifyInternals.generateChallenge().taskId);
  assert.ok(seen.size >= 8, `ausreichend viele verschiedene Aufgaben (${seen.size}/10)`);
  ok(`Aufgaben-Palette: ${seen.size} verschiedene Typen in 150 Ziehungen`);

  const challenge = _memberVerifyInternals.generateChallenge();
  assert.ok(challenge.nonce !== undefined && challenge.expected !== undefined, 'Challenge hat nonce + expected');
  assert.ok(['text', 'buttons'].includes(challenge.kind), 'Challenge hat gültigen kind');
  assert.ok(challenge.promptTitle && challenge.promptDescription, 'Challenge hat Aufgaben-Text');
  if (challenge.kind === 'buttons') {
    assert.ok(Array.isArray(challenge.options) && challenge.options.length >= 4, 'Button-Aufgaben haben Optionen');
    assert.ok(challenge.correctIndex >= 0 && challenge.correctIndex < challenge.options.length, 'Button-Aufgaben haben correctIndex');
  }
  ok('Challenge-Struktur (nonce, expected, kind, Optionen, Text)');

  // Bild-Captcha: PNG-Signatur + Deflate-Roundtrip + Antwort-Prüfung
  const { generateCaptcha } = await import('../src/runtime/captchaImage.js');
  const captcha = generateCaptcha({ length: 4 });
  assert.match(captcha.text, /^[A-Z0-9]{4}$/, 'Captcha-Text aus erlaubtem Zeichensatz');
  const png = captcha.buffer;
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], 'PNG-Signatur');
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  assert.ok(width > 100 && height > 60, `Bildgröße plausibel (${width}x${height})`);
  assert.equal(png.readUInt8(24), 8, '8 Bit Tiefe');
  assert.equal(png.readUInt8(25), 6, 'RGBA-Farbtyp');
  const { inflateSync } = await import('node:zlib');
  const idatStart = png.indexOf(Buffer.from('IDAT'));
  const idatLength = png.readUInt32BE(idatStart - 4);
  const raw = inflateSync(png.subarray(idatStart + 4, idatStart + 4 + idatLength));
  assert.equal(raw.length, (width * 4 + 1) * height, 'IDAT-Dekompression liefert erwartete Scanline-Größe');
  assert.ok(_memberVerifyInternals.verifyAnswer('captcha', captcha.text, captcha.text.toLowerCase()), 'Captcha-Antwort case-insensitive korrekt');
  assert.equal(_memberVerifyInternals.verifyAnswer('captcha', captcha.text, 'ZZZZ'), false, 'falsche Captcha-Antwort abgelehnt');
  ok('Captcha: PNG-Encoding + Antwort-Prüfung');

  // Text-Aufgaben-Antworten
  assert.equal(_memberVerifyInternals.verifyAnswer('wordMath', '11', '11'), true);
  assert.equal(_memberVerifyInternals.verifyAnswer('wordMath', '11', '9'), false);
  assert.equal(_memberVerifyInternals.verifyAnswer('wordMath', '11', '11,0'), true, 'Komma-Dezimal akzeptiert');
  assert.equal(_memberVerifyInternals.verifyAnswer('countEmoji', '4', '04'), true, 'führende Null ok');
  assert.equal(_memberVerifyInternals.verifyAnswer('countEmoji', '4', '5'), false);
  assert.equal(_memberVerifyInternals.verifyAnswer('reverseWord', 'HAUS', 'haus'), true, 'Wort case-insensitive');
  assert.equal(_memberVerifyInternals.verifyAnswer('reverseWord', 'HAUS', 'SUAH'), false);
  assert.equal(_memberVerifyInternals.verifyAnswer('emojiPick', 2, '2'), true, 'Button-Index numerisch');
  assert.equal(_memberVerifyInternals.verifyAnswer('emojiPick', 2, '3'), false);
  ok('verifyAnswer: alle Aufgabentypen (Text + Buttons)');

  const questions = _memberVerifyInternals.customQuestions(moduleCfg({ customQuestions: 'Wie heißt unser Server?\n\nZu kurze Frage\n'.repeat(8) }));
  assert.equal(questions.length, 3, 'max. 3 Fragen, zu kurze Zeilen gefiltert');
  ok('Custom-Fragen: max. 3, leere/zu kurze Zeilen gefiltert');

  const modal = _memberVerifyInternals.buildQuizModal({ taskId: 'wordMath', nonce: 'abc123' }, questions);
  assert.match(modal.data.custom_id, /^fh_verify:submit:[a-z0-9]+$/, 'Modal-Custom-ID trägt nonce');
  assert.equal(modal.components.length, 1 + questions.length, '1 Aufgaben-Feld + Custom-Fragen als Zeilen');
  assert.equal(modal.components[0].components[0].data.custom_id, 'answer', 'Antwort-Feld vorhanden');
  ok('Modal enthält Aufgaben-Feld + Custom-Fragen');

  assert.equal(_memberVerifyInternals.MAX_ATTEMPTS, 3, 'max. 3 Versuche');
  assert.ok(_memberVerifyInternals.MIN_ANSWER_MS >= 1000, 'Mindest-Lesezeit gesetzt');
  ok('Sicherheitsparameter (Versuche, Lesezeit)');
}

console.log('Team-Rechte:');
{
  const guild = { ownerId: '9' };
  const mod = { permissions: { has: (flag) => flag === 1n << 40n }, guild }; // ModerateMembers
  const banned = { permissions: { has: (flag) => flag === 1n << 2n }, guild }; // BanMembers
  const normal = { permissions: { has: () => false }, guild };
  const owner = { permissions: { has: () => false }, guild, id: '9' };
  assert.ok(_memberVerifyInternals.isTeamMember(mod), 'ModerateMembers → Team');
  assert.ok(_memberVerifyInternals.isTeamMember(banned), 'BanMembers → Team');
  assert.ok(_memberVerifyInternals.isTeamMember(owner), 'Server-Owner → Team');
  assert.equal(_memberVerifyInternals.isTeamMember(normal), false, 'normales Mitglied → kein Team');
  ok('Team-Erkennung (ModerateMembers/BanMembers/Owner)');
}

console.log('Reminder-Logik:');
{
  const rs = _memberVerifyInternals.reminderSettings(cfg());
  assert.equal(rs.enabled, true, 'Reminder aktiv per Default');
  assert.equal(rs.delayMs, 5 * 60 * 1000, 'Default-Verzögerung 5 Minuten');
  assert.equal(rs.maxReminders, 3, 'Default max. 3 Erinnerungen');
  ok('Reminder-Einstellungen (5 min, max. 3, aktiv)');

  const off = _memberVerifyInternals.reminderSettings(cfg({ reminderEnabled: false, maxReminders: 0, reminderDelayMinutes: 5 }));
  assert.equal(off.enabled, false, 'Reminder deaktivierbar');
  ok('Reminder abschaltbar');

  const now = Date.now();
  const delay = 5 * 60 * 1000;
  assert.equal(_memberVerifyInternals.earnedReminderCount({ joinedAt: now, now, delayMs: delay }), 0, 'vor Ablauf keine Erinnerung');
  assert.equal(_memberVerifyInternals.earnedReminderCount({ joinedAt: now - delay - 1000, now, delayMs: delay }), 1, 'nach Ablauf die erste');
  assert.equal(_memberVerifyInternals.earnedReminderCount({ joinedAt: now - 2 * delay - 1000, now, delayMs: delay }), 2, 'nach 2 Intervallen die zweite');
  assert.equal(_memberVerifyInternals.earnedReminderCount({ joinedAt: now - 3 * delay - 1000, now, delayMs: delay }), 3, 'nach 3 Intervallen die dritte');
  assert.equal(_memberVerifyInternals.earnedReminderCount({ joinedAt: now - 4 * delay - 1000, now, delayMs: delay }), 4, 'danach mehr als max → Kick-Fall');
  ok('Fälligkeits-Berechnung (1., 2., 3., Kick-Fall)');

  const phrases = _memberVerifyInternals.reminderPhrases({ reminderPhrases: '' });
  assert.ok(phrases.length >= 5, 'eingebaute Sätze vorhanden');
  const custom = _memberVerifyInternals.reminderPhrases({ reminderPhrases: 'Hallo {user}!\n\nZu kurz\n'.repeat(30) });
  assert.equal(custom.length, 20, 'max. 20 eigene Sätze');
  assert.ok(custom.every((line) => line.length >= 5 && line.length <= 300), 'nur gültige Sätze');
  assert.match(custom[0], /\{user\}/);
  ok('Reminder-Sätze (eingebaut + eigene, {user}-Template)');

  const store = { version: 1, guilds: {} };
  const joined = new Date(now - 60 * 1000);
  const entry = _memberVerifyInternals.trackReminderMember(store, 'g1', { id: 'u1', joinedAt: joined });
  assert.ok(Number(entry.joinedAtForReminders) > 0, 'Mitglied wird für Reminder getrackt');
  const entry2 = _memberVerifyInternals.trackReminderMember(store, 'g1', { id: 'u1', joinedAt: new Date(now) });
  assert.equal(entry2.joinedAtForReminders, entry.joinedAtForReminders, 'Beitrittszeit bleibt stabil');
  _memberVerifyInternals.clearReminderState(store, 'g1', 'u1');
  assert.equal(store.guilds.g1.pending.u1.joinedAtForReminders, undefined, 'Reminder-Zustand aufräumbar');
  ok('Reminder-Tracking im Store (stabil + aufräumbar)');
}

console.log('Statistik-Zähler:');
{
  const store = { version: 1, guilds: {} };
  _memberVerifyInternals.bumpStats(store, 'g1', 'verifiedTotal');
  _memberVerifyInternals.bumpStats(store, 'g1', 'verifiedTotal');
  _memberVerifyInternals.bumpStats(store, 'g1', 'flaggedTotal');
  _memberVerifyInternals.bumpStats(store, 'g1', 'bannedTotal');
  _memberVerifyInternals.bumpStats(store, 'g1', 'kickedTotal');
  const stats = store.guilds.g1.stats;
  assert.equal(stats.verifiedTotal, 2, 'verifiedTotal zählt hoch');
  assert.equal(stats.verifiedToday, 2, 'verifiedToday zählt hoch');
  assert.equal(stats.flaggedTotal, 1, 'flaggedTotal zählt hoch');
  assert.equal(stats.bannedTotal, 1, 'bannedTotal zählt hoch');
  assert.equal(stats.kickedTotal, 1, 'kickedTotal zählt hoch');
  ok('Statistik-Zähler (verifiziert/geflaggt/gebanned/gekickt)');
}

console.log('Editierbare Texte (3.9.222-Prinzip):');
{
  const custom = moduleCfg({
    panelStartButton: 'Jetzt verifizieren',
    panelStatsButton: 'Meine Zahlen',
    challengeTitle: 'Bist du wirklich ein Mensch?',
    challengeDescription: 'Löse die Aufgabe – {validMinutes} Minuten Zeit.',
    challengeFooterButtons: 'Privat · Klicke die richtige Antwort',
    challengeFooterText: 'Privat · {validMinutes} Minuten gültig',
    statsTitle: 'Meine Verify-Statistik',
    statsAuthor: 'FALLEN HEAVEN · MEINE ZAHLEN',
    statsFooter: 'Nur für dich sichtbar',
    statsVerifiedTotalField: 'Gesamt verifiziert',
    statsVerifiedTodayField: 'Heute',
    statsApprovedField: 'Freigaben',
    statsFlaggedField: 'Geprüft',
    statsBannedField: 'Banns',
    statsKickedField: 'Kicks',
    statsPendingField: 'Offen',
    statsAwaitingField: 'Wartet',
    decisionApprovePending: 'Ok, freigeben',
    decisionApproveDone: 'Wieder durchlassen',
    decisionApproveResolved: 'Freigegeben ✓',
    decisionBan: 'Sperren',
    decisionBanResolved: 'Gesperrt',
    answerButtonLabel: 'Antworten',
    approvalAuthor: 'FREIGABE NÖTIG',
    approvalDescription: '{username} hat die Aufgabe gelöst – bitte prüfen.',
    approvalMemberField: 'Person',
    approvalTaskField: 'Aufgabe',
    approvalAnswersField: 'Antworten'
  });
  const texts = _memberVerifyInternals.verifyTexts(custom);
  assert.equal(texts.panelStartButton, 'Jetzt verifizieren', 'Panel-Start-Button editierbar');
  assert.equal(texts.statsBannedField, 'Banns', 'Statistik-Feldname editierbar');
  assert.equal(texts.decisionBan, 'Sperren', 'Bann-Button-Label editierbar');
  assert.equal(texts.approvalAuthor, 'FREIGABE NÖTIG', 'Freigabe-Autor editierbar');

  // Fallbacks: leere Config liefert die Standard-Texte
  const defaults = _memberVerifyInternals.verifyTexts(moduleCfg());
  assert.equal(defaults.panelStartButton, 'Verifizieren', 'Default-Start-Button');
  assert.equal(defaults.statsTitle, 'Verifizierungs-Statistik', 'Default-Statistik-Titel');
  assert.equal(defaults.challengeFooterText, 'Nur für dich sichtbar · {validMinutes} Minuten gültig', 'Default-Challenge-Footer');

  // Platzhalter-Ersetzung
  const formatted = _memberVerifyInternals.formatVerifyText('Hallo {username} auf {server} · {validMinutes} min', {
    username: 'Max', server: 'FALLEN HEAVEN', validMinutes: '5'
  });
  assert.equal(formatted, 'Hallo Max auf FALLEN HEAVEN · 5 min', 'Platzhalter {username}/{server}/{validMinutes} ersetzt');

  ok('Verify-Texte: Defaults, eigene Werte und Platzhalter-Ersetzung funktionieren');
}

console.log(`\nMitglieder-Verifizierung: ${passed} Checks grün ✅`);
