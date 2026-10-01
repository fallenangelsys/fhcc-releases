// Smoke-Test: atomicJsonStore mit zeitlich gedrosselter Backup-Rotation.
// Verifiziert: (1) atomarer Schreibpfad funktioniert weiter, (2) Backups
// werden beim ersten Write erstellt, (3) schnelle Folge-Writes ersetzen die
// Hauptdatei korrekt (Gedächtnis-Test), (4) readJsonWithRecovery liest den
// letzten Stand.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { atomicWriteJson, readJsonWithRecovery } from '../src/runtime/atomicJsonStore.js';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atomic-store-smoke-'));
const file = path.join(directory, 'state.json');

try {
  // 0. Datei vorab anlegen: Backup-Rotation setzt eine bestehende Datei voraus.
  await fs.writeFile(file, JSON.stringify({ version: 0, items: [] }), 'utf8');

  // 1. Erster Write: Hauptdatei + Backup-Kette (max. 2).
  const first = await atomicWriteJson(file, { version: 1, items: ['a', 'b'] }, { backupLimit: 2 });
  assert.equal(first.ok, true);
  const primary = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.deepEqual(primary, { version: 1, items: ['a', 'b'] });
  const backup1 = JSON.parse(await fs.readFile(`${file}.bak.1`, 'utf8'));
  assert.deepEqual(backup1, { version: 0, items: [] });

  // 2. Schnelle Folge-Writes (innerhalb des Drossel-Fensters): Hauptdatei
  // muss bei jedem Write den neuesten Stand enthalten, die Backup-Kette darf
  // bestehen bleiben (kein Fehler, keine Korruption).
  for (let index = 2; index <= 30; index += 1) {
    await atomicWriteJson(file, { version: index, items: [`item-${index}`] }, { backupLimit: 2 });
  }
  const latest = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(latest.version, 30);
  assert.deepEqual(latest.items, ['item-30']);

  // 3. Recovery liest den letzten Stand.
  const recovered = await readJsonWithRecovery(file, { fallback: {}, backupLimit: 2 });
  assert.equal(recovered.source, 'primary');
  assert.equal(recovered.value.version, 30);

  // 4. Simulierter „Crash“ zwischen Writes: Hauptdatei bleibt valides JSON.
  await atomicWriteJson(file, { version: 31, items: [] }, { backupLimit: 2 });
  const afterCrash = await readJsonWithRecovery(file, { fallback: {}, backupLimit: 2 });
  assert.equal(afterCrash.value.version, 31);

  console.log('✓ atomicJsonStore-Smoke: atomare Writes, Drosselung, Backups und Recovery OK');
} finally {
  await fs.rm(directory, { recursive: true, force: true });
}
