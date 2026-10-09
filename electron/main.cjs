const { app, BrowserWindow, dialog, session, ipcMain, net } = require('electron');

// === CRITICAL: MUST BE FIRST - Disable GPU before ANY other Electron code ===
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('use-gl', 'swiftshader');
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('no-sandbox');
// === END GPU DISABLE ===

const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const waitOn = require('wait-on');

// --- Global Config & State ---
const isDev = !app.isPackaged;
const BACKEND_PORT = 35412;
const proxyAuthMap = new Map();
const partitionFingerprints = new Map();
const preloadLS = new Map();

// --- Command Line Switches: Aggressive for stability on experimental macOS ---
app.commandLine.appendSwitch('disable-features', 'Autofill,PasswordManager,TargetedExperience,PreloadMediaEngagementData,MediaEngagementBypassAutoplayPolicies');
app.commandLine.appendSwitch('disable-save-password-bubble');
app.commandLine.appendSwitch('disable-site-isolation-trials');
app.commandLine.appendSwitch('ignore-certificate-errors');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-quic');

// --- Logger ---
const logPath = path.join(app.getPath('home'), 'astra_startup_log.txt');
function logToFile(msg) {
  try {
    const timestamp = new Date().toISOString();
    fs.appendFileSync(logPath, `${timestamp}: ${msg}\n`);
  } catch (e) { }
}

// --- IPC Handlers (Global Scope) ---

// Synchronous LS provider for webviewPreload.cjs
ipcMain.on('get-ls-data', (event, partition) => {
  try {
    let targetPartition = partition;

    // If partition is empty, try to detect it from the sender's session
    if (!targetPartition && event.sender) {
      // WebContents has a session property, we need to find which partition it belongs to
      const senderSession = event.sender.session;

      // Check all registered partitions in preloadLS
      for (const [key, value] of preloadLS.entries()) {
        const partitionSession = session.fromPartition(key);
        if (partitionSession === senderSession) {
          targetPartition = key;
          break;
        }
      }
    }

    logToFile(`[get-ls-data] Partition: ${targetPartition}, Data exists: ${preloadLS.has(targetPartition)}`);

    if (!targetPartition) {
      logToFile(`[get-ls-data] ERROR: Could not detect partition!`);
      event.returnValue = null;
      return;
    }

    const data = preloadLS.get(targetPartition) || null;
    logToFile(`[get-ls-data] Returning ${data ? Object.keys(data).length : 0} keys for ${targetPartition}`);
    event.returnValue = data;
  } catch (e) {
    logToFile(`[get-ls-data] EXCEPTION: ${e.message}`);
    event.returnValue = null;
  }
});

ipcMain.handle('set-fingerprint', async (_event, partition, fingerprint) => {
  partitionFingerprints.set(partition, fingerprint);
  const ses = session.fromPartition(partition);

  // 1. User Agent enforcement
  if (fingerprint && fingerprint.userAgent) {
    ses.setUserAgent(fingerprint.userAgent);
    logToFile(`[Session] Set UserAgent for ${partition}: ${fingerprint.userAgent.substring(0, 30)}...`);
  }

  // 2. Locale enforcement (Essential for site identity)
  if (fingerprint && fingerprint.locale) {
    const localeCode = fingerprint.locale.split('-')[0]; // e.g., 'en' from 'en-IN'
    try {
      ses.setSpellCheckerLanguages([localeCode]);
    } catch (e) { }
  }

  return { success: true };
});

ipcMain.handle('set-preload-ls', async (_event, partition, data) => {
  preloadLS.set(partition, data);
  return { success: true };
});

