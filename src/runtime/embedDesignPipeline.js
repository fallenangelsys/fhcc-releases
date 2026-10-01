// ---------------------------------------------------------------------------
// Zentraler Speicher-/Aktualisierungspfad für ALLE Studio-Embeds.
//
// Jeder Design-Save läuft durch persistEmbedDesign:
//   1. Config laden (getConfig)
//   2. Modul-spezifisch normalisieren (save) → { patch, result }
//   3. Persistieren (persist)
//   4. Live-Refresh (refresh – wird IMMER versucht; ein Fehler verliert den
//      Save nie, sondern wird protokolliert)
//   5. Einheitliche Antwort (response oder { config: saved, ...result })
//
// Damit kann kein Modul mehr „nur speichern, aber nicht aktualisieren“:
// Der Refresh ist fester Bestandteil des Pfads und wird abgewartet, bevor die
// App ihre Bestätigung bekommt. Alle Design-Routen in index.js rufen nur noch
// diesen einen Pfad auf – die Fehlerklasse „gespeichert, aber nicht
// aktualisiert“ hat damit keinen Platz mehr.
// ---------------------------------------------------------------------------

export const persistEmbedDesign = async ({ guild, key = '', payload = {}, save, refresh, response, getConfig, persist } = {}) => {
  if (typeof save !== 'function') throw new Error(`Embed-Design (${key || 'unbekannt'}): Kein save-Schritt registriert.`);
  if (typeof getConfig !== 'function') throw new Error(`Embed-Design (${key || 'unbekannt'}): Kein getConfig-Schritt registriert.`);
  if (typeof persist !== 'function') throw new Error(`Embed-Design (${key || 'unbekannt'}): Kein persist-Schritt registriert.`);
  const cfg = await Promise.resolve(getConfig());
  const { patch, result = {} } = await save({ guild, cfg, payload });
  if (!patch || typeof patch !== 'object') {
    throw new Error(`Design-Speicherung (${key || 'unbekannt'}) ohne Config-Patch abgebrochen.`);
  }
  const saved = await Promise.resolve(persist(patch));
  if (typeof refresh === 'function') {
    try {
      await refresh({ guild, cfg: saved, result });
    } catch (error) {
      // Der Save ist bereits sicher persistiert – ein Refresh-Fehler darf die
      // Bestätigung nicht verhindern, wird aber protokolliert, damit er in der
      // Live-Diagnose sichtbar ist.
      console.warn(`[embed-design:${key || 'unbekannt'}] Live-Refresh fehlgeschlagen: ${error?.message || error}`);
    }
  }
  return response ? response(saved, result) : { config: saved, ...result };
};

export const _embedDesignPipelineInternals = {
  persistEmbedDesign
};
