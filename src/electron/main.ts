import { app, BrowserWindow, ipcMain, session } from 'electron';
import { loadCookiesFromDisk, saveCookiesToDisk, adaptCookiesForShopsy } from '../cookies.js';
import { loadSettings, saveSettings, getSettings } from '../settings.js';
import { fetchFlipkartOtp } from '../email.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadAccounts, upsertAccount, getAccount } from '../accounts.js';
import { loginFlipkart } from '../login/flipkart.js';
import { loginShopsy } from '../login/shopsy.js';
import { checkAccountHealth } from '../check/health.js';
import { refreshSession } from '../refresh/flow.js';
import { saveProfileToDisk } from '../profiles/store.js';
import { initDirs, loadConfig } from '../config.js';
import crypto from 'crypto';
import { loginUser, createUser, getUsers, initAuth, AuthSession } from '../auth.js';
import {
    pushAccounts, pullSyncData, logActivity, reportError,
    fetchCloudUsers, upsertCloudUser, deleteCloudUser,
    fetchActivityLogs, fetchAppErrors
} from '../cloud.js';
import pkg from 'electron-updater';
const { autoUpdater } = pkg;

// Configure autoUpdater
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { browsers } from '../browserManager.js';

let mainWindow: BrowserWindow | null = null;
let currentSession: AuthSession | null = null;

async function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 850,
        minWidth: 1024,
        minHeight: 700,
        title: "Flipkart/Shopsy Automation",
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false, // Required for ESM preload to work comfortably in some setups
            webviewTag: true, // Enable webview tag
        },
    });

    // Calculate path to index.html based on structure
    // src/electron/main.ts -> dist/electron/main.js
    // src/electron/ui/index.html -> stays in src/electron/ui during dev? 
    // No, we should copy it or point to it. Typescript doesn't move html.
    // In dev: ../../src/electron/ui/index.html from dist/electron
    // In prod: resources/app/src/electron/ui/index.html or similar?

    // Let's assume we copy UI assets to dist/electron/ui or access via source if generic.
    // Ideally build process handles this. For now let's point to source for dev ease or copy.
    // Better: adjust package.json build files to include src/electron/ui

    const uiPath = app.isPackaged
        ? path.join(__dirname, '../src/electron/ui/index.html')
        : path.join(__dirname, '../../src/electron/ui/index.html');

    console.log(`[Main] Loading UI from: ${uiPath}`);
    mainWindow.loadFile(uiPath);
}

