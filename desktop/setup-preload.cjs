const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fallenHeavenSetup', {
  status: () => ipcRenderer.invoke('setup:status'),
  saveBotToken: (token) => ipcRenderer.invoke('setup:save-bot-token', token),
  saveCredentials: (payload) => ipcRenderer.invoke('setup:save-credentials', payload),
  importPortableBackup: (payload) => ipcRenderer.invoke('setup:portable-backup-import', payload),
  deleteBotToken: () => ipcRenderer.invoke('setup:delete-bot-token'),
  openMain: () => ipcRenderer.invoke('setup:open-main'),
  minimize: () => ipcRenderer.send('setup:minimize'),
  close: () => ipcRenderer.send('setup:close')
});
