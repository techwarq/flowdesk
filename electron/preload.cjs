const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
    // Add API functions here if needed
    sendAppReady: () => ipcRenderer.send('app-ready'),
    setCookies: (partition, cookies) => ipcRenderer.invoke('set-cookies', { partition, cookies }),
    clearCookies: (partition) => ipcRenderer.invoke('clear-cookies', partition),
    setProxy: (partition, proxyRules) => ipcRenderer.send('set-proxy', { partition, proxyRules }),
    getCookies: (partition) => ipcRenderer.send('get-cookies', { partition }),
    getIpInfo: (partition) => {
        console.log(`[Preload] getIpInfo called for ${partition}`);
        ipcRenderer.send('get-ip-info', { partition });
    },

    // === SESSION INJECTION (iQOO, Xiaomi, etc.) ===
    setFingerprint: (partition, fingerprint) => {
        console.log(`[Preload] setFingerprint called for ${partition}`);
        return ipcRenderer.invoke('set-fingerprint', partition, fingerprint);
    },
    setPreloadLS: (partition, data) => {
        console.log(`[Preload] setPreloadLS called for ${partition}`);
        return ipcRenderer.invoke('set-preload-ls', partition, data);
    },
    getPreloadLS: (partition) => {
        return ipcRenderer.invoke('get-preload-ls', partition);
    },
    // === HIDDEN ORIGIN WARMUP (Critical for iQOO, Vivo, Oppo, Realme) ===
    warmupOrigin: (partition, url, userAgent) => {
        console.log(`[Preload] warmupOrigin called for ${partition} -> ${url}`);
        return ipcRenderer.invoke('warmup-origin', partition, url, userAgent);
    },

    on: (channel, func) => {
        const subscription = (event, ...args) => func(event, ...args);
        ipcRenderer.on(channel, subscription);
        return () => {
            ipcRenderer.removeListener(channel, subscription);
        };
    },
    removeListener: (channel, func) => {
        // Direct removal might be tricky with context isolation due to function reference mismatch
        // But for our audit usehash, we can just effectively no-op or implement better subscription management
        // properly exposed above via the return value of 'on'.
        ipcRenderer.removeListener(channel, func);
    }
});
