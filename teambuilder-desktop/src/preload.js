const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tbApi', {
  loadData: () => ipcRenderer.invoke('tb:data'),
  openSignIn: () => ipcRenderer.invoke('tb:open-signin'),
  listCaptures: () => ipcRenderer.invoke('tb:list-captures'),
  loadCapture: (id) => ipcRenderer.invoke('tb:load-capture', id),
  openFile: () => ipcRenderer.invoke('tb:open-file'),
  saveFile: (args) => ipcRenderer.invoke('tb:save-file', args),
  saveReport: (args) => ipcRenderer.invoke('tb:save-report', args),
  openCapturesFolder: () => ipcRenderer.invoke('tb:open-captures-folder'),
  setDirty: (value) => ipcRenderer.send('tb:set-dirty', value),
  onCaptured: (cb) => ipcRenderer.on('tb:captured', (_e, c) => cb(c)),
  onCaptureError: (cb) => ipcRenderer.on('tb:capture-error', (_e, err) => cb(err)),
});
