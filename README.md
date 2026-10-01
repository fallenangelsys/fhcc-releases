# FALLEN HEAVEN Control Center - Releases

Dieses Repository enthaelt ausschliesslich veroeffentlichte Versionen der Desktop-App.

Die App laedt Updates ueber die GitHub-Release-API. Jedes Release enthaelt:

- `FHCC-Setup-<version>-x64.exe` - der Windows-Installer
- `latest.yml` - Version und SHA-512-Pruefsumme (Integritaetsquelle)
- `FHCC-Setup-<version>-x64.exe.blockmap` - Differentialdaten

Die SHA-512 aus `latest.yml` wird vor jedem Installationsstart geprueft.
Ein Installer ohne passenden Hash wird verworfen.
