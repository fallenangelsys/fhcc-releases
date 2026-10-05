# FHCC auf Android — Stand der Umsetzung

Stand: 2026-10-06 · Version 4.1.3 · APK `de.fallenheaven.controlcenter`

Ziel: dieselbe App wie am PC, aber lauffähig auf dem Handy. **Kein Remote,
kein Server im Rechenzentrum** — Bot, Datenbank und Oberfläche laufen auf dem
Gerät selbst.

**Status: die APK ist gebaut und signiert.** Artefakt:
`android/app/build/outputs/apk/release/app-release.apk` (88,5 MB).
Was noch fehlt, ist ausschließlich der Test auf einem echten Gerät.

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
unverändert `better-sqlite3`; Android setzt `FH_SQLITE_FLAVOUR=node`.

### 2. Mobile-Bridge

[desktop/renderer/mobile-bridge.js](../desktop/renderer/mobile-bridge.js) ersetzt
`window.fallenHeaven` (44 Methoden) außerhalb von Electron. Der Renderer ruft
unverändert `api.controlBot(...)`, `api.apiRequest(...)` — nur die Transportschicht
wechselt von IPC auf HTTP.

Windows-only-Methoden (Ordner öffnen, NSIS-Updates, DPAPI, Fensterknöpfe)
antworten mit einer klaren Meldung statt zu crashen.

