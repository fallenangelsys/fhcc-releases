const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const artifactName = `FHCC-Setup-${packageJson.version}-x64.exe`;
const artifact = path.join(root, 'dist', artifactName);
const manifest = path.join(root, 'dist', 'latest.yml');

if (!fs.existsSync(artifact)) {
  console.error(`Update-Manifest konnte nicht erstellt werden: ${artifactName} fehlt.`);
  process.exit(1);
}

const buffer = fs.readFileSync(artifact);
const sha512 = crypto.createHash('sha512').update(buffer).digest('base64');
const releaseDate = new Date(fs.statSync(artifact).mtimeMs).toISOString();
const yaml = [
  `version: ${packageJson.version}`,
  'files:',
  `  - url: ${artifactName}`,
  `    sha512: ${sha512}`,
  `    size: ${buffer.length}`,
  `path: ${artifactName}`,
  `sha512: ${sha512}`,
  `releaseDate: '${releaseDate}'`,
  ''
].join('\n');

fs.writeFileSync(manifest, yaml, 'utf8');
console.log(`Update-Manifest erstellt: ${path.relative(root, manifest)} · ${buffer.length} Bytes · SHA-512 geprüft.`);
