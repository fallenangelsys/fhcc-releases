export const featureCards = [
  {
    id: 'botProfile',
    title: 'Bot Profil & Branding',
    description: 'Name, Avatar, Banner, App-Tags und Presence',
    detail: 'Globale Bot-Identität. Avatar, Banner, Username, App-Beschreibung und App-Tags wirken für den Bot insgesamt, nicht nur auf einem Server. Wegen Discord-Rate-Limits nur bewusst anwenden.',
    icon: 'ID',
    fields: [
      { key: 'botProfile.applyProfileOnStartup', label: 'Profil beim Start anwenden', type: 'checkbox', info: 'Wenn aktiv, versucht der Bot beim Start die unten gesetzten Profilwerte zu übernehmen. Nicht ständig ändern, Discord limitiert solche Aktionen.' },
      { key: 'botProfile.forceApplyImages', label: 'Bilder erneut erzwingen', type: 'checkbox', info: 'Erzwingt Avatar/Banner/Icon/Cover erneut, auch wenn dieselbe Quelle schon angewendet wurde. Nur nutzen, wenn Discord das Bild nicht übernommen hat.' },
      { key: 'botProfile.username', label: 'Bot Username', type: 'text', placeholder: 'Fallen Heaven', info: 'Globaler Username des Bots. Discord erlaubt 2 bis 32 Zeichen und verbietet manche Begriffe/Zeichen.' },
      { key: 'botProfile.guildNickname', label: 'Server Nickname', type: 'text', placeholder: 'Fallen Heaven AI', info: 'Nickname des Bots auf deinen Servern. Das ist sicherer als der globale Username und kann pro Server sichtbar anders sein.' },
      { key: 'botProfile.avatarImage', label: 'Avatar Bild URL/Pfad', type: 'text', placeholder: 'https://... oder C:\\\\Pfad\\\\avatar.png', info: 'Avatar des Bot-Users. Unterstützt Bild-URL, Data-URI oder lokalen Pfad.' },
      { key: 'botProfile.bannerImage', label: 'Bot Banner URL/Pfad', type: 'text', placeholder: 'https://... oder C:\\\\Pfad\\\\banner.png', info: 'Profilbanner des Bot-Users, falls Discord es für den Bot akzeptiert.' },
      { key: 'botProfile.appIconImage', label: 'App Icon URL/Pfad', type: 'text', placeholder: 'optional', info: 'Icon der Discord Application. Sichtbar im Developer/App-Profil.' },
      { key: 'botProfile.appCoverImage', label: 'App Cover/Banner URL/Pfad', type: 'text', placeholder: 'optional', info: 'Cover Image der Discord Application, nicht zu verwechseln mit dem Bot-User-Banner.' },
      { key: 'botProfile.applicationDescription', label: 'App Beschreibung', type: 'textarea', rows: 5, info: 'Professionelle Beschreibung für die Discord Application.' },
      { key: 'botProfile.applicationTags', label: 'App Tags (max. 5)', type: 'arrayLines', placeholder: 'moderation\nleveling\nai\nutility\ncommunity', info: 'Discord Application Tags, maximal 5 Tags und jeweils maximal 20 Zeichen. Das ist der echte App-Tag-Bereich, nicht der persönliche Server-Tag.' },
      { key: 'botProfile.serverTagNote', label: 'Server-Tag Hinweis', type: 'text', placeholder: 'Bots können Primary-Guild-Tags nicht selbst erzwingen.', info: 'Discord zeigt Server-Tags als Primary-Guild-Identität bei Usern. Ein Bot kann diese Auswahl nicht wie ein normaler User frei erzwingen.' }
    ]
  },
  {
    id: 'customRichPresence',
    title: 'Custom Rich Presence',
    description: 'Eigener Live-RPC wie CustomRP',
    detail: 'Native Discord Rich Presence direkt aus der FALLEN-HEAVEN-App. Die Party-Zahl zeigt ausschließlich sichtbare Online-Mitglieder links und alle Servermitglieder rechts.',
    icon: 'RPC',
    fields: [
      { key: 'customRichPresence.enabled', label: 'Custom RP aktiv', type: 'checkbox', info: 'Schaltet die eigene Discord Rich Presence ein. CustomRP muss dafür nicht zusätzlich laufen.' },
      { key: 'customRichPresence.applicationId', label: 'Application ID', type: 'text', placeholder: '1486457987072528575', info: 'Discord Application Client ID für die Rich Presence Assets und Buttons.' },
      { key: 'customRichPresence.details', label: 'Details', type: 'text', placeholder: '{guild} - {online} online', info: 'Erste Zeile der Presence. Platzhalter: {guild}, {online}, {members}, {channels}.' },
      { key: 'customRichPresence.state', label: 'State', type: 'text', placeholder: 'Aktive Gefallene', info: 'Zweite Zeile der Presence.' },
      { key: 'customRichPresence.countMode', label: 'Party-Zahl Modus', type: 'select', options: [
        { value: 'presence-total', label: 'Discord online / Mitglieder gesamt' }
      ], info: 'Fest auf Discord online / Mitglieder gesamt eingestellt. Dafür muss Presence Intent im Discord Developer Portal aktiv sein.' },
      { key: 'customRichPresence.largeImageKey', label: 'Großes Bild Key', type: 'text', placeholder: 'pfp', info: 'Asset-Key aus dem Discord Developer Portal Rich Presence Assets.' },
      { key: 'customRichPresence.largeImageText', label: 'Großes Bild Text', type: 'text', placeholder: 'Fallen-Heaven', info: 'Tooltip für das große Bild.' },
      { key: 'customRichPresence.smallImageKey', label: 'Kleines Bild Key', type: 'text', placeholder: 'verified', info: 'Asset-Key für das kleine Bild.' },
      { key: 'customRichPresence.smallImageText', label: 'Kleines Bild Text', type: 'text', placeholder: 'Aktiver Server', info: 'Tooltip für das kleine Bild.' },
      { key: 'customRichPresence.button1Label', label: 'Knopf 1 Text', type: 'text', placeholder: 'Mein Server', info: 'Text für den ersten Rich-Presence-Button.' },
      { key: 'customRichPresence.button1Url', label: 'Knopf 1 URL', type: 'text', placeholder: 'https://discord.gg/fallen-heaven', info: 'URL für Knopf 1. Discord erlaubt nur echte https/http Links.' },
      { key: 'customRichPresence.button2Label', label: 'Knopf 2 Text', type: 'text', placeholder: 'guns.lol', info: 'Text für den zweiten Rich-Presence-Button.' },
      { key: 'customRichPresence.button2Url', label: 'Knopf 2 URL', type: 'text', placeholder: 'https://guns.lol/0xvoidsoul', info: 'URL für Knopf 2.' },
      { key: 'customRichPresence.updateIntervalSeconds', label: 'Update Intervall Sekunden', type: 'number', min: 15, max: 300, info: 'Wie oft die Presence maximal aktualisiert wird. Zusätzlich wird nur bei Änderung gesendet.' }
    ]
  },
  {
    id: 'general',
    title: 'Allgemein',
    description: 'Basiseinstellungen und Verhalten',
    detail: 'Grundverhalten des Bots: Prefix-Fallback, Sprache, Zeitzone, Status und automatische Backups.',
    icon: '⚙️',
    fields: [
      { key: 'general.prefix', label: 'Prefix', type: 'text', placeholder: '!', hint: 'Fallback für Nicht-Slash-Befehle', info: 'Zeichen vor klassischen Textbefehlen. Slash-Commands funktionieren unabhängig davon, aber ein Prefix ist praktisch für ältere Commands oder schnelle Admin-Aktionen.' },
      { key: 'general.locale', label: 'Locale', type: 'text', placeholder: 'de-DE', info: 'Sprache/Region für Texte und Formatierungen. Für deutsche Server ist de-DE ideal.' },
      { key: 'general.timezone', label: 'Zeitzone', type: 'text', placeholder: 'Europe/Berlin', info: 'Zeitzone für Logs, Backups und geplante Aktionen. Europe/Berlin nutzt automatisch Sommer-/Winterzeit.' },
      { key: 'general.statusMessage', label: 'Status Nachricht', type: 'text', placeholder: 'Bot ist aktiv', info: 'Text, den der Bot als Discord-Aktivität anzeigen soll.' },
      { key: 'general.statusType', label: 'Status Typ', type: 'select', options: [
        { value: 'Playing', label: 'Spielt' },
        { value: 'Watching', label: 'Schaut' },
        { value: 'Listening', label: 'Hört' },
        { value: 'Competing', label: 'Tritt an' }
      ], info: 'Legt fest, wie Discord die Aktivität anzeigt, z. B. Spielt, Schaut oder Hört.' },
      { key: 'general.onlineStatus', label: 'Online Status', type: 'select', options: [
        { value: 'online', label: 'Online' },
        { value: 'idle', label: 'Abwesend' },
        { value: 'dnd', label: 'Nicht stören' }
      ], info: 'Discord-Präsenz des Bots. Online ist Standard, DND wirkt professionell für Wartungsphasen.' },
      { key: 'general.ownerUserIds', label: 'Owner User IDs', type: 'arrayLines', placeholder: '123456789\n987654321', info: 'Optionale Liste deiner Discord-User-IDs für spätere Admin-Spezialfunktionen.' },
      { key: 'general.staffRoleIds', label: 'Teamrollen', type: 'multiRoleSelect', info: 'Wähle die globalen Teamrollen direkt aus Discord aus. Nicht verwaltbare Rollen werden klar gekennzeichnet.' },
      { key: 'general.commandLogChannelId', label: 'Command Log Kanal', type: 'channelSelect', placeholder: 'optional', info: 'Kanal für spätere Command-Logs und Admin-Aktionen.' },
      { key: 'general.enableTypingIndicator', label: 'Typing-Indikator', type: 'checkbox', info: 'Wenn aktiv, kann der Bot vor längeren Antworten den Schreibstatus anzeigen.' },
      { key: 'general.autoBackupMinutes', label: 'Auto Backup (Minuten)', type: 'number', min: 5, step: 1, info: 'Intervall für automatische Sicherungen der Server-Konfiguration. 10 bis 30 Minuten sind ein guter Bereich.' }
    ]
  },
  {
    id: 'moderation',
    title: 'Moderationsassistent',
    description: 'Beobachten, verwarnen und sicher eingreifen',
    detail: 'Bündelt Regelverstöße zu nachvollziehbaren Vorfällen, schützt vor Fehlalarmen und lässt das Team jede Entscheidung prüfen.',
    icon: '🛡️',
    fields: [
      { key: 'moderation.enabled', label: 'Modul aktiv', type: 'checkbox', info: 'Schaltet alle Moderationsregeln dieses Moduls ein oder aus.' },
      { key: 'moderation.mode', label: 'Betriebsmodus', type: 'select', options: [
        { value: 'observe', label: 'Nur beobachten (empfohlen zum Einrichten)' },
        { value: 'warn', label: 'Löschen und verwarnen' },
        { value: 'enforce', label: 'Vollautomatisch mit Timeout' }
      ], info: 'Beobachten protokolliert nur. Verwarnen löscht Treffer und informiert im Kanal. Vollautomatisch setzt nach der gewählten Anzahl einen Discord-Timeout.' },
      { key: 'moderation.logChannelId', label: 'Moderationsprotokoll', type: 'channelSelect', placeholder: 'Kanal auswählen ...', info: 'Hier erscheinen prüfbare Vorfälle mit Schaltflächen für Fehlalarm, Erlassen und Timeout-Aufhebung.' },
      { key: 'moderation.autoDelete', label: 'Verstoß automatisch löschen', type: 'checkbox', info: 'Wirkt nur in den Modi Verwarnen und Vollautomatisch. Im Beobachtungsmodus bleibt die Nachricht unangetastet.' },
      { key: 'moderation.badWords', label: 'Gesperrte Begriffe · mittel', type: 'arrayLines', placeholder: 'Begriff oder Ausdruck je Zeile', info: 'Exakte Wörter und Ausdrücke mittlerer Schwere. Wortgrenzen verhindern einfache Fehlalarme in längeren, harmlosen Wörtern.' },
      { key: 'moderation.highRiskTerms', label: 'Schwere Begriffe · hoch', type: 'arrayLines', placeholder: 'Schwerer Ausdruck je Zeile', info: 'Begriffe, die als schwerer Verstoß protokolliert werden.' },
      { key: 'moderation.criticalTerms', label: 'Kritische Begriffe', type: 'arrayLines', placeholder: 'Kritischer Ausdruck je Zeile', info: 'Nur für eindeutig kritische Inhalte. Ein sofortiger Timeout muss separat ausdrücklich aktiviert werden.' },
      { key: 'moderation.antiSpamEnabled', label: 'Anti-Spam aktiv', type: 'checkbox', info: 'Erkennt zu viele Nachrichten in kurzer Zeit und kann automatisch warnen oder timeouten.' },
      { key: 'moderation.antiSpamThreshold', label: 'Nachrichten-Schwelle', type: 'number', min: 3, max: 50, step: 1, info: 'Wie viele Nachrichten im Zeitfenster erlaubt sind, bevor Anti-Spam reagiert.' },
      { key: 'moderation.antiSpamWindowSeconds', label: 'Zeitfenster (Sekunden)', type: 'number', min: 3, step: 1, info: 'Zeitraum, in dem Nachrichten gezählt werden. Kürzer ist strenger.' },
      { key: 'moderation.mentionSpamThreshold', label: 'Erwähnungen pro Nachricht', type: 'number', min: 3, max: 50, step: 1, info: 'Ab dieser Anzahl unterschiedlicher Nutzer- und Rollen-Erwähnungen wird die Nachricht als Mention-Spam bewertet.' },
      { key: 'moderation.incidentWindowSeconds', label: 'Vorfälle bündeln (Sekunden)', type: 'number', min: 15, max: 900, step: 5, info: 'Mehrere Treffer derselben Person in diesem kurzen Zeitraum werden als ein Vorfall behandelt und erzeugen nicht künstlich mehrere Verwarnungen.' },
      { key: 'moderation.warningWindowDays', label: 'Verwarnungen berücksichtigen (Tage)', type: 'number', min: 1, max: 365, step: 1, info: 'Nur aktive Vorfälle innerhalb dieses Zeitraums zählen für die Eskalation.' },
      { key: 'moderation.maxWarnings', label: 'Timeout nach Verwarnungen', type: 'number', min: 1, max: 20, step: 1, info: 'Im vollautomatischen Modus wird ab dieser Anzahl aktiver Vorfälle ein Timeout gesetzt.' },
      { key: 'moderation.lightTimeoutMinutes', label: 'Timeout · leicht (Minuten)', type: 'number', min: 1, max: 40320, step: 1, info: 'Dauer für Spam und leichte Verstöße.' },
      { key: 'moderation.mediumTimeoutMinutes', label: 'Timeout · mittel (Minuten)', type: 'number', min: 1, max: 40320, step: 1, info: 'Dauer für gesperrte Begriffe und Mention-Spam.' },
      { key: 'moderation.highTimeoutMinutes', label: 'Timeout · hoch (Minuten)', type: 'number', min: 1, max: 40320, step: 1, info: 'Dauer für schwere Verstöße.' },
      { key: 'moderation.criticalTimeoutMinutes', label: 'Timeout · kritisch (Minuten)', type: 'number', min: 1, max: 40320, step: 1, info: 'Dauer für kritische Verstöße.' },
      { key: 'moderation.criticalImmediateTimeout', label: 'Kritische Treffer sofort timeouten', type: 'checkbox', info: 'Nur im vollautomatischen Modus. Überspringt bei kritischen Treffern die normale Verwarnungsanzahl.' },
      { key: 'moderation.muteRoleId', label: 'Optionale Mute-Rolle', type: 'roleSelect', info: 'Spiegelt einen aktiven Discord-Timeout als Rolle. Nach Ende des Timeouts wird die Rolle automatisch entfernt.' },
      { key: 'moderation.exemptRoleIds', label: 'Ausgenommene Rollen', type: 'multiRoleSelect', info: 'Mitglieder mit einer dieser Rollen werden vom Moderationsassistenten nicht automatisch bewertet.' },
      { key: 'moderation.ignoredChannelIds', label: 'Ausgenommene Kanäle und Kategorien', type: 'multiChannelSelect', info: 'Ausgewählte Kanäle sowie ausgewählte Kategorien werden vollständig ignoriert.' },
      { key: 'moderation.warningDeleteSeconds', label: 'Hinweis ausblenden nach (Sekunden)', type: 'number', min: 3, max: 300, step: 1, info: 'Kurze öffentliche Hinweise werden danach automatisch entfernt. Es werden keine DMs gesendet.' },
      { key: 'moderation.retentionDays', label: 'Vorfallsdaten aufbewahren (Tage)', type: 'number', min: 7, max: 365, step: 1, info: 'Technische Vorfälle werden lokal aufbewahrt und danach automatisch bereinigt.' }
    ]
  },
  {
    id: 'welcomeFarewell',
    title: 'Welcome / Farewell',
    description: 'Begrüßung und Verabschiedung',
    detail: 'Automatische Nachrichten und Rollen, wenn Mitglieder kommen oder gehen.',
    icon: '👋',
    fields: [
      { key: 'welcomeFarewell.enabled', label: 'Modul aktiv', type: 'checkbox', info: 'Schaltet Welcome, Farewell und AutoRole zusammen ein oder aus.' },
      { key: 'welcomeFarewell.welcomeEnabled', label: 'Welcome aktiv', type: 'checkbox', info: 'Sendet eine Begrüßung, wenn ein neues Mitglied beitritt.' },
      { key: 'welcomeFarewell.welcomeAfterVerification', label: 'Erst nach Verifizierung begrüßen', type: 'checkbox', info: 'Wartet mit der Begrüßung, bis die ausgewählte Unverified-Rolle tatsächlich entfernt wurde. Ideal für externe Verify-Bots wie GalaxyBot.' },
      { key: 'welcomeFarewell.verificationRoleId', label: 'Unverified-Rolle', type: 'roleSelect', placeholder: 'Unverified-Rolle auswählen ...', info: 'Die Begrüßung wird exakt beim Entfernen dieser Rolle gesendet. Die Rolle kann direkt aus der aktuellen Discord-Rollenliste gewählt werden.' },
      { key: 'welcomeFarewell.postVerificationRolesEnabled', label: 'Rollen nach Verifizierung aktiv', type: 'checkbox', info: 'Vergibt die ausgewählten Basisrollen, sobald die Unverified-Rolle entfernt wurde. Funktioniert unabhängig von der Welcome-Nachricht.' },
      { key: 'welcomeFarewell.postVerificationRoleIds', label: 'Rollen nach Verifizierung', type: 'multiRoleSelect', info: 'Wähle alle Rollen, die ein verifiziertes Mitglied gleichzeitig erhalten soll. Beim Bot-Start werden während Offline-Zeiten verpasste Vergaben effizient nachgetragen.' },
      { key: 'welcomeFarewell.welcomeChannelId', label: 'Welcome-Kanal', type: 'channelSelect', placeholder: 'Kanal auswählen ...', info: 'Wähle den Kanal aus, in den Begrüßungen gesendet werden.' },
      { key: 'welcomeFarewell.welcomeMessage', label: 'Welcome Text', type: 'text', placeholder: 'Willkommen {user} auf {guild}!', info: 'Text der Begrüßung. {user} und {username} pingen den User, {guild} schreibt den Servernamen.' },
      { key: 'welcomeFarewell.farewellEnabled', label: 'Farewell aktiv', type: 'checkbox', info: 'Sendet eine Nachricht, wenn ein Mitglied den Server verlässt.' },
      { key: 'welcomeFarewell.farewellChannelId', label: 'Farewell-Kanal', type: 'channelSelect', placeholder: 'Kanal auswählen ...', info: 'Wähle den Kanal für Abschiedsnachrichten aus.' },
      { key: 'welcomeFarewell.farewellMessage', label: 'Farewell Text', type: 'text', placeholder: '{user} hat den Server verlassen.', info: 'Text der Abschiedsnachricht. {user} und {username} pingen den User, {guild} schreibt den Servernamen.' },
      { key: 'welcomeFarewell.autoRoleEnabled', label: 'AutoRole aktiv', type: 'checkbox', info: 'Vergibt automatisch eine Rolle an neue Mitglieder.' },
      { key: 'welcomeFarewell.autoRoleName', label: 'AutoRole', type: 'roleSelect', placeholder: 'Rolle auswählen ...', info: 'Wähle die Rolle direkt aus Discord. Der Bot muss in der Rollenliste darüber stehen.' }
    ]
  },
  {
    id: 'autoresponder',
    title: 'Auto Responder',
    description: 'Kontrollierte Antworten ohne Doppelposts',
    detail: 'Reagiert einmalig auf präzise Trigger, respektiert Kanalregeln und verhindert Teilwort-Treffer, Spam sowie Doppelantworten.',
    icon: '🤖',
    fields: [
      { key: 'autoresponder.enabled', label: 'Modul aktiv', type: 'checkbox', info: 'Schaltet automatische Textantworten ein oder aus.' },
      { key: 'autoresponder.cooldownSeconds', label: 'Cooldown Sekunden', type: 'number', min: 5, step: 1, info: 'Mindestzeit zwischen zwei Auto-Antworten, damit der Bot nicht spammt.' },
      { key: 'autoresponder.caseInsensitive', label: 'Groß-/Klein-Schreibung ignorieren', type: 'checkbox', info: 'Wenn aktiv, erkennt der Bot Trigger unabhängig von Groß-/Kleinschreibung.' },
      { key: 'autoresponder.mentionOnly', label: 'Nur bei Erwähnung', type: 'checkbox', info: 'Antwortet nur, wenn der Bot erwähnt wird. Gut für ruhigere Server.' },
      { key: 'autoresponder.channelIds', label: 'Erlaubte Kanäle', type: 'multiChannelSelect', info: 'Optional: Wenn Kanäle gewählt sind, reagiert das Modul ausschließlich dort.' },
      { key: 'autoresponder.ignoredChannelIds', label: 'Ausgeschlossene Kanäle', type: 'multiChannelSelect', info: 'Diese Kanäle und Kategorien werden immer ignoriert.' },
      { key: 'autoresponder.allowUserMention', label: 'Mitglied in Antwort erwähnen', type: 'checkbox', info: 'Erlaubt ausschließlich die gezielte Erwähnung über {user}; Rollen und @everyone bleiben blockiert.' },
      { key: 'autoresponder.deleteCommand', label: 'Auslöser löschen', type: 'checkbox', info: 'Löscht die ursprüngliche Trigger-Nachricht nach der Antwort.' },
      { key: 'autoresponder.rules', label: 'Antwortregeln', type: 'json', placeholder: '[{ "trigger": "hallo", "mode": "word", "response": "Hi {username}!" }]', info: 'Modi: word (empfohlen), exact, startsWith oder contains. Platzhalter: {user}, {username}, {displayName}, {guild}, {channel}.'}
    ]
  },
  {
    id: 'levels',
    title: 'Leveling',
    description: 'Faire XP und Rollen für echte Chat-Aktivität',
    detail: 'Vergibt XP mit Cooldown, Tageslimit und Duplikatschutz, synchronisiert Level-Rollen und kann professionelle Level-Up-Embeds senden.',
    icon: '📈',
    fields: [
      { key: 'levels.enabled', label: 'Modul aktiv', type: 'checkbox', info: 'Schaltet XP-Vergabe und Level-Berechnung ein oder aus.' },
      { key: 'levels.xpPerMessageMin', label: 'Min XP', type: 'number', min: 1, step: 1, info: 'Kleinste XP-Menge pro gültiger Nachricht.' },
      { key: 'levels.xpPerMessageMax', label: 'Max XP', type: 'number', min: 1, step: 1, info: 'Größte XP-Menge pro gültiger Nachricht. Der Bot wählt zufällig zwischen Min und Max.' },
      { key: 'levels.cooldownSeconds', label: 'XP-Cooldown in Sekunden', type: 'number', min: 5, max: 3600, step: 1, info: 'Wie lange ein Mitglied warten muss, bevor eine weitere Nachricht XP gibt.' },
      { key: 'levels.minMessageLength', label: 'Mindestlänge einer Nachricht', type: 'number', min: 1, max: 500, step: 1, info: 'Kurze Zeichenfolgen und Emoji-Spam unter dieser Buchstaben-/Zahlenlänge geben keine XP.' },
      { key: 'levels.maxXpPerDay', label: 'Tägliches XP-Limit pro Mitglied', type: 'number', min: 50, max: 100000, step: 10, info: 'Begrenzt Farmen. Das Limit wird anhand der eingestellten Server-Zeitzone täglich zurückgesetzt.' },
      { key: 'levels.ignoredChannelIds', label: 'Kanäle ohne XP', type: 'multiChannelSelect', placeholder: 'Kanäle auswählen ...', info: 'In diesen Kanälen und ausgewählten Kategorien werden niemals XP vergeben.' },
      { key: 'levels.excludedRoleIds', label: 'Rollen ohne XP', type: 'multiRoleSelect', placeholder: 'Rollen auswählen ...', info: 'Mitglieder mit einer dieser Rollen erhalten keine XP, zum Beispiel Bots oder Quarantäne-Mitglieder.' },
      { key: 'levels.levelRoleMappings', label: 'Level-Belohnungen', type: 'roleMappingSelect', info: 'Wähle direkt aus, welche Discord-Rolle ab welchem Level gelten soll.' },
      { key: 'levels.cumulativeRoleRewards', label: 'Erreichte Level-Rollen behalten', type: 'checkbox', info: 'Aktiv: alle erreichten Rollen bleiben. Inaktiv: nur die höchste passende Level-Rolle bleibt aktiv.' },
      { key: 'levels.announce', label: 'Level Up ankündigen', type: 'checkbox', info: 'Sendet eine Nachricht, wenn jemand ein neues Level erreicht. Nutzt bevorzugt das Level-Up-Embed aus dem Embed Studio.' },
      { key: 'levels.announceChannelId', label: 'Level-Up-Kanal', type: 'channelSelect', placeholder: 'Optional auswählen ...', info: 'Optionaler Kanal für Level-Up-Meldungen. Leer bedeutet: Antwort im aktuellen Chat.' },
      { key: 'levels.levelUpMessage', label: 'Level Up Nachricht', type: 'text', placeholder: '{user} ist Level {level}', info: 'Fallback-Text, falls kein Level-Up-Embed aktiv ist. Platzhalter: {user}, {level}.' },
      { key: 'levels.voiceXpPerMinute', label: 'Voice-XP pro Minute', type: 'number', min: 0, max: 60, step: 1, info: 'XP, die für jede volle Minute in einem wertbaren Sprachchat-Kanal vergeben werden. 0 = keine Voice-XP.' },
      { key: 'levels.voiceMinimumParticipants', label: 'Menschen für gültige Sprachchat-XP', type: 'number', min: 1, max: 20, step: 1, info: 'Sprachchat-XP zählt erst, wenn mindestens so viele echte, wertbare Menschen gemeinsam im Kanal sind.' },
      { key: 'levels.levelCurveBase', label: 'Level-Kurvenbasis', type: 'number', min: 5, max: 100, step: 1, info: 'Bestimmt, wie schnell die Level-Anforderungen steigen. Höhere Werte machen höhere Level langsamer erreichbar.' },
      { key: 'levels.activityBonusPlace1', label: 'Aktivitäts-Bonus Platz 1', type: 'number', min: 0, max: 1000, step: 10, info: 'Täglicher XP-Bonus für den Spitzenreiter der Aktivitäts-Liga.' },
      { key: 'levels.activityBonusMaxPerDay', label: 'Aktivitäts-Bonus Tageslimit', type: 'number', min: 0, max: 5000, step: 10, info: 'Obergrenze für tägliche Aktivitäts-Boni über die Liga.' },
      { key: 'levels.levelRolesPanelChannelId', label: 'Level-Rollen-Panel Kanal', type: 'channelSelect', placeholder: 'optional', info: 'Optionaler Kanal für das Level-Rollen-Panel. Leer = kein Panel.' }
    ]
  },
  {
    id: 'activityRace',
    title: 'Aktivitäts-Liga',
    description: 'Tägliche, wöchentliche und monatliche Live-Ranglisten',
    detail: 'Zeigt faire Ranglisten für Chat und Sprachchat. Die Tagesrollen für Platz 1, 2 und 3 wechseln live mit der aktuellen Rangfolge. Wochen- und Monatsrollen werden erst nach einem vollständig erfassten Kalenderzeitraum vergeben. Nachrichteninhalte werden nicht gespeichert.',
    icon: 'RACE',
    fields: [
      { key: 'activityRace.enabled', label: 'Aktivitäts-Liga aktiv', type: 'checkbox', info: 'Aktiviert Zähler, Live-Embed und Rollenabgleich. Rollen werden niemals ohne deine ausdrückliche Bestätigung erstellt oder umbenannt.' },
      { key: 'activityRace.panelChannelId', label: 'Kanal der Aktivitäts-Liga', type: 'channelSelect', channelTypes: [0, 5], placeholder: 'Automatisch: aktivität-liga', info: 'Leer lassen: Der Bot erkennt den Textkanal „aktivität-liga“ automatisch. Er sendet dort genau ein Embed und aktualisiert anschließend immer diese Nachricht.' },
      { key: 'activityRace.ignoredChannelIds', label: 'Nicht gewertete Kanäle und Kategorien', type: 'multiChannelSelect', info: 'Nachrichten und Voice-Zeit in diesen Kanälen, Threads oder Kategorien zählen nicht.' },
      { key: 'activityRace.excludedRoleIds', label: 'Nicht gewertete Rollen', type: 'multiRoleSelect', info: 'Mitglieder mit einer dieser Rollen werden nicht gewertet, beispielsweise Bots, Quarantäne oder Event-Accounts.' },
      { key: 'activityRace.messageCooldownSeconds', label: 'Chat-Cooldown in Sekunden', type: 'number', min: 0, max: 300, step: 1, info: 'Mindestabstand zwischen zwei gewerteten Nachrichten derselben Person. 10 Sekunden verhindert Farmen, ohne echte Gespräche auszubremsen.' },
      { key: 'activityRace.duplicateWindowMinutes', label: 'Duplikatschutz in Minuten', type: 'number', min: 0, max: 1440, step: 1, info: 'Identische Nachrichten zählen in diesem Zeitraum nur einmal.' },
      { key: 'activityRace.minimumMessageLength', label: 'Mindestlänge für Chat-Wertung', type: 'number', min: 1, max: 500, step: 1, info: 'Mindestens so viele Buchstaben oder Zahlen muss eine Nachricht enthalten. Anhänge und Sticker gelten als Inhalt.' },
      { key: 'activityRace.voiceMinimumParticipants', label: 'Menschen für gültige Sprachchat-Zeit', type: 'number', min: 2, max: 20, step: 1, info: 'Sprachchat-Zeit zählt erst, wenn mindestens so viele echte, wertbare Menschen gemeinsam im Kanal sind.' },
      { key: 'activityRace.excludeDeafened', label: 'Vollständig taube Sprachchat-Zeit ausschließen', type: 'checkbox', info: 'Server- oder selbsttaube Mitglieder sammeln keine Sprachchat-Zeit. Normales Stummschalten bleibt erlaubt.' },
      { key: 'activityRace.placementPings', label: 'Platzierungs-Pings senden', type: 'checkbox', info: 'Der Bot erwähnt die betroffenen Mitglieder, sobald sie neu auf Platz 1–3 stehen, auf Platz 1 vorrücken oder aus den Top 3 verdrängt werden. Genutzt werden die hochgeladenen Trophy-Emojis.' },
      { key: 'activityRace.placementPingChannelId', label: 'Kanal für Platzierungs-Pings', type: 'channelSelect', channelTypes: [0, 5], placeholder: 'Automatisch: Ranglisten-Kanal (aktivität-liga)', info: 'Leer lassen: Die Pings erscheinen im Ranglisten-Kanal der Liga. Alternativ kann ein eigener Kanal für die Platzierungs-Pings ausgewählt werden.' },
      { key: 'activityRace.placementPingLifetimeMinutes', label: 'Ping-Anzeigedauer in Minuten', type: 'number', min: 1, max: 60, step: 1, info: 'Nach dieser Zeit löschen sich die Platzierungs-Pings selbst, damit der Kanal nicht vollläuft. Standard: 5 Minuten.' },
      { key: 'activityRace.pingToggleButtonLabel', label: 'Button · persönliche Liga-Pings', type: 'text', placeholder: 'LIGA-PINGS EIN/AUS', info: 'Label des echten Schalters unter dem separat editierbaren Ping-Info-Panel.' },
      { key: 'activityRace.announceCompletedPeriods', label: 'Abschluss-Ankündigungen senden', type: 'checkbox', info: 'Sobald eine Kalenderwoche oder ein Kalendermonat vollständig abgeschlossen ist, verkündet der Bot die Sieger der Wertung mit Trophys und @Mentions – genau einmal pro Zeitraum.' },
      { key: 'activityRace.announcementChannelId', label: 'Kanal für Abschluss-Ankündigungen', type: 'channelSelect', channelTypes: [0, 5], placeholder: 'Automatisch: Ranglisten-Kanal (aktivität-liga)', info: 'Leer lassen: Die Ankündigungen erscheinen im Ranglisten-Kanal der Liga. Alternativ kann ein eigener Kanal gewählt werden.' },
      { key: 'activityRace.separatorRoleName', label: 'Name der Trennerrolle', type: 'text', placeholder: '━━ AKTIVITÄTS-LIGA ━━', info: 'Diese Begleitrolle erhält jedes Mitglied mit mindestens einer aktiven Liga-Auszeichnung automatisch.' },
      ...[
        ['daily', 'Tageswertung'], ['weekly', 'Wochenwertung'], ['monthly', 'Monatswertung']
      ].flatMap(([period, periodLabel]) => [['Chat', 'Chat'], ['Voice', 'Sprachchat']].flatMap(([metric, metricLabel]) => [1, 2, 3].map((place) => {
        const suffix = place === 1 ? '' : `Top${place}`;
        const medal = place === 1 ? '🥇' : place === 2 ? '🥈' : '🥉';
        return { key: `activityRace.${period}${metric}${suffix}RoleName`, label: `Rollenname · ${periodLabel} · ${metricLabel} · Platz ${place}`, type: 'text', placeholder: `${medal} ${periodLabel} · ${metricLabel} · Platz ${place}`, info: 'Vor der bestätigten Erstellung oder Umbenennung frei änderbar.' };
      }))),
      { key: 'activityRace.separatorRoleId', label: 'Trennerrolle', type: 'roleSelect', placeholder: 'Noch nicht erstellt ...', info: 'Wird mit jeder Liga-Auszeichnung automatisch vergeben und nach der letzten Auszeichnung wieder entzogen.' },
      ...[
        ['daily', 'Tageswertung'], ['weekly', 'Wochenwertung'], ['monthly', 'Monatswertung']
      ].flatMap(([period, periodLabel]) => [['Chat', 'Chat'], ['Voice', 'Sprachchat']].flatMap(([metric, metricLabel]) => [1, 2, 3].map((place) => {
        const suffix = place === 1 ? '' : `Top${place}`;
        const timing = period === 'daily'
          ? 'Wird anhand des aktuellen Tagesstands live vergeben, verschoben und entzogen.'
          : `Wird erst nach einer vollständig erfassten ${period === 'weekly' ? 'Kalenderwoche' : 'Kalendermonatswertung'} vergeben.`;
        return { key: `activityRace.${period}${metric}${suffix}RoleId`, label: `Auszeichnung · ${periodLabel} · ${metricLabel} · Platz ${place}`, type: 'roleSelect', placeholder: 'Rolle auswählen ...', info: timing };
      })))
    ]
  },
  {
    id: 'tickets',
    title: 'Support-Tickets',
    description: 'Professionelles Button-Panel ohne Commands',
    detail: 'Veröffentlicht ein dauerhaftes Support-Panel, öffnet Anliegen über ein Discord-Formular und erstellt private Ticket-Kanäle oder private Threads mit nachvollziehbarem Abschluss.',
    icon: '🎟️',
    fields: [
      { key: 'tickets.enabled', label: 'Modul aktiv', type: 'checkbox', info: 'Schaltet das Ticket-System ein oder aus.' },
      { key: 'tickets.panelChannelId', label: 'Ticket-Panel-Kanal', type: 'channelSelect', channelTypes: [0, 5], placeholder: 'Kanal auswählen ...', info: 'Der Bot erstellt oder aktualisiert dort automatisch genau eine Support-Nachricht mit Schaltfläche.' },
      { key: 'tickets.panelTitle', label: 'Panel-Titel', type: 'text', placeholder: 'FALLEN HEAVEN Support', info: 'Überschrift des öffentlichen Ticket-Panels.' },
      { key: 'tickets.panelDescription', label: 'Panel-Beschreibung', type: 'textarea', rows: 4, info: 'Erklärt kurz, wann Mitglieder ein Ticket öffnen sollen.' },
      { key: 'tickets.panelButtonLabel', label: 'Text der Schaltfläche', type: 'text', placeholder: 'Ticket öffnen', info: 'Beschriftung der Schaltfläche unter dem Panel.' },
      { key: 'tickets.panelButtonEmoji', label: 'Emoji der Schaltfläche', type: 'emoji', placeholder: 'Emoji auswählen ...', info: 'Wähle ein Standard-, Server- oder Bot-Emoji direkt aus der Emoji-Bibliothek.' },
      { key: 'tickets.supportRoleId', label: 'Support-Rolle', type: 'roleSelect', placeholder: 'Optional auswählen ...', info: 'Wähle die Rolle, die Support-Tickets sehen oder bearbeiten darf.' },
      { key: 'tickets.categoryId', label: 'Ticket-Kategorie', type: 'channelSelect', channelTypes: [4], placeholder: 'Kategorie auswählen ...', info: 'Für den empfohlenen Kanalmodus: Neue Tickets werden geordnet in dieser Discord-Kategorie angelegt.' },
      { key: 'tickets.useThreadMode', label: 'Private Threads verwenden', type: 'checkbox', info: 'Erstellt Tickets als private Threads. Aus ist für große Support-Teams zuverlässiger, weil Rollenrechte bei privaten Kanälen vollständig greifen.' },
      { key: 'tickets.threadParentChannelId', label: 'Elternkanal für private Threads', type: 'channelSelect', channelTypes: [0], placeholder: 'Optional auswählen ...', info: 'Nur im Threadmodus. Leer verwendet den Panel-Kanal.' },
      { key: 'tickets.oneOpenPerUser', label: 'Nur ein offenes Ticket pro Mitglied', type: 'checkbox', info: 'Verhindert parallele Doppel-Tickets und prüft auch nach einem Bot-Neustart den bestehenden Kanal.' },
      { key: 'tickets.closeArchive', label: 'Beim Schließen archivieren', type: 'checkbox', info: 'Archiviert Tickets nach dem Schließen, statt sie direkt sichtbar zu lassen.' },
      { key: 'tickets.closeMessage', label: 'Abschlussnachricht', type: 'text', placeholder: 'Das Ticket wurde geschlossen.', info: 'Nachricht, die beim sicheren Schließen im Ticket erscheint.' },
      { key: 'tickets.logChannelId', label: 'Ticket-Protokoll', type: 'channelSelect', channelTypes: [0, 5], placeholder: 'optional', info: 'Privater Team-Kanal für geöffnete und geschlossene Tickets. Ticket-Inhalte werden dort nicht kopiert.' }
    ]
  },
  {
    id: 'logging',
    title: 'Serverprotokoll',
    description: 'Nachvollziehbare Änderungen ohne Log-Spam',
    detail: 'Protokolliert ausgewählte Server-Ereignisse als lesbare Discord-Embeds, ordnet über das Audit-Log nach Möglichkeit Verantwortliche zu und arbeitet standardmäßig datensparsam.',
    icon: '🧾',
    fields: [
      { key: 'logging.enabled', label: 'Modul aktiv', type: 'checkbox', info: 'Schaltet das Serverprotokoll ein oder aus.' },
      { key: 'logging.channelId', label: 'Privater Protokollkanal', type: 'channelSelect', placeholder: 'Kanal auswählen ...', info: 'Der Protokollkanal selbst wird automatisch ignoriert, damit keine Endlosschleifen entstehen.' },
      { key: 'logging.logMessages', label: 'Gelöschte und bearbeitete Nachrichten', type: 'checkbox', info: 'Protokolliert Metadaten wie Mitglied, Kanal, Nachricht und Anzahl der Anhänge.' },
      { key: 'logging.includeMessageContent', label: 'Nachrichteninhalt mitprotokollieren', type: 'checkbox', info: 'Aus Datenschutzgründen standardmäßig deaktiviert. Wenn aktiv, werden Inhalte in Discord gekürzt angezeigt, aber nicht zusätzlich in einer lokalen Chatdatenbank gespeichert.' },
      { key: 'logging.logMembers', label: 'Mitglieder und Nicknames', type: 'checkbox', info: 'Protokolliert Beitritt, Austritt, Kick-Erkennung und Nickname-Änderungen.' },
      { key: 'logging.logRoles', label: 'Rollen und Rollenzuweisungen', type: 'checkbox', info: 'Protokolliert erstellte, gelöschte, bearbeitete sowie an Mitglieder vergebene oder entfernte Rollen.' },
      { key: 'logging.logChannels', label: 'Kanäle und Kategorien', type: 'checkbox', info: 'Protokolliert Erstellung, Löschung, Umbenennung, Verschiebung und relevante Kanaländerungen.' },
      { key: 'logging.logVoice', label: 'Voice-Beitritt und -Austritt', type: 'checkbox', info: 'Optionales Voice-Protokoll. Kann auf großen Servern viele Meldungen erzeugen und ist deshalb standardmäßig aus.' },
      { key: 'logging.logModeration', label: 'Timeouts und Moderation', type: 'checkbox', info: 'Protokolliert gesetzte und aufgehobene Discord-Timeouts. Detaillierte Regelverstöße bleiben im Moderationsprotokoll.' },
      { key: 'logging.ignoredChannelIds', label: 'Ausgenommene Nachrichtenkanäle', type: 'multiChannelSelect', info: 'Gelöschte oder bearbeitete Nachrichten aus diesen Kanälen werden nicht protokolliert.' }
    ]
  },
  {
    id: 'forumCleaner',
    title: 'Forum-Cleaner',
    description: 'Ausgewählte Foren vollständig und sicher bereinigen',
    detail: 'Durchläuft aktive und sämtliche archivierten Posts der ausgewählten Forum- und Media-Kanäle. Leere Posts und Beiträge ehemaliger Mitglieder werden Discord-sicher erkannt; vorübergehende API-Fehler lösen niemals eine Löschung aus.',
    icon: 'FORUM',
    fields: [
      { key: 'forumCleaner.enabled', label: 'Modul aktiv', type: 'checkbox', info: 'Aktiviert die automatische Prüfung ausgewählter Forum- und Media-Kanäle.' },
      { key: 'forumCleaner.channelIds', label: 'Forum- und Media-Kanäle', type: 'multiChannelSelect', channelTypes: [15, 16], info: 'Wähle alle Kanäle aus, die der Tiefenscan vollständig bearbeiten soll. Ohne Auswahl wird nichts gelöscht.' },
      { key: 'forumCleaner.graceMinutes', label: 'Schonfrist (Minuten)', type: 'number', min: 1, max: 1440, step: 1, info: 'So lange wartet der Bot nach Erstellung, bevor ein leerer Post bewertet wird. 5 bis 15 Minuten sind sinnvoll.' },
      { key: 'forumCleaner.scanIntervalMinutes', label: 'Tiefenscan-Intervall (Minuten)', type: 'number', min: 60, max: 1440, step: 60, info: 'Der Tiefenscan lädt wirklich alle Archivseiten. Ein täglicher Lauf mit 1.440 Minuten ist für große Foren empfohlen; neue und geänderte Posts werden zusätzlich per Event geprüft.' },
      { key: 'forumCleaner.scanOnStartup', label: 'Tiefenscan nach Botstart', type: 'checkbox', info: 'Startet nach jedem Bot-Neustart zusätzlich einen vollständigen Lauf. Nach einem erfolgreichen Basislauf kann dies deaktiviert bleiben, weil Events und das tägliche Intervall weiterarbeiten.' },
      { key: 'forumCleaner.includeArchived', label: 'Vollständiges Archiv einbeziehen', type: 'checkbox', info: 'Lädt alle öffentlichen Archivseiten jedes ausgewählten Forums statt nur die zuletzt sichtbaren Posts.' },
      { key: 'forumCleaner.ignorePinned', label: 'Gepinnte Posts schützen', type: 'checkbox', info: 'Gepinnte Forum-Posts werden nie automatisch gelöscht.' },
      { key: 'forumCleaner.ignoreLocked', label: 'Gesperrte Posts schützen', type: 'checkbox', info: 'Gesperrte Threads werden nicht gelöscht, auch wenn sie leer wirken.' },
      { key: 'forumCleaner.requireNoReplies', label: 'Nur ohne Antworten löschen', type: 'checkbox', info: 'Löscht nur, wenn neben der Startnachricht keine echten Antworten vorhanden sind.' },
      { key: 'forumCleaner.titleOnlyIsEmpty', label: 'Nur Titel zählt als leer', type: 'checkbox', info: 'Wenn aktiv, reicht ein Thread-Titel allein nicht als Inhalt. Text, Bilder, Embeds, Sticker oder Antworten schützen den Post.' },
      { key: 'forumCleaner.deleteMissingStarter', label: 'Gelöschte Startposts entfernen', type: 'checkbox', info: 'Löscht Forum-Threads, deren ursprüngliche Startnachricht nicht mehr existiert. Genau diese leeren Discord-Forum-Leichen werden damit bereinigt.' },
      { key: 'forumCleaner.deleteLeftAuthorPosts', label: 'Alle Posts ehemaliger Mitglieder löschen', type: 'checkbox', info: 'Löscht sämtliche Beiträge eines Erstellers erst dann, wenn Discord eindeutig „Unknown Member“ meldet. Timeouts, fehlende Rechte oder Netzwerkfehler gelten ausdrücklich nicht als Austritt.' },
      { key: 'forumCleaner.protectPinnedFromDepartedAuthors', label: 'Gepinnte Posts ehemaliger Mitglieder behalten', type: 'checkbox', info: 'Optionaler Schutz. Aus bedeutet: Bei eindeutig verlassenen Erstellern werden auch gepinnte Beiträge dieses Mitglieds gelöscht.' },
      { key: 'forumCleaner.protectLockedFromDepartedAuthors', label: 'Gesperrte Posts ehemaliger Mitglieder behalten', type: 'checkbox', info: 'Optionaler Schutz. Aus bedeutet: Bei eindeutig verlassenen Erstellern werden auch gesperrte Beiträge dieses Mitglieds gelöscht.' },
      { key: 'forumCleaner.leftAuthorGraceDays', label: 'Ehemalige User: Schonzeit Tage', type: 'number', min: 0, max: 3650, step: 1, info: 'Wartezeit, bevor Posts von ehemaligen Usern automatisch gelöscht werden. 0 bedeutet sofort nach Erkennung.' },
      { key: 'forumCleaner.dryRun', label: 'Prüfmodus ohne Löschen', type: 'checkbox', info: 'Der Bot protokolliert leere Posts, löscht sie aber nicht. Gut für den ersten Testlauf.' },
      { key: 'forumCleaner.logChannelId', label: 'Cleaner Log-Kanal', type: 'channelSelect', placeholder: 'optional', info: 'Optionaler Team-Kanal für gelöschte oder im Prüfmodus erkannte Forum-Posts.' }
    ]
  },
  {
    id: 'steamWorkshop',
    title: 'Steam Workshop',
    description: 'Workshop-Mods als gepflegten Discord-Katalog veröffentlichen',
    detail: 'Erstellt für jede eingetragene Workshop-ID einen eigenen Forum-Post und aktualisiert immer dieselbe Startnachricht. Steam-Daten, Vorschau, Statistiken und Zeitstempel bleiben automatisch aktuell; optionale Update-Meldungen landen getrennt im normalen Textkanal.',
    icon: 'STEAM',
    fields: [
      { key: 'steamWorkshop.enabled', label: 'Modul aktiv', type: 'checkbox', info: 'Aktiviert den automatischen Workshop-Katalog. Es werden ausschließlich die unten eingetragenen Workshop-IDs verarbeitet.' },
      { key: 'steamWorkshop.forumChannelId', label: 'Workshop-Forum', type: 'channelSelect', channelTypes: [15, 16], placeholder: 'Forum auswählen ...', info: 'Empfohlen: ein eigener Forum-Kanal. Jede Mod erhält genau einen dauerhaften Post, dessen Start-Embed der Bot aktualisiert.' },
      { key: 'steamWorkshop.workshopIds', label: 'Steam-Workshop-IDs', type: 'arrayLines', placeholder: '3731417846\nweitere ID ...', info: 'Eine öffentliche Workshop-ID pro Zeile. Du kannst auch mehrere IDs auf einmal einfügen; doppelte oder ungültige Werte werden entfernt.' },
      { key: 'steamWorkshop.appliedTagNames', label: 'Forum-Tags', type: 'arrayLines', placeholder: 'Mod\nProjekt Zomboid', info: 'Optionale vorhandene Forum-Tag-Namen, maximal fünf. Wenn Discord einen Tag verlangt, muss hier mindestens ein exakt passender Name stehen.' },
      { key: 'steamWorkshop.syncIntervalMinutes', label: 'Steam-Abgleich (Minuten)', type: 'number', min: 15, max: 1440, step: 15, info: 'Wie oft Titel, Beschreibung, Vorschaubild, Reichweite und Update-Zeit geprüft werden. 30 bis 60 Minuten ist eine gute Balance.' },
      { key: 'steamWorkshop.syncOnStartup', label: 'Nach Botstart synchronisieren', type: 'checkbox', info: 'Prüft den gesamten Katalog wenige Sekunden nach jedem Botstart.' },
      { key: 'steamWorkshop.pinPosts', label: 'Workshop-Posts oben anpinnen', type: 'checkbox', info: 'Versucht die vom Bot verwalteten Workshop-Posts im Forum oben anzupinnen. Dazu benötigt der Bot „Threads verwalten“.' },
      { key: 'steamWorkshop.notifyOnUpdate', label: 'Update-Meldungen senden', type: 'checkbox', info: 'Sendet bei einer echten Änderung auf Steam zusätzlich eine kompakte Meldung in den optionalen Update-Kanal. Der Katalog selbst wird immer aktualisiert.' },
      { key: 'steamWorkshop.updateChannelId', label: 'Optionaler Update-Kanal', type: 'channelSelect', channelTypes: [0, 5], placeholder: 'Textkanal auswählen ...', info: 'Nur für neue Steam-Updates. Der dauerhafte Mod-Katalog bleibt im Forum und erzeugt keinen Nachrichten-Spam.' },
      { key: 'steamWorkshop.mentionRoleId', label: 'Optionale Update-Rolle', type: 'roleSelect', info: 'Diese Rolle wird ausschließlich bei einer echten Steam-Änderung erwähnt. Ohne Auswahl gibt es keinen Ping.' },
      { key: 'steamWorkshop.buttonLabel', label: 'Workshop-Knopf', type: 'text', placeholder: 'Im Steam Workshop öffnen', info: 'Beschriftung des sicheren Link-Knopfs unter jedem Mod-Embed.' },
      { key: 'steamWorkshop.preferSteamPreviewImage', label: 'Großes Steam-Vorschaubild', type: 'checkbox', info: 'Zeigt automatisch das große Steam-Vorschaubild im Embed, wenn im Embed Studio kein anderes Bild festgelegt wurde.' },
      { key: 'steamWorkshop.showRating', label: 'Steam-Sternebewertung anzeigen', type: 'checkbox', info: 'Liest die öffentlich sichtbare Steam-Bewertung und zeigt Sterne, Durchschnitt und Anzahl der Bewertungen im Katalog.' },
      { key: 'steamWorkshop.maxDescriptionLength', label: 'Maximale Beschreibungslänge', type: 'number', min: 300, max: 1800, step: 100, info: 'Steam-Beschreibungen werden gereinigt und kompakt gekürzt. 1.400 Zeichen vermeiden schwer lesbare Textwände; der vollständige Text bleibt über den Steam-Knopf erreichbar.' }
    ]
  },
  {
    id: 'emojiManager',
    title: 'Emoji-Verwaltung',
    description: 'Statische und animierte Server-Emojis professionell verwalten',
    detail: 'Erstellt zuerst eine sichere Umbenennungs-Vorschau, prüft Discord-Namensregeln, verwaltete Emojis und Zielkollisionen und wendet Änderungen nur nach einer ausdrücklichen Bestätigung an.',
    icon: 'EMOJI',
    fields: [
      { key: 'emojiManager.enabled', label: 'Modul aktiv', type: 'checkbox', info: 'Aktiviert die Verwaltungsoberfläche. Automatische Hintergrund-Umbenennungen finden niemals statt.' },
      { key: 'emojiManager.oldPrefix', label: 'Bisheriges Präfix', type: 'text', placeholder: 'vl_', info: 'Nur Emoji-Namen, die exakt mit diesem Präfix beginnen, erscheinen in der Vorschau.' },
      { key: 'emojiManager.newPrefix', label: 'Neues Präfix', type: 'text', placeholder: 'fh_', info: 'Ersetzt ausschließlich das Präfix. Der restliche Emoji-Name und die Emoji-ID bleiben erhalten.' },
      { key: 'emojiManager.includeStatic', label: 'Statische Emojis einbeziehen', type: 'checkbox', info: 'Berücksichtigt normale PNG-/WebP-Server-Emojis.' },
      { key: 'emojiManager.includeAnimated', label: 'Animierte Emojis einbeziehen', type: 'checkbox', info: 'Berücksichtigt animierte GIF-Server-Emojis.' }
    ]
  },
  {
    id: 'voiceChatCleaner',
    title: 'Voice-Chat-Cleaner',
    description: 'Voice-Chats leeren, sobald der Call verlassen wurde',
    detail: 'Entfernt den vollständigen Nachrichtenverlauf ausgewählter Voice-Channels, nachdem die letzte Person den Call verlassen hat. Vor jeder Löschung wird der Leerstand erneut geprüft; ältere Nachrichten werden Discord-konform einzeln entfernt.',
    icon: 'VC',
    fields: [
      { key: 'voiceChatCleaner.enabled', label: 'Modul aktiv', type: 'checkbox', info: 'Aktiviert die automatische Bereinigung. Ohne ausgewählte Voice-Channels wird niemals etwas gelöscht.' },
      { key: 'voiceChatCleaner.channelIds', label: 'Voice-Channels', type: 'multiChannelSelect', channelTypes: [2], info: 'Wähle gezielt die Voice-Channels aus, deren integrierter Textchat nach dem Verlassen vollständig geleert werden soll.' },
      { key: 'voiceChatCleaner.emptyGraceSeconds', label: 'Sicherheitsfrist (Sekunden)', type: 'number', min: 10, max: 3600, step: 10, info: 'Wartezeit nach dem Verlassen. Betritt in dieser Zeit wieder jemand den Call, wird die Löschung sofort abgebrochen.' },
      { key: 'voiceChatCleaner.cleanupOnStartup', label: 'Leere Voice-Chats nach Botstart prüfen', type: 'checkbox', info: 'Bereinigt nach einem Neustart auch ausgewählte Channels, die bereits leer waren. Die Sicherheitsfrist gilt weiterhin.' },
      { key: 'voiceChatCleaner.deletePinned', label: 'Angepinnte Nachrichten ebenfalls löschen', type: 'checkbox', info: 'Aktiv bedeutet wirklich vollständige Bereinigung einschließlich Pins, Dateien, Embeds und Bot-Nachrichten.' },
      { key: 'voiceChatCleaner.dryRun', label: 'Prüfmodus ohne Löschen', type: 'checkbox', info: 'Lädt die gesamte Historie und zeigt, wie viele Nachrichten löschbar wären, verändert Discord aber nicht.' },
      { key: 'voiceChatCleaner.logChannelId', label: 'Cleaner Log-Kanal', type: 'channelSelect', channelTypes: [0, 5], placeholder: 'optional', info: 'Optionaler privater Team-Kanal für Anzahl, Dauer und Fehler. Nachrichteninhalte werden nie protokolliert.' }
    ]
  },
  {
    id: 'tempVoice',
    title: 'TempVoice',
    description: 'Temporäre Sprachkanäle – eigener Kanal beim Joinen',
    detail: 'Wer den Setup-Kanal joint, bekommt automatisch einen eigenen temporären Sprachkanal. Der Besitzer verwaltet ihn über das Interface: umbenennen, Limit, sperren/öffnen, blocken, Besitz übernehmen/übertragen, Region, Thread. Verlassen alle den Kanal, wird er automatisch gelöscht.',
    icon: 'TV',
    fields: [
      { key: 'tempVoice.enabled', label: 'Modul aktiv', type: 'checkbox', info: 'Aktiviert die automatische Erstellung temporärer Sprachkanäle.' },
      { key: 'tempVoice.creatorChannelIds', label: 'Setup-Kanäle', type: 'multiChannelSelect', channelTypes: [2], info: 'Wer einen dieser Sprachkanäle joint, bekommt automatisch einen eigenen temporären Kanal. Mehrere Setup-Kanäle möglich.' },
      { key: 'tempVoice.categoryId', label: 'Kategorie für neue Kanäle', type: 'channelSelect', channelTypes: [4], placeholder: 'optional', info: 'Neue TempVoice-Kanäle werden in dieser Kategorie erstellt und erben automatisch deren Berechtigungen. Ohne Auswahl werden sie auf Server-Ebene erstellt (alle dürfen sehen und joinen).' },
      { key: 'tempVoice.channelNameTemplate', label: 'Kanal-Namensschema', type: 'text', placeholder: '🎧 {user}', info: 'Platzhalter: {user} = Anzeigename, {username} = Discord-Name.' },
      { key: 'tempVoice.defaultUserLimit', label: 'Standard-Benutzerlimit', type: 'number', min: 0, max: 99, step: 1, info: '0 = unbegrenzt. Der Besitzer kann das Limit jederzeit im Interface ändern.' },
      { key: 'tempVoice.defaultBitrate', label: 'Standard-Bitrate (kbps)', type: 'number', min: 0, max: 384, step: 8, info: 'Bitrate neuer TempVoice-Kanäle in kbps. 0 = automatisch die beste vom Server erlaubte Bitrate (bis 384 kbps).' },
      { key: 'tempVoice.defaultRegion', label: 'Standard-Region', type: 'select', placeholder: 'automatic', info: 'RTC-Region neuer TempVoice-Kanäle (z. B. europe, us-east). Leer = automatisch.', options: [
        { value: 'automatic', label: 'Automatisch' },
        { value: 'europe', label: 'Europa' },
        { value: 'us-west', label: 'US West' },
        { value: 'us-east', label: 'US East' },
        { value: 'us-central', label: 'US Central' },
        { value: 'us-south', label: 'US South' },
        { value: 'singapore', label: 'Singapur' },
        { value: 'southafrica', label: 'Südafrika' },
        { value: 'sydney', label: 'Sydney' },
        { value: 'india', label: 'Indien' },
        { value: 'japan', label: 'Japan' },
        { value: 'brazil', label: 'Brasilien' },
        { value: 'hongkong', label: 'Hongkong' },
        { value: 'russia', label: 'Russland' }
      ] },
      { key: 'tempVoice.emptyGraceSeconds', label: 'Löschfrist nach Verlassen (Sekunden)', type: 'number', min: 0, max: 3600, step: 5, info: '0 = sofort löschen, sobald der Kanal leer ist. Größere Werte halten den leeren Kanal kurz offen (z. B. für einen Re-Join).' },
      { key: 'tempVoice.blacklistRoleIds', label: 'Blacklist-Rollen (dürfen nie joinen)', type: 'multiRoleSelect', info: 'Mitglieder mit einer dieser Rollen können den Setup-Kanal nicht nutzen und bekommen keinen TempVoice-Kanal.' },
      { key: 'tempVoice.requiredRoleIds', label: 'Pflicht-Rollen (mindestens eine nötig)', type: 'multiRoleSelect', info: 'Ohne mindestens eine dieser Rollen ist der Beitritt zum Setup-Kanal nicht möglich. Leer = alle dürfen joinen.' },
      { key: 'tempVoice.allowRename', label: 'Umbenennen erlauben', type: 'checkbox', info: 'Besitzer dürfen ihren Kanal umbenennen.' },
      { key: 'tempVoice.allowLimit', label: 'Limit ändern erlauben', type: 'checkbox', info: 'Besitzer dürfen das Benutzerlimit ändern.' },
      { key: 'tempVoice.allowLock', label: 'Sperren/Öffnen erlauben', type: 'checkbox', info: 'Besitzer dürfen ihren Kanal sperren und öffnen.' },
      { key: 'tempVoice.allowRegion', label: 'Region ändern erlauben', type: 'checkbox', info: 'Besitzer dürfen die Server-Region des Kanals ändern.' },
      { key: 'tempVoice.allowThreads', label: 'Threads erlauben', type: 'checkbox', info: 'Besitzer dürfen einen Thread zu ihrem Kanal erstellen.' },
      { key: 'tempVoice.allowTransfer', label: 'Besitz übertragen erlauben', type: 'checkbox', info: 'Besitzer dürfen die Besitzerschaft an ein anderes Mitglied abgeben.' },
    ]
  },
  {
    id: 'publicCallVote',
    title: 'Public-Call-Moderation',
    description: 'Rauswurf-Abstimmungen in ausgewählten öffentlichen Calls',
    detail: 'Postet in jedem ausgewählten öffentlichen Voice-Call ein dauerhaftes Moderations-Panel. 2er-, 3er- und 4er-Calls werden getrennt ausgewählt: Im 2er-Call genügt eine Dafür-Stimme für den Rauswurf, im 3er-Call sind es zwei, im 4er-Call drei. Bei wiederholten Verstößen greift automatisch ein Server-Timeout. Das Panel ist eine feste Embed und wird vom Voice-Chat-Cleaner nicht gelöscht.',
    icon: '🗳️',
    fields: [
      { key: 'publicCallVote.enabled', label: 'Modul aktiv', type: 'checkbox', info: 'Aktiviert die Moderations-Panels und Rauswurf-Abstimmungen in den ausgewählten öffentlichen Calls.' },
      { key: 'publicCallVote.callChannelIds2', label: '2er Calls', type: 'multiChannelSelect', channelTypes: [2], info: 'Öffentliche Voice-Kanäle für 2 Personen (Duo): Hier genügt bereits eine „Dafür“-Stimme für den Rauswurf. Das Moderations-Panel hängt dauerhaft im Textchat des Calls.' },
      { key: 'publicCallVote.callChannelIds3', label: '3er Calls', type: 'multiChannelSelect', channelTypes: [2], info: 'Öffentliche Voice-Kanäle für 3 Personen (Trio): Hier genügen zwei „Dafür“-Stimmen für den Rauswurf. Das Moderations-Panel hängt dauerhaft im Textchat des Calls.' },
      { key: 'publicCallVote.callChannelIds4', label: '4er Calls', type: 'multiChannelSelect', channelTypes: [2], info: 'Öffentliche Voice-Kanäle für 4 Personen (Quartett): Hier genügen drei „Dafür“-Stimmen für den Rauswurf. Das Moderations-Panel hängt dauerhaft im Textchat des Calls.' },
      { key: 'publicCallVote.callChannelIds', label: 'Weitere öffentliche Calls', type: 'multiChannelSelect', channelTypes: [2], info: 'Übrige öffentliche Calls (gemischte Größen): Die Schwelle richtet sich nach den anwesenden Mitgliedern – Mindeststimmen plus Zustimmung in Prozent. Bestehende Auswahlen aus früheren Versionen liegen hier.' },
      { key: 'publicCallVote.minVotes', label: 'Mindeststimmen für Rauswurf (5+ Calls)', type: 'number', min: 1, max: 50, step: 1, info: 'So viele „Dafür“-Stimmen müssen in Calls ab 5 Personen mindestens zusammenkommen (2er-, 3er- und 4er-Calls haben feste Schwellen).' },
      { key: 'publicCallVote.passPercent', label: 'Zustimmung in Prozent (5+ Calls)', type: 'number', min: 10, max: 100, step: 1, info: 'Anteil der Anwesenden, die zustimmen müssen – zusätzlich zur Mindeststimmenzahl. Gilt für Calls ab 5 Personen.' },
      { key: 'publicCallVote.timeoutSeconds', label: 'Abstimmungsdauer (Sekunden)', type: 'number', min: 15, max: 600, step: 5, info: 'Wie lange eine Abstimmung läuft, bevor sie ausgewertet wird.' },
      { key: 'publicCallVote.resultAutoDeleteSeconds', label: 'Ergebnis automatisch löschen nach (Sekunden)', type: 'number', min: 5, max: 600, step: 5, info: '„Rauswurf beschlossen“- und „Rauswurf abgelehnt“-Nachrichten verschwinden nach dieser Zeit automatisch.' },
      { key: 'publicCallVote.voteReasons', label: 'Vote-Gründe', type: 'json', placeholder: '[{ "id": "spam", "label": "Spam", "kickMinutes": 10, "timeoutAfter": 3, "timeoutMinutes": 60 }]', info: 'Vorgefertigte Gründe: kickMinutes = Call-Sperre nach Rauswurf, timeoutAfter = Verstöße bis zum Server-Timeout, timeoutMinutes = Dauer des Timeouts, needsText = true fragt beim Rauswurf einen Freitext-Grund ab (z. B. bei „Sonstiges“).' },
      { key: 'publicCallVote.teamChannelId', label: 'Team-Kanal', type: 'channelSelect', channelTypes: [0, 5], placeholder: 'optional', info: 'Privater Team-Kanal: Bei jedem erfolgreichen Rauswurf wird dort eine Nachricht mit Team-Rollen-Ping gesendet, was vorgefallen ist.' },
      { key: 'publicCallVote.teamRoleIds', label: 'Team-Rollen (werden gepingt)', type: 'multiRoleSelect', info: 'Diese Rollen werden in der Team-Benachrichtigung bei einem Rauswurf erwähnt.' }
    ]
  },
  {
    id: 'serverBackup',
    title: 'Server-Backup',
    description: 'Tägliche Server-Struktur sichern und wiederherstellen',
    detail: 'Sichert täglich Rollen, Kanäle, Berechtigungen, Server-Einstellungen, Emojis, Sticker und Events – ohne Chat-Inhalte. Restore läuft bewusst kontrolliert und löscht keine zusätzlichen aktuellen Rollen oder Kanäle blind.',
    icon: 'SAFE',
    fields: [
      { key: 'serverBackup.enabled', label: 'Tägliches Backup aktiv', type: 'checkbox', info: 'Erstellt automatisch einmal pro Tag einen sicheren Struktur-Snapshot des Servers.' },
      { key: 'serverBackup.dailyHour', label: 'Backup-Uhrzeit', type: 'number', min: 0, max: 23, step: 1, info: 'Lokale Stunde, ab der das tägliche Backup erstellt wird. 5 bedeutet morgens um 05:00 Uhr oder beim nächsten Bot-Lauf danach.' },
      { key: 'serverBackup.keepBackups', label: 'Backups behalten', type: 'number', min: 3, max: 365, step: 1, info: 'Wie viele Struktur-Backups pro Server lokal behalten werden.' },
      { key: 'serverBackup.startupSafetyBackup', label: 'Start-Sicherheitsbackup', type: 'checkbox', info: 'Erstellt nach Botstart ein Backup, wenn für den Tag noch keins existiert.' },
      { key: 'serverBackup.includeGuildAssets', label: 'Server-Bilder merken', type: 'checkbox', info: 'Speichert URLs zu Icon, Banner, Splash und Discovery-Splash. Dateien werden nicht in Chatlogs geschrieben.' },
      { key: 'serverBackup.includeEmojis', label: 'Emojis sichern', type: 'checkbox', info: 'Sichert Emoji-Metadaten und Discord-CDN-Quelle.' },
      { key: 'serverBackup.includeStickers', label: 'Sticker sichern', type: 'checkbox', info: 'Sichert Sticker-Metadaten und Discord-CDN-Quelle.' },
      { key: 'serverBackup.includeScheduledEvents', label: 'Events sichern', type: 'checkbox', info: 'Sichert geplante Discord-Events als Struktur-Metadaten.' },
      { key: 'serverBackup.restoreServerSettings', label: 'Restore: Serverdaten', type: 'checkbox', info: 'Beim Laden eines Backups Servername, Regeln-/Systemkanäle, Filter- und Grundeinstellungen wiederherstellen.' },
      { key: 'serverBackup.restoreRoles', label: 'Restore: Rollen', type: 'checkbox', info: 'Fehlende Rollen erstellen und vorhandene Rollen angleichen. Managed Rollen werden nie kopiert.' },
      { key: 'serverBackup.restoreChannels', label: 'Restore: Kanäle & Rechte', type: 'checkbox', info: 'Fehlende Kanäle erstellen und vorhandene Kanal-Einstellungen inklusive Rollenrechte angleichen.' },
      { key: 'serverBackup.restoreEmojis', label: 'Restore: Emojis neu erstellen', type: 'checkbox', info: 'Nur aktivieren, wenn der Bot Ausdrücke verwalten darf. Standardmäßig aus, damit Restore nicht unnötig Assets neu anlegt.' },
      { key: 'serverBackup.restoreStickers', label: 'Restore: Sticker neu erstellen', type: 'checkbox', info: 'Nur aktivieren, wenn der Bot Ausdrücke verwalten darf. Standardmäßig aus.' },
      { key: 'serverBackup.logChannelId', label: 'Backup Log-Kanal', type: 'channelSelect', placeholder: 'optional', info: 'Optionaler privater Team-Kanal für Backup- und Restore-Berichte.' }
    ]
  },
  {
    id: 'memberManagement',
    title: 'Member Management',
    description: 'Professionelle Admin-Member-Liste',
    detail: 'Interaktive Member-Liste mit Suche, Sortierung, Filter, Detailpanel, Aktivität, Warnungen, Notizen, Rollenansicht und sicheren Moderations-Confirmations.',
    icon: '👥',
    fields: [
      { key: 'memberManagement.enabled', label: 'Modul aktiv', type: 'checkbox', info: 'Schaltet die Member-Verwaltung, Activity-Tracking und Admin-Panels ein oder aus.' },
      { key: 'memberManagement.pageSize', label: 'Member pro Seite', type: 'number', min: 10, step: 1, info: 'Wie viele Member pro Seite angezeigt werden. Discord bleibt mit 10 bis 15 Einträgen am übersichtlichsten.' },
      { key: 'memberManagement.hideBots', label: 'Bots ausblenden', type: 'checkbox', info: 'Blendet Bot-Accounts in der Standardliste aus. Direkte Suche/Detailpanel bleiben möglich.' },
      { key: 'memberManagement.activityBackfillEnabled', label: 'Nachrichten-Historie indexieren', type: 'checkbox', info: 'Liest lesbare Textkanäle schrittweise und rate-limit-sicher ein, damit „Letzte Nachricht“ auch für ältere Aktivität verfügbar wird.' },
      { key: 'memberManagement.activityBackfillDays', label: 'Historie (Tage)', type: 'number', min: 1, max: 3650, step: 30, info: 'Wie weit der Hintergrund-Crawler zurückgehen darf. Die Verarbeitung läuft mit Checkpoints und blockiert den Botstart nicht.' },
      { key: 'memberManagement.indexRefreshMinutes', label: 'Index-Update (Minuten)', type: 'number', min: 1, max: 60, step: 1, info: 'Prüft regelmäßig nur Nachrichten nach der letzten bekannten Discord-ID. Bereits indexierte Inhalte werden nicht erneut geladen.' },
      { key: 'memberManagement.adminRoleIds', label: 'Adminrollen', type: 'multiRoleSelect', info: 'Wähle die Rollen, die das komplette Member-Admin-Panel benutzen dürfen.' },
      { key: 'memberManagement.moderatorRoleIds', label: 'Moderationsrollen', type: 'multiRoleSelect', info: 'Wähle die Rollen, die Memberdaten, Warnungen und Notizen verwalten dürfen.' },
      { key: 'memberManagement.logChannelId', label: 'Member Log Kanal', type: 'channelSelect', placeholder: 'optional', info: 'Optionaler Kanal für Kick/Ban/Timeout/Warnung/Notiz/Refresh-Logs.' }
    ]
  },
  {
    id: 'autoRole',
    title: 'Automatische Beitrittsrollen',
    description: 'Mehrere Rollen zuverlässig und geprüft vergeben',
    detail: 'Vergibt ausgewählte Rollen mit kurzer Discord-Schonfrist, Wiederholungsversuchen, Rollenhierarchie-Prüfung und optionalem sicheren Startabgleich.',
    icon: '🎗️',
    fields: [
      { key: 'autoRole.enabled', label: 'Modul aktiv', type: 'checkbox', info: 'Schaltet automatische Rollenvergabe ein oder aus.' },
      { key: 'autoRole.excludeBots', label: 'Bots ausschließen', type: 'checkbox', info: 'Wenn aktiv, bekommen Bot-Accounts keine AutoRole.' },
      { key: 'autoRole.roleIds', label: 'Rollen für neue Mitglieder', type: 'multiRoleSelect', info: 'Wähle mehrere Rollen direkt aus Discord. Nicht verwaltbare Bot-, Integrations- und Systemrollen werden gekennzeichnet.' },
      { key: 'autoRole.assignmentDelaySeconds', label: 'Schonfrist nach Beitritt (Sekunden)', type: 'number', min: 0, max: 120, step: 1, info: 'Kurze Wartezeit, bevor Rollen gesetzt werden. Zwei Sekunden verhindern häufige Cache-Rennen direkt beim Beitritt.' },
      { key: 'autoRole.retryCount', label: 'Wiederholungsversuche', type: 'number', min: 1, max: 5, step: 1, info: 'Bei einem vorübergehenden Discord-Fehler wird die Rollenvergabe kontrolliert erneut versucht.' },
      { key: 'autoRole.reconcileOnStartup', label: 'Fehlende Rollen nach Botstart ergänzen', type: 'checkbox', info: 'Optionaler Abgleich für bestehende Mitglieder. Bleibt standardmäßig aus, damit keine große Massenänderung ungefragt startet.' },
      { key: 'autoRole.maxStartupAssignments', label: 'Sicherheitslimit pro Start', type: 'number', min: 1, max: 1000, step: 10, info: 'Begrenzt, bei wie vielen bestehenden Mitgliedern pro Botstart Rollen nachgetragen werden.' },
      { key: 'autoRole.logChannelId', label: 'AutoRole-Protokoll', type: 'channelSelect', placeholder: 'optional', info: 'Privater Team-Kanal für fehlgeschlagene Vergaben und den optionalen Startabgleich.' }
    ]
  },
  {
    id: 'roleSwap',
    title: 'Rollen-Tausch',
    description: 'Rolle automatisch tauschen (z. B. Mute)',
    detail: 'Bekommt ein Mitglied eine Auslöser-Rolle (z. B. eine Mute-Rolle), wird automatisch eine konfigurierte andere Rolle entfernt. Verschwindet die Auslöser-Rolle wieder, bekommt das Mitglied die andere Rolle zurück – und zwar nur dann, wenn sie vorher wirklich von diesem Modul entfernt wurde. Ein Startabgleich holt verpasste Ereignisse nach (z. B. wenn der Bot beim Vergeben der Rolle offline war).',
    icon: '🔁',
    fields: [
      { key: 'roleSwap.enabled', label: 'Modul aktiv', type: 'checkbox', info: 'Schaltet den automatischen Rollen-Tausch ein oder aus.' },
      { key: 'roleSwap.pairs', label: 'Tausch-Paare', type: 'roleSwapSelect', info: 'Je Zeile ein Paar: Auslöser-Rolle (wird vergeben, z. B. Mute) → Rolle, die dann entfernt und später automatisch zurückgegeben wird. Beim Speichern werden nur vollständige Paare übernommen.' },
      { key: 'roleSwap.logChannelId', label: 'Rollen-Tausch-Protokoll', type: 'channelSelect', placeholder: 'optional', info: 'Optionaler Kanal für Benachrichtigungen über entfernte und wiederhergestellte Rollen.' }
    ]
  },
  {
    id: 'counting',
    title: 'Zähl-Kanal',
    description: 'Professionelles Zählspiel mit Anti-Cheat und Best-Serien',
    detail: 'Verwandelt einen Kanal in ein Zählspiel: Die nächste Nachricht muss exakt die nächste Zahl sein. Richtige Züge werden mit ✅ bestätigt, falsche setzen den Zähler zurück (❌). Bots, Webhooks und bearbeitete Nachrichten zählen nie; niemand kann zweimal hintereinander zählen. Meilensteine werden gefeiert, pro Nutzer werden richtige/falsche Züge sowie die Best-Serie gespeichert, und ein optionales Live-Panel zeigt den aktuellen Stand.',
    icon: '🔢',
    fields: [
      { key: 'counting.enabled', label: 'Zähl-Kanal aktiv', type: 'checkbox', info: 'Schaltet das Zählspiel im konfigurierten Kanal ein oder aus.' },
      { key: 'counting.channelId', label: 'Zähl-Kanal', type: 'channelSelect', channelTypes: [0, 5], placeholder: 'Kanal auswählen ...', info: 'Nur Nachrichten in diesem Kanal werden als Züge gewertet. Andere Kanäle bleiben unberührt.' },
      { key: 'counting.resetValue', label: 'Stand nach Fehlversuch', type: 'number', min: 0, max: 100000, step: 1, info: 'Auf diesen Wert fällt der Zähler zurück, wenn jemand die falsche Zahl sendet oder zweimal hintereinander zählt. Standard: 0.' },
      { key: 'counting.deleteWrongMessages', label: 'Falsche Nachrichten löschen', type: 'checkbox', info: 'Falsche Züge werden nach dem ❌ automatisch gelöscht, damit der Kanal sauber bleibt.' },
      { key: 'counting.preventSelfCount', label: 'Keine zwei Züge in Folge', type: 'checkbox', info: 'Dieselbe Person darf nicht zweimal hintereinander zählen – erst muss jemand anderes dran sein.' },
      { key: 'counting.selfCountIsFail', label: 'Doppelzug zählt als Fehlversuch', type: 'checkbox', info: 'Wenn dieselbe Person erneut dran ist, gilt das als Fehlversuch und setzt den Zähler zurück. Aus: Der Doppelzug wird nur ignoriert.' },
      { key: 'counting.excludedRoleIds', label: 'Ausgeschlossene Rollen', type: 'multiRoleSelect', info: 'Mitglieder mit einer dieser Rollen können nicht zählen – ihre Nachrichten werden ignoriert (z. B. Bots, Quarantäne).' },
      { key: 'counting.maxCount', label: 'Maximal zulässiger Wert', type: 'number', min: 10, max: 1000000000000, step: 1, info: 'Sicherheits-Cap. Wer eine Zahl darüber sendet, bekommt einen Fehlversuch statt eines kaputten Zählers.' },
      { key: 'counting.milestones', label: 'Meilensteine', type: 'arrayLines', placeholder: '100\n250\n500\n1000', info: 'Bei diesen Werten feiert der Bot mit einer Nachricht und @Erwähnung. Ein Wert je Zeile.' },
      { key: 'counting.milestoneMessage', label: 'Meilenstein-Nachricht', type: 'textarea', rows: 3, placeholder: '🎉 **Meilenstein erreicht!** {user} hat bis **{count}** gezählt!', info: 'Platzhalter: {user} oder {mention} für die @Erwähnung, {count} für die erreichte Zahl.' },
      { key: 'counting.successReaction', label: 'Reaktion bei richtig', type: 'text', placeholder: '✅', info: 'Reaktion auf korrekte Züge. Unicode- oder Custom-Emoji-Code möglich.' },
      { key: 'counting.failReaction', label: 'Reaktion bei falsch', type: 'text', placeholder: '❌', info: 'Reaktion auf Fehlversuche. Unicode- oder Custom-Emoji-Code möglich.' },
      { key: 'counting.statusChannelId', label: 'Status-Panel Kanal', type: 'channelSelect', channelTypes: [0, 5], placeholder: 'Kein Status-Panel', info: 'Optionaler Kanal für ein Live-Panel mit aktuellem Stand, letztem Zähler, Fehlversuchen und den besten Serien. Nicht den Zähl-Kanal selbst verwenden.' },
      { key: 'counting.statusPanelEnabled', label: 'Status-Panel aktiv', type: 'checkbox', info: 'Zeigt das Live-Panel im konfigurierten Status-Kanal. Das Panel aktualisiert sich automatisch und repariert sich nach einem Neustart.' },
      { key: 'counting.lossMessagesEnabled', label: 'Verlierer-Nachrichten aktiv', type: 'checkbox', info: 'Bei jedem Fehlversuch erscheint eine zufällige Verlierer-Nachricht aus über 100 eingebauten Sätzen (oder deinen eigenen).' },
      { key: 'counting.lossMessages', label: 'Eigene Verlierer-Nachrichten', type: 'arrayLines', placeholder: '💥 Verloren! {user} hat die Serie beendet.\n🔄 Neustart! Wir zählen wieder bei 0.', info: 'Ein Satz je Zeile – leere Liste = die eingebaute Pool mit über 100 Sätzen. Platzhalter: {user} / {mention} für die @Erwähnung, {count} für die falsche Zahl, {next} für die nächste erwartete Zahl. Enthält ein Satz kein {next}, hängt der Bot „Nächste Zahl: X“ automatisch an.' },
      { key: 'counting.clearChannelOnFail', label: 'Chat nach Fehlversuch aufräumen', type: 'checkbox', info: 'Nach einem Fehlversuch wird die falsche Nachricht und alles davor bis zum Panel-Embed gelöscht – so beginnt die neue Runde sauber. Die Verlierer-Nachricht bleibt für die eingestellte Zeit sichtbar und wird danach ebenfalls entfernt. Neue richtige Züge werden dabei nie gelöscht.' },
      { key: 'counting.clearChannelDelaySeconds', label: 'Verlierer-Nachricht anzeigen (Sekunden)', type: 'number', min: 0, max: 300, step: 1, placeholder: '10', info: 'So lange bleibt die Verlierer-Nachricht nach einem Fehlversuch sichtbar, bevor sie entfernt wird. Standard: 10 Sekunden. 0 = sofort entfernen.' },
      { key: 'counting.clearChannelKeepMessages', label: 'Nachrichten behalten (während des Zählens)', type: 'number', min: 0, max: 100, step: 1, placeholder: '5', info: 'Während des Zählens bleiben immer nur die neuesten X Nachrichten im Kanal (wie beim Level-Up-Kanal): Kommt eine neue dazu, wird die älteste gelöscht. Standard: 5. Nur das Panel-Embed und angepinnte Nachrichten bleiben immer stehen. 0 = nur das Panel bleibt.' },
      { key: 'counting.strikesEnabled', label: 'Verwarnungen aktiv', type: 'checkbox', info: 'Wer wirklich unpassende Zahlen schreibt (Fehlversuch), bekommt 1 Verwarnung. Nach der eingestellten Anzahl folgt eine Chat-Sperre. Die Sperren werden lokal gespeichert und überleben Neustarts/Offline-Zeiten.' },
      { key: 'counting.strikesToLock', label: 'Verwarnungen bis zur Sperre', type: 'number', min: 1, max: 20, step: 1, placeholder: '3', info: 'Nach so vielen Verwarnungen wird der User für die eingestellte Zeit vom Zähl-Kanal gesperrt.' },
      { key: 'counting.strikeLockHours', label: 'Sperrdauer in Stunden', type: 'number', min: 1, max: 720, step: 1, placeholder: '24', info: 'Wie lange die Chat-Sperre nach Erreichen der Verwarnungs-Grenze dauert.' },
      { key: 'counting.strikeLockMessage', label: 'Sperr-Nachricht', type: 'textarea', rows: 2, placeholder: '🚫 Chat-Sperre im Zähl-Kanal! Du hast {limit} Verwarnungen gesammelt…', info: 'Wird per DM + im Kanal gesendet. Platzhalter: {user}, {hours}. Leer = Standardtext.' },
      { key: 'counting.strikeTolerance', label: 'Fehler-Toleranz', type: 'number', min: 0, max: 1000000, step: 1, placeholder: '1', info: 'Ein knapp daneben liegender Zug ist ein normaler Fehler und gibt KEINE Verwarnung – z. B. erwartet 4 und gesendet 5 (Abweichung 1, Standard-Toleranz). Erst größere Abweichungen gelten als „wirklich unpassende Zahl“. 0 = jede falsche Zahl verwarnt.' }
    ]
  },
  {
    id: 'serverTagTracker',
    title: 'Server-Tag-Tracker',
    description: 'Server-Tag erkennen und Rollen automatisch synchronisieren',
    detail: 'Reagiert sofort auf Discord-Profiländerungen und entscheidet ausschließlich anhand eines frisch geladenen Discord-Benutzerprofils. Der vollständige Hintergrundabgleich korrigiert verpasste Ereignisse und begrenzt ungewöhnliche Massenvergaben.',
    icon: 'TAG',
    fields: [
      { key: 'serverTagTracker.enabled', label: 'Modul aktiv', type: 'checkbox', info: 'Aktiviert die automatische Server-Tag-Erkennung und Rollensynchronisierung.' },
      { key: 'serverTagTracker.monitorOnly', label: 'Nur prüfen – keine Rollen ändern', type: 'checkbox', info: 'Empfohlener Sicherheitsmodus für die erste Prüfung. Der Bot zeigt bestätigte Träger und geplante Änderungen, verändert aber keine Discord-Rollen.' },
      { key: 'serverTagTracker.roleIds', label: 'Server-Tag-Rollen', type: 'multiRoleSelect', info: 'Wähle alle Rollen, die Server-Tag-Träger gleichzeitig erhalten sollen. Der Bot muss in der Rollenliste über jeder ausgewählten Rolle stehen.' },
      { key: 'serverTagTracker.scanIntervalMinutes', label: 'Vollständiger Abgleich (Minuten)', type: 'number', min: 5, max: 1440, step: 5, info: 'Zusätzlicher Sicherheitsabgleich für verpasste Profiländerungen. Ereignisse werden unabhängig davon zeitnah verarbeitet.' },
      { key: 'serverTagTracker.maxAssignmentsPerScan', label: 'Maximale neue Träger pro Abgleich', type: 'number', min: 1, max: 100, step: 1, info: 'Sicherheitslimit gegen Massenvergaben. Weitere bestätigte Kandidaten bleiben vorgemerkt und werden beim nächsten Abgleich erneut geprüft.' },
      { key: 'serverTagTracker.startupScan', label: 'Beim Botstart vollständig prüfen', type: 'checkbox', info: 'Gleicht nach jedem Botstart alle aktuellen Mitglieder kontrolliert mit Discord ab.' },
      { key: 'serverTagTracker.excludeBots', label: 'Bots ausschließen', type: 'checkbox', info: 'Bot-Accounts werden nicht geprüft und erhalten keine Server-Tag-Rolle.' },
      { key: 'serverTagTracker.excludedRoleIds', label: 'Ausgeschlossene Rollen', type: 'multiRoleSelect', info: 'Mitglieder mit einer dieser Rollen werden vollständig ignoriert. Praktisch für Bots, Integrationen oder besondere Teamkonten.' },
      { key: 'serverTagTracker.logChannelId', label: 'Server-Tag Log-Kanal', type: 'channelSelect', placeholder: 'optional', info: 'Optionaler Team-Kanal für Rollenvergabe, Rollenentzug und echte Rollenfehler. Es werden keine DMs gesendet.' }
    ]
  },
  {
    id: 'boostRoles',
    title: 'Booster-Rollen',
    description: 'Automatische Rollen für aktive Server-Booster',
    detail: 'Aktive Booster erhalten sofort alle ausgewählten Basisrollen. Die vorhandenen Staffelrollen bleiben zusätzlich nach verifizierter Boost-Anzahl vollständig erhalten. Endet der Boost, entfernt der Bot die verwalteten Rollen automatisch; ein regelmäßiger Abgleich korrigiert verpasste Discord-Ereignisse.',
    icon: 'BOOST',
    fields: [
      { key: 'boostRoles.enabled', label: 'Modul aktiv', type: 'checkbox', info: 'Aktiviert den persistenten Booster-Zähler und die automatische Rollensynchronisierung.' },
      { key: 'boostRoles.automaticRoleIds', label: 'Rollen für jeden aktiven Booster', type: 'multiRoleSelect', info: 'Diese Rollen erhält jeder aktive Server-Booster sofort. Sobald der Boost endet, werden sie automatisch wieder entzogen.' },
      { key: 'boostRoles.tierRoleMappings', label: 'Booster-Staffelrollen', type: 'roleMappingSelect', info: 'Wähle für jede Boost-Anzahl direkt die passende Discord-Rolle aus. Bereits gespeicherte Rollen-IDs werden automatisch übernommen.' },
      { key: 'boostRoles.cumulativeRoles', label: 'Staffelrollen kumulativ vergeben', type: 'checkbox', info: 'Aus: Ein 2x Booster erhält nur die 2x-Rolle. An: Er erhält zusätzlich alle niedrigeren Booster-Rollen.' },
      { key: 'boostRoles.removableColorRoleIds', label: 'Booster-Farbrollen', type: 'multiRoleSelect', info: 'Wähle alle Farbrollen aus, die beim vollständigen Boost-Ende entfernt werden sollen.' },
      { key: 'boostRoles.boostInfoChannelId', label: 'Boost-Info-Kanal', type: 'channelSelect', placeholder: 'automatisch erkennen', info: 'Zusätzliche Bestätigung für Boosts. Ohne Auswahl erkennt der Bot einen Kanal mit „boost-info“ im Namen automatisch. Boost-Info ergänzt fehlende Belege, zählt aber niemals doppelt zu Discord-Systemnachrichten.' },
      { key: 'boostRoles.boostEndLogChannelId', label: 'Boost-Ende-Kanal', type: 'channelSelect', placeholder: 'automatisch erkennen', info: 'Vertrauenswürdige Quelle für tatsächlich beendete Boosts. Hinweise wie „Boost läuft am … ab“ werden ausdrücklich nicht als beendeter Boost gezählt.' },
      { key: 'boostRoles.logChannelId', label: 'Booster Log Kanal', type: 'channelSelect', placeholder: 'optional', info: 'Optionaler Kanal für nachvollziehbare Vergabe- und Entfernungsprotokolle ohne Rollen- oder Everyone-Pings.' },
      { key: 'boostRoles.boostAnnounceEnabled', label: 'Boost-Benachrichtigung aktiv', type: 'checkbox', info: 'Sendet bei jedem neuen Boost automatisch das gestaltete Boost-Embed in den gewählten Kanal. Ein 1×-Booster erhält „1× geboostet“, ein 2×-Booster „2× geboostet“.' },
      { key: 'boostRoles.boostAnnounceChannelId', label: 'Boost-Benachrichtigungs-Kanal', type: 'channelSelect', placeholder: 'Kanal auswählen ...', info: 'Kanal für die Boost-Embeds. Das Design wird über den Button „Boost-Benachrichtigung bearbeiten“ im Embed Studio gestaltet.' },
      { key: 'boostRoles.boostTopEnabled', label: 'Top-Booster-Liga aktiv', type: 'checkbox', info: 'Sendet genau eine Live-Nachricht mit den Top 1–3 Boostern in den gewählten Kanal und bearbeitet sie bei jeder Änderung. Leer gelassen erkennt der Bot automatisch einen Kanal mit „top-booster“ im Namen.' },
      { key: 'boostRoles.boostTopChannelId', label: 'Kanal der Top-Booster-Liga', type: 'channelSelect', channelTypes: [0, 5], placeholder: 'Automatisch: top-booster', info: 'Leer lassen: Der Bot erkennt den Textkanal „top-booster“ automatisch. Er sendet dort genau ein Embed und aktualisiert anschließend immer diese Nachricht.' },
      { key: 'boostRoles.boostTopPingsEnabled', label: 'Top-Booster-Platzierungs-Pings senden', type: 'checkbox', info: 'Der Bot erwähnt die betroffenen Mitglieder, sobald sie neu in den Top 3 stehen, aufrücken, überholt werden oder aus den Top 3 verdrängt werden.' },
      { key: 'boostRoles.boostTopPingChannelId', label: 'Kanal für Top-Booster-Pings', type: 'channelSelect', channelTypes: [0, 5], placeholder: 'Automatisch: Top-Booster-Kanal', info: 'Leer lassen: Die Pings erscheinen im Kanal der Top-Booster-Liga. Alternativ kann ein eigener Kanal gewählt werden.' },
      { key: 'boostRoles.boostTopPingLifetimeMinutes', label: 'Ping-Anzeigedauer in Minuten', type: 'number', min: 1, max: 60, step: 1, info: 'Nach dieser Zeit löschen sich die Platzierungs-Pings selbst. Standard: 5 Minuten.' }
    ]
  },
  {
    id: 'heavenEconomy',
    title: 'Heaven Coins & VIP',
    description: 'Interaktiver VIP-Shop ohne Commands',
    detail: 'Veröffentlicht ein dauerhaftes Discord-Panel. Mitglieder öffnen Konto, Shop, Geschenk, Coin-Kauf, Boost-Fortschritt und Vorteile ausschließlich über Buttons und private Auswahlfenster.',
    icon: 'COIN',
    fields: [
      { key: 'heavenEconomy.enabled', label: 'Heaven Economy aktiv', type: 'checkbox', info: 'Aktiviert Coin-Konten, Boost-Meilensteine, VIP-Käufe und das Discord-Panel.' },
      { key: 'heavenEconomy.panelChannelId', label: 'Shop-Panel Kanal', type: 'channelSelect', placeholder: 'Kanal auswählen ...', info: 'Der Bot erstellt oder aktualisiert dort automatisch genau eine Shop-Nachricht.' },
      { key: 'heavenEconomy.coinEmoji', label: 'Coin-Emoji', type: 'emoji', placeholder: 'Emoji auswählen ...', info: 'Wähle ein Server-, Bot- oder Standard-Emoji für Guthaben und Shop.' },
      { key: 'heavenEconomy.boostMilestoneReward', label: 'Coins pro neuer Boost-Stufe', type: 'number', min: 1, max: 10000, step: 1, info: 'Einmalige Belohnung für jede erstmals erreichte persönliche Boost-Anzahl.' },
      { key: 'heavenEconomy.vipRoleMappings', label: 'VIP-Stufen und Rollen', type: 'roleMappingSelect', info: 'Ordne den fünf Preisen die passenden Discord-Rollen zu. Schwellen: 500, 1000, 2500, 4000 und 5000 Coins.' },
      { key: 'heavenEconomy.vipPanelEnabled', label: 'VIP-Panel aktiv', type: 'checkbox', info: 'Sendet genau eine Live-Nachricht mit allen VIP-Stufen und ihren Mitgliedern in den gewählten Kanal und bearbeitet sie bei jeder Änderung. Jede Stufe wird mit ihrem Rang-Emoji als eigenes Feld geführt.' },
      { key: 'heavenEconomy.vipPanelChannelId', label: 'Kanal des VIP-Panels', type: 'channelSelect', channelTypes: [0, 5], placeholder: 'Automatisch: vip', info: 'Leer lassen: Der Bot erkennt den Textkanal „vip“ automatisch. Er sendet dort genau ein Embed mit allen VIP-Stufen zusammen und aktualisiert anschließend immer diese Nachricht.' },
      { key: 'heavenEconomy.paypalUrl', label: 'PayPal Kauf-Link', type: 'text', placeholder: 'https://www.paypal.com/...', info: 'Optionaler sicherer Checkout-Link. Ohne Link verweist das Panel auf den Support.' },
      { key: 'heavenEconomy.paysafecardUrl', label: 'Paysafecard Kauf-Link', type: 'text', placeholder: 'https://...', info: 'Optionaler Checkout-Link eines freigeschalteten Paysafecard-Händlerzugangs.' },
      { key: 'heavenEconomy.supportChannelId', label: 'Support-Kanal', type: 'channelSelect', placeholder: 'optional', info: 'Fallback für Käufe und Rückfragen, falls keine automatische Zahlungsanbindung konfiguriert ist.' },
      { key: 'heavenEconomy.logChannelId', label: 'Economy Log-Kanal', type: 'channelSelect', placeholder: 'optional', info: 'Protokolliert Käufe, Geschenke, Meilensteine und Rollenfehler.' }
    ]
  },
  {
    id: 'antiraid',
    title: 'Raid-Schutz',
    description: 'Beitrittswellen erkennen und sicher eindämmen',
    detail: 'Aktiviert bei ungewöhnlichen Beitrittswellen eine zeitlich begrenzte Schutzphase. Standardmäßig wird nur beobachtet; automatische Kicks und Banns sind bewusst ausgeschlossen.',
    icon: '🚨',
    fields: [
      { key: 'antiraid.enabled', label: 'Modul aktiv', type: 'checkbox', info: 'Schaltet Raid-Erkennung ein oder aus.' },
      { key: 'antiraid.joinThreshold', label: 'Beitritts-Schwelle', type: 'number', min: 3, max: 100, step: 1, info: 'Wie viele neue Mitglieder im Zeitfenster erlaubt sind, bevor der Schutzmodus startet.' },
      { key: 'antiraid.joinWindowSeconds', label: 'Zeitfenster (Sekunden)', type: 'number', min: 5, max: 600, step: 5, info: 'Zeitraum, in dem Beitritte gezählt werden. Kürzer reagiert schneller, kann aber strenger sein.' },
      { key: 'antiraid.shieldMinutes', label: 'Schutzphase (Minuten)', type: 'number', min: 1, max: 180, step: 1, info: 'Während dieser Zeit werden weitere Beitritte ebenfalls nach den Schutzregeln behandelt.' },
      { key: 'antiraid.action', label: 'Aktion', type: 'select', options: [
        { value: 'observe', label: 'Nur beobachten (empfohlen)' },
        { value: 'quarantine', label: 'Quarantäne-Rolle vergeben' },
        { value: 'timeout', label: 'Discord-Timeout setzen' }
      ], info: 'Kicks und Banns werden nicht automatisch ausgeführt. Richte das Modul zuerst im Beobachtungsmodus ein.' },
      { key: 'antiraid.actionDurationMinutes', label: 'Timeout-Dauer (Minuten)', type: 'number', min: 1, max: 40320, step: 1, info: 'Dauer des Discord-Timeouts. Eine gewählte Quarantäne-Rolle kann ergänzend gesetzt werden.' },
      { key: 'antiraid.quarantineRoleId', label: 'Quarantäne-Rolle', type: 'roleSelect', info: 'Optionale eingeschränkte Rolle für neue Konten während einer Schutzphase. Der Bot muss in der Rollenliste darüber stehen.' },
      { key: 'antiraid.onlyRecentAccounts', label: 'Nur junge Konten automatisch behandeln', type: 'checkbox', info: 'Reduziert Fehlalarme: Ältere Discord-Konten werden protokolliert, aber nicht automatisch eingeschränkt.' },
      { key: 'antiraid.recentAccountDays', label: 'Junges Konto bis (Tage)', type: 'number', min: 0, max: 3650, step: 1, info: 'Grenze für die Option „Nur junge Konten“. Null bedeutet ausschließlich am selben Tag erstellte Konten.' },
      { key: 'antiraid.whitelistRoleIds', label: 'Vertrauensrollen', type: 'multiRoleSelect', info: 'Mitglieder mit einer dieser Rollen werden nicht automatisch eingeschränkt.' },
      { key: 'antiraid.trustedUserIds', label: 'Vertrauenspersonen', type: 'arrayLines', placeholder: 'Discord-Nutzer-ID je Zeile', info: 'Optionale feste Ausnahmen für bekannte Personen. Rollen sind in der App direkt auswählbar; IDs werden nur für persönliche Ausnahmen benötigt.' },
      { key: 'antiraid.logChannelId', label: 'Raid-Schutz-Protokoll', type: 'channelSelect', placeholder: 'Kanal auswählen ...', info: 'Privater Team-Kanal für erkannte Wellen, Schutzmodus und angewendete Maßnahmen.' }
    ]
  },
  {
    id: 'memberVerify',
    title: 'Mitglieder-Verifizierung',
    description: 'Verify-Panel, Profil-Screening und Bot-Schutz',
    detail: 'Prüft neue Mitglieder beim Beitritt (Ziffern-Namen, Links, verdächtige Begriffe, junge Konten), bannt klare Bot-/Spam-Kandidaten automatisch und lässt echte Mitglieder per Verify-Panel mit Fragebogen und Team-Freigabe in den Server.',
    icon: '🛡️',
    fields: [
      { key: 'memberVerify.enabled', label: 'Modul aktiv', type: 'checkbox', info: 'Schaltet Profil-Screening, Auto-Bann und das Verify-Panel zusammen ein. Beim Verify wird zufällig eine Aufgabe aus 10 Typen gestellt (Bild-Captcha, Emoji zählen, Rechnen, Farben, Richtung, …).' },
      { key: 'memberVerify.panelChannelId', label: 'Verify-Panel Kanal', type: 'channelSelect', placeholder: 'Kanal auswählen ...', info: 'Kanal, in dem das Verify-Embed mit dem „Verifizieren“-Button gepflegt wird (wird automatisch gesendet/aktualisiert).' },
      { key: 'memberVerify.verifiedRoleId', label: 'Verifizierte Rolle', type: 'roleSelect', placeholder: 'Rolle auswählen ...', info: 'Rolle, die nach erfolgreichem Verify vergeben wird. Der Bot muss in der Rollenhierarchie darüber stehen.' },
      { key: 'memberVerify.unverifiedRoleId', label: 'Unverified-Rolle', type: 'roleSelect', placeholder: 'optional', info: 'Optional: eingeschränkte Rolle, die neue Mitglieder bis zum Verify bekommen und danach entfernt wird.' },
      { key: 'memberVerify.welcomeChannelId', label: 'Willkommens-Kanal', type: 'channelSelect', placeholder: 'optional', info: 'Kanal für die „Erfolgreich verifiziert“-Nachricht. Leer lassen, wenn keine Nachricht gesendet werden soll.' },
      { key: 'memberVerify.welcomeMessage', label: 'Willkommens-Text', type: 'text', placeholder: 'Willkommen {user} – du wurdest verifiziert!', info: 'Template für die Nachricht nach erfolgreichem Verify. {user} pingt, {guild} schreibt den Servernamen.' },
      { key: 'memberVerify.logChannelId', label: 'Verify-Protokoll', type: 'channelSelect', placeholder: 'Kanal auswählen ...', info: 'Privater Team-Kanal: gebannte/gekickte Kandidaten, Freigabe-Warteschlange und manuelle Entscheidungen mit Bann-/Freigabe-Buttons.' },
      { key: 'memberVerify.ownerPingRoleId', label: 'Team-Ping-Rolle', type: 'roleSelect', placeholder: 'optional', info: 'Rolle, die bei neuen verdächtigen Accounts gepingt wird, damit das Team im Protokoll entscheiden kann.' },
      { key: 'memberVerify.requireTeamApproval', label: 'Team-Freigabe erforderlich', type: 'checkbox', info: 'Richtige Verify-Antworten führen nicht direkt zur Rolle, sondern in die Freigabe-Warteschlange. Ein Teammitglied muss im Protokoll auf „Freigeben“ klicken.' },
      { key: 'memberVerify.kickOnFailedVerify', label: 'Bei falscher Antwort kicken', type: 'checkbox', info: 'Nach 3 falschen Versuchen wird das Mitglied gekickt. Ohne diese Option wird es stattdessen für 15 Minuten gesperrt.' },
      { key: 'memberVerify.customQuestions', label: 'Eigene Verify-Fragen', type: 'textarea', rows: 4, placeholder: 'Eine Frage pro Zeile, z. B.:\nWie heißt unser Server?\nWelches Spiel spielen wir hauptsächlich?', info: 'Zusätzliche Freitext-Fragen bei Text-Aufgaben im Fragebogen (max. 3). Antworten können nicht automatisch geprüft werden – sie werden dem Team bei der Freigabe angezeigt.' },
      { key: 'memberVerify.digitRatioPercent', label: 'Ziffern-Anteil Warnung (%)', type: 'number', min: 0, max: 100, step: 1, info: 'Ab diesem Ziffern-Anteil im Nutzernamen gilt ein Konto als bot-verdächtig (typisch für Spam-User). 0 deaktiviert die Warnung.' },
      { key: 'memberVerify.maxDigitRun', label: 'Ziffernblock-Warnung', type: 'number', min: 0, max: 32, step: 1, info: 'Ab dieser Länge einer zusammenhängenden Ziffernfolge gilt der Name als bot-verdächtig. 0 deaktiviert die Warnung.' },
      { key: 'memberVerify.autoBanFlaggedNames', label: 'Verdächtige Namen automatisch bannen', type: 'checkbox', info: 'Konten mit Ziffern-Flut, Links oder verbotenen Begriffen im Namen werden sofort gebannt statt nur protokolliert. Ohne diese Option geht alles in die Team-Entscheidung.' },
      { key: 'memberVerify.minAccountAgeDays', label: 'Mindest-Kontoalter (Tage)', type: 'number', min: 0, max: 3650, step: 1, info: 'Konten, die jünger als diese Tage sind, gelten als bot-verdächtig und werden im Verify-Protokoll geflaggt. 0 deaktiviert die Altersprüfung.' },
      { key: 'memberVerify.autoBanYoungAccounts', label: 'Zu junge Konten automatisch bannen', type: 'checkbox', info: 'Konten unter dem Mindest-Kontoalter werden sofort gebannt statt nur protokolliert (Hard-Flag).' },
      { key: 'memberVerify.flaggedTerms', label: 'Zusätzliche verbotene Begriffe', type: 'arrayLines', placeholder: 'Ein Begriff je Zeile', info: 'Diese Begriffe (auch Teilwörter) im Nutzernamen führen zum Bann bzw. in die Team-Entscheidung. NSFW-/Beleidigungs-Basics sind bereits eingebaut.' },
      { key: 'memberVerify.reminderEnabled', label: 'Reminder bei fehlendem Verify', type: 'checkbox', info: 'Unverifizierte Mitglieder werden nach ein paar Minuten im Verify-Kanal erinnert. Nach der maximalen Anzahl Erinnerungen wird das Mitglied gekickt.' },
      { key: 'memberVerify.reminderDelayMinutes', label: 'Erste Erinnerung nach (Minuten)', type: 'number', min: 1, max: 1440, step: 1, info: 'Wartezeit nach dem Beitritt bis zur ersten Erinnerung (Standard: 5 Minuten).' },
      { key: 'memberVerify.maxReminders', label: 'Maximale Erinnerungen vor Kick', type: 'number', min: 1, max: 10, step: 1, info: 'Nach so vielen Erinnerungen ohne Verify wird das Mitglied gekickt (Standard: 3).' },
      { key: 'memberVerify.reminderChannelId', label: 'Reminder-Kanal', type: 'channelSelect', placeholder: 'optional – nutzt sonst den Verify-Panel-Kanal', info: 'Kanal, in dem die Erinnerungen gepostet werden. Leer lassen, um den Verify-Panel-Kanal zu nutzen.' },
      { key: 'memberVerify.reminderPhrases', label: 'Eigene Erinnerungs-Sätze', type: 'textarea', rows: 4, placeholder: 'Ein Satz pro Zeile – {user} wird durch den Ping ersetzt', info: 'Verschiedene Sätze, aus denen bei jeder Erinnerung zufällig gewählt wird. Ohne Angabe werden eingebaute Sätze verwendet.' }
    ]
  },
  {
    id: 'botUpdates',
    title: 'Bot-Updates',
    description: 'Automatisches Update-Embed für den Server',
    detail: 'Postet ein professionelles, im Embed Studio gestaltbares Update-Embed in einen Kanal – damit der Server mitbekommt, was neu ist oder gerade nicht richtig funktioniert. Der Bot sendet genau eine Nachricht und bearbeitet sie bei jedem Update automatisch.',
    icon: '📢',
    fields: [
      { key: 'botUpdates.enabled', label: 'Modul aktiv', type: 'checkbox', info: 'Postet/aktualisiert das Update-Embed im gewählten Kanal.' },
      { key: 'botUpdates.channelId', label: 'Update-Kanal', type: 'channelSelect', placeholder: 'Kanal auswählen ...', info: 'Kanal für das Update-Embed. Der Bot sendet genau eine Nachricht und bearbeitet sie bei jedem Bot-Update und beim Speichern.' }
    ]
  },
  {
    id: 'roleSaver',
    title: 'Rollen-Saver',
    description: 'Rollen speichern und bei Rückkehr wiederherstellen',
    detail: 'Speichert beim Verlassen automatisch alle Rollen eines Mitglieds (außer Blacklist, @everyone und bot-verwaltete Rollen) und stellt sie bei der Rückkehr wieder her. Team- und Sonderrollen bleiben über die Blacklist geschützt, verwaltete Rollen (Level, Booster, AutoRole …) kommen automatisch von ihren eigenen Modulen zurück.',
    icon: '💾',
    fields: [
      { key: 'roleSaver.enabled', label: 'Modul aktiv', type: 'checkbox', info: 'Aktiviert das Speichern beim Verlassen und die automatische Wiederherstellung bei der Rückkehr.' },
      { key: 'roleSaver.blacklistedRoleIds', label: 'Blacklist-Rollen', type: 'multiRoleSelect', info: 'Diese Rollen werden beim Verlassen NIEMALS gespeichert und bei der Rückkehr NIEMALS vergeben – z. B. Team-, Admin- oder Sonderrollen.' },
      { key: 'roleSaver.excludeBots', label: 'Bots ausschließen', type: 'checkbox', info: 'Bot-Accounts werden nicht gespeichert und erhalten keine Rollen zurück.' },
      { key: 'roleSaver.skipManagedRoles', label: 'Verwaltete Rollen überspringen', type: 'checkbox', info: 'Rollen, die andere Module automatisch vergeben (Level, Booster, AutoRole, Server-Tag, Verify …), werden nicht gespeichert – sie kommen beim Wiederkommen von ihren eigenen Modulen zurück. Empfohlen: an.' },
      { key: 'roleSaver.restoreDelaySeconds', label: 'Wiederherstellung nach (Sekunden)', type: 'number', min: 1, max: 120, step: 1, info: 'Wartezeit nach dem Beitritt, bis die Rollen vergeben werden. Standard: 8 Sekunden.' },
      { key: 'roleSaver.retryCount', label: 'Wiederholungsversuche', type: 'number', min: 1, max: 5, step: 1, info: 'Wie oft die Rollenvergabe bei Fehlern wiederholt wird.' },
      { key: 'roleSaver.maxStoredRoles', label: 'Maximal gespeicherte Rollen', type: 'number', min: 5, max: 100, step: 1, info: 'Obergrenze für gespeicherte Rollen pro Mitglied (Discord erlaubt maximal 250 Rollen insgesamt).' },
      { key: 'roleSaver.logChannelId', label: 'Rollen-Saver Log-Kanal', type: 'channelSelect', placeholder: 'optional', info: 'Optionaler Kanal für Speicher- und Wiederherstellungs-Logs sowie echte Fehler.' }
    ]
  },
  {
    id: 'voiceLogImport',
      title: 'Carl-bot Voice-Log-Import',
      description: 'Sprachchat-Daten aus Carl-bot-Logs in die Mitglieder-Profile übernehmen',
      detail: 'Carl-bot loggt Voice-Events („Member joined/left/changed voice channel“) als Embeds in einen Log-Kanal. Dieses Modul liest diese Nachrichten und verbucht daraus die Sprachchat-Daten der Mitglieder (Voice gesamt / 7d / 30d, letzte Voice-Aktivität, Session-Liste). Live: Jede neue Log-Nachricht wird sofort verarbeitet. Backfill: Beim Bot-Start und bei Aktivierung werden die letzten Stunden nachgeholt – auch Offline-Zeiten werden exakt verbucht (Dauer aus den Log-Zeitstempeln). Verarbeitete Nachrichten werden in einer Datenbank gespeichert und nie doppelt gezählt.',
      icon: '🎙️',
      fields: [
        { key: 'voiceLogImport.enabled', label: 'Modul aktiv', type: 'checkbox', info: 'Aktiviert das Einlesen der Carl-bot-Voice-Logs.' },
        { key: 'voiceLogImport.channelId', label: 'Log-Kanal (Carl-bot)', type: 'channelSelect', info: 'Der Textkanal, in den Carl-bot die Voice-Logs schreibt (bei euch: carl-voice).' },
        { key: 'voiceLogImport.backfillHours', label: 'Nachhol-Zeitraum (Stunden)', type: 'number', min: 1, max: 17520, step: 1, info: 'REST-Nachholzeitraum, falls der Kanal nicht im Index liegt (Standard: 4320 h = 180 Tage). Die komplette Historie wird ohnehin aus dem Server-Index gelesen – dieser Wert gilt nur für den Fallback.' }
      ]
    },
    {
    id: 'inactiveReminder',
    title: 'Inaktivitäts-Erinnerung',
    description: 'Inaktive Mitglieder freundlich anfragen und Server sauber halten',
    detail: 'Mitglieder, die länger als die eingestellte Zeit (Standard: 180 Tage) weder eine Nachricht gesendet noch in einem Sprachkanal waren, erhalten automatisch genau eine Erinnerungs-DM. Carl-bot-Voice-Logs und Nachrichtenindex werden vollständig geprüft. Bereits angeschriebene Mitglieder werden nie erneut angeschrieben. Es gibt keinen Auto-Kick.',
    icon: '🕊️',
    fields: [
      { key: 'inactiveReminder.enabled', label: 'Modul aktiv', type: 'checkbox', info: 'Aktiviert den automatischen Start- und Tageslauf. DMs werden nur gesendet, wenn Mitgliederliste, Nachrichtenindex und Voice-Historie vollständig geprüft wurden und alle Inaktivitätskriterien erfüllt sind.' },
      { key: 'inactiveReminder.thresholdDays', label: 'Inaktiv ab (Tage)', type: 'number', min: 7, max: 3650, step: 1, info: 'Nach wie vielen Tagen ohne Nachricht UND ohne Sprachkanal gilt ein Mitglied als inaktiv? Standard: 180 (ein halbes Jahr). Erst der Beitritt selbst muss ebenfalls älter sein – neue Mitglieder werden nie angeschrieben. Es gibt keinen Auto-Kick – nur das DM-Embed mit den Buttons.' },
      { key: 'inactiveReminder.excludedRoleIds', label: 'Ausgenommene Rollen', type: 'multiRoleSelect', info: 'Mitglieder mit diesen Rollen (z. B. Team, VIP, Booster) werden nie angeschrieben.' }
    ]
  }
];

