// Verhaltens-Check für den neuen Storage-Ladeweg (Dirty-Flag statt
// JSON.stringify-Vergleich bei jedem Config-Zugriff). Läuft isoliert in einem
// Temp-Verzeichnis und prüft: Initialisierung, stabile Config über mehrere
// Zugriffe, Set + Persistenz, Reload vom Disk, Unmodified-Erkennung.
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert';

const dataDir = mkdtempSync(join(tmpdir(), 'fh-storage-check-'));
process.env.FALLEN_HEAVEN_DATA_DIR = dataDir;

const failures = [];
const check = (condition, label) => {
  if (condition) console.log('  ✓ ' + label);
  else { console.error('  ✗ ' + label); failures.push(label); }
};

try {
  const { initializeStorage, getGuildConfig, setGuildConfig, getAllGuildConfigs, isUnmodifiedDefaultConfig, flushStorage } = await import('../src/storage.js');

  await initializeStorage();
  console.log('1) Initialisierung');
  check(true, 'initializeStorage() ohne Fehler');

  const first = await getGuildConfig('g-check-1', 'Test Server');
  const second = await getGuildConfig('g-check-1', 'Test Server');
  console.log('2) Zugriff-Stabilität');
  check(first !== null && typeof first === 'object', 'getGuildConfig liefert Objekt');
  check(JSON.stringify(first) === JSON.stringify(second), 'Zwei aufeinanderfolgende Zugriffe identisch');
  check(String(first.guildName) === 'Test Server', 'guildName übernommen');
  check(first.guildId === 'g-check-1', 'guildId gesetzt');

  console.log('3) Default-Normalisierung');
  check(typeof first.levels === 'object' || typeof first.boostRoles === 'object' || Object.keys(first).length > 30,
    'Config enthält normalisierte Default-Sektionen (' + Object.keys(first).length + ' Keys)');

  console.log('4) Set + Persistenz');
  const patched = await setGuildConfig('g-check-1', { welcomeFarewell: { enabled: true, message: 'Hallo {user}' } });
  check(patched?.welcomeFarewell?.enabled === true, 'setGuildConfig-Patch übernommen');
  const file = join(dataDir, 'guild-configs.json');
  check(existsSync(file), 'guild-configs.json auf Disk geschrieben');
  const onDisk = JSON.parse(readFileSync(file, 'utf8'));
  check(onDisk['g-check-1']?.welcomeFarewell?.message === 'Hallo {user}', 'Patch auf Disk persistiert');

  console.log('5) Unmodified-Erkennung');
  const isUnmodified = await isUnmodifiedDefaultConfig('g-fresh-1', { guildId: 'g-fresh-1' });
  check(isUnmodified === true, 'Frische Default-Config als unmodified erkannt');
  const isModified = await isUnmodifiedDefaultConfig('g-check-1', onDisk['g-check-1']);
  check(isModified === false, 'Angepasste Config als modified erkannt');

  console.log('6) Reload vom Disk (Neustart-Simulation)');
  await flushStorage();
  const before = JSON.stringify(await getAllGuildConfigs());
  // Zweiten Storage-Knoten im selben Prozess gibt es nicht – daher simulieren
  // wir den Neustart über eine frische Modul-Instanz.
  const fresh = await import('../src/storage.js?fresh=' + Date.now());
  await fresh.initializeStorage();
  const after = JSON.stringify(await fresh.getAllGuildConfigs());
  check(before === after, 'Reload liefert identische Daten');

  console.log('7) Zweiter Zugriff ohne Mutation');
  const third = await getGuildConfig('g-check-1', 'Test Server');
  check(JSON.stringify(third) === JSON.stringify(patched), 'Config bleibt nach Set über weitere Zugriffe stabil (kein Re-Normalisieren)');

  if (failures.length) {
    console.error('\nFEHLGESCHLAGEN: ' + failures.length + ' Checks');
    process.exit(1);
  }
  console.log('\nSTORAGE_CHECK_OK');
} catch (error) {
  console.error('Speicher-Check abgebrochen:', error);
  process.exit(1);
} finally {
  rmSync(dataDir, { recursive: true, force: true });
}
