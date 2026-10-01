// src/runtime/verifyChallenges.js
// Verify-Aufgaben-Palette für die Mitglieder-Verifizierung.
// Jede Verifizierung zieht zufällig eine Aufgabe aus diesem Katalog –
// dadurch kann kein einfaches Bot-Skript alle Varianten bedienen.
//
// Zwei Aufgaben-Kategorien:
//  - kind 'text'    → Aufgabe wird im Chat angezeigt, Antwort im Modal eingetippt
//  - kind 'buttons' → die Antwortmöglichkeiten sind direkt als Buttons da
//
// Harte Aufgaben (Bild-Captcha) brauchen echtes Sehen (OCR), die übrigen
// decken zusätzlich Timing- und Zufallsprüfungen ab (siehe memberVerify.js:
// Versuchslimit, Ablauf, Mindest-Lesezeit).
import { generateCaptcha } from './captchaImage.js';

const randomInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const randomPick = (list) => list[Math.floor(Math.random() * list.length)];
const shuffle = (list) => {
  const result = [...list];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};
const pickN = (list, count) => shuffle(list).slice(0, count);
const capitalize = (word) => String(word).charAt(0).toUpperCase() + String(word).slice(1);

export const CHALLENGE_EXPIRY_MS = 5 * 60 * 1000;

const GERMAN_NUMBERS = { 3: 'drei', 4: 'vier', 5: 'fünf', 6: 'sechs', 7: 'sieben', 8: 'acht', 9: 'neun' };

// --- Aufgaben-Builder (jeder liefert eine zufällige Instanz) ---

const buildCaptchaTask = () => {
  const { text, buffer } = generateCaptcha({ length: 4 });
  return {
    promptTitle: 'Bist du ein Mensch?',
    promptDescription: 'Gib die **4 Zeichen** aus dem Bild unten ein und klicke danach auf „Antwort eingeben“.',
    image: buffer,
    expected: text
  };
};

const buildCountEmojiTask = () => {
  const emojis = ['🍎', '🍌', '🍒', '🍇', '🍓'];
  const target = randomPick(emojis);
  const others = emojis.filter((emoji) => emoji !== target);
  const targetCount = randomInt(2, 6);
  const fillerCount = randomInt(2, 5);
  const line = shuffle([
    ...Array(targetCount).fill(target),
    ...Array(fillerCount).fill(others[0]),
    ...(Math.random() < 0.5 ? Array(randomInt(1, 2)).fill(others[1]) : [])
  ]).join('  ');
  return {
    promptTitle: 'Wie viele sind es?',
    promptDescription: `Zähle die **${target}** in dieser Reihe:\n\n${line}\n\nWie viele sind es?`,
    expected: String(targetCount)
  };
};

const buildWordMathTask = () => {
  const a = randomInt(3, 7);
  const b = randomInt(2, 6);
  return {
    promptTitle: 'Kleiner Kopfrechen-Test',
    promptDescription: `**${capitalize(GERMAN_NUMBERS[a])}** plus **${GERMAN_NUMBERS[b]}** – was ergibt das?`,
    expected: String(a + b)
  };
};

const REVERSE_WORDS = ['HAUS', 'BAUM', 'TISCH', 'WASSER', 'SPIEL', 'HIMMEL', 'SONNE', 'WELT', 'STERN', 'BLUME', 'REGEN', 'WIND', 'FEUER', 'WALD', 'BERGE', 'APFEL', 'BROT', 'MILCH', 'HONIG', 'TRAUBE'];

const buildReverseWordTask = () => {
  const word = randomPick(REVERSE_WORDS);
  return {
    promptTitle: 'Wort rückwärts',
    promptDescription: `Das Wort steht auf dem Kopf: **${[...word].reverse().join('')}**\n\nWie lautet es richtig herum?`,
    expected: word
  };
};

const buildEmojiPickTask = () => {
  const emojis = ['🍎', '🍌', '🍒', '🍇', '🍓', '🍑', '🥝', '🍉', '🍍', '🥥'];
  const target = randomPick(emojis);
  const options = shuffle([target, ...pickN(emojis.filter((emoji) => emoji !== target), 4)]);
  return {
    promptTitle: 'Klicke auf das richtige Symbol',
    promptDescription: `Klicke auf den Button mit **${target}**.`,
    options: options.map((emoji) => ({ emoji })),
    correctIndex: options.indexOf(target)
  };
};

