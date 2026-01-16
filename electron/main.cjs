const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const isDev = require('electron-is-dev');
const waitOn = require('wait-on');
const fs = require('fs');

// Simple file logger for startup debugging
const logPath = path.join(app.getPath('home'), 'flowdesk_startup_log.txt');

function logToFile(msg) {
  try {
    const timestamp = new Date().toISOString();
    fs.appendFileSync(logPath, `${timestamp}: ${msg}\n`);
  } catch (e) {
    // ignore logging errors
  }
}

// Global exception handlers
process.on('uncaughtException', (error) => {
  logToFile(`UNCAUGHT EXCEPTION: ${error.stack || error}`);
  dialog.showErrorBox('Startup Error', `An error occurred: ${error.message}\nCheck ${logPath} for details.`);
  process.exit(1);
});

logToFile('App starting...');
try {
  logToFile(`App path: ${app.getAppPath()}`);
  logToFile(`Resources path: ${process.resourcesPath}`);
} catch (e) { }

let mainWindow;
let backendProcess;

// Backend setup
const BACKEND_PORT = 3001;
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;

function startBackend() {
  logToFile('Starting backend function called');
  if (isDev) {
    logToFile('Mode: Development');
    console.log('Starting backend in DEV mode...');
    // In dev, we spawn npm run start which uses tsx
    const backendPath = path.join(__dirname, '..', 'backend');

    backendProcess = spawn('npm', ['run', 'start'], {
      cwd: backendPath,
      env: { ...process.env, PORT: BACKEND_PORT },
      shell: true,
      stdio: 'inherit'
    });
  } else {
    logToFile('Mode: Production');
    console.log('Starting backend in PROD mode...');
    const backendPath = path.join(process.resourcesPath, 'backend');
    logToFile(`Backend Path: ${backendPath}`);
    // Ensure we point to the compiled server file
    const serverPath = path.join(backendPath, 'dist', 'server.js');
    logToFile(`Server Path: ${serverPath}`);

    // Path where browsers are bundled
    const browsersPath = path.join(backendPath, 'browsers');
    logToFile(`Browsers Path: ${browsersPath}`);

    try {
      if (!fs.existsSync(serverPath)) {
        logToFile(`ERROR: Server file not found at ${serverPath}`);
        dialog.showErrorBox('Startup Error', `Backend server file missing at ${serverPath}\nThis is a build issue.`);
      }

      // Use pipe specifically to capture logs
      backendProcess = spawn(process.execPath, [serverPath], {
        cwd: backendPath,
        env: {
          ...process.env,
          PORT: BACKEND_PORT,
          NODE_ENV: 'production',
          PLAYWRIGHT_BROWSERS_PATH: browsersPath
        },
        stdio: 'pipe'
      });

      if (backendProcess && backendProcess.stdout) {
        backendProcess.stdout.on('data', (data) => {
          logToFile(`[Backend]: ${data}`);
        });
      }
      if (backendProcess && backendProcess.stderr) {
        backendProcess.stderr.on('data', (data) => {
          logToFile(`[Backend ERROR]: ${data}`);
        });
      }

      logToFile(`Backend spawned with PID: ${backendProcess.pid}`);
    } catch (e) {
      logToFile(`Failed to spawn backend: ${e.message}`);
      dialog.showErrorBox('Startup Error', `Failed to spawn backend: ${e.message}`);
    }
  }

  if (backendProcess) {
    backendProcess.on('error', (err) => {
      logToFile(`Backend process error: ${err.message}`);
      console.error('Failed to start backend:', err);
    });

    backendProcess.on('exit', (code, signal) => {
      logToFile(`Backend process exited with code ${code} and signal ${signal}`);
      console.log(`Backend process exited with code ${code} and signal ${signal}`);
    });
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs')
    },
  });

  const frontendUrl = isDev
    ? 'http://localhost:5173'
    : `file://${path.join(__dirname, '..', 'dist', 'index.html')}`;

  logToFile(`Loading frontend from: ${frontendUrl}`);
  console.log(`Loading frontend from: ${frontendUrl}`);

  // Resources to wait for
  const resources = [`tcp:${BACKEND_PORT}`];
  if (isDev) {
    resources.push('tcp:5173');
  }

  // Waiting for services
  waitOn({
    resources: resources,
    timeout: 30000 // 30s
  }).then(() => {
    logToFile('Services are ready!');
    console.log('Services are ready!');
    mainWindow.loadURL(frontendUrl);
  }).catch((err) => {
    logToFile(`Services did not start in time: ${err.message}`);
    console.error('Services did not start in time:', err);
    mainWindow.loadURL(frontendUrl);
  });

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.on('ready', () => {
  logToFile('Electron Ready event fired');
  startBackend();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

app.on('will-quit', () => {
  if (backendProcess) {
    backendProcess.kill();
  }
});
