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
  apiRequest: (options) => ipcRenderer.invoke('api:request', options),
  loginDiscord: () => ipcRenderer.invoke('auth:discord-login'),
  logoutDiscord: () => ipcRenderer.invoke('auth:logout'),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  onCloseRequested: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = () => callback();
    ipcRenderer.on('app:close-requested', listener);
    return () => ipcRenderer.removeListener('app:close-requested', listener);
  },
  confirmClose: (accepted) => ipcRenderer.send('window:close-response', accepted === true),
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close')
});
