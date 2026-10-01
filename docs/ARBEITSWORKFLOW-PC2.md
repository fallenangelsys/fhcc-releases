# FALLEN HEAVEN Control Center – Arbeitsworkflow für PC 2

Dieses Handbuch beschreibt, wie Freebuff (oder ein Entwickler) auf **PC 2** am Projekt
arbeiten soll, damit Änderungen genauso sauber landen wie hier auf PC 1: gleiche Tests,
gleiche Versionsnummern, gleiche Builds, gleiche Fehlerkultur.

---

## 1. Projekt-Layout

```
C:\Users\5gtag\Documents\Discord Bot\
├── src\                    # Bot-Logik (Node.js, ESM)
│   ├── index.js            # Bot-Einstieg + HTTP-Server (Port 3000)
│   ├── defaultConfig.js    # Alle Modul-Definitionen + Felder der Modul-Karten
│   ├── features\           # Module: activityRace, boostRoles, leveling, ...
│   └── runtime\            # localImageStore, moduleReadiness, ...
├── desktop\
│   ├── main.cjs            # Electron-Hauptprozess (Fenster, IPC, Auto-Update, Secrets)
│   ├── preload.cjs         # Sichere Bridge Renderer → Main
│   ├── update-check.cjs    # Auto-Update-Logik (latest.yml, SHA-512, Version-Vergleich)
│   └── renderer\
│       ├── index.html      # EINZIGE echte App-Oberfläche (keine Root-Kopie!)
│       ├── app.js          # Renderer-Logik (Monolith, ~8.000+ Zeilen)
│       └── *.css           # ui-fallen-v12.css ist die letzte Design-Ebene
├── scripts\                # Smoke-Tests + Tools (bump-version.cjs)
├── harness\                # UI-Geometrie-Harness (Preview-Bau)
├── docs\                   # Dokumentation
├── dist\                   # Gebaute EXE: FHCC-Setup-x.y.z-x64.exe
└── package.json            # Version + npm-Scripts
```

**Wichtig:** Es gibt NUR EINE `index.html` (`desktop/renderer/index.html`). Eine Root-
`index.html` wurde bewusst entfernt (war 92 KB totes Gewicht im Installer). Nie wieder
anlegen!

---

## 2. Der Standard-Workflow (immer so)

1. **Erst verstehen, dann ändern** – Datei lesen (auch Kontext drumherum), nicht blind
   raten. Bei großen Dateien (`app.js`) erst per Suche die Stelle finden,
   dann ein Fenster von ±100 Zeilen um die Fundstelle lesen.
2. **Kleine, gezielte Edits** – nicht ganze Dateien neu schreiben. Bestehende Muster
   und Stil übernehmen (deutsche Kommentare, semikolonlos ist NICHT der Stil hier –
   im Renderer wird mit `;` geschrieben).
3. **Syntax-Check nach jedem Edit**:
   ```bash
   node --check <datei>
   ```
4. **Betroffene Smoke-Tests laufen lassen** (siehe §4).
5. **Komplette Release-Suite** als Gate vor jedem Build (siehe §5).
6. **Changelog schreiben + Version bumpen** (siehe §6).
7. **Build** (siehe §7).
8. **Installieren / Auto-Update** (siehe §8).

---

## 3. Wo was zu ändern ist (Karte)

| Du willst …                                | Datei                                  |
|--------------------------------------------|----------------------------------------|
| Neues Modul / neue Modul-Einstellung       | `src/defaultConfig.js` (Felder) + Feature in `src/features/` |
| Aktivitäts-Liga, Pings, Ränge              | `src/features/activityRace.js`         |
| Level-System, XP, Levelrollen              | `src/features/leveling*.js`            |
| Server-Tag-Erkennung                       | `src/features/serverTagTracker.js`     |
| Verify, Member-Check                       | `src/features/memberVerify.js`         |
| Auto-Responder                             | `src/features/autoResponder.js`        |
| Bot-Einstieg, HTTP-Routen                  | `src/index.js`                         |
| UI-Design (Obsidian/Violett/Gold)          | `desktop/renderer/ui-fallen-v12.css`   |
| Renderer-Logik (Dashboard, Module, Studio) | `desktop/renderer/app.js`              |
| Fenster, IPC, Secrets, Auto-Update         | `desktop/main.cjs` + `desktop/preload.cjs` |
| Auto-Update-Logik (Version, SHA-512)       | `desktop/update-check.cjs`             |
| Embed-Studio-Versand (localAsset, Bilder)  | `src/runtime/localImageStore.js` + `src/index.js` |

---

## 4. Smoke-Tests (Schnellprüfung)

Jeder Smoke ist ein einzelnes Node-Skript ohne Abhängigkeit vom laufenden Bot –
er importiert die echte Quelle und prüft reine Logik mit `assert`:

```bash
node scripts/leveling-autoresponder-smoke.mjs  # Leveling + Embed-Studio-Versand
node scripts/activity-race-smoke.mjs           # Aktivitäts-Liga
node scripts/ui-recovery-layout-smoke.mjs      # UI-Geometrie (keine Überlappungen)
node scripts/auto-update-smoke.mjs             # Update-Logik
node scripts/boost-top-edit-path-e2e.mjs       # Top-Booster-Edit-Pfad
```

**Neue Funktion → neuer Test.** Wenn du etwas baust, erweitere den passenden Smoke
oder leg ein neues Skript an. Regeln:
- Nur echte Logik testen, keine Netzwerk-/Discord-Abhängigkeiten – `globalThis.fetch`
  mocken, wenn der Code fetcht.
