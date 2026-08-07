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
    id: 'aiChat',
    title: 'AI Chat',
    description: 'Lokaler Ollama-Chat mit Memory',
    detail: 'Verbindet Discord mit deinem lokalen Ollama-Modell. Der Bot antwortet nur im gewählten Kanal, startet per /start ai-chat und speichert lokale Erinnerungen pro Person mit einem 50-GB-Softlimit.',
    icon: '🧠',
    fields: [
      { key: 'aiChat.enabled', label: 'Modul aktiv', type: 'checkbox', info: 'Schaltet den lokalen AI Chat ein oder aus. Ohne aktives Modul reagiert der Bot nie auf AI-Nachrichten.' },
      { key: 'aiChat.channelId', label: 'AI Chat Kanal', type: 'channelSelect', placeholder: 'Kanal auswählen...', info: 'Nur in diesem Kanal darf die AI schreiben. Danach dort /start ai-chat ausführen.' },
      { key: 'aiChat.model', label: 'Ollama Modell', type: 'text', placeholder: 'qwen2.5:7b', info: 'Name des lokal installierten Ollama-Modells. Für dich ist qwen2.5:7b als Standard optimiert.' },
      { key: 'aiChat.ollamaUrl', label: 'Ollama URL', type: 'text', placeholder: 'http://127.0.0.1:11434', info: 'Lokale Ollama-API. Standard ist http://127.0.0.1:11434.' },
      { key: 'aiChat.requireStart', label: '/start ai-chat erforderlich', type: 'checkbox', info: 'Wenn aktiv, startet der Bot erst nach /start ai-chat im eingestellten Kanal. Das verhindert versehentliches Antworten.' },
      { key: 'aiChat.memoryEnabled', label: 'Lokale Erinnerung aktiv', type: 'checkbox', info: 'Speichert Gesprächsnotizen, Fakten und Verlauf lokal auf deinem PC, damit der Bot Personen wiedererkennt.' },
      { key: 'aiChat.rememberUserFacts', label: 'Einzelne User merken', type: 'checkbox', info: 'Speichert Fakten getrennt pro Discord-User. Jeder User bekommt eine eigene Datei, keine große Mischdatei.' },
      { key: 'aiChat.autoCleanChannel', label: 'AI-Kanal automatisch leeren', type: 'checkbox', info: 'Entfernt nach längerer Inaktivität nur die sichtbaren Discord-Nachrichten. Lokale AI-Erinnerungen und der Serverindex bleiben erhalten.' },
      { key: 'aiChat.channelIdleMinutes', label: 'Leeren nach Inaktivität (Minuten)', type: 'number', min: 15, max: 10080, step: 15, info: 'Standard sind 60 Minuten. Der Bot wartet immer bis die Unterhaltung wirklich inaktiv ist und löscht niemals mitten im Gespräch.' },
      { key: 'aiChat.keepPinnedMessages', label: 'Angepinnte Nachrichten behalten', type: 'checkbox', info: 'Angepinnte Regeln, Hinweise oder Startinformationen werden beim automatischen Aufräumen nicht gelöscht.' },
      { key: 'aiChat.welcomeEmbedEnabled', label: 'Info-Embed im Kanal', type: 'checkbox', info: 'Zeigt im AI-Chat-Kanal eine erste Nachricht, die erklärt, was man die AI fragen kann. Design, Text und Farbe bearbeitest du wie bei anderen Vorlagen im Embed Studio. Dieses Embed wird beim automatischen Aufräumen niemals gelöscht und bei Bedarf neu erstellt.' },
      { key: 'aiChat.memoryScope', label: 'Memory Modus', type: 'select', options: [
        { value: 'user-channel', label: 'User + Kanal' },
        { value: 'user', label: 'Nur User' },
        { value: 'channel', label: 'Nur Kanal' },
        { value: 'none', label: 'Kein Verlauf' }
      ], info: 'User + Kanal ist am intelligentesten: Persönliche Erinnerung bleibt pro Person getrennt, der aktuelle Kanal-Kontext bleibt trotzdem verständlich.' },
      { key: 'aiChat.replyMode', label: 'Antwortmodus', type: 'select', options: [
        { value: 'channel', label: 'Alle Nachrichten im AI-Kanal' },
        { value: 'mention', label: 'Nur bei Ping' },
        { value: 'reply', label: 'Nur bei Antwort auf Bot' },
        { value: 'mention-reply', label: 'Ping oder Antwort' }
      ], info: 'Alle Nachrichten braucht in Discord das Message Content Intent. Wenn das nicht aktiv ist, nutze Ping oder Antwort auf Bot.' },
      { key: 'aiChat.memoryLimitGb', label: 'Speicherlimit GB', type: 'number', min: 1, step: 1, info: 'Softlimit für lokale AI-Daten. Bei 50 GB darf der Bot bis zu 50 GB nutzen und räumt danach alte Archive auf.' },
      { key: 'aiChat.maxHistoryMessages', label: 'Kontext Nachrichten', type: 'number', min: 6, step: 1, info: 'Wie viele letzte Nachrichten an Ollama mitgegeben werden. Mehr Kontext ist klüger, aber langsamer.' },
      { key: 'aiChat.maxUserFacts', label: 'Fakten pro User', type: 'number', min: 10, step: 5, info: 'Wie viele feste Erinnerungen pro Person maximal gespeichert werden.' },
      { key: 'aiChat.temperature', label: 'Kreativität', type: 'number', min: 0, step: 0.1, info: '0 ist sehr nüchtern, 0.7 ist natürlich, 1.2+ ist kreativer und chaotischer.' },
      { key: 'aiChat.contextTokens', label: 'Kontext-Tokens', type: 'number', min: 8192, max: 32768, step: 1024, info: 'Mindestens 8.192 Tokens reservieren genug Platz für App-Daten, Gesprächskontext und eine vollständige Antwort. Größere Werte benötigen mehr RAM/VRAM.' },
      { key: 'aiChat.maxResponseChars', label: 'Maximale Antwortzeichen', type: 'number', min: 400, max: 2000, step: 100, info: 'Discord erlaubt 2.000 Zeichen pro Nachricht. Die AI darf diesen Rahmen nutzen, plant ihre Antwort aber so, dass sie vollständig und nicht mitten im Satz endet.' },
      { key: 'aiChat.strictSafetyEnabled', label: 'Strikte Sicherheitsgrenzen', type: 'checkbox', info: 'AI darf keine Rollen, Rechte, Bans, Kicks, Mutes oder Admin-Aktionen ausführen oder versprechen.' },
      { key: 'aiChat.promptInjectionProtection', label: 'Jailbreak-Schutz', type: 'checkbox', info: 'Blockiert Versuche, Systemregeln zu ignorieren, Prompts offenzulegen oder die AI in einen ungeschützten Modus zu zwingen.' },
      { key: 'aiChat.protectPrivateData', label: 'Private Daten schützen', type: 'checkbox', info: 'Verhindert die Ausgabe von Tokens, API-Schlüsseln, Konfigurationen, internen Pfaden und Erinnerungen anderer Nutzer.' },
      { key: 'aiChat.blockInsults', label: 'Beleidigungen blocken', type: 'checkbox', info: 'AI spielt bei Beleidigungen nicht mit und setzt kurz Grenzen.' },
      { key: 'aiChat.blockPrivilegedActions', label: 'Admin-Aktionen blocken', type: 'checkbox', info: 'Fragen nach Rollen, Rechten, Bans, Kicks oder Mutes werden direkt abgelehnt.' },
      { key: 'aiChat.onlyMeaningfulQuestions', label: 'Nur sinnvolle Fragen beantworten', type: 'checkbox', info: 'AI reagiert nur auf echte Fragen, Bitten, Ping oder Antworten auf den Bot. Normales Chat-Rauschen wird ignoriert.' },
      { key: 'aiChat.floodProtectionEnabled', label: 'Anti-Flood Schutz', type: 'checkbox', info: 'Schützt die lokale AI vor Spam, Massenanfragen und mehrfachen gleichen Nachrichten.' },
      { key: 'aiChat.userCooldownSeconds', label: 'User Cooldown Sekunden', type: 'number', min: 0, max: 120, info: 'Wie lange ein einzelner User warten muss, bevor er erneut eine AI-Antwort auslösen kann.' },
      { key: 'aiChat.channelCooldownSeconds', label: 'Kanal Cooldown Sekunden', type: 'number', min: 0, max: 60, info: 'Mindestabstand zwischen zwei AI-Antworten im selben Kanal.' },
      { key: 'aiChat.maxUserMessagesPerMinute', label: 'Max User-Anfragen pro Minute', type: 'number', min: 1, max: 60, info: 'Harte Grenze gegen einzelne User, die die AI überfluten.' },
      { key: 'aiChat.maxChannelMessagesPerMinute', label: 'Max Kanal-Anfragen pro Minute', type: 'number', min: 1, max: 180, info: 'Harte Grenze gegen Kanal-Spam und Raid-artige AI-Anfragen.' },
      { key: 'aiChat.duplicateWindowSeconds', label: 'Duplicate Schutz Sekunden', type: 'number', min: 5, max: 300, info: 'Gleiche Nachricht vom selben User wird in diesem Zeitraum ignoriert.' },
      { key: 'aiChat.webSearchEnabled', label: 'Websuche aktiv', type: 'checkbox', info: 'Erlaubt der AI Web-Kurzsuche nur bei klarer Anfrage nach aktuellen Infos, Quellen oder Internet-Suche.' },
      { key: 'aiChat.webSearchMode', label: 'Websuche-Intelligenz', type: 'select', options: [
          { value: 'smart', label: 'Smart: Faktenfragen' },
          { value: 'all-facts', label: 'Alle Faktenfragen' },
          { value: 'off', label: 'Nur lokal' }
        ], info: 'Smart sucht bei Faktenfragen und zwingend bei aktuellen Themen. Begrüßungen, Smalltalk, Witze, Rechnen und kreative Aufgaben bleiben lokal und schnell.' },
      { key: 'aiChat.webSearchCooldownSeconds', label: 'Websuche Cooldown Sekunden', type: 'number', min: 5, max: 300, info: 'Schützt vor zu vielen Websuchen pro User.' },
      { key: 'aiChat.webSearchMaxResults', label: 'Web-Treffer', type: 'number', min: 3, max: 10, info: 'Wie viele echte Suchtreffer als Belege geprüft werden. Fünf ist schnell und zuverlässig.' },
      { key: 'aiChat.webFetchPages', label: 'Quellen vollständig lesen', type: 'number', min: 0, max: 3, info: 'Liest parallel bis zu drei Treffer genauer. Zwei bietet einen guten Mix aus Qualität und Geschwindigkeit.' },
      { key: 'aiChat.webSearchTimeoutSeconds', label: 'Websuche Timeout', type: 'number', min: 5, max: 30, info: 'Bricht eine hängende Recherche kontrolliert ab, statt den gesamten AI-Chat zu blockieren.' },
      { key: 'aiChat.showWebSources', label: 'Quellen unter Antwort', type: 'checkbox', info: 'Hängt nur tatsächlich verwendete Links unter recherchierte Antworten. Smalltalk bleibt ohne Quellenzeile.' },
      { key: 'aiChat.serverKnowledgeEnabled', label: 'Live-Serverwissen', type: 'checkbox', info: 'Beantwortet Fragen zu Mitgliedern, Beitritten, Boosts, Rollen, Events und Orientierung direkt aus Discord statt aus Modellwissen oder Websuche.' },
      { key: 'aiChat.serverKnowledgeCacheSeconds', label: 'Serverdaten Cache Sekunden', type: 'number', min: 15, max: 300, info: 'Hält Live-Serverdaten kurz im schnellen Cache. 45 Sekunden sind aktuell genug und schützen Discord vor unnötigen Vollabfragen.' },
      { key: 'aiChat.useServerEmojis', label: 'Server-Emojis nutzen', type: 'checkbox', info: 'Erlaubt der AI, passende Custom-Emojis vom Server sparsam in Antworten zu benutzen.' },
      { key: 'aiChat.emojiUsage', label: 'Emoji-Stil', type: 'select', options: [
        { value: 'off', label: 'Aus' },
        { value: 'subtle', label: 'Sparsam' },
        { value: 'rich', label: 'Mehr Atmosphäre' }
      ], info: 'Sparsam nutzt höchstens ein passendes Server-Emoji. Mehr Atmosphäre erlaubt häufiger animierte Server-Emojis.' },
      { key: 'aiChat.useGifReplies', label: 'GIF-Reaktionen nutzen', type: 'checkbox', info: 'Erlaubt passende GIF-Reaktionen aus deiner geprüften Bibliothek, optional über einen offiziellen Tenor-Zugang aus der Bot-Umgebung und über den gepflegten sicheren Fallback.' },
      { key: 'aiChat.gifUsage', label: 'GIF-Modus', type: 'select', options: [
        { value: 'off', label: 'Aus' },
        { value: 'on-request', label: 'Nur auf Wunsch' },
        { value: 'mood', label: 'Wenn es passt' }
      ], info: 'Nur auf Wunsch sendet GIFs nur, wenn User nach GIF/Meme/Reaktion fragen. Wenn es passt reagiert auch auf klare Stimmung.' },
      { key: 'aiChat.gifProvider', label: 'GIF-Anbieter', type: 'select', options: [
        { value: 'hybrid', label: 'Bibliothek zuerst (empfohlen)' },
        { value: 'tenor', label: 'Tenor über Umgebungsvariable + Fallback' },
        { value: 'library', label: 'Nur eigene Bibliothek' }
      ], info: 'Empfohlen ist die eigene geprüfte Bibliothek als erste Quelle. Ein bestehender offizieller Tenor-Key wird ausschließlich sicher über TENOR_API_KEY aus der Bot-Umgebung gelesen, niemals aus der Serverkonfiguration. Danach greift der gepflegte, jugendfreie nekos.best-Fallback. HTML-Scraping ist vollständig deaktiviert.' },
      { key: 'aiChat.tenorContentFilter', label: 'Tenor Inhaltsfilter', type: 'select', options: [
        { value: 'high', label: 'Sehr sicher' },
        { value: 'medium', label: 'Moderat' },
        { value: 'low', label: 'Locker' }
      ], info: 'Steuert den Inhaltsfilter für unterstützte externe GIF-Quellen. Sehr sicher ist für einen Community-Server empfohlen und wählt beim Fallback besonders zurückhaltende Reaktionskategorien.' },
      { key: 'aiChat.tenorLocale', label: 'Tenor Sprache', type: 'select', options: [
        { value: 'de_DE', label: 'Deutsch' },
        { value: 'en_US', label: 'Englisch' }
      ], info: 'Bestimmt Sprache und regionale Sortierung bei unterstützten externen GIF-Quellen.' },
      { key: 'aiChat.gifChancePercent', label: 'GIF-Chance in Prozent', type: 'number', min: 0, max: 100, info: 'Wie oft die AI bei passender Stimmung wirklich ein GIF ergänzt. Auf ausdrücklichen Wunsch wird immer gesucht.' },
      { key: 'aiChat.gifLibrary', label: 'Freigegebene GIF-Bibliothek', type: 'arrayLines', placeholder: 'https://cdn.example.org/reaction.gif', info: 'Bevorzugte, von dir geprüfte direkte HTTPS-GIF-URLs. Unsichere, lokale, doppelte oder nicht direkt auf .gif/.gifv endende Adressen werden verworfen.' },
      { key: 'aiChat.sendTyping', label: 'Typing anzeigen', type: 'checkbox', info: 'Zeigt im Discord-Kanal an, dass die AI gerade schreibt.' },
      { key: 'aiChat.personaName', label: 'AI Name', type: 'text', placeholder: 'Fallen Heaven AI', info: 'Name/Identität, in der die AI denkt und antwortet.' },
      { key: 'aiChat.personality', label: 'Persönlichkeit', type: 'textarea', rows: 4, info: 'Charakter der AI: z. B. ruhig, loyal, witzig, düster, professionell, mentorhaft.' },
      { key: 'aiChat.speakingStyle', label: 'Sprachstil', type: 'textarea', rows: 4, info: 'Wie die AI schreibt: kurz, episch, locker, sachlich, Gamer-Slang, High-Class-Support usw.' },
      { key: 'aiChat.responseLength', label: 'Antwortlänge', type: 'select', options: [
        { value: 'kurz', label: 'Kurz' },
        { value: 'normal', label: 'Normal' },
        { value: 'detail', label: 'Detailliert' },
        { value: 'story', label: 'Story-Modus' }
      ], info: 'Legt fest, ob Antworten knapp, normal, detailliert oder atmosphärisch/storylastig sind.' },
      { key: 'aiChat.lore', label: 'AI Story / Lore', type: 'textarea', rows: 5, info: 'Hintergrundgeschichte der AI. Gut für Server-Atmosphäre und Wiedererkennung.' },
      { key: 'aiChat.relationshipMode', label: 'Beziehungsmodus', type: 'textarea', rows: 4, info: 'Wie die AI mit Stammusern umgehen soll: erinnern, respektvoll, nicht creepy, hilfreich, persönlicher Ton.' },
      { key: 'aiChat.safetyRules', label: 'Sicherheitsregeln', type: 'textarea', rows: 5, info: 'Grenzen der AI: keine gefährlichen Anleitungen, keine Doxxing-Hilfe, keine Massenmentions, keine erfundenen privaten Daten.' },
      { key: 'aiChat.forbiddenTopics', label: 'Verbotene Themen / Grenzen', type: 'textarea', rows: 4, info: 'Server-spezifische Tabus oder Themen, bei denen die AI höflich umlenken soll.' },
      { key: 'aiChat.systemPrompt', label: 'AI Persönlichkeit / Regeln', type: 'textarea', rows: 8, info: 'Grundregeln für die AI. Hier kannst du Ton, Grenzen, Sprache und Server-Stil festlegen.' }
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
      { key: 'levels.levelUpMessage', label: 'Level Up Nachricht', type: 'text', placeholder: '{user} ist Level {level}', info: 'Fallback-Text, falls kein Level-Up-Embed aktiv ist. Platzhalter: {user}, {level}.' }
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
    id: 'serverContext',
    title: 'Serverwissen & Vollindex',
    description: 'Vollständiger Index mit schnellem 30-Tage-Kontext',
    detail: 'Die AI durchsucht den vollständigen, persistenten Serverindex und erhält nur passende Belege aus Kanälen, die der anfragende Nutzer sehen darf. Zusätzlich hält dieses Modul einen kompakten 30-Tage-Kontext für sehr aktuelle Ereignisse bereit. Der vollständige Index wird nicht ungefiltert in Ollama geladen.',
    icon: '🧠',
    fields: [
      { key: 'serverContext.enabled', label: 'Aktuellen Kontext aktivieren', type: 'checkbox', info: 'Erfasst neue Nachrichten zusätzlich im schnellen 30-Tage-Kontext. Der persistente Vollindex der Serververwaltung bleibt die langfristige Wissensquelle.' },
      { key: 'serverContext.retentionDays', label: 'Schnellkontext (Tage)', type: 'number', min: 1, max: 30, step: 1, info: 'Nur die kompakte Aktualitätsschicht wird nach dieser Zeit bereinigt. Die AI-Suche nutzt weiterhin den vollständigen Serverindex.' },
      { key: 'serverContext.maxStorageGb', label: 'Schnellkontext-Limit (GB)', type: 'number', min: 1, max: 50, step: 1, info: 'Harte Obergrenze ausschließlich für die aktuelle Kontextschicht. Der persistente Serverindex wird getrennt verwaltet.' },
      { key: 'serverContext.maxContextEntries', label: 'Aktuelle Belege pro Anfrage', type: 'number', min: 10, max: 200, step: 10, info: 'Begrenzt die aktuellen Zusatzbelege. Aus dem Vollindex werden separat nur die relevantesten Treffer abgerufen.' },
      { key: 'serverContext.channelIds', label: 'Schnellkontext-Kanäle', type: 'multiChannelSelect', info: 'Optional nur neue Nachrichten ausgewählter Kanäle in die schnelle Aktualitätsschicht übernehmen.' },
      { key: 'serverContext.excludedChannelIds', label: 'Vom Schnellkontext ausschließen', type: 'multiChannelSelect', info: 'Sensible oder private Kanäle aus der schnellen Aktualitätsschicht ausschließen. Die AI beachtet bei jeder Indexsuche zusätzlich die aktuellen Discord-Berechtigungen.' },
      { key: 'serverContext.storeAttachmentLinks', label: 'Anhang-Links merken', type: 'checkbox', info: 'Speichert nur Metadaten und Discord-Link. Dateien werden nicht heruntergeladen.' }
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
      { key: 'boostRoles.logChannelId', label: 'Booster Log Kanal', type: 'channelSelect', placeholder: 'optional', info: 'Optionaler Kanal für nachvollziehbare Vergabe- und Entfernungsprotokolle ohne Rollen- oder Everyone-Pings.' }
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
    title: 'Level Up!',
    description: '{user} hat Level **{level}** erreicht.',
    color: '#35d07f',
    thumbnailUrl: '{userAvatar}',
    footerText: '{guild} Level-System',
    fields: [
      { name: 'Neues Level', value: '{level}', inline: true },
      { name: 'Server', value: '{guild}', inline: true }
    ]
  }),
  createEmbedTemplate('welcome', 'Welcome', 'Automation', {
    title: 'Willkommen auf {guild}',
    description: 'Schön, dass du da bist, {user}. Lies die Regeln und fühl dich zuhause.',
    color: '#27c4e8',
    thumbnailUrl: '{userAvatar}',
    footerText: 'Mitglied beigetreten'
  }),
  createEmbedTemplate('ai-chat-welcome', 'AI Chat Willkommen', 'Automation', {
    title: 'Willkommen im AI Chat',
    description: 'Frag mich einfach – hier ein paar Beispiele:\n\n• „Wie viele Mitglieder hat der Server gerade?“\n• „Wer führt die Aktivitäts-Liga diese Woche an?“\n• „Was ist der aktuelle Stand vom Projekt?“\n• „Erzähl mir etwas über dich“\n• „Suche im Internet nach …“\n\nSo funktioniert der Kanal:\n• Du schreibst normal in diesen Kanal, ich antworte direkt\n• Gespräche und Erinnerungen bleiben lokal auf deinem PC\n• Der Kanal wird nach längerer Inaktivität automatisch aufgeräumt – diese Nachricht bleibt immer stehen',
    color: '#9b59b6',
    footerText: 'Diese Nachricht bleibt beim automatischen Aufräumen erhalten.',
    timestamp: true
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

const cryptoRandomId = () => `embed-${Math.random().toString(36).slice(2, 10)}`;

const normalizeEmbeds = (value = {}, fallback = {}) => {
  const defaultTemplates = Array.isArray(fallback.templates) ? fallback.templates : defaultEmbedTemplates();
  const providedTemplates = Array.isArray(value.templates) ? value.templates : [];
  const byId = new Map(defaultTemplates.map((template) => [template.id, template]));
  const normalizedDefaults = defaultTemplates.map((template) => {
    const override = providedTemplates.find((entry) => entry?.id === template.id);
    return normalizeEmbedTemplate(override || template, template);
  });
  const customTemplates = providedTemplates
    .filter((template) => template?.id && !byId.has(template.id))
    .map((template) => normalizeEmbedTemplate(template));

  return {
    selectedTemplateId: String(value.selectedTemplateId || fallback.selectedTemplateId || normalizedDefaults[0]?.id || ''),
    templates: [...normalizedDefaults, ...customTemplates]
  };
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
    applicationId: '1486457987072528575',
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
        thumbnailUrl: 'https://cdn.discordapp.com/emojis/1524506249427812454.gif',
        imageUrl: 'https://cdn.discordapp.com/attachments/1290011700627505304/1525214381993099496/99r7x48.png?ex=6a6852d5&is=6a670155&hm=2b6811cf4e5d49d697a6a30945f535ff562a7ec3f409f51006728a44b35b6423&',
        footerText: 'Liebe Grüße vom Maskottchen, HALO',
        footerIconUrl: 'https://cdn.discordapp.com/emojis/1525132444171370516.png',
        timestamp: false,
        fields: [
          { name: 'Regeln?', value: '<#1278044527168323655>', inline: false },
          { name: 'Übersicht?', value: '<#1305845798289936426>', inline: false },
          { name: 'Vorstellung?', value: '<#1306009795647508550>', inline: false },
          { name: 'Booster werden?', value: '<#1305857962274848818>', inline: false }
        ]
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
  aiChat: {
    enabled: true,
    channelId: '',
    model: 'qwen2.5:7b',
    ollamaUrl: 'http://127.0.0.1:11434',
    requireStart: true,
    memoryEnabled: true,
    rememberUserFacts: true,
    autoCleanChannel: true,
    channelIdleMinutes: 60,
    keepPinnedMessages: true,
    welcomeEmbedEnabled: true,
    memoryScope: 'user-channel',
    replyMode: 'channel',
    memoryLimitGb: 50,
    maxHistoryMessages: 24,
    maxStoredMessages: 800,
    maxUserFacts: 80,
    maxResponseChars: 2000,
    responseLimitVersion: 2,
    temperature: 0.55,
    contextTokens: 8192,
    contextWindowVersion: 2,
    sendTyping: true,
    strictSafetyEnabled: true,
    promptInjectionProtection: true,
    protectPrivateData: true,
    blockInsults: true,
    blockPrivilegedActions: true,
    onlyMeaningfulQuestions: true,
    floodProtectionEnabled: true,
    userCooldownSeconds: 0,
    channelCooldownSeconds: 0,
    maxUserMessagesPerMinute: 10,
    maxChannelMessagesPerMinute: 30,
    duplicateWindowSeconds: 20,
    webSearchEnabled: true,
    webSearchMode: 'smart',
    webSearchCooldownSeconds: 0,
    webSearchMaxResults: 5,
    webFetchPages: 2,
    webSearchTimeoutSeconds: 12,
    showWebSources: true,
    serverKnowledgeEnabled: true,
    serverKnowledgeCacheSeconds: 45,
    useServerEmojis: true,
    emojiUsage: 'subtle',
    useGifReplies: true,
    gifUsage: 'on-request',
    gifProvider: 'hybrid',
    gifChancePercent: 22,
    tenorContentFilter: 'high',
    tenorLocale: 'de_DE',
    gifLibrary: [],
    personaName: 'Fallen Heaven AI',
    personality: 'Ruhig, aufmerksam, trocken-humorig, direkt, loyal zur Community, nicht anbiedernd.',
    speakingStyle: 'Menschliches Deutsch wie im Discord-Chat: kurze Sätze, kein Supportbot-Ton, keine KI-Floskeln.',
    responseLength: 'normal',
    lore: 'Du bist die lokale Server-KI von Fallen Heaven. Du lernst die Community über getrennte User-Erinnerungen kennen und hilfst wie ein ruhiger Operator im Hintergrund.',
    relationshipMode: 'Merke dir hilfreiche Vorlieben, Namen, Projekte und wiederkehrende Themen. Sei persönlicher bei Stammusern, aber nicht aufdringlich oder creepy.',
    safetyRules: 'Keine privaten Daten erfinden. Keine Massenmentions. Keine gefährlichen Schritt-für-Schritt-Anleitungen. Bei Unsicherheit nachfragen.',
    forbiddenTopics: '',
    systemPrompt: 'Du bist Fallen Heaven AI im Discord. Schreib wie ein echter Mensch im Serverchat: kurz, passend, natürlich, ausschließlich Deutsch. Keine Supportbot-Floskeln, keine ständigen Rückfragen, keine Sätze wie "Wie kann ich dir helfen?". Wenn jemand nur grüßt, grüße nur passend zurück. Bei Fragen mit aktuellen Fakten, Release-Daten, Sport, News oder Ergebnissen gilt Webkontext vor Modellwissen. Wenn Webtreffer nichts sauber belegen, sag ehrlich, dass du es gerade nicht sicher belegt findest. Schreibe nie "Lass mich prüfen" oder "ich recherchiere kurz", sondern antworte direkt mit dem vorhandenen Webkontext.'
  },
  levels: {
    enabled: true,
    xpPerMessageMin: 6,
    xpPerMessageMax: 16,
    cooldownSeconds: 60,
    minMessageLength: 3,
    maxXpPerDay: 500,
    ignoredChannelIds: [],
    excludedRoleIds: [],
    levelRoleMappings: [],
    cumulativeRoleRewards: false,
    announce: true,
    announceChannelId: '',
    levelUpMessage: '{user} erreicht Level {level}!'
  },
  activityRace: {
    enabled: false,
    panelChannelId: '',
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
    logChannelId: ''
  },
  heavenEconomy: {
    enabled: false,
    panelChannelId: '',
    panelMessageId: '',
    coinEmoji: '🪙',
    boostMilestoneReward: 100,
    vipRoleMappings: [],
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
  const safeAiChat = { ...normalized.aiChat };
  delete safeAiChat.tenorApiKey;

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
    aiChat: {
      ...safeAiChat,
      channelId: String(normalized.aiChat.channelId || '').trim(),
      model: String(normalized.aiChat.model || base.aiChat.model).trim(),
      ollamaUrl: String(normalized.aiChat.ollamaUrl || base.aiChat.ollamaUrl).trim(),
      memoryLimitGb: Math.min(50, Math.max(1, toNumber(normalized.aiChat.memoryLimitGb, base.aiChat.memoryLimitGb))),
      maxHistoryMessages: Math.min(80, Math.max(6, toNumber(normalized.aiChat.maxHistoryMessages, base.aiChat.maxHistoryMessages))),
      maxStoredMessages: Math.min(5000, Math.max(100, toNumber(normalized.aiChat.maxStoredMessages, base.aiChat.maxStoredMessages))),
      maxUserFacts: Math.min(250, Math.max(10, toNumber(normalized.aiChat.maxUserFacts, base.aiChat.maxUserFacts))),
      maxResponseChars: Number(raw.aiChat?.responseLimitVersion || 0) >= 2
        ? Math.min(2000, Math.max(400, toNumber(normalized.aiChat.maxResponseChars, base.aiChat.maxResponseChars)))
        : 2000,
      responseLimitVersion: 2,
      temperature: Math.min(2, Math.max(0, toNumber(normalized.aiChat.temperature, base.aiChat.temperature))),
      contextTokens: Number(raw.aiChat?.contextWindowVersion || 0) >= 2
        ? Math.min(32768, Math.max(8192, toNumber(normalized.aiChat.contextTokens, base.aiChat.contextTokens)))
        : 8192,
      contextWindowVersion: 2,
      requireStart: normalized.aiChat.requireStart !== false,
      memoryEnabled: normalized.aiChat.memoryEnabled !== false,
      rememberUserFacts: normalized.aiChat.rememberUserFacts !== false,
      autoCleanChannel: normalized.aiChat.autoCleanChannel !== false,
      channelIdleMinutes: Math.min(10080, Math.max(15, toNumber(normalized.aiChat.channelIdleMinutes, base.aiChat.channelIdleMinutes))),
      keepPinnedMessages: normalized.aiChat.keepPinnedMessages !== false,
      memoryScope: String(normalized.aiChat.memoryScope || base.aiChat.memoryScope),
      replyMode: String(normalized.aiChat.replyMode || base.aiChat.replyMode),
      sendTyping: normalized.aiChat.sendTyping !== false,
      serverKnowledgeEnabled: normalized.aiChat.serverKnowledgeEnabled !== false,
      serverKnowledgeCacheSeconds: Math.min(300, Math.max(15, toNumber(normalized.aiChat.serverKnowledgeCacheSeconds, base.aiChat.serverKnowledgeCacheSeconds))),
      useServerEmojis: normalized.aiChat.useServerEmojis !== false,
      emojiUsage: String(normalized.aiChat.emojiUsage || base.aiChat.emojiUsage),
      useGifReplies: normalized.aiChat.useGifReplies !== false,
      gifUsage: ['off', 'on-request', 'mood'].includes(String(normalized.aiChat.gifUsage || '').trim().toLowerCase())
        ? String(normalized.aiChat.gifUsage).trim().toLowerCase()
        : base.aiChat.gifUsage,
      gifProvider: ['hybrid', 'tenor', 'library'].includes(String(normalized.aiChat.gifProvider || '').trim().toLowerCase())
        ? String(normalized.aiChat.gifProvider).trim().toLowerCase()
        : base.aiChat.gifProvider,
      gifChancePercent: Math.min(100, Math.max(0, toNumber(normalized.aiChat.gifChancePercent, base.aiChat.gifChancePercent))),
      tenorContentFilter: ['high', 'medium', 'low'].includes(String(normalized.aiChat.tenorContentFilter || '').trim().toLowerCase())
        ? String(normalized.aiChat.tenorContentFilter).trim().toLowerCase()
        : base.aiChat.tenorContentFilter,
      tenorLocale: String(normalized.aiChat.tenorLocale || '').trim().replace('-', '_').toLowerCase() === 'en_us' ? 'en_US' : 'de_DE',
      gifLibrary: toSafeGifLibrary(normalized.aiChat.gifLibrary),
      personaName: String(normalized.aiChat.personaName || base.aiChat.personaName),
      personality: String(normalized.aiChat.personality || base.aiChat.personality),
      speakingStyle: String(normalized.aiChat.speakingStyle || base.aiChat.speakingStyle),
      responseLength: String(normalized.aiChat.responseLength || base.aiChat.responseLength),
      lore: String(normalized.aiChat.lore || base.aiChat.lore),
      relationshipMode: String(normalized.aiChat.relationshipMode || base.aiChat.relationshipMode),
      safetyRules: String(normalized.aiChat.safetyRules || base.aiChat.safetyRules),
      forbiddenTopics: String(normalized.aiChat.forbiddenTopics || ''),
      systemPrompt: String(normalized.aiChat.systemPrompt || base.aiChat.systemPrompt)
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
      maxXpPerDay: toBoundedInteger(normalized.levels.maxXpPerDay, base.levels.maxXpPerDay, 50, 100000),
      ignoredChannelIds: [...new Set(toList(normalized.levels.ignoredChannelIds, []).map(String).filter(Boolean))],
      excludedRoleIds: [...new Set(toList(normalized.levels.excludedRoleIds, []).map(String).filter(Boolean))],
      levelRoleMappings: toList(normalized.levels.levelRoleMappings, []).map(String).map((entry) => entry.trim()).filter(Boolean),
      cumulativeRoleRewards: normalized.levels?.cumulativeRoleRewards === true,
      announce: normalized.levels?.announce !== false,
      announceChannelId: String(normalized.levels?.announceChannelId || '').trim(),
      levelUpMessage: String(normalized.levels?.levelUpMessage || base.levels.levelUpMessage)
    },
    activityRace: {
      ...normalized.activityRace,
      enabled: normalized.activityRace?.enabled === true,
      panelChannelId: String(normalized.activityRace?.panelChannelId || '').trim(),
      panelDesign: normalizeActivityPanelDesign(normalized.activityRace?.panelDesign, base.activityRace.panelDesign),
      ignoredChannelIds: [...new Set(toList(normalized.activityRace?.ignoredChannelIds, []).map(String).filter(Boolean))],
      excludedRoleIds: [...new Set(toList(normalized.activityRace?.excludedRoleIds, []).map(String).filter(Boolean))],
      messageCooldownSeconds: toBoundedInteger(normalized.activityRace?.messageCooldownSeconds, base.activityRace.messageCooldownSeconds, 0, 300),
      duplicateWindowMinutes: toBoundedInteger(normalized.activityRace?.duplicateWindowMinutes, base.activityRace.duplicateWindowMinutes, 0, 1440),
      minimumMessageLength: toBoundedInteger(normalized.activityRace?.minimumMessageLength, base.activityRace.minimumMessageLength, 1, 500),
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
      logChannelId: String(normalized.boostRoles?.logChannelId || '')
    },
    heavenEconomy: {
      ...normalized.heavenEconomy,
      enabled: normalized.heavenEconomy?.enabled === true,
      panelChannelId: String(normalized.heavenEconomy?.panelChannelId || ''),
      panelMessageId: String(normalized.heavenEconomy?.panelMessageId || ''),
      coinEmoji: String(normalized.heavenEconomy?.coinEmoji || '🪙').slice(0, 100),
      boostMilestoneReward: Math.min(10000, Math.max(1, toNumber(normalized.heavenEconomy?.boostMilestoneReward, 100))),
      vipRoleMappings: toList(normalized.heavenEconomy?.vipRoleMappings, []),
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
    embeds: normalizeEmbeds(normalized.embeds, base.embeds)
  };
}






