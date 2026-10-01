import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const moduleSource = readFileSync('desktop/renderer/message-emoji-loader.js', 'utf8');
const studioHtml = readFileSync('desktop/renderer/index.html', 'utf8');
assert.match(studioHtml, /message-emoji-loader\.js\?v=\d+\.\d+\.\d+[\s\S]*app\.js\?v=\d+\.\d+\.\d+/, 'Emoji loader must be loaded before app.js.');
const context = { window: {} };
vm.runInNewContext(moduleSource, context, { filename: 'message-emoji-loader.js' });
assert.equal(typeof context.window.FHCCMessageEmojiLoader?.create, 'function', 'Emoji loader must expose its factory.');
const pending = new Map();
const apiRequest = ({ path }) => {
    const guildId = decodeURIComponent(path.split('/').at(-2));
    return new Promise((resolve) => pending.set(guildId, resolve));
};
const state = {
  authenticated: true,
  selectedGuildId: 'guild-a',
  messageEmojis: [],
  messageEmojiGuildId: '',
  messageEmojiLoading: false,
  messageEmojiFetchedAt: 0
};
const loader = context.window.FHCCMessageEmojiLoader.create({
  state,
  apiRequest,
  render: () => {},
  nativeEmojis: [{ id: 'native', name: 'Native' }],
  selectedGuildId: () => state.selectedGuildId
});

const guildARequest = loader.load('guild-a');
state.selectedGuildId = 'guild-b';
const guildBRequest = loader.load('guild-b');
pending.get('guild-b')({ ok: true, data: { emojis: [{ id: 'b', name: 'Guild B' }] } });
await guildBRequest;
pending.get('guild-a')({ ok: true, data: { emojis: [{ id: 'a', name: 'Guild A' }] } });
await guildARequest;

assert.equal(state.messageEmojiGuildId, 'guild-b', 'A stale response must not replace the selected guild emoji catalog.');
assert.deepEqual(state.messageEmojis.map((emoji) => emoji.id), ['native', 'b'], 'Only emojis from the currently selected guild may remain visible.');
assert.equal(state.messageEmojiLoading, false, 'The active emoji request must leave loading state cleanly.');

console.log('Message-Emoji-Cache-Smoke bestanden: Serverwechsel und veraltete Antworten sind race-sicher.');
