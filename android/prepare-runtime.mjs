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
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// Nur ausfuehren, wenn die Datei direkt gestartet wurde. Beim Import in Tests
// darf nicht das ganze Laufzeitpaket kopiert werden.
const isDirectRun = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
const projectRoot = path.resolve(here, '..');
const assetsRuntime = path.join(here, 'app', 'src', 'main', 'assets', 'runtime');

const args = process.argv.slice(2);
const nodeIndex = args.indexOf('--node-dir');
const providedNodeDir = nodeIndex >= 0 ? args[nodeIndex + 1] : '';

const log = (message) => console.log(`[runtime] ${message}`);

// arm64-v8a deckt jedes moderne Telefon ab. x86_64 ist fuer den Emulator da,
// damit die App auch ohne Geraet geprueft werden kann.
const ABIS = ['arm64-v8a', 'x86_64'];
// e_machine laut ELF-Spezifikation. Damit wird verhindert, dass eine ARM-Binary
// im x86_64-Ordner landet und beim Laden abstuerzt.
const ELF_MACHINES = { 'arm64-v8a': 0xb7, 'x86_64': 0x3e };

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
  const abiDir = path.join(here, 'app', 'src', 'main', 'jniLibs', 'arm64-v8a');
  const soFile = path.join(abiDir, 'libnode.so');
  return fs.existsSync(soFile) ? soFile : null;
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
    log(' Funktionierender Weg:');
    log('  Das Termux-Paket fuer aarch64 herunterladen und die Binary');
    log('  herausloesen. Sie ist gegen /system/bin/linker64 gelinkt und');
    log('  braucht damit ausser Bionic nichts aus dem System.');
    log('');
    log('   node android/prepare-runtime.mjs --node-dir <ordner-mit-bin/node>');
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
    // Bewusst KEINE Kopie nach assets/runtime/bin/node: von dort wuerde die App
    // sie in ihr schreibbares Datenverzeichnis entpacken, und Android 10+
    // verbietet dort das Ausfuehren (W^X fuer targetSdk >= 29). Zulaessig ist
    // nur das nativeLibraryDir, in das das System Dateien aus lib/<abi>/*.so
    // selbst entpackt und ausfuehrbar ablegt. Eine zweite Kopie in den Assets
    // waere zudem 45 MB Ballast in der APK.
    packageAsNativeLibrary(sourceBinary);
  }

  // Gegenprobe: ist die Binary ueberhaupt fuer Android gebaut? Entscheidend ist
  // der Interpreter, nicht das Vorhandensein eines Interpolators.
  //   statisch              -> auf Android lauffaehig
  //   /system/bin/linker64  -> Bionic, genau das nutzen Termux-Builds: lauffaehig
  //   ld-linux*/ld.so*      -> glibc, existiert auf Android nicht: zurueckweisen
  const bundled = findBundledNode();
  if (bundled) {
    const check = inspectElf(bundled);
    if (check.glibc) {
      log('');
      log('FEHLER: Die Laufzeit ist gegen glibc gelinkt (' + check.interpreter + ').');
      log('       Android hat keinen Linux-Loader - sie startet dort nie.');
      log('       Bitte eine gegen Bionic gebaute Binary nehmen (Termux-Build),');
      log('       oder das ganze Laufzeitpaket weglassen und Termux auf dem');
      log('       Geraet verwenden.');
      process.exitCode = 1;
      return;
    }
    if (check.interpreter) {
      log('Laufzeit ist gegen ' + check.interpreter + ' gelinkt (Bionic) - fuer Android verwendbar.');
    } else {
      log('Laufzeit ist statisch gelinkt und damit fuer Android verwendbar.');
    }
  }

  log('Fertig. Naechster Schritt: cd android && gradlew assembleRelease');
};

/**
 * Legt die Node-Binary als <abi>/libnode.so unter src/main/jniLibs ab.
 * AGP extrahiert sie beim Installieren nach nativeLibraryDir und setzt dort
 * das Ausfuehrungsbit - der einzige Weg, auf dem der Prozess auf Android 10+
 * ueberhaupt starten darf.
 */
const packageAsNativeLibrary = (sourceBinary) => {
  const machine = readElfMachine(sourceBinary);
  const abis = ABIS.filter((abi) => ELF_MACHINES[abi] === machine);
  if (abis.length === 0) {
    log('');
    log('FEHLER: Die Binary passt zu keiner unterstuetzten ABI.');
    log('       erwartet: ' + ABIS.map((a) => a + ' (e_machine 0x' + ELF_MACHINES[a].toString(16) + ')').join(' oder '));
    log('       gefunden : 0x' + machine.toString(16));
    process.exitCode = 1;
    return;
  }
  const skipped = ABIS.filter((abi) => !abis.includes(abi));
  const jniRoot = path.join(here, 'app', 'src', 'main', 'jniLibs');
  for (const abi of abis) {
    const dir = path.join(jniRoot, abi);
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(sourceBinary, path.join(dir, 'libnode.so'));
  }
  log(`Als native Bibliothek verpackt: ${abis.join(', ')} (libnode.so)`);
  if (skipped.length) {
    log(`  ausgelassen: ${skipped.join(', ')} - die Binary ist dafuer nicht gebaut,`);
    log('  eine fremde Architektur im jniLibs-Ordner wuerde beim Laden abstuerzen.');
  }
};

/** e_machine aus dem ELF-Header (Offset 18). */
const readElfMachine = (filePath) => {
  const buffer = fs.readFileSync(filePath);
  if (buffer.length < 20 || buffer[0] !== 0x7f || buffer[1] !== 0x45) return -1;
  return buffer.readUInt16LE(18);
};

/** Liest den ELF-Interpreter aus und erkennt, ob es ein glibc-Loader ist. */
const inspectElf = (filePath) => {
  const buffer = fs.readFileSync(filePath);
  const header = readElfHeader(buffer);
  if (!header) return { interpreter: null, glibc: false };
  const { phoff, phentsize, phnum } = header;
  for (let i = 0; i < phnum; i += 1) {
    const o = phoff + i * phentsize;
    if (buffer.readUInt32LE(o) !== 3) continue; // PT_INTERP
    const offset = Number(buffer.readBigUInt64LE(o + 8));
    const size = Number(buffer.readBigUInt64LE(o + 32));
    const interpreter = buffer.subarray(offset, offset + size).toString('utf8').replace(/\0/g, '').trim();
    // glibc-Loader existieren unter Android nicht. Bionics linker64 ist der
    // regulaere Weg (Termux) und muss durchgelassen werden.
    const glibc = /(ld-linux|ld\.so|ld64\.so|libc\.so)/i.test(interpreter)
      && !/linker/i.test(interpreter);
    return { interpreter, glibc };
  }
  return { interpreter: null, glibc: false };
};

const readElfHeader = (buffer) => {
  if (buffer.length < 64 || buffer[0] !== 0x7f || buffer[1] !== 0x45) return null;
  const phoff = Number(buffer.readBigUInt64LE(32));
  const phentsize = buffer.readUInt16LE(54);
  const phnum = buffer.readUInt16LE(56);
  return { phoff, phentsize, phnum };
};

if (isDirectRun) main();

export { inspectElf, isRunnableOnTarget };
