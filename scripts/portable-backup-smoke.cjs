'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  createEncryptedBackup,
  extractEncryptedBackup,
  normalizeArchivePath,
  replaceTargetsTransaction,
  validatePassphrase
} = require('../desktop/portable-backup.cjs');

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fhcc-portable-backup-test-'));
  try {
    const source = path.join(root, 'source');
    const archive = path.join(root, 'working-state.fhccbackup');
    const secondArchive = path.join(root, 'updated-working-state.fhccbackup');
    const stage = path.join(root, 'stage');
    const stageWrong = path.join(root, 'stage-wrong');
    const rollbackStage = path.join(root, 'rollback-stage');
    const dataPath = path.join(source, 'guild-configs.json');
    const imagePath = path.join(source, 'studio-image.png');
    const secureSecretPath = path.join(source, 'credentials', 'discord-token.bin');
    await fs.mkdir(path.join(source, 'credentials'), { recursive: true });
    await fs.writeFile(dataPath, '{"guilds":{"123":{"embed":{"title":"Weiterarbeiten"}}}}');
    await fs.writeFile(imagePath, Buffer.from([0, 1, 2, 3, 254, 255]));
    await fs.writeFile(secureSecretPath, Buffer.from('source-dpapi-ciphertext'));

    assert.equal(validatePassphrase('This is a strong test passphrase!'), 'This is a strong test passphrase!');
    assert.throws(() => validatePassphrase('short'), /mindestens 12/);
    assert.throws(() => normalizeArchivePath('../escape.txt'), /Ungültiger Pfad/);
    assert.throws(() => normalizeArchivePath('runtime\\data\\escape.txt'), /Ungültiger Pfad/);
    assert.throws(() => normalizeArchivePath('runtime/data/CON.txt'), /Ungültiger Pfad/);
    assert.throws(() => normalizeArchivePath('runtime/data/name. '), /Ungültiger Pfad/);

    const entries = [
      { path: 'runtime/data', type: 'directory' },
      { path: 'runtime/data/guild-configs.json', type: 'file', filePath: dataPath },
      { path: 'runtime/data/studio-images', type: 'directory' },
      { path: 'runtime/data/studio-images/studio-image.png', type: 'file', filePath: imagePath },
      { path: 'credentials', type: 'directory' },
      { path: 'credentials/discord-bot-token.bin', type: 'file', filePath: secureSecretPath },
      { path: 'portable/local-storage.json', type: 'file', data: Buffer.from('[["fh-selected-guild","123"]]') },
      { path: 'portable/secrets.json', type: 'file', data: Buffer.from('{"DISCORD_TOKEN":"sensitive"}') },
      { path: 'portable/update-token.json', type: 'file', data: Buffer.from('{"token":"private-token"}') },
      { path: 'app/startup-settings.json', type: 'file', data: Buffer.from('{"startMode":"manual"}') },
      { path: 'app/update-settings.json', type: 'file', data: Buffer.from('{"repoOwner":"fallenangel"}') }
    ];
    await assert.rejects(createEncryptedBackup({
      outputPath: path.join(root, 'duplicate.fhccbackup'),
      password: 'This is a strong test passphrase!',
      entries: [
        { path: 'runtime/data', type: 'directory' },
        { path: 'runtime/data/Case.json', type: 'file', data: Buffer.from('one') },
        { path: 'runtime/data/case.json', type: 'file', data: Buffer.from('two') }
      ]
    }), /Doppelter Backup-Pfad/);
    await assert.rejects(createEncryptedBackup({
      outputPath: path.join(root, 'ancestor.fhccbackup'),
      password: 'This is a strong test passphrase!',
      entries: [
        { path: 'runtime/data', type: 'directory' },
        { path: 'runtime/data/store', type: 'file', data: Buffer.from('file') },
        { path: 'runtime/data/store/item.json', type: 'file', data: Buffer.from('child') }
      ]
    }), /liegt innerhalb einer Datei/);

    const created = await createEncryptedBackup({
      outputPath: archive,
      password: 'This is a strong test passphrase!',
      entries
    });
    assert.equal(created.entries, entries.length);
    assert.ok(created.size > 64);

    const extracted = await extractEncryptedBackup({
      inputPath: archive,
      password: 'This is a strong test passphrase!',
      stageDirectory: stage,
      memoryPaths: ['portable/local-storage.json', 'portable/secrets.json', 'portable/update-token.json']
    });
    assert.equal(extracted.records.length, entries.length);
    assert.equal(await fs.readFile(path.join(stage, 'runtime/data/guild-configs.json'), 'utf8'), await fs.readFile(dataPath, 'utf8'));
    assert.deepEqual(await fs.readFile(path.join(stage, 'runtime/data/studio-images/studio-image.png')), await fs.readFile(imagePath));
    assert.deepEqual(await fs.readFile(path.join(stage, 'credentials/discord-bot-token.bin')), await fs.readFile(secureSecretPath));
    assert.equal(extracted.records.find((entry) => entry.path === 'portable/local-storage.json').data.toString('utf8'), '[["fh-selected-guild","123"]]');

    await assert.rejects(extractEncryptedBackup({
      inputPath: archive,
      password: 'A different and incorrect passphrase',
      stageDirectory: stageWrong,
      memoryPaths: ['portable/local-storage.json']
    }));
    await assert.rejects(fs.stat(stageWrong), { code: 'ENOENT' });

    const corrupt = path.join(root, 'corrupt.fhccbackup');
    const bytes = await fs.readFile(archive);
    bytes[Math.floor(bytes.length / 2)] ^= 0x40;
    await fs.writeFile(corrupt, bytes);
    await assert.rejects(extractEncryptedBackup({
      inputPath: corrupt,
      password: 'This is a strong test passphrase!',
      stageDirectory: path.join(root, 'stage-corrupt')
    }));

    const target = path.join(root, 'target');
    await fs.mkdir(path.join(target, 'runtime', 'data'), { recursive: true });
    await fs.writeFile(path.join(target, 'runtime', 'data', 'existing.json'), 'old-value');
    await assert.rejects(replaceTargetsTransaction({
      stageDirectory: stage,
      targetRoot: target,
      targets: ['runtime/data', 'secrets.bin']
    }));
    assert.equal(await fs.readFile(path.join(target, 'runtime', 'data', 'existing.json'), 'utf8'), 'old-value');
    await assert.rejects(replaceTargetsTransaction({ stageDirectory: stage, targetRoot: target, targets: ['../escape'] }));

    const rollbackEntry = path.join(root, 'rollback-source.json');
    await fs.writeFile(rollbackEntry, '{"title":"will rollback"}');
    await createEncryptedBackup({
      outputPath: secondArchive,
      password: 'This is a strong test passphrase!',
      entries: [
        { path: 'runtime/data', type: 'directory' },
        { path: 'runtime/data/new.json', type: 'file', filePath: rollbackEntry }
      ]
    });
    await extractEncryptedBackup({ inputPath: secondArchive, password: 'This is a strong test passphrase!', stageDirectory: rollbackStage });
    await assert.rejects(replaceTargetsTransaction({
      stageDirectory: rollbackStage,
      targetRoot: target,
      targets: ['runtime/data'],
      afterReplace: async () => { throw new Error('simulated storage failure'); }
    }), /simulated storage failure/);
    assert.equal(await fs.readFile(path.join(target, 'runtime', 'data', 'existing.json'), 'utf8'), 'old-value');
    assert.equal(await fs.readFile(path.join(target, 'runtime', 'data', 'guild-configs.json')).catch(() => null), null);

    const transaction = await replaceTargetsTransaction({
      stageDirectory: stage,
      targetRoot: target,
      targets: ['runtime/data']
    });
    assert.equal(transaction.replaced, 1);
    assert.equal(await fs.readFile(path.join(target, 'runtime/data/guild-configs.json'), 'utf8'), await fs.readFile(dataPath, 'utf8'));
    assert.equal(await fs.readFile(path.join(target, 'runtime/data/existing.json')).catch(() => null), null);

    console.log('portable-backup-smoke: alle Prüfungen bestanden.');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
