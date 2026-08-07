import { readFileSync } from 'node:fs';

const skinEditor = readFileSync('desktop/renderer/skin-editor.js', 'utf8');
const html = readFileSync('desktop/renderer/index.html', 'utf8');
const server = readFileSync('src/index.js', 'utf8');

const checks = [
  {
    label: 'Minecraft UV base regions are mapped',
    ok: skinEditor.includes('const SKIN_BASE_RECTS') && skinEditor.includes('const SKIN_OVERLAY_RECTS')
  },
  {
    label: 'Imported skins split base and outer layer',
    ok: skinEditor.includes('copySkinRegions(normalizedCanvas, baseContext, SKIN_BASE_RECTS)')
      && skinEditor.includes("Import · Overlay / 2. Ebene")
  },
  {
    label: 'AI generator creates separate base/detail/overlay layers',
    ok: skinEditor.includes('drawAiSkinBaseLayer')
      && skinEditor.includes('drawAiSkinDetailLayer')
      && skinEditor.includes('drawAiSkinOverlayLayer')
      && skinEditor.includes('AI · Overlay / 2. Ebene')
  },
  {
    label: 'AI assistant prompt requests UV and outer-layer design',
    ok: server.includes('64x64-UV-Layout')
      && server.includes('Base-Layer plus echte Outer-Layer-Details')
      && server.includes('keine flachen Rechteckflächen')
  },
  {
    label: 'Skin Studio UI explains layered local generation',
    ok: html.includes('UV-Flächen und Overlay') && html.includes('lokale Layer-Generator')
  }
];

const failed = checks.filter((check) => !check.ok);
if (failed.length) {
  console.error('Skin editor layered AI smoke failed:');
  for (const check of failed) console.error(`- ${check.label}`);
  process.exit(1);
}

console.log(`Skin editor layered AI smoke passed (${checks.length} checks).`);
