#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
const file = 'desktop/renderer/app.js';
let c = readFileSync(file, 'utf8');
const needle = `if (!(await setView('studio'))) return;`;
const replacement = needle + `\n  await refreshConfig(state.selectedGuildId);`;
const before = c.split(needle).length - 1;
c = c.split(needle).join(replacement);
writeFileSync(file, c);
console.log(`Patched ${before} studio-open functions with refreshConfig()`);