app.whenReady().then(async () => {
    await initDirs();
    await loadConfig();
    await loadSettings();
    await initAuth();

    // Clear cache to ensure UI reflects latest index.html/css/js changes
    await session.defaultSession.clearCache();
    await session.defaultSession.clearStorageData();

    createWindow();

    // Check for updates
    autoUpdater.checkForUpdatesAndNotify();

    autoUpdater.on('update-available', () => {
        mainWindow?.webContents.send('update-status', 'Update available. Downloading...');
    });

    autoUpdater.on('update-downloaded', () => {
        mainWindow?.webContents.send('update-status', 'Update downloaded. Restarting...');
        setTimeout(() => autoUpdater.quitAndInstall(), 3000);
    });

    autoUpdater.on('error', (err) => {
        console.error('Update error:', err);
    });

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// --- IPC Handlers ---

/**
 * Standardized IPC Wrapper for Stability
 */
function safeIpc(handler: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => Promise<any>) {
    return async (event: Electron.IpcMainInvokeEvent, ...args: any[]) => {
        try {
            return await handler(event, ...args);
        } catch (error: any) {
            console.error(`[IPC Error] ${error.message}`, error);
            // Return clean error to UI
            return {
                success: false,
                error: error.message || 'Unknown internal error'
            };
        }
    };
}

// Auth Middleware
const requireAuth = () => {
    if (!currentSession) throw new Error("Unauthorized: Please log in again.");
};

const requireAdmin = () => {
    requireAuth();
    if (currentSession?.role !== 'admin') throw new Error("Access Denied: Admin privileges required.");
};

// Auth Handlers
ipcMain.handle('auth-login', safeIpc(async (event, creds) => {
    const res = await loginUser(creds.username, creds.password);
    if (res.success && res.session) {
        currentSession = res.session;
    }
    return res;
}));

ipcMain.handle('auth-logout', safeIpc(async () => {
    currentSession = null;
    return { success: true };
}));

ipcMain.handle('auth-get-session', safeIpc(async () => {
    return currentSession;
}));

ipcMain.handle('admin-get-users', safeIpc(async () => {
    requireAdmin();
    return await getUsers();
}));

ipcMain.handle('admin-create-user', safeIpc(async (event, user) => {
    requireAdmin();
    return await createUser(currentSession!.username, user);
}));


ipcMain.handle('get-accounts', safeIpc(async () => {
    requireAuth();
    const data = await loadAccounts();
    return data.accounts;
}));

ipcMain.handle('add-account', safeIpc(async (event, data) => {
    if (!currentSession) throw new Error('Unauthorized');
    const existingAccounts = (await loadAccounts()).accounts;
    if (existingAccounts.length >= currentSession.allowedAccounts && currentSession.role !== 'admin') {
        throw new Error(`Account limit reached (${currentSession.allowedAccounts}). Contact admin to increase limit.`);
    }
    const platform = data.platform;
    const accountId = data.accountId.toLowerCase().trim();
    const identifier = data.identifier.trim();
    const { loginType, emailUser, emailPass, emailHost } = data;

    let emailConfig = undefined;
    if (emailUser && emailPass) {
        const passEncrypted = Buffer.from(emailPass).toString('base64');
        emailConfig = { user: emailUser, passEncrypted, host: emailHost };
    }

    await upsertAccount({
        id: accountId,
        platform,
        loginType,
        identifier,
        status: 'New',
        assignedTo: 'admin',
        emailConfig
    });

    try {
        if (platform === 'flipkart') {
            return await loginFlipkart({ accountId, identifier, headless: false, keepOpen: true });
        } else {
            return await loginShopsy({ accountId, identifier, headless: false });
        }
    } catch (error) {
        return { status: 'error', message: String(error) };
    }
}));

ipcMain.handle('update-account', safeIpc(async (event, data) => {
    await upsertAccount(data);
    return { success: true };
}));

ipcMain.handle('open-account', safeIpc(async (event, { accountId, platform }) => {
    const account = await getAccount(accountId);
    if (!account) throw new Error('Account information not found.');

    if (platform === 'flipkart') {
        return await loginFlipkart({ accountId, identifier: account.identifier, headless: false, keepOpen: true });
    } else {
        return await loginShopsy({ accountId, identifier: account.identifier, headless: false });
    }
}));

ipcMain.handle('check-health', safeIpc(async (event, accountId) => {
    const account = await getAccount(accountId);
    if (!account) throw new Error('Account not found');
    return await checkAccountHealth(account.platform, accountId);
}));

ipcMain.handle('check-all-health', safeIpc(async (event) => {
    const data = await loadAccounts();
    const accounts = data.accounts;
    let processed = 0;

    for (const acc of accounts) {
        processed++;
        mainWindow?.webContents.send('check-all-progress', {
            current: processed,
            total: accounts.length,
            id: acc.id
        });
        try {
            await checkAccountHealth(acc.platform, acc.id);
        } catch (e) {
            console.error(`Health check failed for ${acc.id}`, e);
        }
    }
    return { success: true };
}));

ipcMain.handle('refresh-session', safeIpc(async (event, accountId) => {
    const account = await getAccount(accountId);
    if (!account) throw new Error('Account not found');
    return await refreshSession(account.platform, accountId, account.identifier);
}));

ipcMain.handle('terminate-all-browsers', safeIpc(async () => {
    await browsers.closeAll();
    return { success: true };
}));

app.on('window-all-closed', async () => {
    await browsers.closeAll();
    if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('log-activity', safeIpc(async (event, { action, data }) => {
    if (currentSession) await logActivity(currentSession.username, action, data);
    return { success: true };
}));

ipcMain.handle('report-error', safeIpc(async (event, { message, stack, context }) => {
    if (currentSession) await reportError(currentSession.username, message, stack, context);
    return { success: true };
}));

ipcMain.handle('get-cloud-users', safeIpc(async () => {
    return await fetchCloudUsers();
}));

ipcMain.handle('upsert-cloud-user', safeIpc(async (event, user) => {
    await upsertCloudUser(user);
    return { success: true };
}));

ipcMain.handle('delete-cloud-user', safeIpc(async (event, username) => {
    await deleteCloudUser(username);
    return { success: true };
}));

ipcMain.handle('get-activity-logs', safeIpc(async () => {
    if (currentSession?.role !== 'admin') throw new Error('Unauthorized');
    return await fetchActivityLogs();
}));

ipcMain.handle('get-app-errors', safeIpc(async () => {
    if (currentSession?.role !== 'admin') throw new Error('Unauthorized');
    return await fetchAppErrors();
}));

ipcMain.handle('export-profile', safeIpc(async (event, accountId) => {
    const account = await getAccount(accountId);
    if (!account) throw new Error('Account not found');
    return await saveProfileToDisk(account.platform, accountId);
}));

ipcMain.handle('delete-account', safeIpc(async (event, accountId) => {
    const { deleteAccount } = await import('../accounts.js');
    return await deleteAccount(accountId);
}));

ipcMain.handle('get-account', safeIpc(async (event, id) => {
    const { getAccount } = await import('../accounts.js');
    return await getAccount(id);
}));

ipcMain.handle('get-settings', safeIpc(async () => getSettings()));
ipcMain.handle('save-settings', safeIpc(async (event, settings) => saveSettings(settings)));

ipcMain.handle('fetch-master-otp', safeIpc(async () => {
    const settings = getSettings();
    if (!settings.masterEmail) throw new Error("Master Email not configured");
    const pass = Buffer.from(settings.masterEmail.passEncrypted, 'base64').toString('utf-8');
    return await fetchFlipkartOtp({
        user: settings.masterEmail.user,
        password: pass,
        host: settings.masterEmail.host,
        port: 993,
        tls: true
    });
}));
ipcMain.handle('cloud-sync-pull', safeIpc(async () => {
    const { pullSyncData } = await import('../cloud.js');
    return await pullSyncData();
}));

ipcMain.handle('prepare-browser-session', async (event, { accountId: rawId, platform }) => {
    const accountId = rawId.toLowerCase().trim();
    console.log(`[Main] Preparing session for ${accountId} (${platform})`);

    const partition = `persist:${accountId}`;
    const sess = session.fromPartition(partition);
    let cookies = await loadCookiesFromDisk(accountId, platform as any);

    // If opening Shopsy but no Shopsy cookies exist, try adapting Flipkart ones
    if (cookies.length === 0 && platform === 'shopsy') {
        const flipkartCookies = await loadCookiesFromDisk(accountId, 'flipkart');
        if (flipkartCookies.length > 0) {
            cookies = adaptCookiesForShopsy(flipkartCookies);
        }
    }

    // If still no cookies, we ALLOW the webview to open for manual login
    if (cookies.length === 0) {
        console.warn(`[Main] No session found for ${accountId}. Allowing manual login via Webview.`);
        return { success: true, cookiesCount: 0 };
    }

    console.log(`[Main] Injecting ${cookies.length} cookies into session for ${accountId}`);
    for (const cookie of cookies) {
        const scheme = cookie.secure ? 'https' : 'http';
        const domain = cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain;
        const url = `${scheme}://${domain}${cookie.path}`;

        try {
            await sess.cookies.set({
                url,
                name: cookie.name,
                value: cookie.value,
                domain: cookie.domain,
                path: cookie.path,
                secure: cookie.secure,
                httpOnly: cookie.httpOnly,
                expirationDate: cookie.expires
            });
        } catch (e) {
            console.error(`Failed to set cookie ${cookie.name}:`, e);
        }
    }

    return { success: true, cookiesCount: cookies.length };
});

ipcMain.handle('save-browser-session', async (event, { accountId, platform }) => {
    const partition = `persist:${accountId}`;
    const sess = session.fromPartition(partition);
    try {
        const cookies = await sess.cookies.get({});
        await saveCookiesToDisk(accountId, cookies, platform as any);
        return { success: true };
    } catch (e) {
        return { success: false, error: String(e) };
    }
});
