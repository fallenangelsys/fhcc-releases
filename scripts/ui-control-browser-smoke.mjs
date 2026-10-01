import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const runtime = process.env.FHCC_PLAYWRIGHT_MODULE || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const { chromium } = await import(pathToFileURL(runtime).href);
const browser = await chromium.launch({ executablePath: process.env.FHCC_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  for (const theme of ['dark', 'light']) {
    for (const width of [1280, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 800 }, reducedMotion: 'reduce' });
      await page.setContent(`<body class="authenticated" data-theme="${theme}">
        <main class="view active" style="width:100%;max-width:100%;padding:16px;box-sizing:border-box">
          <div class="page-head"><button id="action" class="button primary">Speichern &amp; aktive Interfaces aktualisieren</button></div>
          <button id="disabled" class="button primary" disabled>Wird gespeichert</button>
          <button id="secondary" class="button secondary">Abbrechen</button>
          <article class="module-card">TempVoice</article>
        </main></body>`);
      for (const file of ['ui-base.css', 'ui-aurora.css', 'ui-system.css']) {
        await page.addStyleTag({ content: await fs.readFile(path.join(root, 'desktop/renderer', file), 'utf8') });
      }
      await page.keyboard.press('Tab');
      assert.equal(await page.locator('#action').evaluate(el => getComputedStyle(el).outlineStyle), 'solid', `${theme}/${width}: keyboard focus`);
      await page.locator('#disabled').hover({ force: true });
      const disabled = await page.locator('#disabled').evaluate(el => {
        const s = getComputedStyle(el);
        return { transform: s.transform, shadow: s.boxShadow, filter: s.filter, cursor: s.cursor };
      });
      assert.deepEqual(disabled, { transform: 'none', shadow: 'none', filter: 'none', cursor: 'not-allowed' });
      await page.locator('.module-card').hover();
      assert.equal(await page.locator('.module-card').evaluate(el => getComputedStyle(el).transform), 'none');
      assert.ok(await page.locator('#action').evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${theme}/${width}: long label fits`);
      assert.ok(await page.locator('.module-card').evaluate(el => parseFloat(getComputedStyle(el).transitionDuration) <= .001), 'reduced motion');
      await page.close();
    }
  }
  console.log('UI controls: dark/light at 1280/390px; focus, disabled hover, long labels and reduced motion passed.');
} finally {
  await browser.close();
}
