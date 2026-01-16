const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
    // Add API functions here if needed
    // For now, the app uses http calls to localhost
});