const toList = (value, fallback = []) => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (entry && typeof entry === 'object') {
          return entry;
        }
        return String(entry).trim();
      })
      .filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split('\n')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return fallback;
};

const toIdList = (value, fallback = []) => {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[\s,;]+/)
      : fallback;
  return [...new Set(source
    .map((entry) => String(entry || '').trim())
    .filter((entry) => /^\d{15,22}$/.test(entry)))];
};

const toSafeGifLibrary = (value) => {
  const result = [];
  const seen = new Set();
  for (const entry of toList(value, [])) {
    if (typeof entry !== 'string' || entry.length > 1000 || /[\r\n\0]/.test(entry)) continue;
    try {
      const parsed = new URL(entry);
      const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
      const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)?.slice(1).map(Number) || null;
      const localIpv4 = Boolean(ipv4 && (
        ipv4.some((part) => part < 0 || part > 255)
        || [0, 10, 127].includes(ipv4[0])
        || (ipv4[0] === 169 && ipv4[1] === 254)
        || (ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31)
        || (ipv4[0] === 192 && ipv4[1] === 168)
        || (ipv4[0] === 100 && ipv4[1] >= 64 && ipv4[1] <= 127)
        || (ipv4[0] === 198 && [18, 19].includes(ipv4[1]))
      ));
      const localIpv6 = host === '::1' || (host.includes(':') && /^(?:fc|fd|fe80:)/.test(host));
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) continue;
      if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || localIpv4 || localIpv6) continue;
      if (!/\.(?:gif|gifv)$/i.test(parsed.pathname)) continue;
      parsed.hash = '';
      const url = parsed.toString();
      const key = url.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(url);
      if (result.length >= 30) break;
    } catch {}
  }
  return result;
};

const toNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

// Das Inaktivitäts-Erinnerungs-Embed darf NIE leer sein: Wenn kein Design
// gespeichert wurde (oder das gespeicherte nur leere Felder hat), wird das
// Standard-Design benutzt – der Benutzer-Text (content) bleibt dabei erhalten.
const normalizeInactiveReminderDesign = (value, fallback) => {
  const fallbackDesign = fallback && typeof fallback === 'object' && !Array.isArray(fallback) ? fallback : null;
  const design = value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  if (!design) return fallbackDesign || { content: '', embed: {} };
  const embed = design.embed && typeof design.embed === 'object' && !Array.isArray(design.embed) ? design.embed : {};
  const hasContent = String(embed.title || '').trim()
    || String(embed.description || '').trim()
    || (Array.isArray(embed.fields) && embed.fields.length > 0)
    || String(design.content || '').trim();
  if (hasContent || !fallbackDesign) return design;
  return {
    content: String(design.content || fallbackDesign.content || ''),
    embed: fallbackDesign.embed && typeof fallbackDesign.embed === 'object' ? fallbackDesign.embed : {}
  };
};

const configModuleAliases = {
  antiRaid: 'antiraid',
  leveling: 'levels',
  level: 'levels'
};

const normalizeLegacyTopLevelModules = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }

  const entries = { ...value };
  Object.entries(configModuleAliases).forEach(function ([alias, canonical]) {
    const aliasKey = String(alias || '').trim();
    const canonicalKey = String(canonical || '').trim();
    if (!aliasKey || !canonicalKey || !Object.prototype.hasOwnProperty.call(entries, aliasKey)) {
      return;
    }

    const aliasValue = entries[aliasKey];
    const canonicalValue = entries[canonicalKey];

    if (!Object.prototype.hasOwnProperty.call(entries, canonicalKey)) {
      entries[canonicalKey] = aliasValue;
    } else if (aliasValue && typeof aliasValue === 'object' && !Array.isArray(aliasValue)
      && canonicalValue && typeof canonicalValue === 'object' && !Array.isArray(canonicalValue)) {
      entries[canonicalKey] = { ...canonicalValue, ...aliasValue };
    } else if (canonicalValue == null) {
      entries[canonicalKey] = aliasValue;
    }

    delete entries[aliasKey];
  });

  return entries;
};

