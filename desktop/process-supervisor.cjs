const { spawn, execFile, execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

const { detectFreshInstall } = require('./startup-mode.cjs');

function redactLogValue(value) {
  return String(value || '')
    .replace(/\b(?:mfa\.)?[A-Za-z0-9_-]{15,30}\.[A-Za-z0-9_-]{5,8}\.[A-Za-z0-9_-]{20,50}\b/g, '[DISCORD-TOKEN GESCHÜTZT]')
    .replace(/\b(?:sk|key|token|secret)[-_]?[A-Za-z0-9_-]{20,}\b/gi, '[SECRET GESCHÜTZT]')
    .replace(/\b(?:DISCORD_TOKEN|DISCORD_CLIENT_SECRET|GOOGLE_API_KEY)\s*[=:]\s*[^\s]+/gi, '$1=[GESCHÜTZT]');
}

function parseEnv(source) {
  const values = {};
  for (const line of String(source || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

class BotProcessSupervisor {
  constructor({ app, safeStorage, projectRoot, isPackaged, onState, onEvent, getRuntimeSecrets }) {
    this.app = app;
    this.safeStorage = safeStorage;
    this.projectRoot = projectRoot;
    this.isPackaged = isPackaged;
    this.onState = typeof onState === 'function' ? onState : () => {};
    this.onEvent = typeof onEvent === 'function' ? onEvent : () => {};
    this.getRuntimeSecrets = typeof getRuntimeSecrets === 'function' ? getRuntimeSecrets : () => ({});
    this.child = null;
    this.queue = Promise.resolve();
    this.healthFailures = 0;
    this.lastHealthyAt = 0;
    this.preferredPort = Number(process.env.FALLEN_HEAVEN_PORT || 3000);
    this.port = this.preferredPort;
    this.controlToken = crypto.randomBytes(32).toString('base64url');
    this.instanceId = crypto.randomUUID();
    this.state = {
      phase: 'stopped', active: false, ready: false, pid: null,
      message: 'Bot ist gestoppt.', port: this.port, updatedAt: new Date().toISOString()
    };
    this.paths = this.prepareRuntime();
  }

  getLogPath() {
    return this.paths.log;
  }

  getControlHeaders() {
    return {
      'x-fallen-heaven-app': 'desktop-control-v2',
      'x-fallen-heaven-control': this.controlToken
    };
  }

  getInstanceId() {
    return this.instanceId;
  }

  publish(next) {
    this.state = { ...this.state, ...next, updatedAt: new Date().toISOString() };
    this.onState(this.state);
    return this.state;
  }

  log(message) {
    try {
      if (existsSync(this.paths.log) && statSync(this.paths.log).size > 10 * 1024 * 1024) {
        for (let index = 3; index >= 1; index -= 1) {
          const source = index === 1 ? this.paths.log : `${this.paths.log}.${index - 1}`;
          const destination = `${this.paths.log}.${index}`;
          if (!existsSync(source)) continue;
          try { if (existsSync(destination)) rmSync(destination, { force: true }); } catch {}
          try { renameSync(source, destination); } catch {}
        }
      }
      appendFileSync(this.paths.log, `[${new Date().toISOString()}] ${redactLogValue(message)}\n`, 'utf8');
    } catch {}
  }

  prepareRuntime() {
    const userData = this.app.getPath('userData');
    const root = path.join(userData, 'runtime');
    const data = path.join(root, 'data');
    const logs = path.join(root, 'logs');
    const secrets = path.join(userData, 'secrets.bin');
    mkdirSync(data, { recursive: true });
    mkdirSync(logs, { recursive: true });

    // Nur im Entwicklungsmodus wird ein geerbter Datenordner uebernommen. In der
    // gepackten App wuerde das sonst die Serverdaten des Entwicklerrechners in eine
    // frische Installation kopieren - der Bot startete dadurch mit fremden Daten.
    const legacyData = path.join(this.projectRoot, 'data');
    let targetEmpty = true;
    try { targetEmpty = readdirSync(data).length === 0; } catch {}
    if (!this.isPackaged && targetEmpty && existsSync(legacyData)) {
      try { cpSync(legacyData, data, { recursive: true, force: false, errorOnExist: false }); } catch {}
    }

    if (this.isPackaged) {
      const sourcePublic = path.join(this.projectRoot, 'public');
      const runtimePublic = path.join(root, 'public');
      if (!existsSync(runtimePublic) && existsSync(sourcePublic)) {
        try { symlinkSync(sourcePublic, runtimePublic, 'junction'); }
        catch { try { cpSync(sourcePublic, runtimePublic, { recursive: true, force: false }); } catch {} }
      }
      const sourceCode = path.join(this.projectRoot, 'src');
      const runtimeCode = path.join(root, 'src');
      if (existsSync(sourceCode)) {
        try { cpSync(sourceCode, runtimeCode, { recursive: true, force: true }); } catch {}
      }
      const bundledModules = path.join(this.projectRoot, '.desktop-runtime', 'node_modules');
      const runtimeModules = path.join(root, 'node_modules');
      if (!existsSync(runtimeModules) && existsSync(bundledModules)) {
        try { symlinkSync(bundledModules, runtimeModules, 'junction'); }
        catch { try { cpSync(bundledModules, runtimeModules, { recursive: true, force: false }); } catch {} }
      }
    }
    return { root, data, logs, secrets, log: path.join(logs, 'bot-runtime.log') };
  }

  secretCandidates() {
    // In der gepackten App zaehlt ausschliesslich die .env neben den Appdaten.
    // Projektordner und ~/Documents/Discord Bot sind Entwicklungsrueckfaelle -
    // ohne diese Einschraenkung wuerde deren DISCORD_TOKEN still eine fremde
    // Installation starten.
    if (this.isPackaged) return [path.join(this.app.getPath('userData'), '.env')];
    return [
      path.join(this.app.getPath('userData'), '.env'),
      path.join(this.projectRoot, '.env'),
      path.join(this.app.getPath('documents'), 'Discord Bot', '.env')
    ];
  }

  /**
   * true, sobald die App mindestens einmal benutzt wurde. Ein frischer Start hat
   * zwar Heartbeat- und Sitzungsdateien, aber keine Serverkonfiguration.
   */
  isFreshInstall() {
    let entries = [];
    try { entries = readdirSync(this.paths.data); } catch {}
    return detectFreshInstall(entries);
  }

  ensureManagedSecrets(values = {}) {
    const managed = { ...values };
    let changed = false;
    if (!managed.DASHBOARD_SESSION_SECRET) {
      managed.DASHBOARD_SESSION_SECRET = crypto.randomBytes(48).toString('hex');
      changed = true;
    }
    if (changed && this.safeStorage.isEncryptionAvailable()) {
      try {
        writeFileSync(this.paths.secrets, this.safeStorage.encryptString(JSON.stringify(managed)));
        this.log('Dauerhaftes Dashboard-Sitzungsgeheimnis verschlüsselt gespeichert.');
      } catch (error) {
        this.log(`Dashboard-Sitzungsgeheimnis konnte nicht gespeichert werden: ${error.message}`);
      }
    }
    return managed;
  }

  loadSecrets() {
    const newerSource = this.secretCandidates().find((candidate) => {
      if (!existsSync(candidate)) return false;
      if (!existsSync(this.paths.secrets)) return true;
      try { return statSync(candidate).mtimeMs > statSync(this.paths.secrets).mtimeMs; } catch { return false; }
    });
    if (!newerSource && existsSync(this.paths.secrets) && this.safeStorage.isEncryptionAvailable()) {
      try {
        return this.ensureManagedSecrets(JSON.parse(this.safeStorage.decryptString(readFileSync(this.paths.secrets))));
      } catch (error) {
        this.log(`Verschlüsselte Konfiguration konnte nicht gelesen werden: ${error.message}`);
        // Backup der defekten Datei, damit der Benutzer sie wiederherstellen kann
        try {
          const backupPath = this.paths.secrets + '.broken.' + Date.now();
          cpSync(this.paths.secrets, backupPath);
          this.log(`Backup der defekten Konfiguration: ${backupPath}`);
        } catch {}
      }
    }
    for (const candidate of newerSource ? [newerSource] : this.secretCandidates()) {
      if (!existsSync(candidate)) continue;
      try {
        const values = parseEnv(readFileSync(candidate, 'utf8'));
        if (!Object.keys(values).length) continue;
        const managed = this.ensureManagedSecrets(values);
        if (this.safeStorage.isEncryptionAvailable()) {
          writeFileSync(this.paths.secrets, this.safeStorage.encryptString(JSON.stringify(managed)));
          this.log('Secret-Konfiguration mit Windows-Verschlüsselung gesichert.');
        }
        return managed;
      } catch (error) {
        this.log(`Secret-Migration fehlgeschlagen: ${error.message}`);
      }
    }
    return this.ensureManagedSecrets({});
  }

  saveSecrets(patch = {}) {
    if (!this.safeStorage.isEncryptionAvailable()) {
      return { ok: false, error: 'Windows-Verschlüsselung ist für dieses Benutzerkonto nicht verfügbar.' };
    }
    const allowedKeys = new Set([
      'DISCORD_CLIENT_ID',
      'DISCORD_CLIENT_SECRET',
      'DASHBOARD_DISCORD_REDIRECT_URI',
      'DASHBOARD_SESSION_SECRET',
      'DASHBOARD_JWT_TTL'
    ]);
    const current = this.loadSecrets();
    const next = { ...current };
    for (const [key, rawValue] of Object.entries(patch || {})) {
      if (!allowedKeys.has(key)) continue;
      const value = String(rawValue || '').trim();
      if (value) next[key] = value;
      else delete next[key];
    }
    const managed = this.ensureManagedSecrets(next);
    writeFileSync(this.paths.secrets, this.safeStorage.encryptString(JSON.stringify(managed)), { mode: 0o600 });
    this.log('OAuth- und Dashboard-Zugangsdaten wurden verschlüsselt aktualisiert.');
    return { ok: true };
  }

  deleteSecrets(keys = []) {
    if (!this.safeStorage.isEncryptionAvailable()) {
      return { ok: false, error: 'Windows-Verschlüsselung ist für dieses Benutzerkonto nicht verfügbar.' };
    }
    const current = this.loadSecrets();
    const next = { ...current };
    for (const key of keys) delete next[String(key || '')];
    const managed = this.ensureManagedSecrets(next);
    writeFileSync(this.paths.secrets, this.safeStorage.encryptString(JSON.stringify(managed)), { mode: 0o600 });
    this.log('Ausgewählte verschlüsselte Zugangsdaten wurden entfernt.');
    return { ok: true };
  }

  getSecretStatus() {
    const values = this.loadSecrets();
    const clientId = String(values.DISCORD_CLIENT_ID || '').trim();
    const clientSecret = String(values.DISCORD_CLIENT_SECRET || '').trim();
    const clientIdValid = /^\d{15,22}$/.test(clientId);
    const clientSecretValid = clientSecret.length >= 20 && !/^paste_your_/i.test(clientSecret) && !/\s/.test(clientSecret);
    return {
      encrypted: existsSync(this.paths.secrets) && this.safeStorage.isEncryptionAvailable(),
      discordToken: Boolean(values.DISCORD_TOKEN || values.BOT_TOKEN),
      discordClientId: clientIdValid,
      discordClientSecret: clientSecretValid,
      oauthConfigured: clientIdValid && clientSecretValid,
      redirectUri: String(values.DASHBOARD_DISCORD_REDIRECT_URI || '')
    };
  }

  health(timeout = 4000) {
    return new Promise((resolve) => {
      const request = http.request({
        hostname: '127.0.0.1', port: this.port, path: '/api/app/health', method: 'GET',
        headers: this.getControlHeaders(), timeout
      }, (response) => {
        let raw = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { raw += chunk; });
        response.on('end', () => {
          try { resolve(response.statusCode === 200 ? JSON.parse(raw) : null); } catch { resolve(null); }
        });
      });
      request.once('timeout', () => request.destroy());
      request.once('error', () => resolve(null));
      request.end();
    });
  }

  publicHealth(port = this.port, timeout = 1800) {
    return new Promise((resolve) => {
      const request = http.request({
        hostname: '127.0.0.1', port, path: '/api/ping', method: 'GET', timeout
      }, (response) => {
        let raw = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { raw += chunk; });
        response.on('end', () => {
          try {
            const data = JSON.parse(raw);
            resolve(response.statusCode === 200 && data?.ok === true ? data : null);
          } catch { resolve(null); }
        });
      });
      request.once('timeout', () => request.destroy());
      request.once('error', () => resolve(null));
      request.end();
    });
  }

  isPortOccupied(timeout = 700) {
    return new Promise((resolve) => {
      const socket = net.createConnection({ host: '127.0.0.1', port: this.port });
      let settled = false;
      const finish = (occupied) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(occupied);
      };
      socket.setTimeout(timeout);
      socket.once('connect', () => finish(true));
      socket.once('timeout', () => finish(false));
      socket.once('error', () => finish(false));
    });
  }

  reserveFreePort() {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.unref();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        const port = typeof address === 'object' && address ? Number(address.port) : 0;
        server.close((error) => error ? reject(error) : resolve(port));
      });
    });
  }

  waitForReady(expected, timeout = 30000) {
    const started = Date.now();
    return new Promise((resolve) => {
      const poll = async () => {
        const ready = Boolean((await this.health())?.ok);
        if (ready === expected) return resolve(true);
        if (Date.now() - started >= timeout) return resolve(false);
        setTimeout(poll, 300);
      };
      void poll();
    });
  }

  requestShutdown() {
    return new Promise((resolve) => {
      const request = http.request({
        hostname: '127.0.0.1', port: this.port, path: '/api/app/system/stop', method: 'POST',
        headers: { ...this.getControlHeaders(), 'content-length': '0' }, timeout: 5000
      }, (response) => {
        response.resume();
        response.once('end', () => resolve(response.statusCode >= 200 && response.statusCode < 300));
      });
      request.once('timeout', () => request.destroy());
      request.once('error', () => resolve(false));
      request.end();
    });
  }

  killTree(pid) {
    return new Promise((resolve) => {
      if (!pid) return resolve(false);
      execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve(true));
    });
  }

  forceStopSync() {
    const child = this.child;
    const pid = Number(child?.pid || 0);
    if (!pid || child?.exitCode !== null) return false;
    try { child.kill('SIGTERM'); } catch {}
    if (process.platform === 'win32') {
      try {
        execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
          timeout: 5000
        });
      } catch {}
    }
    this.child = null;
    return true;
  }

  async start() {
    if ((await this.health())?.ok) {
      this.publish({ phase: 'running', active: true, ready: true, message: 'Bot läuft bereits.' });
      return { ok: true, active: true, ready: true, output: this.state.message };
    }
    if (this.child && this.child.exitCode === null) {
      return { ok: false, active: false, ready: false, output: 'Bot wird bereits gestartet.' };
    }

    const existingService = await this.publicHealth(this.preferredPort);
    if (existingService) {
      this.port = this.preferredPort;
      this.publish({
        phase: 'running', active: true, ready: true, pid: null, port: this.port,
        external: true,
        message: 'Der bereits laufende Bot wird sicher verwendet.'
      });
      this.log(`Bestehender Bot auf Port ${this.port} erkannt. Kein zweiter Discord-Client wurde gestartet.`);
      return { ok: true, active: true, ready: true, external: true, output: this.state.message };
    }

    if (await this.isPortOccupied()) {
      const occupiedPort = this.port;
      this.port = await this.reserveFreePort();
      this.publish({ port: this.port });
      this.log(`Port ${occupiedPort} gehört nicht zu dieser App-Instanz. Sicherer Ersatzport ${this.port} wurde reserviert.`);
    }

    const script = path.join(this.projectRoot, 'src', 'index.js');
    if (!existsSync(script)) return { ok: false, active: false, ready: false, output: 'Bot-Quelldatei wurde nicht gefunden.' };

    const secrets = { ...this.loadSecrets(), ...this.getRuntimeSecrets() };
    const nodeModules = path.join(this.projectRoot, 'node_modules');
    this.publish({ phase: 'starting', active: false, ready: false, message: 'Bot wird gestartet …' });
    const launcher = path.join(this.projectRoot, 'src', 'runtime', 'launcher.cjs');
    if (!existsSync(launcher)) return { ok: false, active: false, ready: false, output: 'Sicherer Bot-Launcher wurde nicht gefunden.' };
    const runtimeExecutable = this.isPackaged
      ? process.execPath
      : (process.env.FALLEN_HEAVEN_NODE_EXECUTABLE || 'node');
    const runtimeMode = this.isPackaged ? { ELECTRON_RUN_AS_NODE: '1' } : {};
    const child = spawn(runtimeExecutable, [launcher], {
      cwd: this.isPackaged ? this.paths.root : this.projectRoot,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: {
        ...process.env,
        ...secrets,
        ...runtimeMode,
        NODE_PATH: [nodeModules, process.env.NODE_PATH].filter(Boolean).join(path.delimiter),
        FALLEN_HEAVEN_APP_ROOT: this.projectRoot,
        FALLEN_HEAVEN_DATA_DIR: this.paths.data,
        FALLEN_HEAVEN_RUNTIME_DIR: this.paths.root,
        FALLEN_HEAVEN_BOT_ENTRY: script,
        FALLEN_HEAVEN_CONTROL_TOKEN: this.controlToken,
        FALLEN_HEAVEN_INSTANCE_ID: this.instanceId,
        FALLEN_HEAVEN_PARENT_PID: String(process.pid),
        DASHBOARD_SESSION_SECRET: secrets.DASHBOARD_SESSION_SECRET,
        DASHBOARD_PORT: String(this.port),
        HOST: '127.0.0.1',
        PORT: String(this.port)
      }
    });
    this.child = child;
    this.publish({ pid: child.pid });
    this.log(`Botprozess gestartet (PID ${child.pid}).`);
    child.stdout.on('data', (chunk) => this.log(`[bot] ${String(chunk).trimEnd()}`));
    child.stderr.on('data', (chunk) => this.log(`[bot:error] ${String(chunk).trimEnd()}`));
    child.on('message', (message) => {
      if (!message || typeof message !== 'object') return;
      if (message.type === 'runtime:metrics') this.publish({ metrics: message.payload || null });
      else if (message.type === 'runtime:events') this.onEvent(message.payload || []);
    });
    child.once('error', (error) => {
      this.log(`Botprozess-Fehler: ${error.message}`);
      if (this.child !== child) return;
      this.publish({ phase: 'error', active: false, ready: false, pid: null, message: error.message });
    });
    child.once('exit', (code, signal) => {
      const expected = ['stopping', 'stopped'].includes(this.state.phase);
      this.log(`Botprozess beendet (Code ${code ?? '-'}, Signal ${signal || '-'}).`);
      if (this.child !== child) return;
      this.child = null;
      this.publish({
        phase: expected ? 'stopped' : 'error', active: false, ready: false, pid: null,
        message: expected ? 'Bot wurde gestoppt.' : `Bot wurde unerwartet beendet (Code ${code ?? '-'}).`
      });
    });

    if (!(await this.waitForReady(true, 30000))) {
      if (this.child !== child || child.exitCode !== null) return { ok: false, ...this.state, output: this.state.message };
      const message = 'Bot-Prozess läuft; der interne Dienst wird noch initialisiert.';
      this.publish({ phase: 'starting', active: true, ready: false, message });
      return { ok: true, active: true, ready: false, degraded: true, output: message };
    }
    this.publish({ phase: 'running', active: true, ready: true, message: 'Bot ist aktiv und verbunden.' });
    return { ok: true, active: true, ready: true, output: 'Bot wurde gestartet und ist erreichbar.' };
  }

  async stop() {
    this.publish({ phase: 'stopping', message: 'Bot wird vollständig gestoppt …' });
    const child = this.child;
    await this.requestShutdown();
    await this.waitForReady(false, 6000);

    if (child && child.exitCode === null) {
      try { child.kill('SIGTERM'); } catch {}
      const exited = await Promise.race([
        new Promise((resolve) => child.once('exit', () => resolve(true))),
        new Promise((resolve) => setTimeout(() => resolve(false), 4000))
      ]);
      if (!exited && child.pid) await this.killTree(child.pid);
    }
    await this.waitForReady(false, 4000);
    const active = Boolean((await this.health())?.ok);
    if (!active) {
      this.child = null;
      this.publish({ phase: 'stopped', active: false, ready: false, pid: null, message: 'Bot wurde vollständig gestoppt.' });
    } else {
      this.publish({ phase: 'error', active: true, ready: true, message: 'Ein älterer Botprozess läuft noch und konnte nicht übernommen werden.' });
    }
    return { ok: !active, active, ready: active, output: this.state.message };
  }

  async execute(action) {
    if (action === 'start') return this.start();
    if (action === 'stop') return this.stop();
    if (action === 'restart') {
      const stopped = await this.stop();
      return stopped.ok ? this.start() : stopped;
    }
    const health = await this.health(4000);
    if (health?.ok) {
      this.healthFailures = 0;
      this.lastHealthyAt = Date.now();
      this.publish({ phase: 'running', active: true, ready: true, message: 'Bot ist aktiv und verbunden.' });
      return { ok: true, active: true, ready: true, health, output: this.state.message };
    }
    if (await this.publicHealth(this.preferredPort)) {
      this.healthFailures = 0;
      this.lastHealthyAt = Date.now();
      this.port = this.preferredPort;
      this.publish({ phase: 'running', active: true, ready: true, pid: null, port: this.port, external: true, message: 'Bot ist aktiv und verbunden.' });
      return { ok: true, active: true, ready: true, external: true, output: this.state.message };
    }
    const childAlive = Boolean(this.child && this.child.exitCode === null);
    const recentlyHealthy = this.lastHealthyAt > 0 && Date.now() - this.lastHealthyAt < 90_000;
    if (childAlive || recentlyHealthy) {
      this.healthFailures += 1;
      const withinFailureBudget = this.healthFailures <= 3;
      const ready = Boolean(this.state.ready && (recentlyHealthy || (childAlive && withinFailureBudget)));
      const message = ready
        ? 'Bot ist aktiv; die Diagnoseantwort ist momentan verzögert.'
        : 'Botprozess ist aktiv; Discord-Verbindung wird geprüft.';
      this.publish({ phase: ready ? 'running' : 'starting', active: true, ready, message });
      return { ok: true, active: true, ready, degraded: true, health: null, output: message };
    }
    this.healthFailures += 1;
    this.publish({ phase: 'stopped', active: false, ready: false, message: 'Bot ist gestoppt.' });
    return { ok: true, active: false, ready: false, health: null, output: this.state.message };
  }

  control(action) {
    const operation = this.queue.then(() => this.execute(action));
    this.queue = operation.catch(() => {});
    return operation;
  }
}

module.exports = { BotProcessSupervisor };