// === HIDDEN ORIGIN WARMUP (Critical for iQOO, Vivo, Oppo, Realme - BBK Group sites) ===
// These sites reject cookies that are injected without a matching origin navigation.
// We use net.request to make a simple HTTP request that establishes origin trust
// WITHOUT executing JavaScript (which could set new cookies and overwrite our auth).
ipcMain.handle('warmup-origin', async (_event, partition, url, userAgent) => {
  try {
    const ses = session.fromPartition(partition);

    logToFile(`[warmup-origin] Starting warmup for ${partition} on ${url}`);

    // Option 1: Simple net.request (doesn't execute JS, just establishes origin in session)
    await new Promise((resolve, reject) => {
      const request = net.request({
        method: 'GET',
        url: url,
        session: ses,
        useSessionCookies: true, // Send cookies; auto-fix listener will correct overwrites
        redirect: 'follow'
      });

      // Set headers to match fingerprint
      request.setHeader('User-Agent', userAgent);
      request.setHeader('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
      request.setHeader('Accept-Language', 'en-IN,en;q=0.9');

      request.on('response', (response) => {
        logToFile(`[warmup-origin] Got response: ${response.statusCode}`);
        // Consume the response data to complete the request
        response.on('data', () => { });
        response.on('end', () => resolve());
        response.on('error', (e) => {
          logToFile(`[warmup-origin] Response error: ${e.message}`);
          resolve(); // Still resolve - we made the request
        });
      });

      request.on('error', (e) => {
        logToFile(`[warmup-origin] Request error: ${e.message}`);
        resolve(); // Still resolve - best effort
      });

      request.end();

      // Timeout fallback
      setTimeout(() => resolve(), 5000);
    });

    logToFile(`[warmup-origin] ✅ Completed warmup for ${partition} on ${url}`);
    return { success: true };
  } catch (e) {
    logToFile(`[warmup-origin] ❌ Failed: ${e.message}`);
    return { success: false, error: e.message };
  }
});

ipcMain.on('set-proxy', async (event, { partition, proxyRules }) => {
  try {
    const ses = session.fromPartition(partition);
    const match = proxyRules.match(/^(?:https?:\/\/)?([^:]+):([^@]+)@(.+)$/);
    let finalRules = proxyRules.replace(/\/$/, '');

    if (match) {
      const [_, user, pass, hostAndPort] = match;
      finalRules = proxyRules.includes('://') ? (proxyRules.split('://')[0] + '://' + hostAndPort) : hostAndPort;
      proxyAuthMap.set(hostAndPort.replace(/\/$/, ''), { username: user, password: pass });
    }

    await ses.setProxy({ proxyRules: finalRules });
    event.sender.send('proxy-set-complete', { partition });
  } catch (e) { }
});

// --- Window/Webview lifecycle ---

app.on('web-contents-created', (event, contents) => {
  const cType = contents.getType();

  if (cType === 'window') {
    contents.on('will-attach-webview', (_e, params) => {
      if (params.partition && preloadLS.has(params.partition)) {
        params.preload = path.join(__dirname, 'webviewPreload.cjs');
      }
    });
  }

  if (cType === 'webview') {
    contents.setWindowOpenHandler(({ url }) => {
      if (mainWindow) mainWindow.webContents.send('open-url-in-tab', { url });
      return { action: 'deny' };
    });

    // NOTE: Realme login redirects (login?cb=...) are a legitimate SSO handoff.
    // Do NOT intercept them - the flow needs to complete naturally.
  }
});

app.on('login', (event, webContents, request, authInfo, callback) => {
  if (authInfo.isProxy) {
    const key = `${authInfo.host}:${authInfo.port}`;
    let creds = proxyAuthMap.get(key);
    if (!creds) {
      for (const [mKey, mCreds] of proxyAuthMap.entries()) {
        if (mKey.endsWith(':' + authInfo.port)) { creds = mCreds; break; }
      }
    }
    if (creds) { event.preventDefault(); callback(creds.username, creds.password); }
  }
});

let mainWindow, splashWindow, backendProcess;

function startBackend() {
  const isProd = app.isPackaged;
  const backendPath = isProd
    ? path.join(process.resourcesPath, 'backend')
    : path.join(__dirname, '..', 'backend');

  const userDataPath = app.getPath('userData');
  const browsersPath = isProd
    ? path.join(backendPath, 'browsers')
    : path.resolve(backendPath, 'browsers');

  // Load .env file for production (in dev, tsx --env-file handles this)
  if (isProd) {
    const envFilePath = path.join(backendPath, '.env');
    if (fs.existsSync(envFilePath)) {
      const envContent = fs.readFileSync(envFilePath, 'utf-8');
      for (const line of envContent.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex > 0) {
          const key = trimmed.substring(0, eqIndex).trim();
          let value = trimmed.substring(eqIndex + 1).trim();
          // Remove surrounding quotes if present
          if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }
          process.env[key] = value;
        }
      }
      logToFile(`[Backend] Loaded .env from ${envFilePath}`);
    } else {
      logToFile(`[Backend] WARNING: .env file not found at ${envFilePath}`);
    }
  }

  const env = {
    ...process.env,
    PORT: BACKEND_PORT,
    NODE_ENV: isProd ? 'production' : 'development',
    USER_DATA_PATH: userDataPath,
    PLAYWRIGHT_BROWSERS_PATH: isProd ? browsersPath : undefined,
    ELECTRON_RUN_AS_NODE: '1'
  };

  logToFile(`[Backend] Starting from: ${backendPath}`);
  logToFile(`[Backend] User Data: ${userDataPath}`);
  logToFile(`[Backend] Browsers: ${browsersPath}`);

  if (!isProd) {
    // Use npx to run tsx from local node_modules (tsx is a devDependency)
    backendProcess = spawn('npx', ['tsx', '--env-file=.env', 'server.ts'], { cwd: backendPath, env, shell: true, stdio: 'inherit' });
  } else {
    const serverJs = path.join(backendPath, 'dist', 'server.cjs');
    if (!fs.existsSync(serverJs)) {
      logToFile(`[Backend] ERROR: server.js not found at ${serverJs}`);
      return;
    }

    // In production, we need to make sure the process runs relative to the resources folder
    // because that's where the bundled node_modules and browsers are.
    backendProcess = spawn(process.execPath, [serverJs], {
      cwd: backendPath,
      env,
      stdio: 'pipe'
    });

    backendProcess.stdout.on('data', (data) => logToFile(`[Backend STDOUT] ${data.toString().trim()}`));
    backendProcess.stderr.on('data', (data) => logToFile(`[Backend STDERR] ${data.toString().trim()}`));

    backendProcess.on('error', (err) => {
      logToFile(`[Backend] Process Error: ${err.message}`);
      if (err.stack) logToFile(`[Backend] Stack: ${err.stack}`);
    });

    backendProcess.on('exit', (code, signal) => {
      logToFile(`[Backend] Process Exited. Code: ${code}, Signal: ${signal}`);
      if (code !== 0 && code !== null) {
        logToFile(`[Backend] CRITICAL: Backend process crashed or failed to start!`);
        // Auto-restart backend (max 3 attempts)
        if (!startBackend._restartCount) startBackend._restartCount = 0;
        if (startBackend._restartCount < 3) {
          startBackend._restartCount++;
          logToFile(`[Backend] Auto-restarting (attempt ${startBackend._restartCount}/3)...`);
          setTimeout(() => startBackend(), 2000);
        } else {
          logToFile(`[Backend] Max restart attempts reached. Backend is down.`);
        }
      }
    });
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200, height: 800, show: false,
    webPreferences: {
      nodeIntegration: false, contextIsolation: true, webviewTag: true,
      preload: path.join(__dirname, 'preload.cjs'), partition: 'persist:astra_main'
    },
  });
  const frontendUrl = isDev ? 'http://localhost:5173' : `file://${path.join(__dirname, '..', 'dist', 'index.html')}`;
  waitOn({ resources: [`tcp:${BACKEND_PORT}`], timeout: 30000 }).then(() => mainWindow.loadURL(frontendUrl)).catch((err) => { logToFile(`[Startup] Backend failed to start in time: ${err}`); mainWindow.loadURL(frontendUrl); });
  if (isDev) mainWindow.webContents.openDevTools();
  mainWindow.on('closed', () => mainWindow = null);
}

