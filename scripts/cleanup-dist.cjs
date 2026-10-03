#!/usr/bin/env node
// Räumt dist/ nach dem Windows-Build auf: behält nur die neueste EXE (inkl.
// Blockmap und latest.yml) und entfernt alte Installer sowie Zwischenartefakte.
const fs = require('fs');
const path = require('path');

const dist = path.resolve(__dirname, '..', 'dist');
if (!fs.existsSync(dist)) {
  console.log('[cleanup-dist] dist/ existiert nicht – nichts zu tun.');
  process.exit(0);
}

const entries = fs.readdirSync(dist);
const installers = entries.filter((name) => /^FHCC-Setup-[\d.]+-x64\.exe$/i.test(name));
const blockmaps = entries.filter((name) => /^FHCC-Setup-[\d.]+-x64\.exe\.blockmap$/i.test(name));

const versionOf = (name) => {
  const match = /^FHCC-Setup-([\d.]+)-x64\.exe(?:\.blockmap)?$/i.exec(name);
  return match ? match[1].split('.').map((part) => Number(part) || 0) : [0, 0, 0];
};
const compare = (left, right) => {
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
};

let kept = 0;
let removed = 0;
if (installers.length) {
  const newest = installers.sort((a, b) => compare(versionOf(b), versionOf(a)))[0];
  const newestVersion = versionOf(newest).join('.');
  for (const name of installers) {
    if (versionOf(name).join('.') === newestVersion) { kept += 1; continue; }
    fs.rmSync(path.join(dist, name), { force: true });
    removed += 1;
  }
  for (const name of blockmaps) {
    if (versionOf(name).join('.') === newestVersion) { kept += 1; continue; }
    fs.rmSync(path.join(dist, name), { force: true });
    removed += 1;
  }
}

for (const name of ['builder-debug.yml', 'builder-effective-config.yaml']) {
  fs.rmSync(path.join(dist, name), { force: true });
}
fs.rmSync(path.join(dist, 'win-unpacked'), { recursive: true, force: true });

console.log(`[cleanup-dist] Fertig: ${kept} Datei(en) behalten (neueste EXE), ${removed} alte entfernt.`);
