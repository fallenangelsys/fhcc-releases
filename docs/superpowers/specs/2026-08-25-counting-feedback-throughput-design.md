# Counting: garantierte Reaktionen und entkoppelte Nebenarbeiten

Datum: 2026-08-25

## Ziel

Jede akzeptierte Zahl erhaelt genau einen gruenen Haken. Eine falsche Zahl erhaelt keinen gruenen Haken, sondern weiterhin die konfigurierte Fehlerreaktion und den vorhandenen Fehlerablauf. Schnelle Folgen duerfen weder die Zahlenreihenfolge noch Reaktionen verlieren.

## Bestaetigte Ursache

`message.react(...)` erzeugt pro Nachricht einen eigenen Discord-REST-Aufruf. Discord.js serialisiert diese Aufrufe anhand der von Discord gelieferten Bucket-Informationen. Der bisherige Counting-Code startete alle Reaktions-Promises unkontrolliert und liess gleichzeitig Kanalbereinigung und Panel-Synchronisation anlaufen. Die Bereinigung konnte dadurch eine Nachricht entfernen, bevor deren wartende Reaktion Discord erreicht hatte. Ausserdem konnten mehrere Bereinigungen ueberlappen. Panel-Aufrufe innerhalb des Zwei-Sekunden-Fensters wurden verworfen, sodass der neueste Zaehlerstand nicht zwingend nachgeliefert wurde.

## Entwurf

### Reaktionsauslieferung

- Pro Counting-Kanal existiert eine FIFO-Queue.
- Die Message-ID ist der Deduplizierungsschluessel.
- Genau ein Worker pro Kanal ruft `message.react(...)` auf und wartet dessen Ergebnis ab.
- Die Zahlenpruefung und State-Mutation warten nicht auf Discord.
- Das Ergebnis der Reaktion wird in einem kompakten Laufzeitstatus festgehalten. Fehler werden sichtbar protokolliert; die Queue bleibt begrenzt auf reale noch offene Eintraege.

### Rolling Window

- Jede beobachtete Counting-Nachricht wird lokal registriert.
- Eine Nachricht ist erst loeschbar, wenn ihre Reaktion abgeschlossen ist oder keine Reaktion vorgesehen war.
- Normales Rolling-Cleanup wird pro Kanal serialisiert und zusammengefasst. Parallele `messages.fetch({ limit: 100 })`- und Delete-Laeufe sind ausgeschlossen.
- Die erste Bereinigung nach Start darf den Kanal einmal hydratisieren. Danach dienen beobachtete Message-Objekte als schnelle Quelle; ein Reset darf weiterhin einen vollstaendigen Sicherheitsabgleich ausfuehren.

### Status-Panel

- Pro Guild laeuft hoechstens ein Panel-Sync.
- Weitere Aenderungen waehrend des Zwei-Sekunden-Fensters setzen einen Pending-Status.
- Nach Ablauf des Fensters wird der neueste State einmal synchronisiert. Zwischenstaende werden zusammengefasst, der Endstand aber nie verworfen.

### Diagnose

Der Counting-Laufzeitstatus liefert Queue-Tiefe, Alter des aeltesten Eintrags, erfolgreiche/fehlgeschlagene Reaktionen, zusammengefasste Panel-Aufrufe und Cleanup-Aktivitaet. Damit kann die App zwischen lokaler Verzoegerung und Discord-Rate-Limit unterscheiden.

## Regressionen

- Viele schnelle korrekte Nachrichten: jede Message-ID genau einmal und in Reihenfolge mit dem gruenen Haken.
- Langsame Reaktion plus Cleanup: Die Nachricht wird nicht vor Abschluss ihrer Reaktion geloescht.
- Mehrere Cleanup-Anforderungen: maximal ein aktiver Lauf, danach aktueller Endzustand.
- Viele Panel-Anforderungen innerhalb des Fensters: ein nachlaufender Sync enthaelt den neuesten Zaehlerstand.
- Falsche Zahl: keine Erfolgsreaktion, weiterhin konfigurierte Fehlerreaktion.