const toBoundedInteger = (value, fallback, minimum, maximum) => {
  const number = Math.floor(toNumber(value, fallback));
  return Math.min(maximum, Math.max(minimum, number));
};

const activityLeagueRoleEntries = [
  ...['daily', 'weekly', 'monthly'].flatMap((period) => ['Chat', 'Voice'].flatMap((metric) => [1, 2, 3].map((place) => ({
    idKey: `${period}${metric}${place === 1 ? '' : `Top${place}`}RoleId`,
    nameKey: `${period}${metric}${place === 1 ? '' : `Top${place}`}RoleName`
  }))))
];
const legacyActivityRoleNames = new Set([
  '━━ FALLEN ACTIVITY ━━',
  '✦ Daily · Chat', '✦ Daily · Voice',
  '✦ Weekly · Chat', '✦ Weekly · Voice',
  '♛ Monthly · Chat', '♛ Monthly · Voice'
]);
const normalizedActivityRoleName = (value, fallback) => {
  const current = String(value || fallback).replace(/\s+/g, ' ').trim().slice(0, 100);
  return legacyActivityRoleNames.has(current) ? fallback : current;
};

const createEmbedTemplate = (id, name, category, embed, extra = {}) => ({
  id,
  name,
  category,
  channelId: '',
  content: '',
  messageId: '',
  enabled: true,
  embed: {
    title: '',
    description: '',
    color: '#27c4e8',
    authorName: '',
      authorIconUrl: '',
      thumbnailUrl: '',
      imageUrl: '',
      outsideImageUrl: '',
      footerText: '',
    footerIconUrl: '',
    timestamp: true,
    fields: [],
    ...embed
  },
  ...extra
});

