const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('store', {
  load: () => ipcRenderer.sendSync('store:load'),
  save: (data) => ipcRenderer.sendSync('store:save', data),
  attention: () => ipcRenderer.send('app:attention'),
  openExternal: (url) => ipcRenderer.send('app:open-external', url),
  setTheme: (theme, explicit) => ipcRenderer.send('app:theme', { theme, explicit }),
  trayStatus: (text, running) => ipcRenderer.send('tray:status', { text, running }),
  onTimerToggle: (fn) => ipcRenderer.on('timer:toggle', () => fn()),
});
