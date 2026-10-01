#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';

const file = 'desktop/renderer/app.js';
let c = readFileSync(file, 'utf8');
let count = 0;

// Pattern: result.config?.X || result.config || state.config.X
// Fix:     result.config?.X || state.config.X
// (Remove the dangerous || result.config fallback)
const pattern = /(\w+)\s*=\s*result\.config\?\.(\w+)\s*\|\|\s*result\.config\s*\|\|\s*state\.config\.\2/g;
c = c.replace(pattern, (match, fullKey, subKey) => {
  count++;
  return `${fullKey} = result.config?.${subKey} || state.config.${subKey}`;
});

// Sonderfall: publicCallVote (hat savedCfg Pattern)
const pcvPattern = /state\.config\.publicCallVote\s*=\s*savedCfg\.publicCallVote\s*\|\|\s*savedCfg\s*\|\|\s*state\.config\.publicCallVote/g;
c = c.replace(pcvPattern, (match) => {
  count++;
  return 'state.config.publicCallVote = savedCfg.publicCallVote || state.config.publicCallVote';
});

writeFileSync(file, c);
console.log(`Fixed ${count} onSaved callbacks (removed || result.config / || savedCfg fallback)`);
