import assert from 'node:assert/strict';
import { createFeatureDispatcher } from '../src/runtime/featureDispatcher.js';

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const timeline = [];
const errors = [];
const features = [
  {
    id: 'slow',
    async onMessageCreate({ sequence }) {
      timeline.push(`slow-${sequence}-start`);
      await sleep(70);
      timeline.push(`slow-${sequence}-end`);
    }
  },
  {
    id: 'fast',
    async onMessageCreate({ sequence }) {
      timeline.push(`fast-${sequence}`);
    }
  },
  {
    id: 'broken',
    async onMessageCreate() {
      throw new Error('Testfehler');
    }
  },
  {
    id: 'slowPerGuild',
    async onMessageCreate({ message }) {
      if (!message) return;
      timeline.push(`perguild-${message.id}-start`);
      await sleep(60);
      timeline.push(`perguild-${message.id}-end`);
    }
  }
];
const dispatcher = createFeatureDispatcher({
  features,
  runOperation: async (_name, _meta, task) => task(),
  recordError: (name, error) => errors.push({ name, message: error.message })
});

const first = dispatcher.dispatch('onMessageCreate', { sequence: 1 });
await sleep(5);
const second = dispatcher.dispatch('onMessageCreate', { sequence: 2 });
await Promise.all([first, second]);

const guildFirst = dispatcher.dispatch('onMessageCreate', {
  message: { id: '1001', guildId: 'guild-a', channelId: 'channel-a' }
});
await sleep(5);
const guildSecond = dispatcher.dispatch('onMessageCreate', {
  message: { id: '1002', guildId: 'guild-b', channelId: 'channel-b' }
});
await Promise.all([guildFirst, guildSecond]);

assert(timeline.indexOf('fast-1') < timeline.indexOf('slow-1-end'), 'Schnelle Module dürfen nicht auf langsame Module warten.');
assert(timeline.indexOf('slow-1-end') < timeline.indexOf('slow-2-start'), 'Ereignisse desselben Moduls müssen geordnet bleiben.');
assert.equal(errors.filter((entry) => entry.name === 'broken.onMessageCreate' && entry.message === 'Testfehler').length, 4);
assert.equal(errors.filter((entry) => entry.name === 'slowPerGuild.onMessageCreate').length, 0);
assert(timeline.indexOf('perguild-1002-start') < timeline.indexOf('perguild-1001-end'), 'Unabhängige Guilds dürfen sich im gleichen Modul nicht gegenseitig blockieren.');
const snapshot = dispatcher.getSnapshot();
assert.equal(snapshot.activeFeatures, 0);
assert.equal(snapshot.features.find((entry) => entry.featureId === 'slow').completed, 4);
assert.equal(snapshot.features.find((entry) => entry.featureId === 'broken').failed, 4);
console.log('Feature-Dispatcher-Smoke bestanden: Module laufen parallel, pro Modul geordnet und mit zentraler Fehlererfassung.');
