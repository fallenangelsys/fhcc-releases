import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'src', 'index.js'), 'utf8');
const healthRoute = source.indexOf("app.get('/api/app/health', requireDesktopProbe");
const diagnosticsRoute = source.indexOf("app.get('/api/app/diagnostics', requireDesktopProbe");
const protectedBoundary = source.indexOf("app.use('/api/app', requireDesktopApp)");
const systemRoute = source.indexOf("app.get('/api/app/system/status'");
const failures = [];
if (healthRoute < 0 || diagnosticsRoute < 0) failures.push('Lokale Diagnose-Leseroute fehlt.');
if (!(healthRoute < protectedBoundary && diagnosticsRoute < protectedBoundary)) failures.push('Diagnose-Leserouten liegen hinter der Token-Sperre.');
if (!(protectedBoundary > 0 && protectedBoundary < systemRoute)) failures.push('Schreibende/System-Routen sind nicht hinter der Token-Sperre.');
if (!/isLoopback[\s\S]*appMarkerValid[\s\S]*tokenValid/.test(source)) failures.push('Loopback- und App-Kennung werden nicht gemeinsam geprüft.');
if (/app\.(?:post|put|patch|delete)\('\/api\/app\/(?:health|diagnostics)'/.test(source)) failures.push('Diagnosezugriff ist nicht rein lesend.');

if (failures.length) {
  console.error('Diagnose-Zugriffstest fehlgeschlagen:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('Diagnose-Zugriffstest bestanden: lokale Lesewerte frei, alle Aktionen weiter token-geschützt.');