const ODD_CATEGORIES = {
  Tiere: ['🐶', '🐱', '🐔', '🐮', '🐷', '🐰', '🦊', '🐸'],
  Obst: ['🍎', '🍌', '🍇', '🍓', '🍒', '🍍', '🍑', '🥝'],
  Fahrzeuge: ['🚗', '🚕', '🚌', '🚓', '🚑', '🚒', '🚜', '🚲'],
  Sport: ['⚽', '🏀', '🎾', '🏓', '🏸', '🎳', '🏒', '🥊']
};

const buildOddOneOutTask = () => {
  const categoryNames = Object.keys(ODD_CATEGORIES);
  const main = randomPick(categoryNames);
  const oddCategory = randomPick(categoryNames.filter((name) => name !== main));
  const correct = randomPick(ODD_CATEGORIES[oddCategory]);
  const options = shuffle([correct, ...pickN(ODD_CATEGORIES[main], 4)]);
  return {
    promptTitle: 'Was gehört nicht dazu?',
    promptDescription: 'Vier dieser Symbole gehören zusammen, **eines nicht**.\n\nKlicke auf das Symbol, das **nicht** dazu passt.',
    options: options.map((emoji) => ({ emoji })),
    correctIndex: options.indexOf(correct)
  };
};

const DIRECTIONS = [
  { word: 'links', emoji: '⬅️' },
  { word: 'rechts', emoji: '➡️' },
  { word: 'oben', emoji: '⬆️' },
  { word: 'unten', emoji: '⬇️' }
];

const buildDirectionTask = () => {
  const target = randomPick(DIRECTIONS);
  const options = shuffle(DIRECTIONS);
  return {
    promptTitle: 'Klicke auf den richtigen Pfeil',
    promptDescription: `Klicke auf den Pfeil, der nach **${target.word}** zeigt.`,
    options: options.map((direction) => ({ emoji: direction.emoji })),
    correctIndex: options.indexOf(target)
  };
};

const ANIMALS = [
  { emoji: '🐶', sound: 'Wuff' },
  { emoji: '🐱', sound: 'Miau' },
  { emoji: '🐮', sound: 'Muh' },
  { emoji: '🐴', sound: 'Wiehern' },
  { emoji: '🐔', sound: 'Gackern' },
  { emoji: '🐑', sound: 'Mäh' }
];

const buildAnimalSoundTask = () => {
  const target = randomPick(ANIMALS);
  const options = shuffle([target, ...pickN(ANIMALS.filter((animal) => animal !== target), 4)]);
  return {
    promptTitle: 'Welches Tier macht das?',
    promptDescription: `Welches Tier macht **„${target.sound}“**?`,
    options: options.map((animal) => ({ emoji: animal.emoji })),
    correctIndex: options.indexOf(target)
  };
};

const COLORS = [
  { name: 'Gelb', object: 'eine Banane' },
  { name: 'Grün', object: 'Gras' },
  { name: 'Weiß', object: 'Schnee' },
  { name: 'Rot', object: 'Blut' },
  { name: 'Blau', object: 'der Himmel' },
  { name: 'Orange', object: 'eine Orange' },
  { name: 'Lila', object: 'eine Aubergine' },
  { name: 'Schwarz', object: 'Kohle' }
];

const buildColorTask = () => {
  const target = randomPick(COLORS);
  const options = shuffle([target, ...pickN(COLORS.filter((color) => color !== target), 4)]);
  return {
    promptTitle: 'Welche Farbe?',
    promptDescription: `Welche Farbe hat **${target.object}**?`,
    options: options.map((color) => ({ label: color.name })),
    correctIndex: options.indexOf(target)
  };
};

const buildArithmeticTask = () => {
  const a = randomInt(3, 9);
  const b = randomInt(2, 9);
  const correct = a + b;
  const distractors = new Set();
  while (distractors.size < 4) {
    const candidate = correct + randomInt(-3, 3);
    if (candidate !== correct && candidate >= 2 && candidate <= 20) distractors.add(candidate);
  }
  const options = shuffle([correct, ...distractors]);
  return {
    promptTitle: 'Kleiner Kopfrechen-Test',
    promptDescription: `Was ergibt **${a} + ${b}**?`,
    options: options.map((number) => ({ label: String(number) })),
    correctIndex: options.indexOf(correct)
  };
};