function createSplashWindow() {
  splashWindow = new BrowserWindow({ width: 340, height: 340, frame: false, alwaysOnTop: true, transparent: false, webPreferences: { nodeIntegration: false, contextIsolation: true } });
  splashWindow.loadFile(path.join(__dirname, 'splash.html')).catch(() => { });
  splashWindow.center();
}

app.on('ready', () => {
  createSplashWindow();
  startBackend();
  createWindow();

  ipcMain.on('app-ready', () => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
    if (splashWindow) { setTimeout(() => { if (splashWindow && !splashWindow.isDestroyed()) splashWindow.destroy(); }, 300); }
  });
});

// --- Cookie handlers (moved to global scope for immediate availability) ---
ipcMain.on('get-cookies', async (event, { partition }) => {
  try {
    const ses = session.fromPartition(partition);
    const cookies = await ses.cookies.get({});
    event.sender.send('cookies-retrieved', { partition, cookies });
  } catch (e) { event.sender.send('cookies-retrieved', { partition, cookies: [] }); }
});

// Clear all cookies for a partition (needed to fix HttpOnly overwrite errors)
ipcMain.handle('clear-cookies', async (_event, partition) => {
  try {
    const ses = session.fromPartition(partition);
    const cookies = await ses.cookies.get({});
    for (const c of cookies) {
      try {
        const url = `https://${c.domain.startsWith('.') ? c.domain.substring(1) : c.domain}${c.path || '/'}`;
        await ses.cookies.remove(url, c.name);
      } catch (e) { /* ignore individual removal errors */ }
    }
    logToFile(`[Cookies] Cleared ${cookies.length} cookies for ${partition}`);
    return { success: true, cleared: cookies.length };
  } catch (e) {
    logToFile(`[Cookies] Clear failed for ${partition}: ${e.message}`);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('set-cookies', async (event, { partition, cookies }) => {
  if (!cookies || !Array.isArray(cookies)) return { success: false };
  const ses = session.fromPartition(partition);
  let successCount = 0;
  let failCount = 0;

  for (const c of cookies) {
    try {
      // Construct valid URL: strip leading dot for URL (Electron requires a valid URL for the cookie)
      // IMPORTANT: For wildcard domains like `.realme.com`, we need a proper origin URL.
      // Using `www.` prefix for wildcard domains ensures Chromium validates correctly.
      const rawDomain = c.domain || '';
      let cleanDomain;
      if (rawDomain.startsWith('.')) {
        // Wildcard domain (e.g. `.realme.com`): use www.realme.com as origin for proper validation
        cleanDomain = 'www.' + rawDomain.substring(1);
      } else {
        cleanDomain = rawDomain;
      }
      const url = `https://${cleanDomain}${c.path || '/'}`;

      const cookieDetails = {
        url,
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        secure: c.secure,
        httpOnly: c.httpOnly,
        expirationDate: c.expirationDate || c.expires,
        sameSite: c.sameSite === 'None' ? 'no_restriction' : (c.sameSite === 'Lax' ? 'lax' : (c.sameSite === 'Strict' ? 'strict' : 'lax'))
      };

      // Chromium/Electron Security Enforcement: SameSite=None MUST be Secure
      if (cookieDetails.sameSite === 'no_restriction') {
        cookieDetails.secure = true;
      }

      // DEBUG: Log critical auth cookies
      const isAuthCookie = ['accessToken', 'acIdAuthSession', 'RMID', 'nickname'].includes(c.name);
      if (isAuthCookie) {
        logToFile(`[Cookies] AUTH COOKIE: name=${c.name} domain=${c.domain} url=${url} sameSite=${cookieDetails.sameSite} secure=${cookieDetails.secure} httpOnly=${cookieDetails.httpOnly} expDate=${cookieDetails.expirationDate}`);
      }

      await ses.cookies.set(cookieDetails);
      successCount++;
    } catch (e) {
      failCount++;
      logToFile(`[Cookies] ❌ FAILED to set cookie ${c.name} (domain=${c.domain}) for ${partition}: ${e.message}`);
    }
  }

  // VERIFICATION: Read back auth cookies for the partition
  try {
    const allCookies = await ses.cookies.get({});
    const authNames = ['accessToken', 'acIdAuthSession', 'RMID', 'nickname'];
    const authCookies = allCookies.filter(c => authNames.includes(c.name));
    logToFile(`[Cookies] VERIFY after injection for ${partition}: total=${allCookies.length} auth=${authCookies.length}`);
    authCookies.forEach(c => {
      logToFile(`[Cookies] VERIFY: ${c.name} domain=${c.domain} secure=${c.secure} httpOnly=${c.httpOnly} sameSite=${c.sameSite} value_len=${(c.value || '').length}`);
    });
  } catch (e) {
    logToFile(`[Cookies] VERIFY failed: ${e.message}`);
  }

  logToFile(`[Cookies] Injected for ${partition}: ${successCount} success, ${failCount} failed`);
  return { success: true, successCount, failCount };
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (mainWindow === null) createWindow(); });
app.on('will-quit', () => { if (backendProcess) backendProcess.kill(); });

process.on('uncaughtException', (error) => {
  logToFile(`UNCAUGHT EXCEPTION: ${error.stack || error}`);
  dialog.showErrorBox('Critical Startup Error', error.message || 'The application crashed during startup.');
  process.exit(1);
});