const defaultEmbedTemplates = () => [
  createEmbedTemplate('level-up', 'Level Up', 'Automation', {
    title: '🏆 Level Up!',
    // {content} = '{user}' (Mention im Content) → echter Discord-Ping. Die
    // Beschreibung erwähnt den User genau EINMAL: {roleText} ist rollen-fokussiert
    // ohne {user}, die Hauptzeile trägt die einzelne Markierung – keine
    // doppelte Erwähnung, kein doppelter „erreicht“-Satz.
    description: '{roleText}{user} hat Level **{level}** erreicht – jetzt **Rang #{rank}** 🚀\n\n{progressBar} **{progressPercent} %** · noch **{xpNeeded}** XP bis Level **{nextLevel}**',
    color: '#f1b84b',
    // Profilbild doppelt: kleine Author-Zeile (Name + Avatar) als Kopfzeile und
    // großer Avatar als Thumbnail rechts – der Standard-Look für Level-Ups.
    authorName: '{username}',
    authorIconUrl: '{userAvatar}',
    thumbnailUrl: '{userAvatar}',
    footerText: 'FALLEN HEAVEN · Leveling · Level {level}',
    timestamp: true,
    fields: [
      { name: 'Neues Level', value: '{level}', inline: true },
      { name: 'XP gesamt', value: '{xp}', inline: true },
      { name: 'Rang', value: '#{rank}', inline: true },
      { name: 'Im Level', value: '{xpInLevel} / {levelSpan} XP', inline: true },
      { name: 'Noch bis Level {nextLevel}', value: '{xpNeeded} XP', inline: true },
      { name: 'Heute (Chat + Voice)', value: '{dailyXp} XP', inline: true }
    ]
  }, { content: '{user}' }),
  createEmbedTemplate('level-up-info', 'Level Up Info', 'Automation', {
    title: '🕊️ Leveling – so funktioniert es',
    description: 'Mit Aktivität im Chat und im Sprachchat sammelst du XP und steigst Level für Level auf – je höher dein Level, desto höher dein Rang und deine Engel-Rolle.\n\n'
      + '**CHAT**\n• 6–16 XP pro gültiger Nachricht (ab 2 Zeichen, max. 1 Wertung alle 60 Sekunden)\n'
      + '**SPRACHCHAT**\n• 2 XP pro Minute, gemeinsam mit mindestens einer weiteren Person\n'
      + '**LEVEL & RANG**\n• Mit jedem Level wartet eine höhere Engel-Rolle auf dich\n• `/level` – dein Stand · `/level @user` – den Stand anderer checken\n'
      + '**NO-XP**\n• Wer die NO-XP-Rolle nimmt, sammelt keine XP mehr – jederzeit umkehrbar am Levelrollen-Panel',
    color: '#f1b84b',
    footerText: 'FALLEN HEAVEN · Leveling',
    timestamp: true,
    fields: []
  }),
  createEmbedTemplate('level-card', 'Level Karte', 'Automation', {
    title: 'Level {level}',
    description: '{progressBar} **{progressPercent} %** · noch **{xpNeeded}** XP bis Level **{nextLevel}**\n\n**XP gesamt:** {xp} · **Rang:** #{rank} auf dem Server',
    color: '#f1b84b',
    thumbnailUrl: '{userAvatar}',
    footerText: 'FALLEN HEAVEN · Leveling',
    timestamp: true,
    fields: [
      { name: 'Im Level', value: '{xpInLevel} / {levelSpan} XP', inline: true },
      { name: 'Heute (Chat + Voice)', value: '{dailyXp} XP', inline: true },
      { name: 'Liga-Bonus', value: '{bonusXp} XP', inline: true }
    ]
  }),
  createEmbedTemplate('welcome', 'Welcome', 'Automation', {
    title: 'Willkommen auf {guild}',
    description: 'Schön, dass du da bist, {user}. Lies die Regeln und fühl dich zuhause.',
    color: '#27c4e8',
    thumbnailUrl: '{userAvatar}',
    footerText: 'Mitglied beigetreten'
  }),
  createEmbedTemplate('farewell', 'Farewell', 'Automation', {
    title: 'Mitglied verlassen',
    description: '{user} hat {guild} verlassen.',
    color: '#ff6b6b',
    thumbnailUrl: '{userAvatar}',
    footerText: 'Farewell-System'
  }),
  createEmbedTemplate('announcement', 'Announcement', 'Custom', {
    title: 'Ankündigung',
    description: 'Schreibe hier deine Nachricht.',
    color: '#f1b84b',
    footerText: '{guild}'
  })
];

const normalizeEmbedFields = (fields = []) => {
  if (!Array.isArray(fields)) {
    return [];
  }

  return fields
    .filter((field) => field && typeof field === 'object')
    .map((field) => ({
      name: String(field.name || '').slice(0, 256),
      value: String(field.value || '').slice(0, 1024),
      inline: Boolean(field.inline)
    }))
    .filter((field) => field.name || field.value)
    .slice(0, 25);
};

const normalizeEmbedTemplate = (template = {}, fallback = {}) => {
  const fallbackEmbed = fallback.embed || {};
  const embed = template.embed && typeof template.embed === 'object' ? template.embed : {};
  // Außenbild (Embed Studio) lebt auf Template-Ebene – Legacy-Designs mit
  // embed.outsideImageUrl werden einmalig nach oben gezogen.
  const legacyOutsideUrl = String(embed.outsideImageUrl || '').trim();
  const outsideImageUrl = String(template.outsideImageUrl ?? legacyOutsideUrl ?? '').trim();
  const rawAttachment = template.outsideImageAttachment && typeof template.outsideImageAttachment === 'object'
    ? template.outsideImageAttachment
    : (embed.outsideImageAttachment && typeof embed.outsideImageAttachment === 'object' ? embed.outsideImageAttachment : null);
  const outsideImageAttachment = rawAttachment
    ? {
        id: String(rawAttachment.id || '').trim(),
        url: String(rawAttachment.url || '').trim().slice(0, 2000),
        name: String(rawAttachment.name || rawAttachment.filename || 'Bild-Anhang').slice(0, 120),
        size: Math.max(0, Number(rawAttachment.size || 0)),
        ...(rawAttachment.localAsset === true ? { localAsset: true, mime: String(rawAttachment.mime || '') } : {})
      }
    : null;

  return {
    ...fallback,
    ...template,
    id: String(template.id || fallback.id || cryptoRandomId()).trim(),
    name: String(template.name || fallback.name || 'Custom Embed').trim(),
    category: String(template.category || fallback.category || 'Custom').trim(),
    channelId: String(template.channelId || fallback.channelId || '').trim(),
    content: String(template.content || fallback.content || '').slice(0, 2000),
    messageId: String(template.messageId || fallback.messageId || '').trim(),
    enabled: template.enabled !== false,
    outsideImageUrl,
    outsideImageAttachment,
    embed: {
      ...fallbackEmbed,
      ...embed,
      title: String(embed.title || fallbackEmbed.title || '').slice(0, 256),
      description: String(embed.description || fallbackEmbed.description || '').slice(0, 4096),
      color: String(embed.color || fallbackEmbed.color || '#27c4e8'),
      authorName: String(embed.authorName || fallbackEmbed.authorName || '').slice(0, 256),
      authorIconUrl: String(embed.authorIconUrl || fallbackEmbed.authorIconUrl || ''),
      thumbnailUrl: String(embed.thumbnailUrl || fallbackEmbed.thumbnailUrl || ''),
      imageUrl: String(embed.imageUrl || fallbackEmbed.imageUrl || ''),
      outsideImageUrl: String(embed.outsideImageUrl || fallbackEmbed.outsideImageUrl || ''),
      footerText: String(embed.footerText || fallbackEmbed.footerText || '').slice(0, 2048),
      footerIconUrl: String(embed.footerIconUrl || fallbackEmbed.footerIconUrl || ''),
      timestamp: embed.timestamp !== false,
      fields: normalizeEmbedFields(embed.fields || fallbackEmbed.fields)
    }
  };
};

const normalizeActivityPanelDesign = (value = {}, fallback = {}) => {
  const source = value && typeof value === 'object' ? value : {};
  const fallbackEmbed = fallback.embed && typeof fallback.embed === 'object' ? fallback.embed : {};
  const embed = source.embed && typeof source.embed === 'object' ? source.embed : {};
  const fallbackFields = Array.isArray(fallbackEmbed.fields) ? fallbackEmbed.fields : [];
  const sourceFields = Array.isArray(embed.fields) ? embed.fields : fallbackFields;
  return {
    id: 'activity-race-panel',
    name: 'Aktivitäts-Liga',
    category: 'Automation',
    content: String(source.content ?? fallback.content ?? '').slice(0, 2_000),
    outsideImageUrl: String(source.outsideImageUrl ?? fallback.outsideImageUrl ?? '').trim().slice(0, 2_000),
    outsideImageAttachment: source.outsideImageAttachment && typeof source.outsideImageAttachment === 'object'
      ? {
          id: String(source.outsideImageAttachment.id || '').trim(),
          url: String(source.outsideImageAttachment.url || '').trim().slice(0, 2_000),
          name: String(source.outsideImageAttachment.name || '').trim().slice(0, 120),
          size: Math.max(0, Number(source.outsideImageAttachment.size || 0))
        }
      : null,
    embed: {
      title: String(embed.title ?? fallbackEmbed.title ?? '').slice(0, 256),
      url: String(embed.url ?? fallbackEmbed.url ?? '').trim().slice(0, 2_000),
      description: String(embed.description ?? fallbackEmbed.description ?? '').slice(0, 4_096),
      color: String(embed.color ?? fallbackEmbed.color ?? '').trim().slice(0, 16),
      authorName: String(embed.authorName ?? fallbackEmbed.authorName ?? '').slice(0, 256),
      authorIconUrl: String(embed.authorIconUrl ?? fallbackEmbed.authorIconUrl ?? '').trim().slice(0, 2_000),
      thumbnailUrl: String(embed.thumbnailUrl ?? fallbackEmbed.thumbnailUrl ?? '').trim().slice(0, 2_000),
      imageUrl: String(embed.imageUrl ?? fallbackEmbed.imageUrl ?? '').trim().slice(0, 2_000),
      footerText: String(embed.footerText ?? fallbackEmbed.footerText ?? '').slice(0, 2_048),
      footerIconUrl: String(embed.footerIconUrl ?? fallbackEmbed.footerIconUrl ?? '').trim().slice(0, 2_000),
      timestamp: embed.timestamp !== false,
      fields: sourceFields.slice(0, 21).map((field) => ({
        name: String(field?.name || '').slice(0, 256),
        value: String(field?.value || '').slice(0, 1_024),
        inline: field?.inline === true
      })).filter((field) => field.name || field.value)
    }
  };
};

const normalizeActivityPingInfoDesign = (value = {}, fallback = {}) => {
  const source = value && typeof value === 'object' ? value : {};
  const fallbackEmbeds = Array.isArray(fallback.embeds) ? fallback.embeds : [fallback.embed || {}];
  const sourceEmbeds = (Array.isArray(source.embeds) ? source.embeds : [source.embed]).filter((entry) => entry && typeof entry === 'object');
  const attachment = source.outsideImageAttachment && typeof source.outsideImageAttachment === 'object'
    ? {
        id: String(source.outsideImageAttachment.id || ''),
        url: String(source.outsideImageAttachment.url || '').slice(0, 2048),
        name: String(source.outsideImageAttachment.name || source.outsideImageName || 'activity-race-ping-info.png').slice(0, 120),
        size: Math.max(0, Number(source.outsideImageAttachment.size || 0)),
        ...(source.outsideImageAttachment.localAsset === true ? { localAsset: true, mime: String(source.outsideImageAttachment.mime || '').slice(0, 100) } : {})
      }
    : null;
  return {
    content: String(source.content ?? fallback.content ?? '').slice(0, 2000),
    outsideImageUrl: String(source.outsideImageUrl ?? fallback.outsideImageUrl ?? '').slice(0, 2048),
    outsideImageName: String(source.outsideImageName || attachment?.name || '').slice(0, 120),
    outsideImageSize: Math.max(0, Number(source.outsideImageSize || attachment?.size || 0)),
    outsideImageAttachment: attachment,
    embeds: (sourceEmbeds.length ? sourceEmbeds : fallbackEmbeds).slice(0, 10).map((embed) => ({
      title: String(embed?.title || '').slice(0, 256),
      url: String(embed?.url || '').slice(0, 2048),
      description: String(embed?.description || '').slice(0, 4096),
      color: String(embed?.color || '#6fd8ff').slice(0, 16),
      authorName: String(embed?.authorName || '').slice(0, 256),
      authorIconUrl: String(embed?.authorIconUrl || '').slice(0, 2048),
      thumbnailUrl: String(embed?.thumbnailUrl || '').slice(0, 2048),
      imageUrl: String(embed?.imageUrl || '').slice(0, 2048),
      footerText: String(embed?.footerText || '').slice(0, 2048),
      footerIconUrl: String(embed?.footerIconUrl || '').slice(0, 2048),
      timestamp: embed?.timestamp === true,
      fields: (Array.isArray(embed?.fields) ? embed.fields : []).slice(0, 25).map((field) => ({
        name: String(field?.name || '').slice(0, 256),
        value: String(field?.value || '').slice(0, 1024),
        inline: field?.inline === true
      })).filter((field) => field.name || field.value)
    }))
  };
};

