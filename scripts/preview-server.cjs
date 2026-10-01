/**
 * Preview server for the FHCC desktop renderer.
 *
 * The Electron renderer normally talks to the backend through the preload
 * bridge (window.fallenHeaven). For browser previews the renderer ships a
 * read-only visual QA route: opening index.html with `?preview=<view>`
 * (login | center | community | modules | studio | skin | system) renders
 * that view statically without the bridge (see modern-ui-v5.js and the boot
 * guard in app.js).
 *
 * This server only serves the renderer directory; it needs no .env, no
 * Discord token and no build step. Default port is 3000 (the app's canonical
 * dashboard port); override with PORT if it is taken.
 */
'use strict';

const path = require('path');
const express = require('express');

const RENDERER_DIR = path.join(__dirname, '..', 'desktop', 'renderer');
const HOST = '127.0.0.1';
// Port selection: honor PORT when it is a positive integer (some machines
// export PORT=0, which would bind a random ephemeral port), otherwise try 3000
// (the app's canonical dashboard port) and fall back to 8099 when the installed
// FHCC app already holds 3000.
const requestedPort = Number(process.env.PORT);
const CANDIDATE_PORTS = Number.isInteger(requestedPort) && requestedPort > 0
  ? [requestedPort]
  : [3000, 8099];

const app = express();

// No aggressive caching: edits to the renderer files must show up on reload.
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache');
  next();
});
app.use(express.static(RENDERER_DIR));

function listen(attempt) {
  if (attempt >= CANDIDATE_PORTS.length) {
    // eslint-disable-next-line no-console
    console.error('Kein freier Port gefunden.');
    process.exit(1);
  }
  const port = CANDIDATE_PORTS[attempt];
  const server = app.listen(port, HOST);
  server.on('listening', () => {
    // eslint-disable-next-line no-console
    console.log(`FHCC renderer preview: http://${HOST}:${port}/?preview=center`);
  });
  server.on('error', (error) => {
    if (error && error.code === 'EADDRINUSE') {
      // eslint-disable-next-line no-console
      console.log(`Port ${port} belegt – versuche naechsten Kandidaten.`);
      listen(attempt + 1);
      return;
    }
    throw error;
  });
}

listen(0);
