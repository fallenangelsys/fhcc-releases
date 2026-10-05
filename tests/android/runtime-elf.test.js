import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectElf, isRunnableOnTarget } from '../../android/prepare-runtime.mjs';

/**
 * Baut eine minimale, aber structurally korrekte ELF64-Datei mit genau einem
 * PT_INTERP-Eintrag. Damit wird der Interpreter-Pfad ohne echte Binaries geprueft -
 * und zwar derselbe Code, der beim Bauen der APK ueber eine Binary entscheidet.
 */
const buildElf = (interpreter) => {
  const interpBytes = Buffer.from(`${interpreter}\0`, 'utf8');
  const phoff = 64;
  const interpOffset = phoff + 56;
  const buffer = Buffer.alloc(interpOffset + interpBytes.length);

  buffer[0] = 0x7f;
  buffer[1] = 0x45; // 'E'
  buffer[2] = 0x4c; // 'L'
  buffer[3] = 0x46; // 'F'
  buffer[4] = 2; // ELFCLASS64
  buffer.writeBigUInt64LE(BigInt(phoff), 32); // e_phoff
  buffer.writeUInt16LE(56, 52); // e_phentsize
  buffer.writeUInt16LE(1, 54 + 2); // e_phnum = 1
  buffer.writeUInt32LE(3, phoff); // p_type = PT_INTERP
  buffer.writeBigUInt64LE(BigInt(interpOffset), phoff + 8);
  buffer.writeBigUInt64LE(BigInt(interpBytes.length), phoff + 32);
  interpBytes.copy(buffer, interpOffset);
  return buffer;
};

const withTempFile = (contents, run) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fhcc-elf-'));
  const file = path.join(dir, 'node');
  fs.writeFileSync(file, contents);
  try {
    return run(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

describe('Android-Laufzeit: ELF-Pruefung', () => {
  it('weist die offizielle Linux-Binary ab (glibc-Loader)', () => {
    // Genau der Loader, der node-v24-linux-arm64.tar.xz aus nodejs.org traegt.
    const result = withTempFile(buildElf('/lib/ld-linux-aarch64.so.1'), inspectElf);
    expect(result.glibc).toBe(true);
    expect(result.interpreter).toBe('/lib/ld-linux-aarch64.so.1');
  });

  it('weist x86_64-glibc ebenfalls ab', () => {
    const result = withTempFile(buildElf('/lib64/ld-linux-x86-64.so.2'), inspectElf);
    expect(result.glibc).toBe(true);
  });

  it('akzeptiert einen Termux-Build gegen Bionic', () => {
    // Termux linkt gegen /system/bin/linker64 - das existiert auf Android.
    const result = withTempFile(buildElf('/system/bin/linker64'), inspectElf);
    expect(result.glibc).toBe(false);
    expect(result.interpreter).toBe('/system/bin/linker64');
  });

  it('akzeptiert einen 32-Bit-Bionic-Build', () => {
    const result = withTempFile(buildElf('/system/bin/linker'), inspectElf);
    expect(result.glibc).toBe(false);
  });

  it('erkennt statisch gelinkte Binaries ohne Interpreter', () => {
    // Kein PT_INTERP: der Loop laeuft durch und findet nichts.
    const header = buildElf('/system/bin/linker64');
    header.writeUInt32LE(1, 64); // p_type = PT_LOAD statt PT_INTERP
    const result = withTempFile(header, inspectElf);
    expect(result.interpreter).toBeNull();
    expect(result.glibc).toBe(false);
  });

  it('meldet fuer Nicht-ELF-Dateien kein Ergebnis statt einen Absturz', () => {
    const result = withTempFile(Buffer.from('MZ\x90\x00 keine ELF-Datei'), inspectElf);
    expect(result.interpreter).toBeNull();
    expect(result.glibc).toBe(false);
  });
});

describe('Android-Laufzeit: Kopierfilter', () => {
  it('schliesst Windows-Startskripte aus', () => {
    // Ein .cmd im Paket wuerde auf dem Geraet fehlen und den Start brechen.
    expect(isRunnableOnTarget('/x/node_modules/a/run.cmd', { isDirectory: () => false })).toBe(false);
    expect(isRunnableOnTarget('/x/node_modules/a/run.exe', { isDirectory: () => false })).toBe(false);
    expect(isRunnableOnTarget('/x/node_modules/a/index.js', { isDirectory: () => false })).toBe(true);
  });
});