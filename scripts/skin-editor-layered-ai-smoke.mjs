import { readFileSync } from 'node:fs';

const skinEditor = readFileSync('desktop/renderer/skin-editor.js', 'utf8');
const html = readFileSync('desktop/renderer/index.html', 'utf8');

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
    label: 'Starter skin fallback draws separate base/detail/overlay layers',
    ok: skinEditor.includes('drawStarterBaseLayer')
      && skinEditor.includes('drawStarterDetailLayer')
      && skinEditor.includes('drawStarterOverlayLayer')
      && skinEditor.includes('FH · Hood & Outer-Layer')
  },
  {
    label: 'No AI Skin Creator UI remains in the HTML',
    ok: !html.includes('skin-ai-creator')
      && !html.includes('skin-ai-open')
      && !html.includes('skin-ai-prompt')
      && !html.includes('AI SKIN CREATOR')
  },
  {
    label: 'No AI generator code remains in the skin editor',
    ok: !skinEditor.includes('createAiSkinLayers')
      && !skinEditor.includes('generateAiSkin')
      && !skinEditor.includes('normalizedSkinRecipe')
      && !skinEditor.includes('skin-ai-')
  },
  {
    label: 'No Ollama dependency remains in the skin generator',
    ok: !skinEditor.includes('ollama') && !skinEditor.includes('Ollama') && !skinEditor.includes('/api/chat')
  }
];

const failed = checks.filter((check) => !check.ok);
if (failed.length) {
  console.error('Skin editor smoke failed:');
  for (const check of failed) console.error(`- ${check.label}`);
  process.exit(1);
}

console.log(`Skin editor smoke passed (${checks.length} checks).`);
