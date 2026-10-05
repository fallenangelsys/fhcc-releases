# FHCC auf Android — Stand der Umsetzung

Stand: 2026-10-05 · Version 4.1.3

Ziel: dieselbe App wie am PC, aber lauffähig auf dem Handy. **Kein Remote,
kein Server im Rechenzentrum** — Bot, Datenbank und Oberfläche laufen auf dem
Gerät selbst.

## Was gebaut und geprüft ist

### 1. SQLite-Blocker gelöst (der eigentliche Android-Hindernis)

`better-sqlite3` ist ein natives C++-Addon. Für Android gibt es keine fertigen
Binaries — damit wäre **jede** Android-Version beim Start abgestürzt, egal wie
gut das Gerät ist.

Node 22+ bringt `node:sqlite` mit: dieselbe SQLite-Bibliothek, ohne
Kompilierschritt. Neu: [src/runtime/sqliteAdapter.js](../src/runtime/sqliteAdapter.js)

Der Adapter ergänzt die zwei fehlenden Methoden:

| better-sqlite3 | node:sqlite | Lösung im Adapter |
|---|---|---|
| `db.pragma(sql, {simple:true})` → Skalar | kennt `pragma()` nicht | `pragma()` mit `simple`-Unterstützung |
| `db.transaction(fn)` | kennt `transaction()` nicht | BEGIN/COMMIT, verschachtelt als SAVEPOINT |

**Geprüft:** beide Wege liefern identische Werte (`page_count`, `freelist_count`),
Persistieren von 25 Nachrichten, Volltextsuche, Checkpoint, VACUUM im
Worker-Thread — auf `better-sqlite3` **und** `node:sqlite`. Desktop nutzt
unverändert `better-sqlite3`; Android fällt automatisch auf `node:sqlite` zurück.

### 2. Mobile-Bridge

[desktop/renderer/mobile-bridge.js](../desktop/renderer/mobile-bridge.js) ersetzt
`window.fallenHeaven` (43 Methoden) außerhalb von Electron. Der Renderer ruft
unverändert `api.controlBot(...)`, `api.apiRequest(...)` — nur die Transportschicht
wechselt von IPC auf HTTP.

Windows-only-Methoden (Ordner öffnen, NSIS-Updates, DPAPI, Fensterknöpfe)
antworten mit einer klaren Meldung statt zu crashen.

**Geprüft im echten Browser:** Login-Szene erscheint, 43 Methoden vorhanden,
Bot-Status und Discord-Events funktionieren, keine Konsolenfehler.

### 3. Oberfläche für Handy

[desktop/renderer/ui-mobile.css](../desktop/renderer/ui-mobile.css), nur unter
`max-width: 860px` geladen. Ab 861 px ist die Desktop-Darstellung unverändert.

Problem gefunden und behoben: `ui-aurora.css` blendet die Navigation unter
980 px per `display:none` aus. Auf dem Handy war damit **jede Navigation
weg** — die Desktop-Sidebar wird jetzt zu einer unteren, scrollbaren Leiste.

**Geprüft bei 412 px (S24 Ultra Hochformat):** 7 Navigationspunkte mit 52 px
Tippfläche, 84 px Freiraum unten, Raster einspultig, kein horizontaler Überlauf.
Desktop bei 1920 px gegengeprüft: Sidebar weiterhin vertikal.

### 4. Android-Projekt

```
android/
├── app/src/main/java/de/fallenheaven/controlcenter/
│   ├── MainActivity.java      WebView auf 127.0.0.1:3000/app/
│   ├── RuntimeService.java    Foreground-Service (Bot bleibt online)
│   ├── RuntimeProcess.java    startet Node mit Android-Umgebung
│   └── SecureStore.java       Android-Keystore statt Windows-DPAPI
├── app/src/main/AndroidManifest.xml
├── app/build.gradle           minSdk 26, targetSdk 35, Java 17
└── prepare-runtime.mjs        baut das Laufzeitpaket
```

Der Server liefert seine eigene Oberfläche aus (`/app/`), deshalb ist die App
eine dünne Hülle und jedes UI-Update sofort verfügbar.

## Was NOCH NICHT geht — der letzte Blocker (recherchiert, nicht geraten)

**Es gibt keine wartbare Node-Laufzeit, die man einfach in eine APK legen kann.**

### Belegter Befund

