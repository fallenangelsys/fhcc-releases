// ---------------------------------------------------------------------------
// Smoke-Test-Umgebung: Leitet FALLEN_HEAVEN_DATA_DIR auf einen temporären
// Ordner um, BEVOR die Modul-Imports evaluieren. Muss als ERSTER Import in
// jeder Smoke-Datei stehen, die den Store berührt – sonst schreiben Tests in
// die echten Nutzerdaten (AppData).
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.FALLEN_HEAVEN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-smoke-'));
process.env.FALLEN_HEAVEN_SMOKE_TEST = '1';