const defaultLevelsPanelDesign = () => ({
  content: '',
  outsideImageUrl: '',
  outsideImageAttachment: null,
  embed: {
    title: '💯 Leveln',
    url: '',
    description: 'Diese Rollen kannst du durch Aktivität im Chat und in den Sprachkanälen freischalten. Je höher dein Level, desto höher dein Rang.\n\n{levelRoles}',
    color: '#8b82ff',
    authorName: '',
    authorIconUrl: '',
    thumbnailUrl: '',
    imageUrl: '',
    footerText: 'FALLEN HEAVEN wünscht dir einen schönen Aufenthalt.',
    footerIconUrl: '',
    timestamp: true,
    fields: []
  }
});
const defaultBotUpdatesFields = () => [
  {
    name: 'Was ist neu',
    value: '📢 **Bot v{version}** – die wichtigsten Neuerungen:\n{changelog}',
    inline: false
  },
  {
    name: 'Bekannte Probleme',
    value: '⚠️ Sollte etwas nicht rund laufen, wird es hier im nächsten Update kommuniziert. Bei Fragen wende dich ans Team.',
    inline: false
  }
];
const defaultBotUpdatesDesign = () => ({
  content: '',
  outsideImageUrl: '',
  outsideImageAttachment: null,
  embed: {
    title: '🔔 Bot-Update v{version} · Update #{updateCount}',
    url: '',
    description: 'Hier erfährst du, was am Bot gerade neu ist – und was gerade nicht rund läuft.',
    color: '#8b82ff',
    authorName: 'FALLEN HEAVEN',
    authorIconUrl: '',
    thumbnailUrl: '',
    imageUrl: '',
    footerText: 'FALLEN HEAVEN · Updates',
    footerIconUrl: '',
    timestamp: true,
    fields: defaultBotUpdatesFields()
  }
});
const safeDesignText = (value, fallback = '', max = 4096) => String(value ?? fallback).slice(0, max);
const normalizeBotUpdatesDesign = (value = {}) => {
  const fallback = defaultBotUpdatesDesign();
  const embed = value?.embed && typeof value.embed === 'object' ? value.embed : {};
  return {
    content: safeDesignText(value?.content, fallback.content, 2000),
    outsideImageUrl: /^https?:\/\//i.test(String(value?.outsideImageUrl || '')) ? String(value.outsideImageUrl) : '',
    outsideImageAttachment: value?.outsideImageAttachment && typeof value.outsideImageAttachment === 'object'
      ? {
        id: String(value.outsideImageAttachment.id || ''),
        url: String(value.outsideImageAttachment.url || ''),
        name: String(value.outsideImageAttachment.name || 'fallen-heaven-update.png'),
        size: Math.max(0, Number(value.outsideImageAttachment.size || 0))
      }
      : null,
    embed: {
      title: safeDesignText(embed.title, fallback.embed.title, 256),
      url: /^https?:\/\//i.test(String(embed.url || '')) ? String(embed.url) : '',
      description: safeDesignText(embed.description, fallback.embed.description, 4096),
      color: String(embed.color || fallback.embed.color).slice(0, 16),
      authorName: safeDesignText(embed.authorName, fallback.embed.authorName, 256),
      authorIconUrl: /^https?:\/\//i.test(String(embed.authorIconUrl || '')) ? String(embed.authorIconUrl) : '',
      thumbnailUrl: /^https?:\/\//i.test(String(embed.thumbnailUrl || '')) ? String(embed.thumbnailUrl) : '',
      imageUrl: /^https?:\/\//i.test(String(embed.imageUrl || '')) ? String(embed.imageUrl) : '',
      footerText: safeDesignText(embed.footerText, fallback.embed.footerText, 2048),
      footerIconUrl: /^https?:\/\//i.test(String(embed.footerIconUrl || '')) ? String(embed.footerIconUrl) : '',
      timestamp: embed.timestamp !== false,
      fields: normalizeBotUpdatesFields(embed.fields)
    }
  };
};
const normalizeBotUpdatesFields = (rawFields) => {
  const fields = (Array.isArray(rawFields) ? rawFields : []).slice(0, 21).map((field) => ({
    name: safeDesignText(field?.name, '', 256),
    value: safeDesignText(field?.value, '', 1024),
    inline: field?.inline === true
  })).filter((field) => field.name || field.value);
  if (!fields.length) return defaultBotUpdatesFields();
  const defaults = defaultBotUpdatesFields();
  const isLegacy = (value) => /fülle dieses feld|fuelle dieses feld|trage hier|bitte ausfüllen|bitte ausfuellen|verbesserte websuche/.test(String(value || '').toLowerCase());
  const replaced = fields.map((field) => {
    if (!isLegacy(field.value)) return field;
    const match = defaults.find((candidate) => candidate.name === field.name) || defaults[0];
    return { ...field, name: match.name, value: match.value };
  });
  return replaced;
};
const normalizeLevelsPanelDesign = (value = {}) => {
  const fallback = defaultLevelsPanelDesign();
  const source = value && typeof value === 'object' ? value : {};
  const fallbackEmbed = fallback.embed;
  const embed = source.embed && typeof source.embed === 'object' ? source.embed : {};
  return {
    content: String(source.content ?? fallback.content ?? '').slice(0, 2_000),
    outsideImageUrl: String(source.outsideImageUrl ?? fallback.outsideImageUrl ?? '').trim().slice(0, 2_000),
    outsideImageAttachment: source.outsideImageAttachment && typeof source.outsideImageAttachment === 'object'
      ? {
          id: String(source.outsideImageAttachment.id || '').trim(),
          url: String(source.outsideImageAttachment.url || '').trim().slice(0, 2_000),
          name: String(source.outsideImageAttachment.name || '').trim().slice(0, 120),
          size: Math.max(0, Number(source.outsideImageAttachment.size || 0))
        }
      : null,
    embed: {
      title: String(embed.title ?? fallbackEmbed.title ?? '').slice(0, 256),
      url: String(embed.url ?? fallbackEmbed.url ?? '').trim().slice(0, 2_000),
      description: String(embed.description ?? fallbackEmbed.description ?? '').slice(0, 4_096),
      color: String(embed.color ?? fallbackEmbed.color ?? '').trim().slice(0, 16),
      authorName: String(embed.authorName ?? fallbackEmbed.authorName ?? '').slice(0, 256),
      authorIconUrl: String(embed.authorIconUrl ?? fallbackEmbed.authorIconUrl ?? '').trim().slice(0, 2_000),
      thumbnailUrl: String(embed.thumbnailUrl ?? fallbackEmbed.thumbnailUrl ?? '').trim().slice(0, 2_000),
      imageUrl: String(embed.imageUrl ?? fallbackEmbed.imageUrl ?? '').trim().slice(0, 2_000),
      footerText: String(embed.footerText ?? fallbackEmbed.footerText ?? '').slice(0, 2_048),
      footerIconUrl: String(embed.footerIconUrl ?? fallbackEmbed.footerIconUrl ?? '').trim().slice(0, 2_000),
      timestamp: embed.timestamp !== false,
      fields: (Array.isArray(embed.fields) ? embed.fields : fallbackEmbed.fields).slice(0, 21).map((field) => ({
        name: String(field?.name || '').slice(0, 256),
        value: String(field?.value || '').slice(0, 1_024),
        inline: field?.inline === true
      })).filter((field) => field.name || field.value)
    }
  };
};
// Wählt das panelDesign: explizit gesetztes Design gewinnt; sonst werden die alten
// Textfelder (Titel/Beschreibung/Fußzeile/Farbe) migriert; ansonsten das Standard-Design.
const resolveLevelsPanelDesign = (rawLevels = {}, mergedLevels = {}) => {
  const explicit = rawLevels?.panelDesign && typeof rawLevels.panelDesign === 'object' ? rawLevels.panelDesign : null;
  if (explicit) return explicit;
  const hasLegacyFields = ['levelRolesPanelTitle', 'levelRolesPanelDescription', 'levelRolesPanelFooter', 'levelRolesPanelColor']
    .some((key) => Object.prototype.hasOwnProperty.call(rawLevels || {}, key));
  if (hasLegacyFields) return migrateLegacyLevelsPanelDesign(rawLevels);
  return mergedLevels?.panelDesign;
};
// Übernimmt die alten Textfelder (Titel/Beschreibung/Fußzeile/Farbe) in das neue
// panelDesign-Format, damit bestehende Einstellungen beim Update nicht verloren gehen.
const migrateLegacyLevelsPanelDesign = (levels = {}) => {
  const fallback = defaultLevelsPanelDesign();
  const description = String(levels?.levelRolesPanelDescription || fallback.embed.description).trim();
  return {
    content: '',
    outsideImageUrl: '',
    outsideImageAttachment: null,
    embed: {
      title: String(levels?.levelRolesPanelTitle || fallback.embed.title).trim(),
      url: '',
      description: description.includes('{levelRoles}')
        ? description
        : [description, '{levelRoles}'].filter(Boolean).join('\n\n'),
      color: String(levels?.levelRolesPanelColor || fallback.embed.color).trim(),
      authorName: '',
      authorIconUrl: '',
      thumbnailUrl: '',
      imageUrl: '',
      footerText: String(levels?.levelRolesPanelFooter || fallback.embed.footerText).trim(),
      footerIconUrl: '',
      timestamp: true,
      fields: []
    }
  };
};

const cryptoRandomId = () => `embed-${Math.random().toString(36).slice(2, 10)}`;

// Hebt gespeicherte Level-Templates, die noch das alte (veraltete) Design
// enthalten, automatisch auf das aktuelle Fallen-Heaven-Design an – einmalig,
// ohne eigene Anpassungen des Nutzers an anderen Templates anzufassen.
const migrateLegacyLevelTemplate = (override, fallback) => {
  if (!override || !fallback) return override;
  const id = String(override.id || '');
  if (id !== 'level-up' && id !== 'level-card' && id !== 'level-up-info') return override;
  const embed = override.embed && typeof override.embed === 'object' ? override.embed : {};
  const title = String(embed.title || '');
  const description = String(embed.description || '');
  const legacy = id === 'level-card'
    ? title === '{username} · Level {level}'
    : id === 'level-up-info'
      ? title === '💜 Leveling – so funktioniert es'
      : (title === 'Level Up!' || description.includes('erreicht und steigt in der Rangliste auf')
        // Design v2: Der bisherige Standard (ohne Author-Zeile, „Rang #") wird
        // einmalig auf das neue Level-Up-Design (Author + Thumbnail) gehoben.
        || (title === '🏆 Level Up!'
          && description.includes('hat Level **{level}** erreicht – Rang')
          && String(embed.authorName || '') === ''
          && String(embed.thumbnailUrl || '') === '{userAvatar}'));
  if (!legacy) return override;
  return { ...override, embed: { ...(fallback.embed || {}) } };
};

const normalizeEmbeds = (value = {}, fallback = {}) => {
  const defaultTemplates = Array.isArray(fallback.templates) ? fallback.templates : defaultEmbedTemplates();
  const providedTemplates = Array.isArray(value.templates) ? value.templates : [];
  const byId = new Map(defaultTemplates.map((template) => [template.id, template]));
  const normalizedDefaults = defaultTemplates.map((template) => {
    const override = providedTemplates.find((entry) => entry?.id === template.id);
    return normalizeEmbedTemplate(migrateLegacyLevelTemplate(override, template) || template, template);
  });
  const customTemplates = providedTemplates
    .filter((template) => template?.id && !byId.has(template.id))
    .map((template) => normalizeEmbedTemplate(template));

  return {
    selectedTemplateId: String(value.selectedTemplateId || fallback.selectedTemplateId || normalizedDefaults[0]?.id || ''),
    templates: [...normalizedDefaults, ...customTemplates]
  };
};

// Editierbare Embed-Vorlagen der Public-Call-Moderation (Embed Studio).
const DEFAULT_PUBLIC_CALL_VOTE_BASE_DESIGNS = {
  panel: {
    title: '🎙️ Öffentlicher Call · Moderation',
    description: 'In öffentlichen Calls kannst du per Abstimmung entscheiden, ob ein Mitglied den Call verlassen muss. Wähle **„Rauswurf beantragen“**, nenne das Mitglied und wähle einen Grund – die Community stimmt ab. Bei wiederholten Verstößen greift automatisch ein Server-Timeout.',
    color: '#2b2d31',
    authorName: '',
    authorIconUrl: '',
    footerText: '{server}',
    timestamp: false
  },
  vote: {
    title: '🚫 Rauswurf-Abstimmung',
    description: 'Soll **{targetMention}** aus {channel} entfernt werden?\n\n**Grund:** {reason}\n{progress}',
    color: '#ed4245',
    authorName: '{targetName}',
    authorIconUrl: '',
    footerText: '{server}',
    timestamp: false
  },
  result: {
    title: '{outcome}',
    description: '**{targetMention}** {outcomeText}.',
    color: '#57f287',
    authorName: '{targetName}',
    authorIconUrl: '',
    footerText: '{server}',
    timestamp: false
  },
  team: {
    title: '🚫 Rauswurf aus öffentlichem Call',
    description: '**{targetMention}** wurde per Community-Abstimmung aus {channel} entfernt.',
    color: '#ed4245',
    authorName: '{targetName}',
    authorIconUrl: '',
    footerText: '{server}',
    timestamp: true
  },
  dm: {
    title: '🚫 Du wurdest aus dem Call entfernt',
    description: 'Du wurdest per Community-Abstimmung aus {channel} entfernt.\n\n**Grund:** {reason}\n**Call-Sperre:** {kickMinutes} Min.\n\nFalls du dich ungerecht behandelt fühlst, wende dich an das Team.',
    color: '#ed4245',
    authorName: '{targetName}',
    authorIconUrl: '',
    footerText: '{server}',
    timestamp: true
  },
  release: {
    title: '✅ Deine Call-Sperre ist vorbei',
    description: '**{targetMention}**, deine Call-Sperre in {channel} ist abgelaufen.\n\n**Grund:** {reason}\n**Sperrdauer:** {kickMinutes} Min.\n\nDu kannst dem Call wieder beitreten.',
    color: '#57f287',
    authorName: '{targetName}',
    authorIconUrl: '',
    footerText: '{server}',
    timestamp: true
  }
};

// 2er-/3er-/4er-Varianten: Jede Call-Art hat eigene, im Embed-Studio einzeln
// editierbare Sektionen (panel2/vote2/.../dm4). Sie erben die Basis-Designs –
// nur die Panel-Beschreibung nennt die feste Schwelle der Call-Art. WICHTIG:
// Diese vollständige Liste ist der Grundstein für normalizeConfig – fehlen die
// Varianten hier, zeigt der Studio-Editor für 2er/3er/4er ein leeres Embed,
// weil die gespeicherte Config (aus älteren Versionen) nur die 5 Basis-Sektionen kennt.
const DEFAULT_PUBLIC_CALL_VOTE_DESIGNS = {
  ...DEFAULT_PUBLIC_CALL_VOTE_BASE_DESIGNS,
  panel2: { ...DEFAULT_PUBLIC_CALL_VOTE_BASE_DESIGNS.panel, description: `**2er-Call – eine „Dafür“-Stimme genügt.**\n\n${DEFAULT_PUBLIC_CALL_VOTE_BASE_DESIGNS.panel.description}` },
  vote2: { ...DEFAULT_PUBLIC_CALL_VOTE_BASE_DESIGNS.vote },
  result2: { ...DEFAULT_PUBLIC_CALL_VOTE_BASE_DESIGNS.result },
  team2: { ...DEFAULT_PUBLIC_CALL_VOTE_BASE_DESIGNS.team },
  dm2: { ...DEFAULT_PUBLIC_CALL_VOTE_BASE_DESIGNS.dm },
  panel3: { ...DEFAULT_PUBLIC_CALL_VOTE_BASE_DESIGNS.panel, description: `**3er-Call – zwei „Dafür“-Stimmen genügen.**\n\n${DEFAULT_PUBLIC_CALL_VOTE_BASE_DESIGNS.panel.description}` },
  vote3: { ...DEFAULT_PUBLIC_CALL_VOTE_BASE_DESIGNS.vote },
  result3: { ...DEFAULT_PUBLIC_CALL_VOTE_BASE_DESIGNS.result },
  team3: { ...DEFAULT_PUBLIC_CALL_VOTE_BASE_DESIGNS.team },
  dm3: { ...DEFAULT_PUBLIC_CALL_VOTE_BASE_DESIGNS.dm },
  panel4: { ...DEFAULT_PUBLIC_CALL_VOTE_BASE_DESIGNS.panel, description: `**4er-Call – drei „Dafür“-Stimmen genügen.**\n\n${DEFAULT_PUBLIC_CALL_VOTE_BASE_DESIGNS.panel.description}` },
  vote4: { ...DEFAULT_PUBLIC_CALL_VOTE_BASE_DESIGNS.vote },
  result4: { ...DEFAULT_PUBLIC_CALL_VOTE_BASE_DESIGNS.result },
  team4: { ...DEFAULT_PUBLIC_CALL_VOTE_BASE_DESIGNS.team },
  dm4: { ...DEFAULT_PUBLIC_CALL_VOTE_BASE_DESIGNS.dm },
  release2: { ...DEFAULT_PUBLIC_CALL_VOTE_BASE_DESIGNS.release },
  release3: { ...DEFAULT_PUBLIC_CALL_VOTE_BASE_DESIGNS.release },
  release4: { ...DEFAULT_PUBLIC_CALL_VOTE_BASE_DESIGNS.release }
};

export const defaultGuildConfig = (guildId, guildName = 'Server') => ({
  guildId,
  guildName,
  general: {
    prefix: '!',
    locale: 'de-DE',
    timezone: 'Europe/Berlin',
    statusMessage: 'Bot ist aktiv',
    statusType: 'Playing',
    onlineStatus: 'online',
    ownerUserIds: [],
    staffRoleIds: [],
    commandLogChannelId: '',
    enableTypingIndicator: true,
    autoBackupMinutes: 10
  },
  customRichPresence: {
    enabled: false,
    applicationId: '',
    details: '{guild} - {online} online',
    state: 'Aktive Gefallene',
    countMode: 'presence-total',
    largeImageKey: 'pfp',
    largeImageText: 'Fallen-Heaven',
    smallImageKey: 'verified',
    smallImageText: 'Aktiver Server',
    button1Label: 'Mein Server',
    button1Url: 'https://discord.gg/fallen-heaven',
    button2Label: 'guns.lol',
    button2Url: 'https://guns.lol/0xvoidsoul',
    updateIntervalSeconds: 30
  },
  moderation: {
    enabled: true,
    mode: 'observe',
    badWords: ['spam', 'werbung', 'bannedword'],
    highRiskTerms: [],
    criticalTerms: [],
    autoDelete: true,
    antiSpamEnabled: true,
    antiSpamThreshold: 8,
    antiSpamWindowSeconds: 12,
    mentionSpamThreshold: 6,
    incidentWindowSeconds: 90,
    warningWindowDays: 30,
    timeoutMinutes: 10,
    lightTimeoutMinutes: 10,
    mediumTimeoutMinutes: 60,
    highTimeoutMinutes: 360,
    criticalTimeoutMinutes: 1440,
    criticalImmediateTimeout: false,
    maxWarnings: 3,
    muteRoleId: '',
    exemptRoleIds: [],
    ignoredChannelIds: [],
    logChannelId: '',
    warningDeleteSeconds: 15,
    retentionDays: 90
  },
  welcomeFarewell: {
    enabled: true,
    welcomeEnabled: true,
    welcomeAfterVerification: false,
    verificationRoleId: '',
    postVerificationRolesEnabled: false,
    postVerificationRoleIds: [],
    welcomeChannelId: '',
    welcomeMessage: 'Willkommen {user} auf {guild}!',
    welcomeTemplate: {
      content: '{user}',
      outsideImageUrl: '',
      embeds: [{
        title: 'Herzlich Willkommen {nickname}!',
        url: '',
        description: 'Fühl dich hier lieb aufgehoben 🤍\nHol dir gern deine Rollen bei <id:customize>\nund schau dich hier gern um.',
        color: '#58b9ff',
        authorName: '',
        authorIconUrl: '',
        thumbnailUrl: '',
        imageUrl: '',
        footerText: 'Liebe Grüße vom Maskottchen, HALO',
        footerIconUrl: '',
        timestamp: false,
        fields: []
      }]
    },
    farewellEnabled: true,
    farewellChannelId: '',
    farewellMessage: '{user} hat den Server verlassen.',
    autoRoleEnabled: true,
    autoRoleName: 'Member'
  },
  autoresponder: {
    enabled: false,
    cooldownSeconds: 120,
    caseInsensitive: true,
    mentionOnly: false,
    channelIds: [],
    ignoredChannelIds: [],
    allowUserMention: false,
    deleteCommand: false,
    rules: [
      { trigger: 'hallo', mode: 'word', response: 'Hi {username}!' },
      { trigger: 'hilfe', mode: 'word', response: 'Das Team hilft dir gern weiter.' }
    ]
  },
  levels: {
    enabled: true,
    xpPerMessageMin: 6,
    xpPerMessageMax: 16,
    cooldownSeconds: 60,
    minMessageLength: 2,
    maxXpPerDay: 0,
    ignoredChannelIds: [],
    excludedRoleIds: [],
    noXpRoleIds: [],
    levelRoleMappings: [],
    cumulativeRoleRewards: false,
    announce: true,
    announceChannelId: '',
    commandChannelId: '',
    levelUpMessage: '{user} erreicht Level {level}!',
    voiceXpPerMinute: 2,
    voiceMinimumParticipants: 2,
    excludeDeafenedVoice: true,
    levelCurveBase: 20,
    activityBonusEnabled: true,
    activityBonusPlace1: 100,
    activityBonusPlace2: 70,
    activityBonusPlace3: 40,
    activityBonusMaxPerDay: 150,
    tagBonusXpPerDay: 30,
    boostBonusEnabled: true,
    boostBonusXpPerBoost: 10,
    boostBonusMaxPerDay: 40,
    levelRolesPanelChannelId: '',
    levelUpInfoEnabled: false,
    levelUpInfoChannelId: '',
    levelUpCleanupEnabled: false,
    levelUpCleanupMaxMessages: 20,
    panelDesign: {
      content: '',
      outsideImageUrl: '',
      outsideImageAttachment: null,
      embed: {
        title: '💯 Leveln',
        url: '',
        description: 'Diese Rollen kannst du durch Aktivität im Chat und in den Sprachkanälen freischalten. Je höher dein Level, desto höher dein Rang.\n\n{levelRoles}',
        color: '#8b82ff',
        authorName: '',
        authorIconUrl: '',
        thumbnailUrl: '',
        imageUrl: '',
        footerText: 'FALLEN HEAVEN wünscht dir einen schönen Aufenthalt.',
        footerIconUrl: '',
        timestamp: true,
        fields: []
      }
    }
  },
  activityRace: {
    enabled: false,
    panelChannelId: '',
    rankingDisplayCount: 3,
    panelDesign: {
      id: 'activity-race-panel',
      name: 'Aktivitäts-Liga',
      category: 'Automation',
      content: '',
      outsideImageUrl: '',
      outsideImageAttachment: null,
      embed: {
        title: '{period}',
        url: '',
        description: 'Die aktivsten Mitglieder im Chat und Sprachchat.\n*{completion}*',
        color: '',
        authorName: 'FALLEN HEAVEN · AKTIVITÄTS-LIGA',
        authorIconUrl: '',
        thumbnailUrl: '',
        imageUrl: '',
        footerText: '{period} · nachvollziehbar und automatisch ausgewertet',
        footerIconUrl: '',
        timestamp: true,
        fields: []
      }
    },
    pingToggleButtonLabel: 'LIGA-PINGS EIN/AUS',
    pingInfoDesign: {
      content: '',
      outsideImageUrl: '',
      outsideImageAttachment: null,
      embeds: [{
        title: 'Aktivitäts-Liga · Benachrichtigungen',
        url: '',
        description: 'Du entscheidest selbst, ob du bei Änderungen deiner Liga-Platzierung erwähnt wirst. Mit dem Button kannst du deine persönlichen Liga-Pings jederzeit ein- oder ausschalten.',
        color: '#6fd8ff',
        authorName: '{server}',
        authorIconUrl: '',
        thumbnailUrl: '',
        imageUrl: '',
        footerText: 'Deine Auswahl bleibt gespeichert.',
        footerIconUrl: '',
        timestamp: false,
        fields: []
      }]
    },
    ignoredChannelIds: [],
    excludedRoleIds: [],
    messageCooldownSeconds: 10,
    duplicateWindowMinutes: 10,
    minimumMessageLength: 3,
    voiceMinimumParticipants: 2,
    excludeDeafened: true,
    placementPings: true,
    placementPingChannelId: '',
    placementPingLifetimeMinutes: 5,
    announceCompletedPeriods: true,
    announcementChannelId: '',
    separatorRoleName: '━━ AKTIVITÄTS-LIGA ━━',
    dailyChatRoleName: '🥇 Tageswertung · Chat · Platz 1',
    dailyChatTop2RoleName: '🥈 Tageswertung · Chat · Platz 2',
    dailyChatTop3RoleName: '🥉 Tageswertung · Chat · Platz 3',
    dailyVoiceRoleName: '🥇 Tageswertung · Sprachchat · Platz 1',
    dailyVoiceTop2RoleName: '🥈 Tageswertung · Sprachchat · Platz 2',
    dailyVoiceTop3RoleName: '🥉 Tageswertung · Sprachchat · Platz 3',
    weeklyChatRoleName: '🥇 Wochenwertung · Chat · Platz 1',
    weeklyChatTop2RoleName: '🥈 Wochenwertung · Chat · Platz 2',
    weeklyChatTop3RoleName: '🥉 Wochenwertung · Chat · Platz 3',
    weeklyVoiceRoleName: '🥇 Wochenwertung · Sprachchat · Platz 1',
    weeklyVoiceTop2RoleName: '🥈 Wochenwertung · Sprachchat · Platz 2',
    weeklyVoiceTop3RoleName: '🥉 Wochenwertung · Sprachchat · Platz 3',
    monthlyChatRoleName: '🥇 Monatswertung · Chat · Platz 1',
    monthlyChatTop2RoleName: '🥈 Monatswertung · Chat · Platz 2',
    monthlyChatTop3RoleName: '🥉 Monatswertung · Chat · Platz 3',
    monthlyVoiceRoleName: '🥇 Monatswertung · Sprachchat · Platz 1',
    monthlyVoiceTop2RoleName: '🥈 Monatswertung · Sprachchat · Platz 2',
    monthlyVoiceTop3RoleName: '🥉 Monatswertung · Sprachchat · Platz 3',
    separatorRoleId: '',
    dailyChatRoleId: '',
    dailyChatTop2RoleId: '',
    dailyChatTop3RoleId: '',
    dailyVoiceRoleId: '',
    dailyVoiceTop2RoleId: '',
    dailyVoiceTop3RoleId: '',
    weeklyChatRoleId: '',
    weeklyChatTop2RoleId: '',
    weeklyChatTop3RoleId: '',
    weeklyVoiceRoleId: '',
    weeklyVoiceTop2RoleId: '',
    weeklyVoiceTop3RoleId: '',
    monthlyChatRoleId: '',
    monthlyChatTop2RoleId: '',
    monthlyChatTop3RoleId: '',
    monthlyVoiceRoleId: '',
    monthlyVoiceTop2RoleId: '',
    monthlyVoiceTop3RoleId: ''
  },
  tickets: {
    enabled: true,
    panelChannelId: '',
    panelTitle: 'FALLEN HEAVEN Support',
    panelDescription: 'Öffne hier vertraulich ein Support-Ticket. Beschreibe dein Anliegen so genau wie möglich, damit das Team dir schnell helfen kann.',
    panelButtonLabel: 'Ticket öffnen',
    panelButtonEmoji: '🎫',
    supportRoleId: '',
    categoryId: '',
    useThreadMode: false,
    threadParentChannelId: '',
    oneOpenPerUser: true,
    closeArchive: true,
    closeMessage: 'Das Ticket wurde geschlossen.',
    logChannelId: ''
  },
  logging: {
    enabled: true,
    channelId: '',
    logMessages: true,
    includeMessageContent: false,
    logMembers: true,
    logRoles: true,
    logChannels: true,
    logVoice: false,
    logModeration: true,
    ignoredChannelIds: []
  },
  forumCleaner: {
    enabled: false,
    channelIds: [],
    graceMinutes: 10,
    scanIntervalMinutes: 1440,
    scanOnStartup: true,
    includeArchived: true,
    ignorePinned: true,
    ignoreLocked: true,
    requireNoReplies: true,
    titleOnlyIsEmpty: true,
    deleteMissingStarter: true,
    deleteLeftAuthorPosts: true,
    protectPinnedFromDepartedAuthors: false,
    protectLockedFromDepartedAuthors: false,
    leftAuthorGraceDays: 0,
    dryRun: false,
    logChannelId: ''
  },
  steamWorkshop: {
    enabled: false,
    forumChannelId: '',
    updateChannelId: '',
    workshopIds: [],
    syncIntervalMinutes: 30,
    syncOnStartup: true,
    notifyOnUpdate: false,
    mentionRoleId: '',
    appliedTagNames: [],
    pinPosts: false,
    buttonLabel: 'Im Steam Workshop öffnen',
    maxDescriptionLength: 1400,
    preferSteamPreviewImage: true,
    showRating: true,
    design: {
      content: '',
      outsideImageUrl: '',
      outsideImageAssetName: '',
      outsideImageAssetSize: 0,
      embed: {
        title: '{title}',
        url: '{workshopUrl}',
        description: '{description}',
        color: '#1b2838',
        authorName: 'STEAM WORKSHOP · {game}',
        authorIconUrl: '',
        thumbnailUrl: '',
        imageUrl: '{previewUrl}',
        footerText: 'Workshop-ID: {workshopId}',
        footerIconUrl: '',
        timestamp: true,
        fields: [
          { name: 'REICHWEITE', value: '**{subscriptions}** Abonnenten\n**{favorites}** Favoriten\n**{views}** Aufrufe', inline: true },
          { name: 'VERÖFFENTLICHUNG', value: 'Erstellt: {createdAt}\nAktualisiert: {updatedAt}', inline: true },
          { name: 'DATEI', value: '{fileSize}\nApp-ID: `{appId}`', inline: true },
          { name: 'TAGS', value: '{tags}', inline: false }
        ]
      }
    }
  },
  emojiManager: {
    enabled: true,
    oldPrefix: 'vl_',
    newPrefix: 'fh_',
    includeStatic: true,
    includeAnimated: true
  },
  voiceChatCleaner: {
    enabled: false,
    channelIds: [],
    emptyGraceSeconds: 60,
    cleanupOnStartup: true,
    deletePinned: true,
    dryRun: false,
    logChannelId: ''
  },
  tempVoice: {
    enabled: false,
    creatorChannelIds: [],
    categoryId: '',
    channelNameTemplate: '🎧 {user}',
    defaultUserLimit: 0,
    defaultBitrate: 0,
    defaultRegion: '',
    emptyGraceSeconds: 0,
    blacklistRoleIds: [],
    requiredRoleIds: [],
    allowRename: true,
    allowLimit: true,
    allowLock: true,
    allowRegion: true,
    allowThreads: true,
    allowTransfer: true
  },
  publicCallVote: {
    enabled: false,
    callChannelIds: [],
    callChannelIds2: [],
    callChannelIds3: [],
    callChannelIds4: [],
    passPercent: 51,
    minVotes: 3,
    timeoutSeconds: 60,
    resultAutoDeleteSeconds: 30,
    voteReasons: [
      { id: 'spam', label: 'Spam / Flood', kickMinutes: 10, timeoutAfter: 3, timeoutMinutes: 60 },
      { id: 'insult', label: 'Beleidigung', kickMinutes: 30, timeoutAfter: 3, timeoutMinutes: 120 },
      { id: 'noise', label: 'Lärm / Musik', kickMinutes: 15, timeoutAfter: 4, timeoutMinutes: 60 },
      { id: 'nsfw', label: 'Unangemessen', kickMinutes: 60, timeoutAfter: 2, timeoutMinutes: 240 },
      { id: 'other', label: 'Sonstiges', kickMinutes: 10, timeoutAfter: 5, timeoutMinutes: 60 }
    ],
    teamChannelId: '',
    teamRoleIds: [],
    design: DEFAULT_PUBLIC_CALL_VOTE_DESIGNS
  },
  serverBackup: {

    enabled: true,
    dailyHour: 5,
    keepBackups: 30,
    startupSafetyBackup: true,
    includeGuildAssets: true,
    includeEmojis: true,
    includeStickers: true,
    includeScheduledEvents: true,
    restoreServerSettings: true,
    restoreRoles: true,
    restoreChannels: true,
    restoreEmojis: false,
    restoreStickers: false,
    logChannelId: ''
  },
  memberManagement: {
    enabled: true,
    pageSize: 10,
    hideBots: false,
    activityBackfillEnabled: true,
    activityBackfillDays: 365,
    indexRefreshMinutes: 10,
    adminRoleIds: [],
    moderatorRoleIds: [],
    logChannelId: ''
  },
  autoRole: {
    enabled: false,
    excludeBots: true,
    roleIds: [],
    assignmentDelaySeconds: 2,
    retryCount: 3,
    reconcileOnStartup: false,
    maxStartupAssignments: 100,
    logChannelId: ''
  },
  roleSwap: {
    enabled: false,
    pairs: '',
    logChannelId: ''
  },
  counting: {
    enabled: false,
    channelId: '',
    resetValue: 0,
    deleteWrongMessages: true,
    preventSelfCount: true,
    selfCountIsFail: true,
    excludedRoleIds: [],
    maxCount: 1000000000,
    milestones: [100, 250, 500, 1000, 2500, 5000, 10000, 25000],
    milestoneMessage: '',
    successReaction: '✅',
    failReaction: '❌',
    statusChannelId: '',
    statusPanelEnabled: true,
    panelDesign: null,
    lossMessagesEnabled: true,
    lossMessages: [],
    clearChannelOnFail: true,
    clearChannelDelaySeconds: 10,
    clearChannelKeepMessages: 5,
    strikesEnabled: true,
    strikesToLock: 3,
    strikeLockHours: 24,
    strikeLockMessage: '',
    strikeTolerance: 1,
    dmDesigns: {
      strikeLock: {
        title: '🚫 Zähl-Kanal-Sperre',
        description: '**{targetMention}**, du hast {limit} Verwarnungen gesammelt und bist für **{hours} Std.** vom Zähl-Kanal gesperrt.\n\nFalls du denkst, dass das ein Fehler ist, wende dich an das Team.',
        color: '#ed4245',
        authorName: '{server}',
        footerText: 'FALLEN HEAVEN · ZÄHL-KANAL',
        timestamp: true
      },
      strikeRelease: {
        title: '✅ Deine Zähl-Kanal-Sperre ist vorbei',
        description: '**{targetMention}**, deine Chat-Sperre im Zähl-Kanal ist abgelaufen – du kannst wieder zählen!',
        color: '#57f287',
        authorName: '{server}',
        footerText: 'FALLEN HEAVEN · ZÄHL-KANAL',
        timestamp: true
      }
    }
  },
  serverTagTracker: {
    enabled: false,
    monitorOnly: true,
    roleIds: [],
    roleId: '',
    scanIntervalMinutes: 30,
    assignmentConfirmations: 2,
    removalConfirmations: 2,
    maxAssignmentsPerScan: 10,
    startupScan: true,
    excludeBots: true,
    excludedRoleIds: [],
    logChannelId: ''
  },
  boostRoles: {
    enabled: false,
    automaticRoleIds: [],
    tierRoleMappings: [],
    cumulativeRoles: false,
    removableColorRoleIds: [],
    removableColorRolePrefix: 'boost',
    fullHistoryScan: true,
    historyScanLimit: 2000,
    boostInfoChannelId: '',
    boostEndLogChannelId: '',
    logChannelId: '',
    boostAnnounceEnabled: false,
    boostAnnounceChannelId: '',
    boostTopEnabled: false,
    boostTopChannelId: '',
    boostTopPingsEnabled: true,
    boostTopPingChannelId: '',
    boostTopPingLifetimeMinutes: 5,
    boostTopTemplate: {
      content: '',
      outsideImageUrl: '',
      embeds: [{
        title: '🚀 Top-Booster',
        url: '',
        description: 'Die drei größten Booster des Servers. Das Panel wird live aktualisiert, sobald sich die Top 3 ändern.',
        color: '#a596ff',
        authorName: '{server} · Top-Booster',
        authorIconUrl: '',
        thumbnailUrl: '',
        imageUrl: '',
        footerText: '{boostcount} Boosts gesamt',
        footerIconUrl: '',
        timestamp: true,
        fields: []
      }]
    },
    boostAnnounceTemplate: {
      content: '{usermention}',
      outsideImageUrl: '',
      embeds: [{
        title: 'Danke für den Boost, ${usernickname}! 🚀💜',
        url: '',
        description: 'Du boostest jetzt **{boostcount}×** und gibst ${guildname} damit extra Power!\nHol dir jetzt deine Booster-Vorteile und genieß die Perks ✨',
        color: '#a596ff',
        authorName: '',
        authorIconUrl: '',
        thumbnailUrl: '',
        imageUrl: '',
        footerText: 'Liebe Grüße vom Maskottchen, HALO',
        footerIconUrl: '',
        timestamp: true,
        fields: []
      }]
    }
  },
  heavenEconomy: {
    enabled: false,
    panelChannelId: '',
    panelMessageId: '',
    coinEmoji: '🪙',
    boostMilestoneReward: 100,
    vipRoleMappings: [],
    vipPanelEnabled: false,
    vipPanelChannelId: '',
    vipPanelTemplate: {
      content: '',
      outsideImageUrl: '',
      embeds: [{
        title: '👑 VIP-Übersicht',
        url: '',
        description: 'Alle VIP-Stufen und ihre Mitglieder auf einen Blick – live aktualisiert.',
        color: '#ffbd59',
        authorName: '{server} · VIP-Übersicht',
        authorIconUrl: '',
        thumbnailUrl: '',
        imageUrl: '',
        footerText: '{memberCount} VIP-Mitglieder in {tierCount} Stufen',
        footerIconUrl: '',
        timestamp: true,
        fields: []
      }]
    },
    paypalUrl: '',
    paysafecardUrl: '',
    supportChannelId: '',
    logChannelId: ''
  },
  serverContext: {
    enabled: true,
    retentionDays: 30,
    maxStorageGb: 50,
    maxContextEntries: 80,
    channelIds: [],
    excludedChannelIds: [],
    storeAttachmentLinks: true
  },
  antiraid: {
    enabled: false,
    joinThreshold: 10,
    joinWindowSeconds: 60,
    shieldMinutes: 10,
    action: 'observe',
    actionDurationMinutes: 15,
    quarantineRoleId: '',
    onlyRecentAccounts: true,
    recentAccountDays: 7,
    whitelistRoleIds: [],
    trustedUserIds: [],
    logChannelId: ''
  },
  memberVerify: {
    enabled: false,
    panelChannelId: '',
    verifiedRoleId: '',
    unverifiedRoleId: '',
    welcomeChannelId: '',
    welcomeMessage: 'Willkommen {user} – du wurdest erfolgreich verifiziert!',
    logChannelId: '',
    ownerPingRoleId: '',
    requireTeamApproval: true,
    kickOnFailedVerify: true,
    customQuestions: '',
    digitRatioPercent: 40,
    maxDigitRun: 6,
    autoBanFlaggedNames: false,
    minAccountAgeDays: 0,
    autoBanYoungAccounts: false,
    flaggedTerms: '',
    panelTemplate: null,
    reminderEnabled: true,
    reminderDelayMinutes: 5,
    maxReminders: 3,
    reminderChannelId: '',
    reminderPhrases: ''
  },
  botUpdates: {
    enabled: false,
    channelId: '',
    design: null
  },
  roleSaver: {
    enabled: false,
    blacklistedRoleIds: [],
    excludeBots: true,
    skipManagedRoles: true,
    restoreDelaySeconds: 8,
    retryCount: 3,
    maxStoredRoles: 40,
    logChannelId: ''
  },
  voiceLogImport: {
    enabled: false,
    channelId: '',
    backfillHours: 4320,
    batchSize: 100,
    maxPages: 100
  },
  inactiveReminder: {
    enabled: false,
    thresholdDays: 180,
    excludedRoleIds: [],
    dmDesign: {
      content: '',
      outsideImageUrl: '',
      outsideImageAttachment: null,
      embed: {
        title: '🏠 {guild} · Wir vermissen dich!',
        description: '**{user}**, du warst seit über **{thresholdDays} Tagen** nicht mehr in {guild} aktiv – keine Nachrichten, kein Sprachchat.\n\nWir würden uns freuen, wenn du wieder Teil unserer Community bist! Sag uns kurz Bescheid:\n\n✅ **Ja, ich bleibe** – du bekommst erst wieder in {thresholdDays} Tagen eine Nachricht.\n❌ **Nein, bitte entfernen** – wir verabschieden dich freundlich vom Server.',
        color: '#9a8cff',
        authorName: '{server}',
        footerText: 'FALLEN HEAVEN',
        timestamp: true,
        fields: []
      }
    }
  },
  embeds: {
    selectedTemplateId: 'level-up',
    templates: defaultEmbedTemplates()
  }
});

