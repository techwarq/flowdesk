const { ipcRenderer } = require('electron');

/**
 * Early execution script for webviews to inject session data.
 * This script runs BEFORE the page content loads.
 */

(function () {
    try {
        // DIAGNOSTIC: Log the state at preload boot time
        const partition = window.location.href; // Will show URL for context
        console.log(`%c[PRELOAD BOOT] URL: ${partition}`, 'background: purple; color: white');
        console.log(`%c[PRELOAD BOOT] UA: ${navigator.userAgent.substring(0, 50)}...`, 'background: purple; color: white');

        // Use synchronous IPC to get LocalStorage data from the Main process.
        // We pass an empty string because Main identifies the sender's partition.
        const data = ipcRenderer.sendSync('get-ls-data', '');

        console.log(`%c[PRELOAD BOOT] LS data received: ${data ? Object.keys(data).length + ' keys' : 'NULL/EMPTY'}`, 'background: purple; color: white; font-weight: bold');

        if (data && typeof data === 'object') {
            for (const [key, value] of Object.entries(data)) {
                try {
                    window.localStorage.setItem(key, value);
                } catch (e) {
                    // Ignore quota or security errors for individual keys
                }
            }
            console.log(`%c[Preload] 📦 LocalStorage injected (${Object.keys(data).length} keys)`, 'color: orange; font-weight: bold');
        } else {
            console.log('%c[Preload] ⚠️ NO LS DATA RECEIVED - Session will fail!', 'background: red; color: white; font-weight: bold');
        }
    } catch (e) {
        // Crucial: Catch all errors to prevent the preload script from failing and affecting the page load.
        console.error('[Preload] LocalStorage Injection Error:', e);
    }

    // Fallback/Update listener: Listen for async session data updates (if needed)
    ipcRenderer.on('inject-session-data', (event, data) => {
        if (data && data.localStorage) {
            try {
                for (const [key, value] of Object.entries(data.localStorage)) {
                    window.localStorage.setItem(key, value);
                }
                console.log('%c[Preload] 📦 LocalStorage updated (async)', 'color: green; font-weight: bold');
            } catch (e) {
                console.error('[Preload] LS Async Error:', e);
            }
        }
    });
})();
