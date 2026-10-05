#!/usr/bin/env node
/**
 * Bereitet das Laufzeitpaket fuer die Android-APK vor.
 *
 * Die App startet den Bot selbst, also muss ein vollstaendiges Node fuer
 * arm64-v8a (Android) mitgeliefert werden - ohne das kaeme die APK beim Start
 * sofort zum Erliegen.
 *
 * Aufruf:
 *   node android/prepare-runtime.mjs [--node-dir <pfad-zur-node-arm64-linux>]
 *
 * Wird kein Node angegeben, wird nach einer bereits entpackten Laufzeit unter
 * android/app/src/main/assets/runtime gesucht.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');
const assetsRuntime = path.join(here, 'app', 'src', 'main', 'assets', 'runtime');

const args = process.argv.slice(2);
const nodeIndex = args.indexOf('--node-dir');
const providedNodeDir = nodeIndex >= 0 ? args[nodeIndex + 1] : '';

const log = (message) => console.log(`[runtime] ${message}`);

const copyDir = (from, to, filter) => {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (filter && !filter(source, entry)) continue;
    if (entry.isDirectory()) copyDir(source, target, filter);
    else fs.copyFileSync(source, target);
  }
};

/**
 * Ausfuehren auf dem Zielgeraet (arm64) wird ausgeschlossen: Der Windows-
 * Rechner koennte .cmd-Skripte kopieren, die unter Linux fehlen wuerden.
 */
const isRunnableOnTarget = (filePath, stat) => {
  if (stat.isDirectory()) return true;
  if (process.platform === 'win32' && /\.(cmd|ps1|exe|bat)$/i.test(filePath)) return false;
  return true;
};

const findBundledNode = () => {
  const binDir = path.join(assetsRuntime, 'bin');
  if (!fs.existsSync(binDir)) return null;
  const entry = fs.readdirSync(binDir).find((name) => name.startsWith('node'));
  return entry ? path.join(binDir, entry) : null;
};