const merge = (base, patch) => {
  if (!patch || typeof patch !== 'object') {
    return base;
  }
  const output = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (Array.isArray(base[key]) && Array.isArray(value)) {
      output[key] = [...value];
    } else if (
      base[key] && typeof base[key] === 'object' && !Array.isArray(base[key]) && value && typeof value === 'object'
    ) {
      output[key] = merge(base[key], value);
    } else if (value !== undefined) {
      output[key] = value;
    }
  }
  return output;
};

const VOTE_DESIGN_SECTIONS = ['panel', 'vote', 'result', 'team', 'dm', 'release', 'panel2', 'vote2', 'result2', 'team2', 'dm2', 'release2', 'panel3', 'vote3', 'result3', 'team3', 'dm3', 'release3', 'panel4', 'vote4', 'result4', 'team4', 'dm4', 'release4'];

const normalizeVoteDesignSection = (section, value = {}) => {
  const fallback = DEFAULT_PUBLIC_CALL_VOTE_DESIGNS[section] || {};
  const embed = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    title: String(embed.title !== undefined ? embed.title : fallback.title || '').slice(0, 256),
    url: String(embed.url || '').slice(0, 2048),
    description: String(embed.description !== undefined ? embed.description : fallback.description || '').slice(0, 4096),
    color: String(embed.color || fallback.color || '#2b2d31').slice(0, 16),
    authorName: String(embed.authorName !== undefined ? embed.authorName : fallback.authorName || '').slice(0, 256),
    authorIconUrl: String(embed.authorIconUrl || '').slice(0, 2048),
    thumbnailUrl: String(embed.thumbnailUrl || '').slice(0, 2048),
    imageUrl: String(embed.imageUrl || '').slice(0, 2048),
    footerText: String(embed.footerText !== undefined ? embed.footerText : fallback.footerText || '').slice(0, 2048),
    footerIconUrl: String(embed.footerIconUrl || '').slice(0, 2048),
    timestamp: embed.timestamp !== false
  };
};

const normalizeVoteDesigns = (value = {}) => {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(VOTE_DESIGN_SECTIONS.map((section) => [section, normalizeVoteDesignSection(section, source[section])]));
};

