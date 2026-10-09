const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("sync", {
  status: () => ipcRenderer.invoke("status"),
  onEvent: callback => ipcRenderer.on("sync-event", (_event, data) => callback(data))
});