Die offizielle `node-v24.21.0-linux-arm64.tar.xz` (Prüfsumme gegen nodejs.org
verifiziert) ist gegen `/lib/ld-linux-aarch64.so.1` gelinkt. Android besitzt
diesen Linux-Loader nicht — die Binary startet dort nie.
`android/prepare-runtime.mjs` liest das aus dem ELF-Header und bricht mit
Exit 1 ab, statt eine APK zu bauen, die beim Start stirbt.

### Die drei realen Wege

**1. Termux — funktioniert, ist der einzige sofort nutzbare Weg.**
Termux paketiert Node gegen Bionic, also genau für Android. `pkg install
nodejs-lts` liefert eine lauffähige Laufzeit auf dem Gerät. Die App startet
sie über `/data/data/com.termux/files/home/usr/bin/node`
(`RuntimeProcess.findTermuxNode()`). Kein C-Build, kein NDK.

Kosten: eine zweite App muss installiert sein, und Android kann den Prozess
töten. Der *Phantom-Process-Killer* ab Android 12 schlägt zu, sobald
systemweit mehr als 32 Hintergrundprozesse laufen; ab Android 14 gibt es dafür
die Entwickleroption **„Disable child process restrictions“**. Auf Android 12/13
nur per ADB:
`settings put global settings_enable_monitor_phantom_procs false`.
Ein Foreground-Service allein schützt **nicht** — er zählt selbst als
Hintergrundprozess.

**2. Capacitor-NodeJS — vom Autor selbst abgeraten.**
`hampoelz/Capacitor-NodeJS` bettet eine Node-Laufzeit in eine Capacitor-App ein,
also genau die Idee „ganze App in der APK“. Der Autor schreibt im Repository:

> This plugin is no longer recommended for new projects. … The underlying
> Node.js for Mobile Apps toolkit is unmaintained and stuck on Node.js 18.20,
> which reached end-of-life in mid-2025. … I strongly recommend Tauri instead.

Damit fällt dieser Weg für eine professionelle App weg: ausgelieferte
Sicherheitslücken, dazu warnt der Autor vor dem Größen- und
Speicherverbrauch eingebetteter Runtimen.

**3. Tauri 2 — die empfohlene Alternative, aber mit anderem Ansatz.**
Tauri 2 ist seit Oktober 2024 stabil und unterstützt Android nativ. Das
Frontend (unsere Oberfläche) bleibt Web und wird wiederverwendet. Der
Unterschied: Tauri ersetzt Node durch **Rust**. discord.js, better-sqlite3 und
alle 33 Feature-Module müssten neu geschrieben werden. Das ist kein Umbau,
sondern ein zweites Projekt — Wochen bis Monate.

### Weitere offene Punkte

- Android SDK und Gradle fehlen auf diesem Rechner; JDK 25 ist für aktuelle
  AGP-Versionen zu neu (nötig: 17 oder 21).
- Der Gradle-Wrapper (`gradlew`) ist noch nicht vorhanden — nur die
  `gradle-wrapper.properties` mit Gradle 8.11.1.
- Nicht getestet: ein echter Start auf dem S24 Ultra, echter Discord-OAuth,
  Skin Studio auf dem Gerät.

### Empfehlung

**Termux für eine sofort lauffähige App.** Kein C-Build, funktioniert heute,
und die APK bleibt klein, weil die Laufzeit auf dem Gerät liegt statt in der App.
Der Preis ist die Termux-Abhängigkeit — in der App steht der Nutzer dann aber
genau das, statt ein Rätsel zu haben.

Der Phantom-Process-Killer ist dabei die echte Betriebsgefahr, nicht der Start.
Er gehört in die Anleitung und in die App: die Entwickleroption ist ein
einmaliger Handgriff.

## Geprüfte Befehle

```
npx vitest run                                              46/46 grün
node scripts/verify-bot-imports.mjs                         exit 0
node scripts/case-sensitive-import-audit.cjs                exit 0
npm run lint                                                exit 0 (0 Fehler)
node scripts/ui-recovery-layout-smoke.mjs                   exit 0
node scripts/server-management-ui-smoke.mjs                 exit 0
node scripts/ui-field-audit.mjs                             exit 0
node scripts/index-optimizations-smoke.mjs                  exit 0
node android/prepare-runtime.mjs                            exit 0 (saubere Warnung)
node android/prepare-runtime.mjs --node-dir <linux-arm64>   exit 1 (erkennt Loader)
```

Serverstart mit `FH_RUNTIME_PLATFORM=android FH_SQLITE_FLAVOUR=node`:
`/app/`, `ui-mobile.css` und `mobile-bridge.js` liefern alle 200.