export function normalizeConfig(raw = {}) {
  const base = defaultGuildConfig(raw.guildId, raw.guildName);
  const normalizedInput = normalizeLegacyTopLevelModules(raw);
  const normalized = merge(base, normalizedInput);
  const rawServerTagTracker = raw.serverTagTracker && typeof raw.serverTagTracker === 'object' ? raw.serverTagTracker : {};
  const activeServerTagRoleIds = [...new Set(toList(
    Object.prototype.hasOwnProperty.call(rawServerTagTracker, 'roleIds')
      ? rawServerTagTracker.roleIds
      : rawServerTagTracker.roleId ? [rawServerTagTracker.roleId] : [],
    []
  ).map(String).map((roleId) => roleId.trim()).filter(Boolean))];
  return {
    ...normalized,
    general: {
      ...normalized.general,
      ownerUserIds: toIdList(normalized.general?.ownerUserIds, base.general.ownerUserIds),
      staffRoleIds: toIdList(normalized.general?.staffRoleIds, base.general.staffRoleIds)
    },
    moderation: {
      ...normalized.moderation,
      enabled: Boolean(normalized.moderation.enabled),
      mode: ['observe', 'warn', 'enforce'].includes(String(normalized.moderation.mode)) ? String(normalized.moderation.mode) : 'observe',
      autoDelete: Boolean(normalized.moderation.autoDelete),
      badWords: toList(normalized.moderation.badWords, base.moderation.badWords).slice(0, 500),
      highRiskTerms: toList(normalized.moderation.highRiskTerms, []).slice(0, 500),
      criticalTerms: toList(normalized.moderation.criticalTerms, []).slice(0, 500),
      antiSpamEnabled: Boolean(normalized.moderation.antiSpamEnabled),
      antiSpamThreshold: toBoundedInteger(normalized.moderation.antiSpamThreshold, base.moderation.antiSpamThreshold, 3, 50),
      antiSpamWindowSeconds: toBoundedInteger(normalized.moderation.antiSpamWindowSeconds, base.moderation.antiSpamWindowSeconds, 3, 120),
      mentionSpamThreshold: toBoundedInteger(normalized.moderation.mentionSpamThreshold, base.moderation.mentionSpamThreshold, 3, 50),
      incidentWindowSeconds: toBoundedInteger(normalized.moderation.incidentWindowSeconds, base.moderation.incidentWindowSeconds, 15, 900),
      warningWindowDays: toBoundedInteger(normalized.moderation.warningWindowDays, base.moderation.warningWindowDays, 1, 365),
      maxWarnings: toBoundedInteger(normalized.moderation.maxWarnings, base.moderation.maxWarnings, 1, 20),
      timeoutMinutes: toBoundedInteger(normalized.moderation.timeoutMinutes, base.moderation.timeoutMinutes, 1, 40_320),
      lightTimeoutMinutes: toBoundedInteger(normalized.moderation.lightTimeoutMinutes, normalized.moderation.timeoutMinutes || base.moderation.lightTimeoutMinutes, 1, 40_320),
      mediumTimeoutMinutes: toBoundedInteger(normalized.moderation.mediumTimeoutMinutes, base.moderation.mediumTimeoutMinutes, 1, 40_320),
      highTimeoutMinutes: toBoundedInteger(normalized.moderation.highTimeoutMinutes, base.moderation.highTimeoutMinutes, 1, 40_320),
      criticalTimeoutMinutes: toBoundedInteger(normalized.moderation.criticalTimeoutMinutes, base.moderation.criticalTimeoutMinutes, 1, 40_320),
      criticalImmediateTimeout: Boolean(normalized.moderation.criticalImmediateTimeout),
      muteRoleId: String(normalized.moderation.muteRoleId || '').trim(),
      exemptRoleIds: [...new Set(toList(normalized.moderation.exemptRoleIds, []).map(String).filter(Boolean))],
      ignoredChannelIds: [...new Set(toList(normalized.moderation.ignoredChannelIds, []).map(String).filter(Boolean))],
      logChannelId: String(normalized.moderation.logChannelId || '').trim(),
      warningDeleteSeconds: toBoundedInteger(normalized.moderation.warningDeleteSeconds, base.moderation.warningDeleteSeconds, 3, 300),
      retentionDays: toBoundedInteger(normalized.moderation.retentionDays, base.moderation.retentionDays, 7, 365)
    },
    welcomeFarewell: {
      ...normalized.welcomeFarewell,
      enabled: normalized.welcomeFarewell?.enabled !== false,
      welcomeEnabled: normalized.welcomeFarewell?.welcomeEnabled === true,
      welcomeAfterVerification: normalized.welcomeFarewell?.welcomeAfterVerification === true,
      verificationRoleId: String(normalized.welcomeFarewell?.verificationRoleId || '').trim(),
      postVerificationRolesEnabled: normalized.welcomeFarewell?.postVerificationRolesEnabled === true,
      postVerificationRoleIds: [...new Set(toList(normalized.welcomeFarewell?.postVerificationRoleIds, [])
        .map((entry) => String(entry?.id || entry || '').trim()).filter(Boolean))],
      welcomeChannelId: String(normalized.welcomeFarewell?.welcomeChannelId || '').trim(),
      farewellChannelId: String(normalized.welcomeFarewell?.farewellChannelId || '').trim(),
      autoRoleEnabled: normalized.welcomeFarewell?.autoRoleEnabled === true,
      autoRoleName: String(normalized.welcomeFarewell?.autoRoleName || '').trim()
    },
    autoresponder: {
      ...normalized.autoresponder,
      cooldownSeconds: toNumber(normalized.autoresponder.cooldownSeconds, base.autoresponder.cooldownSeconds),
      caseInsensitive: Boolean(normalized.autoresponder.caseInsensitive),
      mentionOnly: Boolean(normalized.autoresponder.mentionOnly),
      channelIds: [...new Set(toList(normalized.autoresponder.channelIds, []).map(String).filter(Boolean))],
      ignoredChannelIds: [...new Set(toList(normalized.autoresponder.ignoredChannelIds, []).map(String).filter(Boolean))],
      allowUserMention: normalized.autoresponder.allowUserMention === true,
      deleteCommand: Boolean(normalized.autoresponder.deleteCommand),
      rules: toList(normalized.autoresponder.rules, [])
        .map((rawRule) => {
          if (typeof rawRule === 'string') {
            try {
              return JSON.parse(rawRule);
            } catch {
              return null;
            }
          }
          return rawRule;
        })
        .map((rule) => {
          if (!rule || typeof rule !== 'object') {
            return null;
          }

          const trigger = String(rule.trigger || '').trim();
          const response = String(rule.response || '').trim();
          if (!trigger || !response) {
            return null;
          }
          const mode = ['exact', 'startsWith', 'word', 'contains'].includes(rule.mode) ? rule.mode : 'word';
          return { trigger, response, mode };
        })
        .filter(Boolean)
    },
    customRichPresence: {
      ...normalized.customRichPresence,
      enabled: normalized.customRichPresence?.enabled === true,
      applicationId: String(normalized.customRichPresence?.applicationId || base.customRichPresence.applicationId).trim(),
      details: String(normalized.customRichPresence?.details || base.customRichPresence.details).replaceAll('{voice}', '{online}'),
      state: String(normalized.customRichPresence?.state || base.customRichPresence.state).replaceAll('{voice}', '{online}'),
      countMode: 'presence-total',
      largeImageKey: String(normalized.customRichPresence?.largeImageKey || base.customRichPresence.largeImageKey).trim(),
      largeImageText: String(normalized.customRichPresence?.largeImageText || base.customRichPresence.largeImageText).replaceAll('{voice}', '{online}'),
      smallImageKey: String(normalized.customRichPresence?.smallImageKey || base.customRichPresence.smallImageKey).trim(),
      smallImageText: String(normalized.customRichPresence?.smallImageText || base.customRichPresence.smallImageText).replaceAll('{voice}', '{online}'),
      button1Label: String(normalized.customRichPresence?.button1Label || base.customRichPresence.button1Label).trim(),
      button1Url: String(normalized.customRichPresence?.button1Url || base.customRichPresence.button1Url).trim(),
      button2Label: String(normalized.customRichPresence?.button2Label || base.customRichPresence.button2Label).trim(),
      button2Url: String(normalized.customRichPresence?.button2Url || base.customRichPresence.button2Url).trim(),
      updateIntervalSeconds: Math.min(300, Math.max(15, toNumber(normalized.customRichPresence?.updateIntervalSeconds, base.customRichPresence.updateIntervalSeconds)))
    },
    levels: {
      ...normalized.levels,
      enabled: normalized.levels?.enabled !== false,
      xpPerMessageMin: toBoundedInteger(normalized.levels.xpPerMessageMin, base.levels.xpPerMessageMin, 1, 1000),
      xpPerMessageMax: Math.max(
        toBoundedInteger(normalized.levels.xpPerMessageMin, base.levels.xpPerMessageMin, 1, 1000),
        toBoundedInteger(normalized.levels.xpPerMessageMax, base.levels.xpPerMessageMax, 1, 1000)
      ),
      cooldownSeconds: toBoundedInteger(normalized.levels.cooldownSeconds, base.levels.cooldownSeconds, 5, 3600),
      minMessageLength: toBoundedInteger(normalized.levels.minMessageLength, base.levels.minMessageLength, 1, 500),
      maxXpPerDay: toBoundedInteger(normalized.levels.maxXpPerDay, base.levels.maxXpPerDay, 0, 100000),
      ignoredChannelIds: [...new Set(toList(normalized.levels.ignoredChannelIds, []).map(String).filter(Boolean))],
      excludedRoleIds: [...new Set(toList(normalized.levels.excludedRoleIds, []).map(String).filter(Boolean))],
      noXpRoleIds: [...new Set(toList(normalized.levels.noXpRoleIds, []).map(String).filter(Boolean))],
      levelRoleMappings: toList(normalized.levels.levelRoleMappings, []).map(String).map((entry) => entry.trim()).filter(Boolean),
      cumulativeRoleRewards: normalized.levels?.cumulativeRoleRewards === true,
      announce: normalized.levels?.announce !== false,
      announceChannelId: String(normalized.levels?.announceChannelId || '').trim(),
      commandChannelId: String(normalized.levels?.commandChannelId || '').trim(),
      levelUpMessage: String(normalized.levels?.levelUpMessage || base.levels.levelUpMessage),
      voiceXpPerMinute: toBoundedInteger(normalized.levels.voiceXpPerMinute, base.levels.voiceXpPerMinute, 0, 60),
      voiceMinimumParticipants: toBoundedInteger(normalized.levels.voiceMinimumParticipants, base.levels.voiceMinimumParticipants, 1, 20),
      excludeDeafenedVoice: normalized.levels?.excludeDeafenedVoice !== false,
      levelCurveBase: toBoundedInteger(normalized.levels.levelCurveBase, base.levels.levelCurveBase, 5, 100),
      activityBonusEnabled: normalized.levels?.activityBonusEnabled !== false,
      activityBonusPlace1: toBoundedInteger(normalized.levels.activityBonusPlace1, base.levels.activityBonusPlace1, 0, 1000),
      activityBonusPlace2: toBoundedInteger(normalized.levels.activityBonusPlace2, base.levels.activityBonusPlace2, 0, 1000),
      activityBonusPlace3: toBoundedInteger(normalized.levels.activityBonusPlace3, base.levels.activityBonusPlace3, 0, 1000),
      activityBonusMaxPerDay: toBoundedInteger(normalized.levels.activityBonusMaxPerDay, base.levels.activityBonusMaxPerDay, 0, 5000),
      tagBonusXpPerDay: toBoundedInteger(normalized.levels.tagBonusXpPerDay, base.levels.tagBonusXpPerDay, 0, 500),
      boostBonusEnabled: normalized.levels?.boostBonusEnabled !== false,
      boostBonusXpPerBoost: toBoundedInteger(normalized.levels.boostBonusXpPerBoost, base.levels.boostBonusXpPerBoost, 0, 100),
      boostBonusMaxPerDay: toBoundedInteger(normalized.levels.boostBonusMaxPerDay, base.levels.boostBonusMaxPerDay, 0, 500),
      levelRolesPanelChannelId: String(normalized.levels?.levelRolesPanelChannelId || '').trim(),
      levelUpInfoEnabled: normalized.levels?.levelUpInfoEnabled === true,
      levelUpInfoChannelId: String(normalized.levels?.levelUpInfoChannelId || '').trim(),
      levelUpCleanupEnabled: normalized.levels?.levelUpCleanupEnabled === true,
      levelUpCleanupMaxMessages: toBoundedInteger(normalized.levels.levelUpCleanupMaxMessages, base.levels.levelUpCleanupMaxMessages, 2, 200),
      panelDesign: normalizeLevelsPanelDesign(resolveLevelsPanelDesign(normalizedInput.levels, normalized.levels))
    },
    activityRace: {
      ...normalized.activityRace,
      enabled: normalized.activityRace?.enabled === true,
      panelChannelId: String(normalized.activityRace?.panelChannelId || '').trim(),
      panelDesign: normalizeActivityPanelDesign(normalized.activityRace?.panelDesign, base.activityRace.panelDesign),
      panelDesignWeekly: normalizeActivityPanelDesign(normalized.activityRace?.panelDesignWeekly ?? normalized.activityRace?.panelDesign, base.activityRace.panelDesign),
      panelDesignMonthly: normalizeActivityPanelDesign(normalized.activityRace?.panelDesignMonthly ?? normalized.activityRace?.panelDesign, base.activityRace.panelDesign),
      pingInfoDesign: normalizeActivityPingInfoDesign(normalized.activityRace?.pingInfoDesign, base.activityRace.pingInfoDesign),
      pingToggleButtonLabel: String(normalized.activityRace?.pingToggleButtonLabel ?? 'LIGA-PINGS EIN/AUS').slice(0, 80),
      ignoredChannelIds: [...new Set(toList(normalized.activityRace?.ignoredChannelIds, []).map(String).filter(Boolean))],
      excludedRoleIds: [...new Set(toList(normalized.activityRace?.excludedRoleIds, []).map(String).filter(Boolean))],
      messageCooldownSeconds: toBoundedInteger(normalized.activityRace?.messageCooldownSeconds, base.activityRace.messageCooldownSeconds, 0, 300),
      duplicateWindowMinutes: toBoundedInteger(normalized.activityRace?.duplicateWindowMinutes, base.activityRace.duplicateWindowMinutes, 0, 1440),
      minimumMessageLength: toBoundedInteger(normalized.activityRace?.minimumMessageLength, base.activityRace.minimumMessageLength, 1, 500),
      rankingDisplayCount: toBoundedInteger(normalized.activityRace?.rankingDisplayCount, base.activityRace.rankingDisplayCount, 3, 20),
      voiceMinimumParticipants: toBoundedInteger(normalized.activityRace?.voiceMinimumParticipants, base.activityRace.voiceMinimumParticipants, 2, 20),
      excludeDeafened: normalized.activityRace?.excludeDeafened !== false,
      placementPings: normalized.activityRace?.placementPings !== false,
      placementPingChannelId: String(normalized.activityRace?.placementPingChannelId || '').trim(),
      placementPingLifetimeMinutes: toBoundedInteger(normalized.activityRace?.placementPingLifetimeMinutes, base.activityRace.placementPingLifetimeMinutes, 1, 60),
      announceCompletedPeriods: normalized.activityRace?.announceCompletedPeriods !== false,
      announcementChannelId: String(normalized.activityRace?.announcementChannelId || '').trim(),
      separatorRoleName: normalizedActivityRoleName(normalized.activityRace?.separatorRoleName, base.activityRace.separatorRoleName),
      separatorRoleId: String(normalized.activityRace?.separatorRoleId || '').trim(),
      ...Object.fromEntries(activityLeagueRoleEntries.flatMap((entry) => [
        [entry.nameKey, normalizedActivityRoleName(normalized.activityRace?.[entry.nameKey], base.activityRace[entry.nameKey])],
        [entry.idKey, String(normalized.activityRace?.[entry.idKey] || '').trim()]
      ]))
    },
    autoRole: {
      ...normalized.autoRole,
      enabled: normalized.autoRole?.enabled === true,
      excludeBots: Boolean(normalized.autoRole.excludeBots),
      roleIds: [...new Set(toList(normalized.autoRole.roleIds, []).map(String).filter(Boolean))],
      assignmentDelaySeconds: toBoundedInteger(normalized.autoRole.assignmentDelaySeconds, base.autoRole.assignmentDelaySeconds, 0, 120),
      retryCount: toBoundedInteger(normalized.autoRole.retryCount, base.autoRole.retryCount, 1, 5),
      reconcileOnStartup: normalized.autoRole.reconcileOnStartup === true,
      maxStartupAssignments: toBoundedInteger(normalized.autoRole.maxStartupAssignments, base.autoRole.maxStartupAssignments, 1, 1000),
      logChannelId: String(normalized.autoRole.logChannelId || '').trim()
    },
    roleSwap: {
      ...normalized.roleSwap,
      enabled: normalized.roleSwap?.enabled === true,
      pairs: String(normalized.roleSwap?.pairs || '').trim(),
      logChannelId: String(normalized.roleSwap?.logChannelId || '').trim()
    },
    counting: {
      ...normalized.counting,
      enabled: normalized.counting?.enabled === true,
      channelId: String(normalized.counting?.channelId || '').trim(),
      resetValue: Math.max(0, Math.min(100000, toNumber(normalized.counting?.resetValue, base.counting.resetValue))),
      deleteWrongMessages: normalized.counting?.deleteWrongMessages !== false,
      preventSelfCount: normalized.counting?.preventSelfCount !== false,
      selfCountIsFail: normalized.counting?.selfCountIsFail !== false,
      excludedRoleIds: [...new Set(toList(normalized.counting?.excludedRoleIds, []).map(String).filter(Boolean))],
      maxCount: Math.max(10, Math.min(1000000000000, toNumber(normalized.counting?.maxCount, base.counting.maxCount))),
      milestones: [...new Set(toList(normalized.counting?.milestones, base.counting.milestones)
        .map((value) => Math.floor(Number(value)))
        .filter((value) => Number.isFinite(value) && value > 0))].sort((left, right) => left - right),
      milestoneMessage: String(normalized.counting?.milestoneMessage || '').trim().slice(0, 2000),
      successReaction: (String(normalized.counting?.successReaction || base.counting.successReaction).trim() || '✅').slice(0, 64),
      failReaction: (String(normalized.counting?.failReaction || base.counting.failReaction).trim() || '❌').slice(0, 64),
      statusChannelId: String(normalized.counting?.statusChannelId || '').trim(),
      statusPanelEnabled: normalized.counting?.statusPanelEnabled !== false,
      panelDesign: normalized.counting?.panelDesign || null,
      lossMessagesEnabled: normalized.counting?.lossMessagesEnabled !== false,
      lossMessages: toList(normalized.counting?.lossMessages, [])
        .map((line) => String(line || '').trim().slice(0, 500))
        .filter(Boolean),
      clearChannelOnFail: normalized.counting?.clearChannelOnFail !== false,
      clearChannelDelaySeconds: Math.max(0, Math.min(300, Math.floor(Number(normalized.counting?.clearChannelDelaySeconds) || 10))),
      clearChannelKeepMessages: Number.isFinite(Number(normalized.counting?.clearChannelKeepMessages))
        ? Math.max(0, Math.min(100, Math.floor(Number(normalized.counting?.clearChannelKeepMessages))))
        : 5,
      strikesEnabled: normalized.counting?.strikesEnabled !== false,
      strikesToLock: Math.max(1, Math.min(20, Math.floor(Number(normalized.counting?.strikesToLock) || 3))),
      strikeLockHours: Math.max(1, Math.min(720, Math.floor(Number(normalized.counting?.strikeLockHours) || 24))),
      strikeLockMessage: String(normalized.counting?.strikeLockMessage || '').trim().slice(0, 2000),
      strikeTolerance: Number.isFinite(Number(normalized.counting?.strikeTolerance))
        ? Math.max(0, Math.min(1000000, Math.floor(Number(normalized.counting?.strikeTolerance))))
        : 1,
      dmDesigns: (() => {
        const source = normalized.counting?.dmDesigns && typeof normalized.counting.dmDesigns === 'object' ? normalized.counting.dmDesigns : {};
        const fallback = base.counting.dmDesigns || {};
        return Object.fromEntries(['strikeLock', 'strikeRelease'].map((section) => {
          const input = source[section] && typeof source[section] === 'object' ? source[section] : {};
          const baseSection = fallback[section] || {};
          return [section, {
            title: String(input.title !== undefined ? input.title : baseSection.title).slice(0, 256),
            url: String(input.url || '').slice(0, 2048),
            description: String(input.description !== undefined ? input.description : baseSection.description).slice(0, 4096),
            color: String(input.color || baseSection.color || '').slice(0, 16),
            authorName: String(input.authorName !== undefined ? input.authorName : baseSection.authorName).slice(0, 256),
            authorIconUrl: String(input.authorIconUrl || '').slice(0, 2048),
            thumbnailUrl: String(input.thumbnailUrl || '').slice(0, 2048),
            imageUrl: String(input.imageUrl || '').slice(0, 2048),
            footerText: String(input.footerText !== undefined ? input.footerText : baseSection.footerText).slice(0, 2048),
            footerIconUrl: String(input.footerIconUrl || '').slice(0, 2048),
            timestamp: input.timestamp !== false
          }];
        }));
      })()
    },
    voiceChatCleaner: {
      ...normalized.voiceChatCleaner,
      enabled: normalized.voiceChatCleaner?.enabled === true,
      channelIds: toList(normalized.voiceChatCleaner?.channelIds, []).map(String).map((channelId) => channelId.trim()).filter(Boolean),
      emptyGraceSeconds: Math.min(3600, Math.max(10, toNumber(normalized.voiceChatCleaner?.emptyGraceSeconds, base.voiceChatCleaner.emptyGraceSeconds))),
      cleanupOnStartup: normalized.voiceChatCleaner?.cleanupOnStartup !== false,
      deletePinned: normalized.voiceChatCleaner?.deletePinned !== false,
      dryRun: normalized.voiceChatCleaner?.dryRun === true,
      logChannelId: String(normalized.voiceChatCleaner?.logChannelId || '').trim()
    },
    tempVoice: {
      ...normalized.tempVoice,
      enabled: normalized.tempVoice?.enabled === true,
      creatorChannelIds: toList(normalized.tempVoice?.creatorChannelIds, []).map(String).map((channelId) => channelId.trim()).filter(Boolean),
      categoryId: String(normalized.tempVoice?.categoryId || '').trim(),
      channelNameTemplate: String(normalized.tempVoice?.channelNameTemplate || base.tempVoice.channelNameTemplate).slice(0, 100),
      defaultUserLimit: Math.min(99, Math.max(0, toNumber(normalized.tempVoice?.defaultUserLimit, 0))),
      // kbps (max 384). Migration: ältere Configs mit bps (>= 8000) werden umgerechnet.
      defaultBitrate: (() => {
        const raw = toNumber(normalized.tempVoice?.defaultBitrate, 0);
        const bps = raw >= 8000 ? Math.round(raw / 1000) : raw;
        return Math.min(384, Math.max(0, Math.trunc(bps)));
      })(),
      defaultRegion: String(normalized.tempVoice?.defaultRegion || '').trim(),
      emptyGraceSeconds: Math.min(3600, Math.max(0, toNumber(normalized.tempVoice?.emptyGraceSeconds, base.tempVoice.emptyGraceSeconds))),
      blacklistRoleIds: toList(normalized.tempVoice?.blacklistRoleIds, []).map(String).filter(Boolean),
      requiredRoleIds: toList(normalized.tempVoice?.requiredRoleIds, []).map(String).filter(Boolean),
      permissionOverwrites: (Array.isArray(normalized.tempVoice?.permissionOverwrites) ? normalized.tempVoice.permissionOverwrites : [])
        .filter((entry) => entry && entry.id)
        .map((entry) => ({
          id: String(entry.id),
          type: Number(entry.type) === 1 ? 1 : 0,
          allow: String(entry.allow ?? '0'),
          deny: String(entry.deny ?? '0')
        })),
      allowRename: normalized.tempVoice?.allowRename !== false,
      allowLimit: normalized.tempVoice?.allowLimit !== false,
      allowLock: normalized.tempVoice?.allowLock !== false,
      allowRegion: normalized.tempVoice?.allowRegion !== false,
      allowThreads: normalized.tempVoice?.allowThreads !== false,
      allowTransfer: normalized.tempVoice?.allowTransfer !== false
    },
    publicCallVote: {
      ...normalized.publicCallVote,
      enabled: normalized.publicCallVote?.enabled === true,
      callChannelIds: toList(normalized.publicCallVote?.callChannelIds, []).map(String).map((channelId) => channelId.trim()).filter(Boolean),
      callChannelIds2: toList(normalized.publicCallVote?.callChannelIds2, []).map(String).map((channelId) => channelId.trim()).filter(Boolean),
      callChannelIds3: toList(normalized.publicCallVote?.callChannelIds3, []).map(String).map((channelId) => channelId.trim()).filter(Boolean),
      callChannelIds4: toList(normalized.publicCallVote?.callChannelIds4, []).map(String).map((channelId) => channelId.trim()).filter(Boolean),
      passPercent: Math.min(100, Math.max(10, toNumber(normalized.publicCallVote?.passPercent, base.publicCallVote.passPercent))),
      minVotes: Math.min(50, Math.max(1, toNumber(normalized.publicCallVote?.minVotes, base.publicCallVote.minVotes))),
      timeoutSeconds: Math.min(600, Math.max(15, toNumber(normalized.publicCallVote?.timeoutSeconds, base.publicCallVote.timeoutSeconds))),
      voteReasons: (Array.isArray(normalized.publicCallVote?.voteReasons) && normalized.publicCallVote.voteReasons.length
        ? normalized.publicCallVote.voteReasons
        : base.publicCallVote.voteReasons).map((reason) => ({
          id: String(reason?.id || '').trim() || 'other',
          label: String(reason?.label || 'Sonstiges').slice(0, 80),
          kickMinutes: Math.min(1440, Math.max(1, toNumber(reason?.kickMinutes, 10))),
          timeoutAfter: Math.min(20, Math.max(1, toNumber(reason?.timeoutAfter, 3))),
          timeoutMinutes: Math.min(10080, Math.max(1, toNumber(reason?.timeoutMinutes, 60))),
          needsText: reason?.needsText === true
        })),
      resultAutoDeleteSeconds: Math.min(600, Math.max(5, toNumber(normalized.publicCallVote?.resultAutoDeleteSeconds, base.publicCallVote.resultAutoDeleteSeconds))),
      teamChannelId: String(normalized.publicCallVote?.teamChannelId || '').trim(),
      teamRoleIds: toList(normalized.publicCallVote?.teamRoleIds, []).map(String).filter(Boolean),
      design: normalizeVoteDesigns(normalized.publicCallVote?.design)
    },
    serverTagTracker: {
      ...normalized.serverTagTracker,
      enabled: normalized.serverTagTracker?.enabled === true,
      monitorOnly: normalized.serverTagTracker?.monitorOnly !== false,
      roleIds: activeServerTagRoleIds,
      roleId: activeServerTagRoleIds[0] || '',
      scanIntervalMinutes: Math.min(1440, Math.max(5, toNumber(normalized.serverTagTracker?.scanIntervalMinutes, base.serverTagTracker.scanIntervalMinutes))),
      assignmentConfirmations: Math.min(5, Math.max(2, toNumber(normalized.serverTagTracker?.assignmentConfirmations, base.serverTagTracker.assignmentConfirmations))),
      removalConfirmations: Math.min(5, Math.max(2, toNumber(normalized.serverTagTracker?.removalConfirmations, base.serverTagTracker.removalConfirmations))),
      maxAssignmentsPerScan: Math.min(100, Math.max(1, toNumber(normalized.serverTagTracker?.maxAssignmentsPerScan, base.serverTagTracker.maxAssignmentsPerScan))),
      startupScan: normalized.serverTagTracker?.startupScan !== false,
      excludeBots: normalized.serverTagTracker?.excludeBots !== false,
      excludedRoleIds: toList(normalized.serverTagTracker?.excludedRoleIds, []),
      logChannelId: String(normalized.serverTagTracker?.logChannelId || '').trim()
    },
    boostRoles: {
      ...normalized.boostRoles,
      enabled: normalized.boostRoles?.enabled === true,
      automaticRoleIds: toList(normalized.boostRoles?.automaticRoleIds, []),
      tierRoleMappings: toList(normalized.boostRoles?.tierRoleMappings, []),
      cumulativeRoles: normalized.boostRoles?.cumulativeRoles === true,
      removableColorRoleIds: toList(normalized.boostRoles?.removableColorRoleIds, []),
      removableColorRolePrefix: String(normalized.boostRoles?.removableColorRolePrefix || 'boost'),
      fullHistoryScan: normalized.boostRoles?.fullHistoryScan !== false,
      historyScanLimit: Math.min(50000, Math.max(100, toNumber(normalized.boostRoles?.historyScanLimit, 2000))),
      boostInfoChannelId: String(normalized.boostRoles?.boostInfoChannelId || '').trim(),
      boostEndLogChannelId: String(normalized.boostRoles?.boostEndLogChannelId || '').trim(),
      logChannelId: String(normalized.boostRoles?.logChannelId || ''),
      boostTopEnabled: normalized.boostRoles?.boostTopEnabled === true,
      boostTopChannelId: String(normalized.boostRoles?.boostTopChannelId || '').trim(),
      boostTopPingsEnabled: normalized.boostRoles?.boostTopPingsEnabled !== false,
      boostTopPingChannelId: String(normalized.boostRoles?.boostTopPingChannelId || '').trim(),
      boostTopPingLifetimeMinutes: Math.min(60, Math.max(1, toNumber(normalized.boostRoles?.boostTopPingLifetimeMinutes, 5)))
    },
    heavenEconomy: {
      ...normalized.heavenEconomy,
      enabled: normalized.heavenEconomy?.enabled === true,
      panelChannelId: String(normalized.heavenEconomy?.panelChannelId || ''),
      panelMessageId: String(normalized.heavenEconomy?.panelMessageId || ''),
      coinEmoji: String(normalized.heavenEconomy?.coinEmoji || '🪙').slice(0, 100),
      boostMilestoneReward: Math.min(10000, Math.max(1, toNumber(normalized.heavenEconomy?.boostMilestoneReward, 100))),
      vipRoleMappings: toList(normalized.heavenEconomy?.vipRoleMappings, []),
      vipPanelEnabled: normalized.heavenEconomy?.vipPanelEnabled === true,
      vipPanelChannelId: String(normalized.heavenEconomy?.vipPanelChannelId || '').trim(),
      paypalUrl: String(normalized.heavenEconomy?.paypalUrl || ''),
      paysafecardUrl: String(normalized.heavenEconomy?.paysafecardUrl || ''),
      supportChannelId: String(normalized.heavenEconomy?.supportChannelId || ''),
      logChannelId: String(normalized.heavenEconomy?.logChannelId || '')
    },
    serverContext: {
      ...normalized.serverContext,
      enabled: normalized.serverContext?.enabled !== false,
      retentionDays: Math.min(30, Math.max(1, toNumber(normalized.serverContext?.retentionDays, 30))),
      maxStorageGb: Math.min(50, Math.max(1, toNumber(normalized.serverContext?.maxStorageGb, 50))),
      maxContextEntries: Math.min(200, Math.max(10, toNumber(normalized.serverContext?.maxContextEntries, 80))),
      channelIds: toList(normalized.serverContext?.channelIds, []),
      excludedChannelIds: toList(normalized.serverContext?.excludedChannelIds, []),
      storeAttachmentLinks: normalized.serverContext?.storeAttachmentLinks !== false
    },
    antiraid: {
      ...normalized.antiraid,
      enabled: normalized.antiraid?.enabled === true,
      joinThreshold: toBoundedInteger(normalized.antiraid.joinThreshold, base.antiraid.joinThreshold, 3, 100),
      joinWindowSeconds: toBoundedInteger(normalized.antiraid.joinWindowSeconds, base.antiraid.joinWindowSeconds, 5, 600),
      shieldMinutes: toBoundedInteger(normalized.antiraid.shieldMinutes, base.antiraid.shieldMinutes, 1, 180),
      action: ['observe', 'quarantine', 'timeout'].includes(String(normalized.antiraid.action)) ? String(normalized.antiraid.action) : 'observe',
      actionDurationMinutes: toBoundedInteger(normalized.antiraid.actionDurationMinutes, base.antiraid.actionDurationMinutes, 1, 40_320),
      quarantineRoleId: String(normalized.antiraid.quarantineRoleId || '').trim(),
      onlyRecentAccounts: normalized.antiraid.onlyRecentAccounts === true,
      recentAccountDays: toBoundedInteger(normalized.antiraid.recentAccountDays, base.antiraid.recentAccountDays, 0, 3650),
      whitelistRoleIds: [...new Set(toList(normalized.antiraid.whitelistRoleIds, []).map(String).filter(Boolean))],
      trustedUserIds: [...new Set(toList(normalized.antiraid.trustedUserIds, []).map(String).filter(Boolean))],
      logChannelId: String(normalized.antiraid.logChannelId || '').trim()
    },
    tickets: {
      ...normalized.tickets,
      enabled: normalized.tickets?.enabled === true,
      panelChannelId: String(normalized.tickets?.panelChannelId || '').trim(),
      panelTitle: String(normalized.tickets?.panelTitle || '').trim().slice(0, 256) || base.tickets.panelTitle,
      panelDescription: String(normalized.tickets?.panelDescription || '').trim().slice(0, 4000) || base.tickets.panelDescription,
      panelButtonLabel: String(normalized.tickets?.panelButtonLabel || '').trim().slice(0, 80) || base.tickets.panelButtonLabel,
      panelButtonEmoji: String(normalized.tickets?.panelButtonEmoji || base.tickets.panelButtonEmoji).trim(),
      supportRoleId: String(normalized.tickets?.supportRoleId || '').trim(),
      categoryId: String(normalized.tickets?.categoryId || '').trim(),
      useThreadMode: normalized.tickets?.useThreadMode === true,
      threadParentChannelId: String(normalized.tickets?.threadParentChannelId || '').trim(),
      oneOpenPerUser: normalized.tickets?.oneOpenPerUser !== false,
      closeArchive: normalized.tickets?.closeArchive !== false,
      closeMessage: String(normalized.tickets?.closeMessage || base.tickets.closeMessage).slice(0, 1000),
      logChannelId: String(normalized.tickets?.logChannelId || '').trim()
    },
    logging: {
      ...normalized.logging,
      enabled: normalized.logging?.enabled === true,
      channelId: String(normalized.logging?.channelId || '').trim(),
      logMessages: normalized.logging?.logMessages !== false,
      includeMessageContent: normalized.logging?.includeMessageContent === true,
      logMembers: normalized.logging?.logMembers !== false,
      logRoles: normalized.logging?.logRoles !== false,
      logChannels: normalized.logging?.logChannels !== false,
      logVoice: normalized.logging?.logVoice === true,
      logModeration: normalized.logging?.logModeration !== false,
      ignoredChannelIds: [...new Set(toList(normalized.logging?.ignoredChannelIds, []).map(String).filter(Boolean))]
    },
    forumCleaner: {
      ...normalized.forumCleaner,
      enabled: normalized.forumCleaner?.enabled === true,
      channelIds: [...new Set(toList(normalized.forumCleaner?.channelIds, []))],
      graceMinutes: Math.min(1440, Math.max(1, toNumber(normalized.forumCleaner?.graceMinutes, base.forumCleaner.graceMinutes))),
      scanIntervalMinutes: Math.min(1440, Math.max(60, toNumber(normalized.forumCleaner?.scanIntervalMinutes, base.forumCleaner.scanIntervalMinutes))),
      scanOnStartup: normalized.forumCleaner?.scanOnStartup !== false,
      includeArchived: normalized.forumCleaner?.includeArchived !== false,
      ignorePinned: normalized.forumCleaner?.ignorePinned !== false,
      ignoreLocked: normalized.forumCleaner?.ignoreLocked !== false,
      requireNoReplies: normalized.forumCleaner?.requireNoReplies !== false,
      titleOnlyIsEmpty: normalized.forumCleaner?.titleOnlyIsEmpty !== false,
      deleteMissingStarter: normalized.forumCleaner?.deleteMissingStarter !== false,
      deleteLeftAuthorPosts: normalized.forumCleaner?.deleteLeftAuthorPosts === true,
      protectPinnedFromDepartedAuthors: normalized.forumCleaner?.protectPinnedFromDepartedAuthors === true,
      protectLockedFromDepartedAuthors: normalized.forumCleaner?.protectLockedFromDepartedAuthors === true,
      leftAuthorGraceDays: Math.min(3650, Math.max(0, toNumber(normalized.forumCleaner?.leftAuthorGraceDays, base.forumCleaner.leftAuthorGraceDays))),
      dryRun: normalized.forumCleaner?.dryRun === true,
      logChannelId: String(normalized.forumCleaner?.logChannelId || '')
    },
    steamWorkshop: {
      ...normalized.steamWorkshop,
      enabled: normalized.steamWorkshop?.enabled === true,
      forumChannelId: String(normalized.steamWorkshop?.forumChannelId || '').trim(),
      updateChannelId: String(normalized.steamWorkshop?.updateChannelId || '').trim(),
      workshopIds: [...new Set(toList(normalized.steamWorkshop?.workshopIds, []).map((entry) => String(entry || '').trim()).filter((entry) => /^\d{6,20}$/.test(entry)))].slice(0, 250),
      syncIntervalMinutes: Math.min(1440, Math.max(15, toNumber(normalized.steamWorkshop?.syncIntervalMinutes, base.steamWorkshop.syncIntervalMinutes))),
      syncOnStartup: normalized.steamWorkshop?.syncOnStartup !== false,
      notifyOnUpdate: normalized.steamWorkshop?.notifyOnUpdate === true,
      mentionRoleId: String(normalized.steamWorkshop?.mentionRoleId || '').trim(),
      appliedTagNames: [...new Set(toList(normalized.steamWorkshop?.appliedTagNames, []).map((entry) => String(entry || '').trim()).filter(Boolean))].slice(0, 5),
      pinPosts: normalized.steamWorkshop?.pinPosts === true,
      buttonLabel: String(normalized.steamWorkshop?.buttonLabel || base.steamWorkshop.buttonLabel).trim().slice(0, 80) || base.steamWorkshop.buttonLabel,
      maxDescriptionLength: Math.min(1800, Math.max(300, toNumber(normalized.steamWorkshop?.maxDescriptionLength, base.steamWorkshop.maxDescriptionLength))),
      preferSteamPreviewImage: normalized.steamWorkshop?.preferSteamPreviewImage !== false,
      showRating: normalized.steamWorkshop?.showRating !== false,
      design: normalized.steamWorkshop?.design && typeof normalized.steamWorkshop.design === 'object'
        ? normalized.steamWorkshop.design
        : base.steamWorkshop.design
    },
    emojiManager: {
      ...normalized.emojiManager,
      enabled: normalized.emojiManager?.enabled !== false,
      oldPrefix: String(normalized.emojiManager?.oldPrefix || base.emojiManager.oldPrefix).trim(),
      newPrefix: String(normalized.emojiManager?.newPrefix || base.emojiManager.newPrefix).trim(),
      includeStatic: normalized.emojiManager?.includeStatic !== false,
      includeAnimated: normalized.emojiManager?.includeAnimated !== false
    },
    serverBackup: {
      ...normalized.serverBackup,
      enabled: normalized.serverBackup?.enabled !== false,
      dailyHour: Math.min(23, Math.max(0, toNumber(normalized.serverBackup?.dailyHour, base.serverBackup.dailyHour))),
      keepBackups: Math.min(365, Math.max(3, toNumber(normalized.serverBackup?.keepBackups, base.serverBackup.keepBackups))),
      startupSafetyBackup: normalized.serverBackup?.startupSafetyBackup !== false,
      includeGuildAssets: normalized.serverBackup?.includeGuildAssets !== false,
      includeEmojis: normalized.serverBackup?.includeEmojis !== false,
      includeStickers: normalized.serverBackup?.includeStickers !== false,
      includeScheduledEvents: normalized.serverBackup?.includeScheduledEvents !== false,
      restoreServerSettings: normalized.serverBackup?.restoreServerSettings !== false,
      restoreRoles: normalized.serverBackup?.restoreRoles !== false,
      restoreChannels: normalized.serverBackup?.restoreChannels !== false,
      restoreEmojis: normalized.serverBackup?.restoreEmojis === true,
      restoreStickers: normalized.serverBackup?.restoreStickers === true,
      logChannelId: String(normalized.serverBackup?.logChannelId || '')
    },
    memberManagement: {
      ...normalized.memberManagement,
      pageSize: Math.min(15, Math.max(10, toNumber(normalized.memberManagement.pageSize, base.memberManagement.pageSize))),
      hideBots: Boolean(normalized.memberManagement.hideBots),
      activityBackfillEnabled: normalized.memberManagement.activityBackfillEnabled !== false,
      activityBackfillDays: Math.min(3650, Math.max(1, toNumber(normalized.memberManagement.activityBackfillDays, 365))),
      indexRefreshMinutes: Math.min(60, Math.max(1, toNumber(normalized.memberManagement.indexRefreshMinutes, 10))),
      adminRoleIds: toList(normalized.memberManagement.adminRoleIds, []),
      moderatorRoleIds: toList(normalized.memberManagement.moderatorRoleIds, []),
      logChannelId: String(normalized.memberManagement.logChannelId || '')
    },
    botUpdates: {
      ...normalized.botUpdates,
      enabled: normalized.botUpdates?.enabled === true,
      channelId: String(normalized.botUpdates?.channelId || '').trim(),
      design: normalizeBotUpdatesDesign(normalized.botUpdates?.design)
    },
    roleSaver: {
      enabled: normalized.roleSaver?.enabled === true,
      blacklistedRoleIds: toIdList(normalized.roleSaver?.blacklistedRoleIds, []),
      excludeBots: normalized.roleSaver?.excludeBots !== false,
      skipManagedRoles: normalized.roleSaver?.skipManagedRoles !== false,
      restoreDelaySeconds: Math.min(120, Math.max(1, toNumber(normalized.roleSaver?.restoreDelaySeconds, 8))),
      retryCount: Math.min(5, Math.max(1, toNumber(normalized.roleSaver?.retryCount, 3))),
      maxStoredRoles: Math.min(100, Math.max(5, toNumber(normalized.roleSaver?.maxStoredRoles, 40))),
      logChannelId: String(normalized.roleSaver?.logChannelId || '').trim()
    },
    inactiveReminder: {
      enabled: normalized.inactiveReminder?.enabled === true,
      thresholdDays: Math.min(3650, Math.max(7, toNumber(normalized.inactiveReminder?.thresholdDays, 180))),
      excludedRoleIds: toIdList(normalized.inactiveReminder?.excludedRoleIds, []),
      dmDesign: normalizeInactiveReminderDesign(normalized.inactiveReminder?.dmDesign, base.inactiveReminder?.dmDesign)
    },
    voiceLogImport: {
      enabled: normalized.voiceLogImport?.enabled === true,
      channelId: String(normalized.voiceLogImport?.channelId || '').trim(),
      backfillHours: Math.min(17520, Math.max(1, toNumber(normalized.voiceLogImport?.backfillHours, 4320))),
      batchSize: Math.min(200, Math.max(20, toNumber(normalized.voiceLogImport?.batchSize, 100))),
      maxPages: Math.min(1000, Math.max(1, toNumber(normalized.voiceLogImport?.maxPages, 100)))
    },
    embeds: normalizeEmbeds(normalized.embeds, base.embeds)
  };
}






