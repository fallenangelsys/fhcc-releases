import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'src', 'index.js'), 'utf8');
// Health bleibt per Loopback erreichbar (botctl ohne Token, nur unkritische
// Prozessdaten). Sensible Routen (Diagnose, Guild-Daten) verlangen IMMER das
// Control-Token – auch von Loopback (requireDesktopSecure).
const healthRoute = source.indexOf("app.get('/api/app/health', requireDesktopProbe");
const diagnosticsRoute = source.indexOf("app.get('/api/app/diagnostics', requireDesktopSecure");
const forumRoute = source.indexOf("app.get('/api/app/guild/:guildId/forum-cleaner', requireDesktopSecure");
const emojiRoute = source.indexOf("app.get('/api/app/guild/:guildId/emoji-rename-preview', requireDesktopSecure");
const secureGuard = source.indexOf('const requireDesktopSecure');
const protectedBoundary = source.indexOf("app.use('/api/app', requireDesktopApp)");
const systemRoute = source.indexOf("app.get('/api/app/system/status'");
const failures = [];
if (healthRoute < 0) failures.push('Health-Leseroute (requireDesktopProbe) fehlt.');
if (diagnosticsRoute < 0 || forumRoute < 0 || emojiRoute < 0 || secureGuard < 0) failures.push('Sensible Diagnose-Routen sind nicht token-geschützt (requireDesktopSecure).');
if (!(healthRoute < protectedBoundary && diagnosticsRoute < protectedBoundary)) failures.push('Diagnose-Leserouten liegen hinter der Token-Sperre.');
if (!(protectedBoundary > 0 && protectedBoundary < systemRoute)) failures.push('Schreibende/System-Routen sind nicht hinter der Token-Sperre.');
if (!/isLoopback[\s\S]*appMarkerValid[\s\S]*tokenValid/.test(source)) failures.push('Loopback- und App-Kennung werden nicht gemeinsam geprüft.');
if (!/timingSafeEqual/.test(source)) failures.push('Token-Vergleich ist nicht timing-sicher (timingSafeEqual fehlt).');
if (/app\.(?:post|put|patch|delete)\('\/api\/app\/(?:health|diagnostics)'/.test(source)) failures.push('Diagnosezugriff ist nicht rein lesend.');

if (failures.length) {
  console.error('Diagnose-Zugriffstest fehlgeschlagen:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('Diagnose-Zugriffstest bestanden: Health loopback-frei, sensible Routen token-geschützt (timing-sicher).');
