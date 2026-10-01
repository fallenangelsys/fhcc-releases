# FALLEN HEAVEN Control Center (FHCC)

Native Discord Operations Suite für Windows. Der aktuelle Quellstand ist die eigenständige Obsidian Generation 5.

Dieses Repository enthält **Quellcode und Releases in einem Ort**. Der Quellcode liegt auf `main`, die veröffentlichten Installer als GitHub-Releases (Tags `v<version>`).

## Releases und Updates

Die App lädt Updates über die GitHub-Release-API. Jedes Release enthält:

- `FHCC-Setup-<version>-x64.exe` – der Windows-Installer
- `latest.yml` – Version und SHA-512-Prüfsumme (Integritätsquelle)
- `FHCC-Setup-<version>-x64.exe.blockmap` – Differentialdaten

Die SHA-512 aus `latest.yml` wird vor jedem Installationsstart geprüft. Ein Installer ohne passenden Hash wird verworfen, und eine Größenabweichung über 1 MB wird abgelehnt. Geprüft wird **bevor** der 566-MB-Download startet.

Release-Kanal in der App: *System → App Updates*. Repository und Token werden dort eingetragen; das Token wird über Windows DPAPI verschlüsselt abgelegt und verlässt die Electron-Brücke nie.

Ein Release veröffentlichen:

```powershell
npm run build:win
npm run release:publish
```

`release:publish` prüft die SHA-512 lokal vor dem Upload und ersetzt vorhandene Assets. Als Token dient `--token`, sonst `GH_TOKEN` oder `GITHUB_TOKEN`.

## Wichtige Projektbereiche

- `desktop/` – Electron-Hauptprozess, Renderer und native App-Oberfläche
- `src/` – Discord-Bot, Dashboard-API, Module und Laufzeitdienste
- `data/` – lokale produktive Serverdaten; niemals ungeprüft löschen
- `runtime/backups/` – manuelle Quell- und Systemeinstellungen-Sicherungen
- `public/assets/` – App-Symbole und vom Bot verwendete öffentliche Assets
- `scripts/` – Qualitäts-, Migrations- und Funktionsprüfungen
- `docs/` – Architektur- und Feature-Dokumentation (z. B. `ai-chat-feature-inventory.md`)

## Entwicklung

```powershell
npm install
npm run start
```

Für den Discord-Login werden mindestens `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` und die Callback-URL aus `.env.example` benötigt. Bot-Token und andere Secrets gehören ausschließlich in `.env` oder in den geschützten App-Speicher.

## Qualitätsprüfung

```powershell
npm run test:quality
npm run test:release
```

Weitere getrennte Testgruppen stehen für Anmeldung, Economy, Sicherheit, Backups, Rollen, Community und AI bereit. `test:release` prüft zusätzlich exakte Paketversionen, ASAR-Sicherheit, native SQLite-Unterstützung und case-sensitive Imports.

## Windows-Build

```powershell
npm run build:win
```

Der Build erzeugt einen x64-NSIS-Installer, `latest.yml`, eine Blockmap und FHCC mit der App-ID `de.fallenheaven.discordbot`. Anschließend startet ein isolierter Pakettest den echten Bot-Dienst ohne Discord-Anmeldung. `better-sqlite3` 13 verwendet ein mitgeliefertes Node-API-Binary und wird bewusst nicht mehr gegen eine einzelne Electron-ABI kompiliert. Dadurch bleibt der installierte Bot unabhängig von wechselnden `NODE_MODULE_VERSION`-Werten startfähig.

Als Rückfall zum GitHub-Kanal kann ein Update-Ordner per HTTPS über `FALLEN_HEAVEN_UPDATE_URL` aktiviert werden. Die URL muss auf den Ordner mit `latest.yml`, Installer und Blockmap zeigen.

## Datenschutz

- `.env`, `data/`, `runtime/`, Installer und temporäre Builds werden nicht in die Anwendung paketiert.
- Der Release-Audit öffnet das erzeugte `app.asar` und blockiert den Build, falls private Laufzeitdaten enthalten sind.
- Diagnoseexporte enthalten keine Tokens, Passwörter oder Nachrichteninhalte.
- Bestehende FHCC-Serverdaten bleiben im bisherigen geschützten Datenordner erhalten und werden nicht in eine zweite App kopiert.
- Commit-Metadaten verwenden die GitHub-Noreply-Adresse, damit keine private E-Mail-Adresse veröffentlicht wird.