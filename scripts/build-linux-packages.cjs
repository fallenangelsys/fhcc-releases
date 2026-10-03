#!/usr/bin/env node
// Baut die Linux-Pakete bewusst als ZWEI electron-builder-Durchlaeufe.
//
// Grund: `electron-builder --linux AppImage deb` packt die App zweimal in
// dasselbe `dist/linux-unpacked` (das deb-Target ruft selbst noch einmal
// doBuild auf). Das dabei entstehende app.asar war im Release-Build nicht mehr
// konsistent - der gepackte Runtime-Probe las daraus den Inhalt einer
// Nachbardatei und starb mit einem Syntaxfehler. Mit einem frischen
// Durchlauf je Target entsteht das app.asar genau einmal und die Smoke-Pruefung
// prueft genau dieses Paket.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

if (process.platform !== 'linux') {
  console.error('Linux-Build bitte auf Linux oder in einem Linux-Docker-Container ausführen.');
  process.exit(1);
}

const root = path.resolve(__dirname, '..');
const unpacked = path.join(root, 'dist', 'linux-unpacked');
const electronBuilder = path.join(root, 'node_modules', '.bin', 'electron-builder');

function run(target) {
  console.log(`[linux-build] electron-builder --linux ${target} --x64 --publish never`);
  const result = spawnSync(electronBuilder, ['--linux', target, '--x64', '--publish', 'never'], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });
  if (result.error) {
    console.error(`[linux-build] electron-builder konnte nicht gestartet werden: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`[linux-build] electron-builder --linux ${target} endete mit Code ${result.status}.`);
    process.exit(result.status || 1);
  }
}

run('AppImage');

// Der AppImage-Lauf hinterlaesst ein unbrauchbares linux-unpacked - der
// deb-Lauf muss seine eigene, frische Kopie bauen.
fs.rmSync(unpacked, { recursive: true, force: true });
run('deb');

console.log('[linux-build] AppImage und .deb sind gebaut.');