const main = () => {
  fs.mkdirSync(assetsRuntime, { recursive: true });

  log('Kopiere Backend (src/) ...');
  const srcTarget = path.join(assetsRuntime, 'src');
  fs.rmSync(srcTarget, { recursive: true, force: true });
  copyDir(path.join(projectRoot, 'src'), srcTarget, isRunnableOnTarget);

  log('Kopiere Oberflaeche (desktop/renderer/) ...');
  const rendererTarget = path.join(assetsRuntime, 'desktop', 'renderer');
  fs.rmSync(rendererTarget, { recursive: true, force: true });
  copyDir(path.join(projectRoot, 'desktop', 'renderer'), rendererTarget, isRunnableOnTarget);

  log('Kopiere Abhaengigkeiten (node_modules ohne Dev-Pakete) ...');
  const modulesTarget = path.join(assetsRuntime, 'node_modules');
  fs.rmSync(modulesTarget, { recursive: true, force: true });
  const sourceModules = path.join(projectRoot, 'node_modules');
  if (fs.existsSync(sourceModules)) {
    const skip = new Set(['.bin', '.cache']);
    const dropDev = new Set(['electron', 'electron-builder', 'vitest', 'eslint', 'nodemon', '@eslint']);
    const walk = (from, to) => {
      fs.mkdirSync(to, { recursive: true });
      for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        if (skip.has(entry.name) || dropDev.has(entry.name)) continue;
        const source = path.join(from, entry.name);
        const target = path.join(to, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) walk(source, target);
        else fs.copyFileSync(source, target);
      }
    };
    walk(sourceModules, modulesTarget);
  } else {
    log('WARNUNG: node_modules fehlt - bitte vorher "npm ci" ausfuehren.');
  }

  log('Kopiere package.json ...');
  fs.copyFileSync(
    path.join(projectRoot, 'package.json'),
    path.join(assetsRuntime, 'package.json')
  );

  const nodeBinary = providedNodeDir
    ? path.join(providedNodeDir, 'bin', 'node')
    : findBundledNode();

  if (!providedNodeDir && !nodeBinary) {
    log('');
    log('=============================================================================');
    log(' Node-Laufzeit fehlt. Ohne sie startet die APK den Bot nicht.');
    log('');
    log(' WICHTIG - nicht die offizielle Linux-Binary nehmen:');
    log(' node-vXX-linux-arm64 ist gegen /lib/ld-linux-aarch64.so.1 gelinkt.');
    log(' Android besitzt diesen Loader nicht, die Binary startet dort nie.');
    log('');
    log(' Funktionierende Wege:');
    log('  1. Termux auf dem Geraet installieren, dort "pkg install nodejs-lts",');
    log('     und die Laufzeit aus Termux in assets/runtime/bin kopieren.');
    log('  2. Eine statisch gelinkte Node-Binary fuer bionic/arm64 verwenden');
    log('     (z. B. aus einem termux-ndk-Build).');
    log('');
    log(' Lage mit beiden:');
    log('   node android/prepare-runtime.mjs --node-dir <ordner>');
    log('=============================================================================');
    return;
  }

  if (providedNodeDir) {
    const sourceBinary = path.join(providedNodeDir, 'bin', 'node');
    if (!fs.existsSync(sourceBinary)) {
      log('');
      log('FEHLER: Unter ' + providedNodeDir + '/bin/node liegt keine Datei.');
      log('       Erwartet wird ein entpackter Node-Ordner mit bin/node,');
      log('       zum Beispiel aus Termux (pkg install nodejs-lts).');
      process.exitCode = 1;
      return;
    }

    log('Kopiere Node-Laufzeit aus ' + providedNodeDir + ' ...');
    fs.mkdirSync(path.join(assetsRuntime, 'bin'), { recursive: true });
    fs.copyFileSync(sourceBinary, path.join(assetsRuntime, 'bin', 'node'));
    const libSource = path.join(providedNodeDir, 'lib');
    if (fs.existsSync(libSource)) {
      copyDir(libSource, path.join(assetsRuntime, 'lib'), isRunnableOnTarget);
    }
    fs.chmodSync(path.join(assetsRuntime, 'bin', 'node'), 0o755);
  }

  // Gegenprobe: ist die Binary ueberhaupt fuer Android gebaut? Eine
  // dynamisch gelinkte Linux-Binary faellt hier auf, bevor sie als APK-Test
  // auf dem Geraet scheitert.
  const bundled = findBundledNode();
  if (bundled) {
    const check = inspectElf(bundled);
    if (check.interpreter) {
      log('');
      log('FEHLER: Die Laufzeit ist dynamisch gelinkt (' + check.interpreter + ').');
      log('       Android hat keinen Linux-Loader - sie startet auf dem Geraet nicht.');
      log('       Bitte eine statisch gelinkte oder fuer bionic gebaute Binary nehmen.');
      process.exitCode = 1;
      return;
    }
    log('Laufzeit ist statisch gelinkt und damit fuer Android verwendbar.');
  }

  log('Fertig. Naechster Schritt: cd android && gradlew assembleRelease');
};

/** Liest den ELF-Interpreter aus, um dynamisches Linking zu erkennen. */
const inspectElf = (filePath) => {
  const buffer = fs.readFileSync(filePath);
  const header = readElfHeader(buffer);
  if (!header) return { interpreter: null };
  const { phoff, phentsize, phnum } = header;
  for (let i = 0; i < phnum; i += 1) {
    const o = phoff + i * phentsize;
    if (buffer.readUInt32LE(o) !== 3) continue; // PT_INTERP
    const offset = Number(buffer.readBigUInt64LE(o + 8));
    const size = Number(buffer.readBigUInt64LE(o + 32));
    return { interpreter: buffer.subarray(offset, offset + size).toString('utf8').replace(/\0/g, '').trim() };
  }
  return { interpreter: null };
};

const readElfHeader = (buffer) => {
  if (buffer.length < 64 || buffer[0] !== 0x7f || buffer[1] !== 0x45) return null;
  const phoff = Number(buffer.readBigUInt64LE(32));
  const phentsize = buffer.readUInt16LE(54);
  const phnum = buffer.readUInt16LE(56);
  return { phoff, phentsize, phnum };
};

main();