// --- Katalog (gewichtete Zufallsauswahl) ---
const REGISTRY = [
  { id: 'captcha', kind: 'text', label: 'Bild-Captcha', modalLabel: 'Zeichen aus dem Bild', placeholder: 'z. B. K7RM', weight: 3, build: buildCaptchaTask },
  { id: 'countEmoji', kind: 'text', label: 'Emoji zählen', modalLabel: 'Wie viele siehst du?', placeholder: 'Zahl eingeben (z. B. 4)', weight: 2, build: buildCountEmojiTask },
  { id: 'wordMath', kind: 'text', label: 'Zahlen-Wort-Aufgabe', modalLabel: 'Deine Antwort (Zahl)', placeholder: 'z. B. 11', weight: 2, build: buildWordMathTask },
  { id: 'reverseWord', kind: 'text', label: 'Wort-Spiegel', modalLabel: 'Das Wort richtig herum', placeholder: 'z. B. HAUS', weight: 2, build: buildReverseWordTask },
  { id: 'emojiPick', kind: 'buttons', label: 'Emoji erkennen', weight: 2, build: buildEmojiPickTask },
  { id: 'oddOneOut', kind: 'buttons', label: 'Was passt nicht?', weight: 2, build: buildOddOneOutTask },
  { id: 'direction', kind: 'buttons', label: 'Richtung erkennen', weight: 2, build: buildDirectionTask },
  { id: 'animalSound', kind: 'buttons', label: 'Tier-Laute', weight: 2, build: buildAnimalSoundTask },
  { id: 'color', kind: 'buttons', label: 'Farben', weight: 2, build: buildColorTask },
  { id: 'arithmetic', kind: 'buttons', label: 'Rechenaufgabe', weight: 2, build: buildArithmeticTask }
];

export const TASK_IDS = REGISTRY.map((entry) => entry.id);

export const taskMeta = (taskId) => {
  const entry = REGISTRY.find((item) => item.id === taskId);
  return entry
    ? { id: entry.id, kind: entry.kind, label: entry.label, modalLabel: entry.modalLabel || '', placeholder: entry.placeholder || '' }
    : null;
};

const randomNonce = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

/**
 * Zieht eine zufällige Aufgabe (gewichtete Auswahl) und erzeugt die Instanz:
 * { taskId, kind, label, nonce, expected, issuedAt, expiresAt, promptTitle,
 *   promptDescription, image?, options?, correctIndex? }
 */
export const generateChallenge = () => {
  const totalWeight = REGISTRY.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = Math.random() * totalWeight;
  let selected = REGISTRY[0];
  for (const entry of REGISTRY) {
    roll -= entry.weight;
    if (roll <= 0) { selected = entry; break; }
  }
  const instance = selected.build();
  const now = Date.now();
  return {
    taskId: selected.id,
    kind: selected.kind,
    label: selected.label,
    ...instance,
    // Einheitlich: `expected` trägt bei Text-Aufgaben die Lösung, bei
    // Button-Aufgaben den Index der richtigen Option (correctIndex).
    expected: instance.expected !== undefined ? instance.expected : instance.correctIndex,
    nonce: randomNonce(),
    issuedAt: now,
    expiresAt: now + CHALLENGE_EXPIRY_MS
  };
};

// --- Antwort-Normalisierung & -Prüfung ---

export const normalizeAnswer = (taskId, raw) => {
  const value = String(raw ?? '').trim();
  if (taskId === 'captcha') return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (taskId === 'reverseWord') return value.toUpperCase().replace(/[^A-ZÄÖÜ]/g, '');
  if (taskId === 'countEmoji') return value.replace(/[^0-9]/g, '');
  if (taskId === 'wordMath') return value.replace(',', '.').trim();
  return value;
};

/**
 * Prüft eine Antwort gegen die erwartete Lösung.
 * - Text-Aufgaben: normalized Vergleich (captcha/reverseWord case-insensitive,
 *   countEmoji/wordMath numerisch)
 * - Button-Aufgaben: `submitted` ist der Index der geklickten Option
 */
export const verifyAnswer = (taskId, expected, submitted) => {
  if (taskId === 'captcha') {
    return Boolean(expected) && normalizeAnswer(taskId, submitted) === String(expected).toUpperCase().replace(/[^A-Z0-9]/g, '');
  }
  if (taskId === 'reverseWord') {
    return Boolean(expected) && normalizeAnswer(taskId, submitted) === String(expected).toUpperCase().replace(/[^A-ZÄÖÜ]/g, '');
  }
  if (taskId === 'countEmoji') {
    const submittedNumber = Math.trunc(Number(normalizeAnswer(taskId, submitted)));
    const expectedNumber = Math.trunc(Number(expected));
    return Number.isFinite(submittedNumber) && submittedNumber === expectedNumber;
  }
  if (taskId === 'wordMath') {
    const parsed = Number(normalizeAnswer(taskId, submitted));
    return Number.isFinite(parsed) && Math.abs(parsed - Number(expected)) < 0.001;
  }
  // Button-Aufgaben & Fallback
  return Number(rawInt(submitted)) === Number(rawInt(expected));
};

const rawInt = (value) => String(value ?? '').replace(/[^0-9-]/g, '');
