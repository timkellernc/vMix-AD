const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  selectFile: () => ipcRenderer.invoke('select-file'),
  scanDefaultsNow: () => ipcRenderer.invoke('scan-defaults-now'),
  resolveMedia: (filename) => ipcRenderer.invoke('resolve-media', filename),
  vmixRequest: (commandStr) => ipcRenderer.invoke('vmix-request', commandStr),
  rundownRequest: (action, params) => ipcRenderer.invoke('rundown-request', action, params),
  openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),
  getVideoDuration: (filePath) => ipcRenderer.invoke('get-video-duration', filePath),
  readCsvFile: (path) => ipcRenderer.invoke('read-csv-file', path),
  getPlaceholderPath: () => ipcRenderer.invoke('get-placeholder-path'),
  rescanDirectories: () => ipcRenderer.invoke('rescan-directories'),
  onCompanionAction: (callback) => ipcRenderer.on('companion-action', callback),
  syncCompanionState: (state) => ipcRenderer.send('sync-companion-state', state),
  onCompanionError: (callback) => ipcRenderer.on('companion-error', callback),
  resetCompanionPush: () => ipcRenderer.send('reset-companion-push')
});
