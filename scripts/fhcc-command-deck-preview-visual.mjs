import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const playwrightModule = path.join(os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'node_modules', 'playwright', 'index.mjs');
const { chromium } = await import(pathToFileURL(playwrightModule).href);
const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true });
const previewUrl = pathToFileURL(path.resolve('docs/fhcc-command-deck-preview.html')).href;

async function verifyViewport({ width, height, screenshot }) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const consoleErrors = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.goto(previewUrl, { waitUntil: 'load' });

  for (const view of ['overview', 'server', 'modules', 'studio', 'system']) {
    await page.locator(`[data-view-target="${view}"]`).click();
    await page.waitForTimeout(450);
    const visibleViews = await page.locator('[data-view].is-active').count();
    assert.equal(visibleViews, 1, `${width}px: exactly one workspace must be active after opening ${view}.`);
    assert.equal(await page.locator(`[data-view="${view}"]`).isVisible(), true, `${width}px: ${view} must be visible.`);
    if (width === 1440) await page.screenshot({ path: `docs/fhcc-command-deck-preview-${view}.png`, fullPage: true });
  }

  await page.locator('[data-view-target="overview"]').click();
  await page.waitForTimeout(450);
  await page.locator('#command-trigger').click();
  assert.equal(await page.locator('#command-layer').isVisible(), true, `${width}px: command layer must open.`);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#command-layer').isVisible(), false, `${width}px: command layer must close.`);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 1, `${width}px: document has ${overflow}px horizontal overflow.`);
  assert.deepEqual(consoleErrors, [], `${width}px: browser console must remain clean.`);
  await page.screenshot({ path: screenshot, fullPage: true });
  await page.close();
}

await verifyViewport({ width: 1440, height: 1000, screenshot: 'docs/fhcc-command-deck-preview-desktop.png' });
await verifyViewport({ width: 390, height: 844, screenshot: 'docs/fhcc-command-deck-preview-mobile.png' });
await browser.close();

console.log('FHCC Command Deck Visual: fünf Ansichten, Command-Palette und Overflow bei 1440px/390px geprüft.');
