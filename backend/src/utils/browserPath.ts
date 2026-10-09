
import path from 'path';
import fs from 'fs';
import { chromium } from 'playwright';

/**
 * Resolves the Chromium executable path for both Development and Production (Electron) environments.
 * 
 * In Production (Electron):
 * The backend is running from resources/backend/dist/server.cjs
 * Browsers are in resources/backend/browsers
 * 
 * In Development:
 * Browsers are in backend/browsers (if locally installed) or in the default cache.
 */
let cachedPath: string | undefined;

export function getChromiumPath(): string | undefined {
    if (cachedPath && fs.existsSync(cachedPath)) {
        return cachedPath;
    }
    // 1. Check if PLAYWRIGHT_BROWSERS_PATH is set (Electron main process sets this)
    if (process.env.PLAYWRIGHT_BROWSERS_PATH) {
        const platform = process.platform === 'win32' ? 'chromium' : 'chromium';
        // Note: Playwright folder names are version-dependent, e.g., chromium-1091
        // We need to find the folder that starts with 'chromium-'

        try {
            const browserDir = process.env.PLAYWRIGHT_BROWSERS_PATH;
            if (fs.existsSync(browserDir)) {
                const entries = fs.readdirSync(browserDir);
                // Find Chromium folder (e.g., chromium-1148)
                const chromiumDirName = entries.find(name => name.startsWith('chromium-') && fs.statSync(path.join(browserDir, name)).isDirectory());

                if (chromiumDirName) {
                    const isWindows = process.platform === 'win32';
                    const isMac = process.platform === 'darwin';

                    if (isWindows) {
                        // Check chrome-win (older) and chrome-win64 (newer)
                        let chromiumPath = path.join(browserDir, chromiumDirName, 'chrome-win', 'chrome.exe');
                        if (!fs.existsSync(chromiumPath)) {
                            chromiumPath = path.join(browserDir, chromiumDirName, 'chrome-win64', 'chrome.exe');
                        }

                        if (fs.existsSync(chromiumPath)) {
                            console.log(`[BrowserPath] Found bundled Windows Chromium at: ${chromiumPath}`);
                            cachedPath = chromiumPath;
                            return chromiumPath;
                        }
                    }

                    if (isMac) {
                        const macPaths = [
                            path.join(browserDir, chromiumDirName, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
                            path.join(browserDir, chromiumDirName, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
                            path.join(browserDir, chromiumDirName, 'chrome-mac-x64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing')
                        ];

                        for (const macPath of macPaths) {
                            if (fs.existsSync(macPath)) {
                                console.log(`[BrowserPath] Found bundled Mac Chromium at: ${macPath}`);
                                cachedPath = macPath;
                                return macPath;
                            }
                        }
                    }
                }
            }
        } catch (e) {
            console.error('[BrowserPath] Error resolving bundled browser:', e);
        }
    }

    // 2. Fallback to Playwright's default resolution via executablePath()
    // This might fail in Electron if strictly relying on bundled variables, but effective in Dev.
    try {
        const defaultPath = chromium.executablePath();
        if (fs.existsSync(defaultPath)) {
            console.log(`[BrowserPath] Using default Playwright path: ${defaultPath}`);
            cachedPath = defaultPath;
            return defaultPath;
        }
    } catch (e) {
        console.warn('[BrowserPath] chromium.executablePath() failed or not found.');
    }

    console.warn('[BrowserPath] Could not resolve Chromium executable path!');
    return undefined;
}
