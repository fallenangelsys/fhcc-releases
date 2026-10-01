#!/usr/bin/env node
/**
 * Smoke-Test: Zentraler Embed-Design-Pipeline.
 *
 * Beweist, dass der EINZIGE Speicher-/Aktualisierungspfad für alle
 * Studio-Embeds zuverlässig funktioniert:
 *   1. save → persist → refresh wird IMMER versucht (auch wenn er wirft,
 *      geht der Save nie verloren) → einheitliche Antwort.
 *   2. Ohne Config-Patch bricht der Save mit klarer Meldung ab.
 *   3. Bild-Validierung (validateEmbedImageUrls) akzeptiert HTTP(S)-URLs und
 *      {Platzhalter}-Tokens, lehnt kaputte Bildfelder ab.
 *   4. savePersistentEmbedDesign nutzt die Validierung im Standardablauf.
 */
import assert from 'node:assert/strict';
import { persistEmbedDesign, _embedDesignPipelineInternals } from '../src/runtime/embedDesignPipeline.js';
import { savePersistentEmbedDesign, _persistentEmbedInternals } from '../src/runtime/persistentEmbedService.js';

let passed = 0;
const ok = (label) => { passed += 1; console.log(`  ✅ ${label}`); };

// ---- 1. Happy Path: save → persist → refresh → einheitliche Antwort --------
{
  const calls = [];
  const result = await persistEmbedDesign({
    guild: { id: 'g1', name: 'Test' },
    key: 'testModul',
    payload: { section: 'panel' },
    save: async ({ guild, cfg, payload }) => {
      calls.push('save');
      assert.equal(guild.id, 'g1', 'save bekommt den Guild');
      assert.equal(cfg.marker, 'geladen', 'save bekommt die geladene Config');
      assert.equal(payload.section, 'panel', 'save bekommt das Payload');
      return { patch: { modul: { marker: 'neu', design: { title: 'X' } } }, result: { design: { title: 'X' }, section: 'panel' } };
    },
    getConfig: async () => ({ marker: 'geladen' }),
    persist: async (patch) => {
      calls.push('persist');
      assert.deepEqual(patch, { modul: { marker: 'neu', design: { title: 'X' } } }, 'persist bekommt genau den Patch');
      return { modul: patch.modul, savedAt: 'soeben' };
    },
    refresh: async ({ guild, cfg, result }) => {
      calls.push('refresh');
      assert.equal(guild.id, 'g1', 'refresh bekommt den Guild');
      assert.equal(cfg.savedAt, 'soeben', 'refresh bekommt die GESPEICHERTE Config');
      assert.equal(result.section, 'panel', 'refresh bekommt das Ergebnis');
    }
  });
  assert.deepEqual(calls, ['save', 'persist', 'refresh'], 'Reihenfolge: save → persist → refresh');
  assert.equal(result.config.modul.marker, 'neu', 'Antwort trägt die gespeicherte Config');
  assert.deepEqual(result.design, { title: 'X' }, 'Antwort trägt das Modul-Ergebnis');
  assert.equal(result.section, 'panel', 'Antwort trägt die Sektion');
  ok('Happy Path: save → persist → refresh → einheitliche Antwort');
}

// ---- 2. Refresh-Fehler verliert den Save nie --------------------------------
{
  const calls = [];
  const result = await persistEmbedDesign({
    guild: { id: 'g1' },
    key: 'testModul',
    save: async () => ({ patch: { modul: { ok: true } }, result: { id: 'r1' } }),
    getConfig: async () => ({}),
    persist: async (patch) => { calls.push('persist'); return { ok: true }; },
    refresh: async () => { calls.push('refresh'); throw new Error('Kanal nicht erreichbar'); }
  });
  assert.deepEqual(calls, ['persist', 'refresh'], 'Refresh wird trotzdem versucht');
  assert.equal(result.config.ok, true, 'Save ist trotz Refresh-Fehler bestätigt');
  assert.equal(result.id, 'r1', 'Ergebnis bleibt erhalten');
  ok('Refresh-Fehler verliert den Save nie (wird trotzdem versucht)');
}

// ---- 3. Ohne Config-Patch: klare Meldung ------------------------------------
{
  let failed = false;
  try {
    await persistEmbedDesign({
      guild: { id: 'g1' },
      key: 'kaputt',
      save: async () => ({ result: {} }),
      getConfig: async () => ({}),
      persist: async () => ({})
    });
  } catch (error) {
    failed = true;
    assert.match(String(error.message), /Config-Patch/, 'Fehlermeldung nennt den fehlenden Patch');
  }
  assert.equal(failed, true, 'Save ohne Patch schlägt fehl');
  ok('Save ohne Config-Patch bricht mit klarer Meldung ab');
}

// ---- 4. response-Override ------------------------------------------------
{
  const result = await persistEmbedDesign({
    guild: { id: 'g1' },
    key: 'levelUpInfo',
    save: async () => ({ patch: { embeds: {} }, result: { status: { action: 'posted' } } }),
    getConfig: async () => ({}),
    persist: async (patch) => ({ embeds: patch.embeds, levels: { levelUpInfoEnabled: true } }),
    response: (saved, result) => ({ config: saved.embeds, levels: saved.levels, ...result })
  });
  assert.equal(result.levels.levelUpInfoEnabled, true, 'Antwort nutzt das response-Override');
  assert.equal(result.status.action, 'posted', 'Ergebnis bleibt im Override erhalten');
  ok('response-Override liefert die modul-spezifische Antwortform');
}

// ---- 5. Bild-Validierung ----------------------------------------------------
{
  const validate = _persistentEmbedInternals.validateEmbedImageUrls;
  validate({ thumbnailUrl: 'https://cdn.discordapp.com/x.png', imageUrl: '{userAvatar}', authorIconUrl: '', footerIconUrl: 'http://a.b/c.gif' }, 'Test');
  ok('Bild-Validierung akzeptiert HTTP(S)-URLs und {Platzhalter}');

  let rejected = false;
  try {
    validate({ thumbnailUrl: 'ftp://x' }, 'Test');
  } catch (error) {
    rejected = true;
    assert.match(String(error.message), /Thumbnail/, 'Fehler nennt das betroffene Feld');
  }
  assert.equal(rejected, true, 'Ungültige Bild-URL wird abgelehnt');
  ok('Bild-Validierung lehnt kaputte Bild-URLs mit klarer Meldung ab');
}

// ---- 6. savePersistentEmbedDesign nutzt die Validierung standardmäßig ------
{
  const guild = {
    id: 'g1',
    channels: { cache: new Map(), get: () => null }
  };
  let rejected = false;
  try {
    await savePersistentEmbedDesign({
      guild,
      template: { embeds: [{ title: 'X', thumbnailUrl: 'not-a-url' }] },
      options: { designId: 'test', designName: 'Test-Embed' }
    });
  } catch (error) {
    rejected = true;
    assert.match(String(error.message), /Thumbnail/, 'Fehler nennt das Bildfeld');
  }
  assert.equal(rejected, true, 'Standard-Pipeline lehnt ungültige Bildfelder ab');
  ok('savePersistentEmbedDesign validiert Bilder im Standardablauf');
}

console.log(`\nembed-design-pipeline-smoke: ok (${passed} Prüfungen)`);