**Geprüft im echten Browser:** Login-Szene erscheint, 44 Methoden vorhanden,
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
│   ├── RuntimeProcess.java    startet Node aus dem nativeLibraryDir
│   ├── SetupBridge.java       native Einrichtung
│   └── SecureStore.java       Android-Keystore statt Windows-DPAPI
├── app/src/main/AndroidManifest.xml
├── app/src/main/jniLibs/arm64-v8a/libnode.so   erzeugt, nicht eingecheckt
├── gradlew, gradle-wrapper.jar                 erzeugt, eingecheckt
└── prepare-runtime.mjs        baut das Laufzeitpaket
```

Der Server liefert seine eigene Oberfläche aus (`/app/`), deshalb ist die App
eine dünne Hülle und jedes UI-Update sofort verfügbar.

### 5. Die Node-Laufzeit — der eigentliche Knackpunkt

Eine APK ist erst nutzbar, wenn darin eine Node-Laufzeit steckt, die auf
Android startet. Zwei Wege führen dorthin, einer davon ist eine Sackgasse.

**Warum die offizielle Linux-Binary nicht geht.**
`node-v24.21.0-linux-arm64.tar.xz` (Prüfsumme gegen nodejs.org verifiziert) ist
gegen `/lib/ld-linux-aarch64.so.1` gelinkt. Android besitzt diesen
Linux-Loader nicht — die Binary startet dort nie. `prepare-runtime.mjs` liest
das aus dem ELF-Header und bricht mit Exit 1 ab, statt eine APK zu bauen, die
beim Start stirbt.

**Warum Termux als Laufzeitquelle nicht geht — obwohl die Binary passt.**
Das Termux-Paket `nodejs-lts` (24.18.0) ist genau richtig: gegen
`/system/bin/linker64` gelinkt, also Bionic, und **ohne jede `DT_NEEDED`** —
außer Bionic braucht die Binary nichts aus dem System.

Als *Startpfad* ist Termux trotzdem tot: Android gibt fremden Apps keinen
Zugriff auf das private Verzeichnis einer anderen App. Termux kann unsere
Dateien nicht lesen, wir können nicht in ihre Sandbox schreiben, auch nicht
über die `RunCommandService`-Schnittstelle. Der frühere Entwurf
(`RuntimeProcess.findTermuxNode()`) hätte deshalb auf jedem Gerät mit
„Permission denied" oder „File not found" geendet.

**Der Weg, der funktioniert: Binary mit in die APK, Start aus dem
nativeLibraryDir.**

Android verbietet seit Version 10 (W^X bei `targetSdk >= 29`) das Ausführen von
Programmen aus dem schreibbaren Datenverzeichnis der App. Entpackt man die
Binary aus den Assets dorthin, scheitert der Start mit `Permission denied`.
Ausführbar ist nur, was das System selbst aus `lib/<abi>/*.so` in das
`nativeLibraryDir` legt.

Deshalb:

1. `prepare-runtime.mjs --node-dir <ordner>` legt die Binary als
   `app/src/main/jniLibs/<abi>/libnode.so` ab. Die ABI wird aus dem
   ELF-`e_machine` gelesen — eine ARM-Binary im `x86_64`-Ordner würde beim
   Laden abstürzen und wird deshalb ausgelassen.
2. `minifyEnabled`/`shrinkResources` dürfen `libnode.so` nicht anfassen; dafür
   sorgen `keepDebugSymbols` und `useLegacyPackaging true`.
3. `RuntimeProcess.nativeNode()` startet genau diese Datei. Das JavaScript liegt
   weiterhin im Datenverzeichnis — dort ist nur die *Ausführung* verboten.

Ergebnis in der APK, geprüft mit `aapt2` und `apksigner`:

| | |
|---|---|
| Package | `de.fallenheaven.controlcenter` |
| minSdk / targetSdk | 26 (Android 8) / 35 (Android 15) |
| native-code | `arm64-v8a` |
| `extractNativeLibs` | `true` |
| Signatur | v2, CN=Fallen Heaven Control Center, SHA-256 `f1f02fdd…` |
| Größe | 88,5 MB |

Der ELF-Check unterscheidet dabei glibc (ablehnen) von Bionic (annehmen). Die
ältere Fassung stufte *jede* dynamisch gelinkte Binary als unbrauchbar ein und
hätte genau diese funktionierende Binary verworfen.
[tests/android/runtime-elf.test.js](../tests/android/runtime-elf.test.js) sichert
beide Richtungen ab.

### 6. Build-Werkzeug eingerichtet

Auf diesem Rechner fehlten anfangs Android SDK, Gradle und ein passendes JDK
(das System hat Java 25, AGP 8.7.3 verlangt 17 oder 21). Eingerichtet unter
`C:\tools\fhcc`:

- Temurin JDK 21.0.12.1
- Android SDK: platform-tools, `platforms;android-35`, `build-tools;35.0.0`
- Gradle 8.11.1; der Wrapper (`gradlew`, `gradlew.bat`, `gradle-wrapper.jar`)
  liegt jetzt im Repository

`android/android-env.sh` setzt `JAVA_HOME` und `ANDROID_HOME`. `local.properties`
verweist mit **Vorwärtsschrägstrichen** auf das SDK: unter Windows interpretiert
Java Backslashes in Properties als Escapesequenzen, `C:\tools` wird sonst zu
`C:<TAB>ools` und der Build bricht mit „Syntax für den Dateinamen ist falsch" ab.

Vier weitere Blocker, die den Build stoppten, und ihre Ursachen:

| Fehler | Ursache |
|---|---|
| „repository 'Google' was added by build file" | `allprojects { repositories }` gegen `FAIL_ON_PROJECT_REPOS` |
| „Could not get unknown property 'release'" | `signingConfigs` stand nach `buildTypes` |
| „Duplicate class kotlin.collections.jdk8…" | `kotlin-stdlib` 1.8.22 neben `kotlin-stdlib-jdk7/8` 1.6.21 |
| „Keystore file … not found" | `file()` löste relativ zu `:app` statt zu `rootProject` auf |

## Was noch offen ist

### Der Phantom-Process-Killer — die echte Betriebsgefahr

Ab Android 12 beendet das System Hintergrundprozesse, sobald systemweit mehr
als 32 laufen. **Ein Foreground-Service schützt nicht davor** — er zählt selbst
als einer. Ohne Gegenmaßnahme läuft der Bot also eine Weile und ist dann weg.

- **Android 14+:** Einstellungen → Entwickleroptionen →
  **„Disable child process restrictions"** einschalten. Die App weist darauf im
  Startbildschirm hin und verlinkt die Akku-Einstellungen.
- **Android 12/13:** nur per ADB:
  `adb shell settings put global settings_enable_monitor_phantom_procs false`
  (zusätzlich `device_config` für `max_phantom_processes` synchronisieren).

Aus der App heraus ist das **nicht** zu lösen.

### Nicht getestet

- **Installation und Start auf einem echten Gerät.** Wichtigster offener Punkt.
- Echter Discord-OAuth auf dem Gerät.
- Skin Studio auf dem Telefon.
- 24-Stunden-Verhalten.

### Wegwerf-Entscheidungen, falls jemand neu darauf kommt

- **Capacitor-NodeJS — vom Autor selbst abgeraten.** `hampoelz/Capacitor-NodeJS`
  bettet eine Node-Laufzeit in eine Capacitor-App ein, also genau die Idee
  „ganze App in der APK". Der Autor schreibt im Repository:

  > This plugin is no longer recommended for new projects. … The underlying
  > Node.js for Mobile Apps toolkit is unmaintained and stuck on Node.js 18.20,
  > which reached end-of-life in mid-2025. … I strongly recommend Tauri instead.

  (`nodejs-mobile` steht real auf Node 12.19.0.) Damit fällt der Weg weg:
  ausgelieferte Sicherheitslücken.

- **Tauri 2 — die Empfehlung des Autors, aber ein zweites Projekt.**
  Das Frontend (unsere Oberfläche) bleibt Web und würde wiederverwendet. Der
  Unterschied: Tauri ersetzt Node durch **Rust**. discord.js, SQLite und alle
  33 Feature-Module müssten neu geschrieben werden.

- **Node selbst gegen Bionic bauen.** Machbar mit dem NDK, aber Tage Arbeit für
  ein Ergebnis, das das fertige Termux-Paket bereits liefert.

## Bauanleitung

```bash
source android/android-env.sh                      # JDK 21 + SDK
npm ci
node android/prepare-runtime.mjs --node-dir <ordner-mit-bin/node>
cd android && ./gradlew assembleRelease
# Ergebnis: app/build/outputs/apk/release/app-release.apk
```

Für den Release-Build braucht es `android/keystore.properties` mit
`storeFile`, `storePassword`, `keyAlias`, `keyPassword`. Beides ist per
`.gitignore` ausgeschlossen — **die Datei aufbewahren**, sonst lässt sich kein
Update über eine installierte App legen. Ohne die Datei baut Gradle nur Debug.

## Geprüfte Befehle

```
npx vitest run                                              53/53 grün
npm run lint                                                exit 0 (0 Fehler)
node scripts/verify-bot-imports.mjs                         exit 0
node scripts/case-sensitive-import-audit.cjs                exit 0
node scripts/ui-field-audit.mjs                             exit 0
node scripts/ui-recovery-layout-smoke.mjs                   exit 0
node scripts/server-management-ui-smoke.mjs                 exit 0
node scripts/index-optimizations-smoke.mjs                  exit 0
cd android && ./gradlew assembleDebug                       BUILD SUCCESSFUL
cd android && ./gradlew assembleRelease                     BUILD SUCCESSFUL
```

Serverstart mit `FH_RUNTIME_PLATFORM=android FH_SQLITE_FLAVOUR=node`:
`/app/`, `ui-mobile.css` und `mobile-bridge.js` liefern alle 200.