- `assert.equal/rejects/deepEqual` verwenden, am Ende eine Erfolgsmeldung loggen.
- Die Smoke-Skripte hängen an `package.json` unter `test:*` bzw. `test:release`.

---

## 5. Release-Suite (Gate vor jedem Build)

```bash
npm run test:release
```

Läuft ALLE Smokes + Release-Prüfung (Paket-Check, ASAR, Node-Version). **Muss grün
sein, bevor eine EXE gebaut wird.** Wenn etwas rot ist: erst fixen, dann weiter.

Zusätzlich im Build selbst: `test:packaged` + `test:artifact` (prüfen den fertigen
Installer-Inhalt). Die laufen automatisch mit `npm run build:win`.

---

## 6. Changelog + Version hochschrauben

**Version wird automatisch gebumpt** – vor dem Build ein Mal ausführen:

```bash
node scripts/bump-version.cjs
```

Was das Skript macht:
- `package.json` + `package-lock.json`: Patch-Version hoch (3.9.102 → 3.9.103).
- `desktop/renderer/index.html`: Cache-Buster `?v=x.y.z` auf die neue Version.
- `desktop/renderer/app.js`: `{version}`-Platzhalter auf die neue Version.
- **Changelog**: Falls für die neue Version noch kein Eintrag existiert, wird ein
  Platzhalter angelegt – ABER: **vor dem Build immer die echten Punkte eintragen!**

**Changelog-Datei:** `CHANGELOG.md` (oder `docs/…` – Suche nach `CHANGELOG`).
Regeln:
- Neuer Eintrag OBEN (neueste Version zuerst).
- **Keine Duplikate**: Ein Test prüft, dass Versionsnummern eindeutig sind und
  numerisch sortiert (String-Sortierung versagt ab 3.9.100!). Format `## 3.9.103`.
- Jeder Eintrag beschreibt konkret, was neu ist – nicht „kleinere Fixes".

**Wichtig fürs Update-Embed:** Der Bot zeigt im Update-Embed die Changelog-Punkte.
Wenn der Eintrag nur der automatische Platzhalter ist, steht dort der Text der
VORHERIGEN Version – also immer die echten Punkte schreiben.

---

## 7. Build (EXE bauen)

```bash
npm run build:win
```

- Stoppt erst laufende FHCC-Prozesse (das Skript macht das selbst).
- Baut den Installer nach `dist\FHCC-Setup-<version>-x64.exe`.
- Führt `test:packaged` + `test:artifact` automatisch mit aus (ASAR-Check).
- **Nicht abbrechen**, auch wenn es mehrere Minuten dauert – sonst bleibt eine
  halbe EXE liegen. Build-Log prüfen: `tail` der Ausgabe, auf „erfolgreich" warten.

Nach dem Build kurz verifizieren:
```bash
ls -lh dist\FHCC-Setup-*-x64.exe
```

---

## 8. Auf PC 2 installieren / Auto-Update

**Standard:** Die EXE auf PC 2 installieren (Setup doppelklicken). Alle Modul- und
Studio-Einstellungen liegen NICHT in der EXE – die sind lokal unter
`%APPDATA%\FALLEN HEAVEN Control Center\` auf jedem PC. Für einen kompletten
Umzug: den Ordner (inkl. `runtime/data/`) kopieren.

**Auto-Update (empfohlen ab 3.9.97):**
1. In der App: **System → App Updates** → Update-Ordner setzen (lokal oder
   Netzwerkfreigabe, z. B. `\\SERVER\DiscordBot`).
2. Neue EXE + `latest.yml` in diesen Ordner legen.
3. Auf PC 2: **„Nach Updates suchen"** → **„Update installieren"**.
   Die Datei wird per SHA-512 gegen `latest.yml` geprüft, in den Temp-Ordner
   kopiert und still installiert – die Freigabe kann danach zu sein.
4. Die App startet sich danach automatisch neu.

---

## 9. Fehlerkultur (wichtig)

- **Nie still schweigen** – wenn etwas fehlschlägt: ehrliche, hilfreiche Meldung mit
  konkreten Schritten, nicht nur „Fehler".
- **Bild-Upload / localAsset:** Bilder „außerhalb vom Embed" werden lokal gespeichert
  und beim Senden als echter Discord-Anhang materialisiert (`materializeOutsideImageTemplate`
  in `src/runtime/localImageStore.js`). Wenn ein Studio-Embed sein Außenbild verliert,
  ist dort oder im Versandpfad (`/embed/send`, `/embed/edit`, `/thread/create` in
  `src/index.js`) der Fehler zu suchen – und der passende Smoke-Test zu erweitern.
- **Timeout-Fallen:** `unref()`-Timer feuern in Tests nicht, weil die Event-Loop
  leerläuft – Fake-Fetch mit eigenem Timeout statt echten Timer erwarten.
- **Leistung:** Keine unbegrenzt wachsenden Maps – immer Pruning
  (`cooldownMap`-Cleanup) wie in `autoResponder.js`.
- **Nicht doppelt bauen** – vor jeder Änderung `git status` prüfen, ob jemand anderes
  (IDE, zweiter Agent) dieselbe Datei bearbeitet hat.

---

## 10. Kurz-Checkliste vor dem „Fertig"

- [ ] `node --check` auf allen geänderten Dateien grün
- [ ] Betroffene Smokes grün
- [ ] `npm run test:release` grün
- [ ] Changelog-Eintrag mit echten Punkten, keine Duplikate
- [ ] `node scripts/bump-version.cjs` ausgeführt
- [ ] `npm run build:win` erfolgreich, EXE existiert in `dist\`
- [ ] Optional: `harness/`-Preview gebaut und Geometrie geprüft (UI-Änderungen)
