import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'fh-economy-merge-'));
const targetFile = path.join(temporaryRoot, 'heaven-economy.json');
const sourceFile = path.join(temporaryRoot, 'legacy-heaven-economy.json');
process.env.FALLEN_HEAVEN_DATA_DIR = temporaryRoot;

await fs.writeFile(targetFile, JSON.stringify({
  version: 1,
  guilds: {
    guild: {
      accounts: {
        current: {
          balance: 75,
          earned: 100,
          spent: 25,
          boostRecord: 1,
          rewardedBoostLevels: [1],
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-02T00:00:00.000Z'
        }
      },
      transactions: [{ id: 'CURRENT', type: 'manual-add', userId: 'current', amount: 75, createdAt: '2026-08-02T00:00:00.000Z' }]
    }
  }
}, null, 2));

await fs.writeFile(sourceFile, JSON.stringify({
  version: 1,
  guilds: {
    guild: {
      accounts: {
        current: {
          balance: 90,
          earned: 90,
          spent: 0,
          boostRecord: 3,
          rewardedBoostLevels: [1, 2, 3],
          createdAt: '2026-07-01T00:00:00.000Z',
          updatedAt: '2026-07-20T00:00:00.000Z'
        },
        legacy: {
          balance: 500,
          earned: 500,
          spent: 0,
          boostRecord: 5,
          rewardedBoostLevels: [1, 2, 3, 4, 5],
          createdAt: '2026-07-01T00:00:00.000Z',
          updatedAt: '2026-07-20T00:00:00.000Z'
        }
      },
      transactions: [
        { id: 'LEGACY', type: 'boost-milestone', userId: 'legacy', amount: 500, createdAt: '2026-07-20T00:00:00.000Z' },
        { id: 'CURRENT', type: 'manual-add', userId: 'current', amount: 75, createdAt: '2026-08-02T00:00:00.000Z' }
      ]
    }
  }
}, null, 2));

const { migrateHeavenEconomyStore } = await import(`../src/features/heavenEconomy.js?merge=${Date.now()}`);
const result = await migrateHeavenEconomyStore({ sourceFiles: [sourceFile] });
assert.equal(result.version, 2);
assert.equal(result.accounts, 2);
assert.equal(result.accountsAdded, 1);
assert.equal(result.transactionsAdded, 1);

const merged = JSON.parse(await fs.readFile(targetFile, 'utf8'));
const guild = merged.guilds.guild;
assert.equal(merged.version, 2);
assert.equal(guild.accounts.current.balance, 75, 'Der neuere aktuelle Kontostand muss gewinnen.');
assert.equal(guild.accounts.current.boostRecord, 3, 'Monotone Boost-Rekorde müssen erhalten bleiben.');
assert.deepEqual(guild.accounts.current.rewardedBoostLevels, [1, 2, 3]);
assert.equal(guild.accounts.legacy.balance, 500);
assert.deepEqual(guild.transactions.map((entry) => entry.id), ['LEGACY', 'CURRENT']);
await fs.access(`${targetFile}.bak`);

await fs.rm(temporaryRoot, { recursive: true, force: true });
console.log('Heaven-Economy-Migrations-Smoke bestanden: getrennte Datenorte werden verlustfrei und idempotent zusammengeführt.');
