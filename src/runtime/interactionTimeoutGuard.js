// Timeout-Watchdog: Discord erwartet innerhalb von 3 Sekunden eine Antwort auf
// jede Interaktion. Viele Handler brauchen länger (Mitglieder/Rollen laden,
// Datei-I/O auf der Freigabe, Rollen vergeben, Nachrichten senden) und lassen
// die Frist verstreichen → „Fallen-Heaven hat nicht rechtzeitig reagiert“.
// Damit das nie wieder passiert, wird jede Interaktion gepatcht:
//  1. Message-Komponenten (Buttons, Auswahl-Menüs) und Modal-Submits werden
//     nach INTERACTION_COMPONENT_DEFER_AFTER_MS unsichtbar per deferUpdate
//     bestätigt – die Original-Nachricht bleibt stehen, der Handler hat das
//     15-Minuten-Fenster für seine Antwort. Alles andere (Slash-Commands) wird
//     nach INTERACTION_DEFER_AFTER_MS per deferReply bestätigt.
//     Warum eine Schonfrist statt 0 ms? Ein 0-ms-Watchdog bestätigt VOR jedem
//     Handler – sobald der Event-Loop einmal echten I/O (Config-Datei auf der
//     Freigabe) abwartet, ist die Interaktion schon acked. Dann kann der
//     Handler kein Modal mehr öffnen (showModal MUSS die erste Antwort sein)
//     und jede eigene Antwort wird zum teuren followUp statt zum direkten
//     Update. Mit der Schonfrist gewinnen schnelle Handler (Config im Cache,
//     reply/update/showModal im selben Tick) ihren eigenen, günstigeren Ack –
//     der Watchdog bleibt mit reichlich Abstand zur 3-Sekunden-Frist bewaffnet
//     und fängt nur noch Handler ab, die wirklich langsamer werden.
//  2. reply()/update()/editReply() werden transparent auf editReply()/followUp()
//     umgeleitet, sobald bereits bestätigt wurde – bestehende Handler
//     funktionieren unverändert. Nach einem Watchdog-Defer (der Handler war zu
//     langsam) landen direkte editReply-Aufrufe auf followUp statt das
//     Original-Panel zu überschreiben; update() bearbeitet weiterhin das Panel.
//  3. showModal() wird gepatcht: Es IST eine gültige erste Antwort und hebt
//     den Watchdog auf (showModal darf nie nach einem Ack kommen).
//  4. HARTE DEADLINE (INTERACTION_RAW_ACK_DEADLINE_MS): Der normale Watchdog
//     bestätigt über die discord.js-REST-Queue. Wenn diese Queue selbst hängt
//     (Bot baut gerade 4-5 Sekunden lange Rate-Limit-Wartezeiten auf, weil
//     Hintergrund-Scans Discord an die Grenzen treiben), bleibt auch der
//     Watchdog-Defer stecken → die Interaktion verfällt trotz Schonfrist.
//     Deshalb feuert die Deadline den Bestätigungs-Callback DIREKT per HTTP an
//     die Discord-API (fetch, ohne Queue): `DEFERRED_UPDATE_MESSAGE` (6) für
//     Komponenten/Modals, `DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE` (5) für
//     Slash-Commands. Sobald der Roh-Ack erfolgreich war, gelten alle
//     gepatchten Methoden als bestätigt (rawAcked) und Antworten laufen über
//     followUp – der Nutzer sieht nie wieder „hat nicht rechtzeitig reagiert“.

export const INTERACTION_DEFER_AFTER_MS = 1_500; // Slash-Commands, Sonstiges (mehr Puffer zur 3-Sekunden-Frist)
export const INTERACTION_COMPONENT_DEFER_AFTER_MS = 500; // Buttons, Menüs, Modals: Schonfrist für eigene Antwort/Modal, dann bestätigen
export const INTERACTION_RAW_ACK_DEADLINE_MS = 1_200; // Komponenten: harte Deadline – direkter HTTP-Ack, falls die REST-Queue hängt
export const INTERACTION_SLASH_RAW_ACK_DEADLINE_MS = 2_400; // Slash-Commands: mehr Puffer, da die 3-s-Frist erst danach droht

