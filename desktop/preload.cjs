const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fallenHeaven', {
  controlBot: (action) => ipcRenderer.invoke('bot:control', action),
  getBotState: () => ipcRenderer.invoke('bot:state'),
  getSecretStatus: () => ipcRenderer.invoke('security:secret-status'),
  onBotState: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('bot:state', listener);
    return () => ipcRenderer.removeListener('bot:state', listener);
  },
  onBotEvent: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, events) => callback(events);
    ipcRenderer.on('bot:event', listener);
    return () => ipcRenderer.removeListener('bot:event', listener);
  },
  ensureDashboard: () => ipcRenderer.invoke('bot:ensure-dashboard'),
  getInfo: () => ipcRenderer.invoke('app:info'),
  getLogs: () => ipcRenderer.invoke('app:logs'),
  getDiagnostics: () => ipcRenderer.invoke('app:diagnostics'),
  getLiveDiagnostics: () => ipcRenderer.invoke('app:get-live-diagnostics'),
  exportDiagnostics: () => ipcRenderer.invoke('app:export-diagnostics'),
  openDataFolder: () => ipcRenderer.invoke('app:open-data-folder'),
  openLogFolder: () => ipcRenderer.invoke('app:open-log-folder'),
  getUpdateSettings: () => ipcRenderer.invoke('app:update-settings'),
  setUpdateSettings: (payload) => ipcRenderer.invoke('app:update-settings-set', payload),
  checkUpdate: () => ipcRenderer.invoke('app:check-update'),
  installUpdate: () => ipcRenderer.invoke('app:install-update'),
  getUpdateSource: () => ipcRenderer.invoke('app:update-source'),
  setUpdateSource: (repo) => ipcRenderer.invoke('app:update-source-set', { repo }),
  setUpdateToken: (token) => ipcRenderer.invoke('app:update-token-set', { token }),
  clearUpdateToken: () => ipcRenderer.invoke('app:update-token-clear'),
  testUpdateChannel: () => ipcRenderer.invoke('app:update-channel-test'),
  onUpdateProgress: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('update-progress', listener);
    return () => ipcRenderer.removeListener('update-progress', listener);
  },
  onUpdateAvailable: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('update-available', listener);
    return () => ipcRenderer.removeListener('update-available', listener);
  },
  openUpdateFolder: () => ipcRenderer.invoke('app:open-update-folder'),
  apiRequest: (options) => ipcRenderer.invoke('api:request', options),
  loginDiscord: () => ipcRenderer.invoke('auth:discord-login'),
  openSetup: () => ipcRenderer.invoke('app:open-setup'),
  logoutDiscord: () => ipcRenderer.invoke('auth:logout'),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  onCloseRequested: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = () => callback();
    ipcRenderer.on('app:close-requested', listener);
    return () => ipcRenderer.removeListener('app:close-requested', listener);
  },
  confirmClose: (accepted) => ipcRenderer.send('window:close-response', accepted === true),
  onThemeChanged: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, theme) => callback(theme);
    ipcRenderer.on('os:theme-changed', listener);
    return () => ipcRenderer.removeListener('os:theme-changed', listener);
  },
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close')
});
