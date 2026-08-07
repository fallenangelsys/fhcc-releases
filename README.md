# FALLEN HEAVEN Control Center (FHCC)

Native Discord Operations Suite für Windows. Der aktuelle Quellstand ist die eigenständige Obsidian Generation 5.

## Wichtige Projektbereiche

- `desktop/` – Electron-Hauptprozess, Renderer und native App-Oberfläche
- `src/` – Discord-Bot, Dashboard-API, Module und Laufzeitdienste
- `data/` – lokale produktive Serverdaten; niemals ungeprüft löschen
- `runtime/backups/` – manuelle Quell- und Systemeinstellungen-Sicherungen
- `public/assets/` – App-Symbole und vom Bot verwendete öffentliche Assets
- `scripts/` – Qualitäts-, Migrations- und Funktionsprüfungen

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

Ein produktiver Updatekanal wird über `FALLEN_HEAVEN_UPDATE_URL` aktiviert. Die URL muss per HTTPS auf den Ordner mit `latest.yml`, Installer und Blockmap zeigen. Ohne konfigurierte URL bleibt die Updatefunktion sichtbar, führt aber keine Netzwerkanfrage aus.

## Datenschutz

- `.env`, `data/`, `runtime/`, Installer und temporäre Builds werden nicht in die Anwendung paketiert.
- Der Release-Audit öffnet das erzeugte `app.asar` und blockiert den Build, falls private Laufzeitdaten enthalten sind.
- Diagnoseexporte enthalten keine Tokens, Passwörter oder Nachrichteninhalte.
- Bestehende FHCC-Serverdaten bleiben im bisherigen geschützten Datenordner erhalten und werden nicht in eine zweite App kopiert.