// Injektionspunkt für Tests: Ersetzt globalThis.fetch, damit der Smoke-Test den
// Roh-Ack abfangen kann, ohne echtes Netzwerk zu berühren.
let rawAckFetcher = null;
export const __setRawAckFetcher = (fetcher) => { rawAckFetcher = fetcher || null; };

// Sendet den Bestätigungs-Callback direkt an Discords Interaktions-Endpoint –
// bewusst OHNE discord.js-REST-Queue (die unter Rate-Limit-Last Sekunden
// warten kann). Liefert true, wenn Discord den Ack akzeptiert hat.
const sendRawCallback = async (interaction, type) => {
  const id = String(interaction?.id || '');
  const token = String(interaction?.token || '');
  if (!id || !token) return false;
  const fetcher = rawAckFetcher || globalThis.fetch;
  if (typeof fetcher !== 'function') return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2_500);
  timer.unref?.();
  try {
    const response = await fetcher(`https://discord.com/api/v10/interactions/${encodeURIComponent(id)}/${encodeURIComponent(token)}/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type }),
      signal: controller.signal
    });
    return response?.ok === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
};

export const patchInteractionForTimeoutSafety = (interaction) => {
  if (!interaction || interaction.__fhTimeoutPatched) return interaction;
  try {
    const originalReply = interaction.reply?.bind(interaction);
    const originalUpdate = interaction.update?.bind(interaction);
    const originalDeferReply = interaction.deferReply?.bind(interaction);
    const originalDeferUpdate = interaction.deferUpdate?.bind(interaction);
    const originalEditReply = interaction.editReply?.bind(interaction);

    let watchdog = null;
    let deferredViaUpdate = false;
    let deferredByWatchdog = false;
    let rawAcked = false;
    let rawAckDeadline = null;
    let rawAckResolver = null;
    // Wird aufgelöst, sobald der ROH-Ack erfolgreich war – hängende
    // deferReply/deferUpdate-Aufrufe des Handlers racem dagegen und können
    // sofort weitermachen, statt auf die verstopfte REST-Queue zu warten.
    const rawAckFired = new Promise((resolve) => { rawAckResolver = resolve; });

    // Zeitpunkt der ersten Bestätigung (deferReply/deferUpdate/reply/update/
    // roher HTTP-Ack) – wird für die Interaktions-Timing-Telemetrie ausgelesen
    // (siehe recordInteractionTiming in index.js). NUR beim ersten Ack gesetzt.
    const clearWatchdog = () => {
      if (!interaction.__fhAckedAt) interaction.__fhAckedAt = Date.now();
      if (watchdog) { clearTimeout(watchdog); watchdog = null; }
    };

    // Komponenten (Buttons, Menüs) UND Modal-Submits: Beide erlauben das
    // unsichtbare deferUpdate als Bestätigung – Modal-Submits gehören damit
    // nicht mehr in die langsame Slash-Kategorie (2 s), sondern werden genauso
    // sofort bestätigt.
    const isComponent = () => typeof interaction.isButton === 'function'
      && (interaction.isButton()
        || (typeof interaction.isAnySelectMenu === 'function' && interaction.isAnySelectMenu())
        || (typeof interaction.isModalSubmit === 'function' && interaction.isModalSubmit()));

    const isAcked = () => Boolean(interaction.replied || interaction.deferred || rawAcked);

    // Harte Deadline: Wenn bis hierher NICHT bestätigt wurde (weder vom
    // Handler noch vom Watchdog-Defer), wird der Ack direkt per HTTP an
    // Discord geschickt – unabhängig von der discord.js-REST-Queue.
    const fireRawAck = () => {
      if (isAcked()) return;
      const type = isComponent() ? 6 : 5; // DEFERRED_UPDATE_MESSAGE bzw. DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE
      void sendRawCallback(interaction, type).then((ok) => {
        if (!ok || isAcked()) return;
        rawAcked = true;
        deferredViaUpdate = true;
        deferredByWatchdog = true;
        if (!interaction.__fhAckedAt) interaction.__fhAckedAt = Date.now();
        clearWatchdog();
        rawAckResolver?.();
      });
    };

    // Wenn der Handler von sich aus antwortet, ist der Watchdog überflüssig.
    const autoDefer = () => {
      if (isAcked() || !watchdog) return;
      clearWatchdog();
      try {
        if (isComponent() && typeof originalDeferUpdate === 'function') {
          // Komponente: Original-Nachricht bleibt sichtbar, Antwort kommt per
          // editReply/followUp – keine neue sichtbare „wird verarbeitet“-Nachricht.
          deferredViaUpdate = true;
          deferredByWatchdog = true;
          void originalDeferUpdate().catch(() => {
            deferredViaUpdate = false;
            deferredByWatchdog = false;
            if (typeof originalDeferReply === 'function') void originalDeferReply({ ephemeral: false }).catch(() => null);
          });
        } else if (typeof originalDeferReply === 'function') {
          void originalDeferReply({ ephemeral: false }).catch(() => null);
        } else if (typeof originalDeferUpdate === 'function') {
          deferredViaUpdate = true;
          deferredByWatchdog = true;
          void originalDeferUpdate().catch(() => {
            deferredViaUpdate = false;
            deferredByWatchdog = false;
          });
        }
      } catch { /* nie werfen */ }
    };

    // Bestätigung gilt als abgeschlossen → weitere defer-Aufrufe sind No-Ops
    // (resolve true statt Fehler). Handler mit „deferX().then(() => true).catch(
    // () => false)“ brechen dadurch nicht mehr ab, wenn der Watchdog schneller
    // war – die Antwort läuft danach transparent über editReply/followUp.
    // Wichtig: Der Watchdog wird erst NACH einer erfolgreichen Bestätigung
    // gelöscht (deferReply/deferUpdate/reply/update), bzw. bei editReply/
    // followUp gar nicht, wenn noch nichts bestätigt wurde. So kann kein
    // Handler – auch kein fehlerhafter, der z.B. zu früh editReply ruft oder
    // dessen reply() an der API scheitert – eine Interaktion unbestätigt
    // zurücklassen: Der Watchdog bestätigt dann trotzdem rechtzeitig, und die
    // harte Deadline fängt sogar eine hängende REST-Queue ab.
    if (originalDeferReply) {
      interaction.deferReply = async (payload) => {
        if (isAcked()) return true;
        const result = await Promise.race([
          originalDeferReply(payload),
          rawAckFired.then(() => ({ __fhRawAcked: true }))
        ]);
        clearWatchdog();
        return result;
      };
    }
    if (originalDeferUpdate) {
      interaction.deferUpdate = async (payload) => {
        if (isAcked()) return true;
        deferredViaUpdate = true;
        deferredByWatchdog = false;
        const result = await Promise.race([
          originalDeferUpdate(payload),
          rawAckFired.then(() => ({ __fhRawAcked: true }))
        ]);
        clearWatchdog();
        return result;
      };
    }

    interaction.reply = async (payload) => {
      if (isAcked()) {
        clearWatchdog();
        // Nach deferUpdate/Roh-Ack: neue Nachricht anhängen (followUp), damit
        // die Original-Komponenten-Nachricht sichtbar bleibt. Nach deferReply:
        // die Bestätigungsnachricht ersetzen.
        if (deferredViaUpdate && typeof interaction.followUp === 'function') {
          return interaction.followUp(payload);
        }
        return interaction.editReply ? interaction.editReply(payload) : originalReply?.(payload);
      }
      const result = originalReply ? await originalReply(payload) : undefined;
      clearWatchdog();
      return result;
    };
    if (originalEditReply) {
      interaction.editReply = async (payload) => {
        // editReply/followUp bestätigen NICHT selbst – der Watchdog bleibt
        // bewaffnet, solange keine Bestätigung erfolgt ist.
        if (isAcked()) clearWatchdog();
        // Nach einem WATCHDOG-deferUpdate (Handler war zu langsam oder die
        // Queue hängte – Roh-Ack) würde ein direkter editReply-Aufruf das
        // Original-Panel überschreiben – z.B. die Abstimmungs-Nachricht der
        // Call-Moderation. Dann stattdessen als Antwort anhängen. Nach eigenem
        // deferUpdate des Handlers bleibt editReply = Original bearbeiten
        // (Panels, private Ansichten).
        if (deferredViaUpdate && deferredByWatchdog && typeof interaction.followUp === 'function') {
          return interaction.followUp(payload);
        }
        return originalEditReply(payload);
      };
    }
    if (originalUpdate) {
      interaction.update = async (payload) => {
        if (isAcked()) {
          clearWatchdog();
          // Original-Nachricht ersetzen – wie Discord es nach deferUpdate tut.
          // Bewusst über die unveränderte editReply, damit update() nach jedem
          // Defer (eigenem, Watchdog oder Roh-Ack) weiterhin das Panel bearbeitet.
          return originalEditReply ? originalEditReply(payload) : originalUpdate(payload);
        }
        const result = await originalUpdate(payload);
        clearWatchdog();
        return result;
      };
    }
    for (const method of ['followUp']) {
      const original = interaction[method]?.bind(interaction);
      if (typeof original !== 'function') continue;
      interaction[method] = async (payload) => {
        if (isAcked()) clearWatchdog();
        return original(payload);
      };
    }
    // showModal MUSS die erste Antwort sein – nach deferReply/deferUpdate/
    // Roh-Ack ist ein Modal unmöglich. Das Patchen macht showModal ack-fähig:
    // Es hebt den Watchdog auf (showModal ist eine gültige Bestätigung),
    // markiert den Ack-Zeitpunkt für die Telemetrie und lässt einen schon
    // erfolgten Watchdog-/Roh-Defer die Modal-Öffnung NICHT zu einem unhandled
    // Fehler machen (Handler mit .catch würden sonst einen „already
    // acknowledged“-Fehler verschlucken).
    const originalShowModal = interaction.showModal?.bind(interaction);
    if (typeof originalShowModal === 'function') {
      interaction.showModal = async (payload) => {
        if (isAcked()) {
          // Watchdog/Roh-Ack war schneller → Modal kann nicht mehr geöffnet
          // werden. Ruhig zurückkehren; der Handler loggt über seinen .catch.
          return undefined;
        }
        clearWatchdog();
        try {
          return await originalShowModal(payload);
        } catch (error) {
          // showModal ist nach einem parallelen Ack-Fehler unwiederbringlich.
          try { console.warn('[interaction-guard] showModal fehlgeschlagen:', String(error?.message || error).slice(0, 200)); } catch {}
          return undefined;
        }
      };
    }

    watchdog = setTimeout(autoDefer, isComponent() ? INTERACTION_COMPONENT_DEFER_AFTER_MS : INTERACTION_DEFER_AFTER_MS);
    watchdog.unref?.();
    rawAckDeadline = setTimeout(fireRawAck, isComponent() ? INTERACTION_RAW_ACK_DEADLINE_MS : INTERACTION_SLASH_RAW_ACK_DEADLINE_MS);
    rawAckDeadline.unref?.();
    interaction.__fhTimeoutPatched = true;
    interaction.__fhClearTimeoutGuards = () => {
      if (watchdog) { clearTimeout(watchdog); watchdog = null; }
      if (rawAckDeadline) { clearTimeout(rawAckDeadline); rawAckDeadline = null; }
    };
  } catch { /* Patchen darf nie den Event-Fluss brechen */ }
  return interaction;
};
