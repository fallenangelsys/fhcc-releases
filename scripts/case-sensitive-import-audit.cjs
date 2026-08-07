const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const sourceRoots = ['src', 'desktop', 'scripts'];
const files = [];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(target);
    else if (/\.(?:js|mjs|cjs)$/i.test(entry.name)) files.push(target);
  }
}

function exactPathProblem(target) {
  let current = path.parse(target).root;
  for (const part of target.slice(current.length).split(path.sep)) {
    if (!part) continue;
    const names = fs.readdirSync(current);
    if (!names.includes(part)) {
      const exact = names.find((name) => name.toLowerCase() === part.toLowerCase());
      return exact ? { requested: part, actual: exact } : { requested: part, actual: null };
    }
    current = path.join(current, part);
  }
  return null;
}

for (const sourceRoot of sourceRoots) walk(path.join(root, sourceRoot));

const problems = [];
const patterns = [
  /^\s*import\s+(?:[^'"\r\n]+\s+from\s+)?['"](\.{1,2}\/[^'"]+)['"]/gm,
  /^\s*(?:const|let|var)\s+[^=\r\n]+?=\s*require\s*\(\s*['"](\.{1,2}\/[^'"]+)['"]/gm,
  /^\s*require\s*\(\s*['"](\.{1,2}\/[^'"]+)['"]/gm
];
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const matches = patterns.flatMap((pattern) => Array.from(source.matchAll(pattern)));
  for (const match of matches) {
    const specifier = match[1];
    const unresolved = path.resolve(path.dirname(file), specifier);
    const candidates = path.extname(unresolved)
      ? [unresolved]
      : [unresolved + '.js', unresolved + '.mjs', unresolved + '.cjs', path.join(unresolved, 'index.js')];
    const target = candidates.find((candidate) => fs.existsSync(candidate));
    if (!target) {
      problems.push({ file: path.relative(root, file), specifier, problem: 'fehlt' });
      continue;
    }
    const casing = exactPathProblem(target);
    if (casing) {
      problems.push({
        file: path.relative(root, file),
        specifier,
        problem: `Schreibweise ${casing.requested} statt ${casing.actual}`
      });
    }
  }
}

if (problems.length) {
  for (const problem of problems) console.error(`${problem.file}: ${problem.specifier} (${problem.problem})`);
  process.exit(1);
}

console.log(`Import-Audit bestanden: ${files.length} Dateien sind ASAR- und case-sensitiv kompatibel.`);
