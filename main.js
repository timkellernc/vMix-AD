const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const Store = require('electron-store');
const fs = require('fs');
const http = require('http');

let companionState = {};
let companionPushFailed = false;

const companionServer = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/api/state') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(companionState));
  } else if (req.method === 'POST' && req.url === '/api/action') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('companion-action', payload);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});

companionServer.listen(8099, '127.0.0.1', () => {
  console.log('Companion HTTP server running on http://127.0.0.1:8099');
});

const store = new Store({
  defaults: {
    rundownCreatorRadioStation: '',
    rundownCreatorAPIKey: '',
    rundownCreatorAPIToken: '',
    vmixIP: '127.0.0.1:8088',
    showDirectory: '',
    defaultsDirectory: '',
    automationColumnName: 'Coding',
    automationMappings: []
  }
});

ipcMain.handle('open-file', async (event, filePath) => {
  if (filePath) {
    await shell.openPath(filePath);
  }
});

const ffprobe = require('@ffprobe-installer/ffprobe');

const { execFile } = require('child_process');

ipcMain.handle('get-video-duration', (event, filePath) => {
  return new Promise((resolve) => {
    execFile(ffprobe.path, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath
    ], (error, stdout, stderr) => {
      if (error) {
        fs.appendFileSync(path.join(app.getPath('userData'), 'debug-log.txt'), 'Duration Error for ' + filePath + ': ' + error.message + '\n');
        return resolve(null);
      }
      const duration = parseFloat(stdout);
      resolve(isNaN(duration) ? null : duration);
    });
  });
});

let mainWindow;
let fallbackDictionary = {};
let showDictionary = {};

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    autoHideMenuBar: true,
    backgroundColor: '#121212',
    icon: path.join(__dirname, 'build/icon.ico')
  });

  mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  // Scan directories on startup if they exist
  const defaultsDir = store.get('defaultsDirectory');
  if (defaultsDir) scanDefaultsDirectory(defaultsDir);

  const showDir = store.get('showDirectory');
  if (showDir) scanShowDirectory(showDir);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handlers

ipcMain.on('sync-companion-state', (event, stateObj) => {
  if (companionPushFailed) return;
  
  companionState = stateObj;

  const pushEnabled = store.get('companionPush');
  const pushUrl = store.get('companionUrl');
  if (pushEnabled && pushUrl) {
    const baseUrl = pushUrl.replace(/\/$/, ''); // remove trailing slash
    for (const [key, value] of Object.entries(stateObj)) {
      const url = new URL(`${baseUrl}/api/custom-variable/${key}/value`);
      url.searchParams.append('value', String(value));
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1000);
      fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: controller.signal
      }).then(() => clearTimeout(timeoutId)).catch(err => {
        clearTimeout(timeoutId);
        if (!companionPushFailed) {
          companionPushFailed = true;
          console.error("Companion API Error: ", url.toString(), err.message);
          event.sender.send('companion-error', err.message);
        }
      });
    }
  }
});

ipcMain.on('reset-companion-push', () => {
  companionPushFailed = false;
});

// Settings
ipcMain.handle('get-settings', () => {
  return store.store;
});

ipcMain.handle('save-settings', (event, settings) => {
  store.set(settings);
  if (settings.defaultsDirectory && settings.defaultsDirectory !== store.get('defaultsDirectory')) {
    scanDefaultsDirectory(settings.defaultsDirectory);
  }
  if (settings.showDirectory && settings.showDirectory !== store.get('showDirectory')) {
    scanShowDirectory(settings.showDirectory);
  }
  return true;
});

ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  if (!result.canceled) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('export-settings', async (event, settingsObj) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Settings',
    defaultPath: 'vmix-ad-settings.json',
    filters: [{ name: 'JSON Files', extensions: ['json'] }]
  });
  if (!result.canceled && result.filePath) {
    fs.writeFileSync(result.filePath, JSON.stringify(settingsObj, null, 2));
    return true;
  }
  return false;
});

ipcMain.handle('import-settings', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import Settings',
    properties: ['openFile'],
    filters: [{ name: 'JSON Files', extensions: ['json'] }]
  });
  if (!result.canceled && result.filePaths.length > 0) {
    try {
      const data = fs.readFileSync(result.filePaths[0], 'utf8');
      return JSON.parse(data);
    } catch (e) {
      console.error("Failed to parse settings JSON:", e);
      return null;
    }
  }
  return null;
});

ipcMain.handle('select-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Media Files', extensions: ['mp4', 'mov', 'webm', 'mkv', 'mxf', 'mpg', 'm4v', 'ts', 'mp3', 'wav', 'png', 'jpg', 'jpeg'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  if (!result.canceled) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('get-placeholder-path', () => {
  const userDataPath = app.getPath('userData');
  const destPath = path.join(userDataPath, 'placeholder.png');
  if (!fs.existsSync(destPath)) {
    const srcPath = path.join(__dirname, 'placeholder.png');
    if (fs.existsSync(srcPath)) {
      try {
        fs.copyFileSync(srcPath, destPath);
      } catch (e) {
        console.error("Failed to copy placeholder.png to userData", e);
        return srcPath;
      }
    }
  }
  return destPath;
});

const validExts = ["mp4", "mov", "mxf", "mpg", "m4v", "webm", "ts", "qt", "jpg", "png", "webp", "tiff", "tif", "bmp", "heif", "mp3", "wav", "gt", "xaml"];

function getExt(filename) {
  const parts = filename.split('.');
  return parts.length > 1 ? parts.pop().toLowerCase() : '';
}

// A file only counts as ready once its size/mtime have been unchanged for this long,
// so a file that is still being exported (Premiere / Media Encoder) isn't loaded half-written.
const FILE_STABLE_MS = 3000;
// A file first seen with an mtime at least this old wasn't just written, so it's trusted immediately.
const FILE_SETTLED_AGE_MS = 10000;
const fileStability = new Map(); // path -> { size, mtimeMs, since }

function isFileReady(filePath) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (err) {
    fileStability.delete(filePath);
    return false;
  }
  if (!stat.isFile()) return false;

  const now = Date.now();
  let entry = fileStability.get(filePath);
  if (!entry || entry.size !== stat.size || entry.mtimeMs !== stat.mtimeMs) {
    const alreadySettled = !entry && (now - stat.mtimeMs) >= FILE_SETTLED_AGE_MS;
    entry = { size: stat.size, mtimeMs: stat.mtimeMs, since: alreadySettled ? now - FILE_STABLE_MS : now };
    fileStability.set(filePath, entry);
  }
  if (stat.size === 0 || (now - entry.since) < FILE_STABLE_MS) return false;

  try {
    const fd = fs.openSync(filePath, 'r+');
    fs.closeSync(fd);
    return true;
  } catch (err) {
    if (err.code === 'EBUSY' || err.code === 'EPERM') {
      return false; // File is locked (still being exported/written)
    }
    // If it's read-only or another error occurs, assume it exists but cannot be written
    return true;
  }
}

// Video files must also be probeable by ffprobe: an unfinished mp4/mov has no index yet and fails here,
// which is exactly the case where vMix would fail the import. Successful probes are cached per size/mtime.
const VIDEO_EXT_RE = /\.(mp4|mov|webm|mkv|mxf|mpg|m4v|ts)$/i;
const probedOk = new Map(); // path -> "size:mtimeMs"

function probeDuration(filePath) {
  return new Promise((resolve) => {
    execFile(ffprobe.path, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath
    ], (error, stdout) => {
      if (error) return resolve(null);
      const duration = parseFloat(stdout);
      resolve(isNaN(duration) ? null : duration);
    });
  });
}

async function isMediaReady(filePath) {
  if (!isFileReady(filePath)) return false;
  if (!VIDEO_EXT_RE.test(filePath)) return true;
  let stat;
  try { stat = fs.statSync(filePath); } catch (e) { return false; }
  const sig = `${stat.size}:${stat.mtimeMs}`;
  if (probedOk.get(filePath) === sig) return true;
  const duration = await probeDuration(filePath);
  if (duration && duration > 0) {
    probedOk.set(filePath, sig);
    return true;
  }
  return false;
}

// File Management & Fallbacks
function deepScanFiles(dir, fileList = []) {
  if (!fs.existsSync(dir)) return fileList;
  try {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const filePath = path.join(dir, file);
      try {
        if (fs.statSync(filePath).isDirectory()) {
          deepScanFiles(filePath, fileList);
        } else {
          const ext = getExt(file);
          if (validExts.includes(ext)) {
            fileList.push(filePath);
          }
        }
      } catch (err) {
        // Ignore stat or read errors for individual files/folders
      }
    }
  } catch (err) {
    // Ignore read errors for unreadable directories (e.g. System Volume Information)
  }
  return fileList;
}

function scanDefaultsDirectory(dirPath) {
  fallbackDictionary = {};
  if (!dirPath || !fs.existsSync(dirPath)) return;

  const allFiles = deepScanFiles(dirPath);
  for (const filePath of allFiles) {
    const filename = path.basename(filePath).toLowerCase();
    // Use the first found file for a given filename
    if (!fallbackDictionary[filename]) {
      fallbackDictionary[filename] = filePath;
    }
  }
  console.log(`Scanned defaults. Found ${Object.keys(fallbackDictionary).length} fallback files.`);
}

function scanShowDirectory(dirPath) {
  showDictionary = {};
  if (!dirPath || !fs.existsSync(dirPath)) return;

  const allFiles = deepScanFiles(dirPath);
  for (const filePath of allFiles) {
    const filename = path.basename(filePath).toLowerCase();
    // Use the first found file for a given filename
    if (!showDictionary[filename]) {
      showDictionary[filename] = filePath;
    }
  }
  console.log(`Scanned show directory. Found ${Object.keys(showDictionary).length} files.`);
}

ipcMain.handle('scan-defaults-now', () => {
  const dir = store.get('defaultsDirectory');
  scanDefaultsDirectory(dir);
  return Object.keys(fallbackDictionary).length;
});

ipcMain.handle('rescan-directories', () => {
  const defaultsDir = store.get('defaultsDirectory');
  if (defaultsDir) scanDefaultsDirectory(defaultsDir);
  
  const showDir = store.get('showDirectory');
  if (showDir) scanShowDirectory(showDir);
});



ipcMain.handle('resolve-media', async (event, filename) => {
  if (!filename) return null;

  const showDir = store.get('showDirectory');

  // Check if filename is an absolute path
  if (path.isAbsolute(filename)) {
    if (await isMediaReady(filename)) return { path: filename, isFallback: false };
    filename = path.basename(filename);
  }

  const ext = getExt(filename);
  let candidates = [];
  if (ext) {
    candidates.push(filename);
  } else {
    validExts.forEach(e => candidates.push(`${filename}.${e}`));
  }

  // 1. Check Show Directory directly (instant, doesn't need cache)
  if (showDir && fs.existsSync(showDir)) {
    for (const cand of candidates) {
      const showPath = path.join(showDir, cand);
      if (await isMediaReady(showPath)) {
        return { path: showPath, isFallback: false };
      }
    }
  }

  // 1b. Check Show Directory subdirectories via cache
  for (const cand of candidates) {
    const lowerFilename = cand.toLowerCase();
    if (showDictionary[lowerFilename]) {
      const showPath = showDictionary[lowerFilename];
      if (await isMediaReady(showPath)) {
        return { path: showPath, isFallback: false };
      }
    }
  }

  // 2. Check Defaults Fallback
  for (const cand of candidates) {
    const lowerFilename = cand.toLowerCase();
    if (fallbackDictionary[lowerFilename]) {
      const fallbackPath = fallbackDictionary[lowerFilename];
      if (await isMediaReady(fallbackPath)) {
        return { path: fallbackPath, isFallback: true };
      }
    }
  }

  // 3. Not found
  return null;
});

// In-memory API / event log (capped) that the renderer can copy from the settings panel.
const API_LOG_MAX = 8000;
const apiLog = [];
let apiLogSeq = 0;

function logLine(text) {
  const d = new Date();
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const ts = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
  apiLog.push(`${ts} ${text}`);
  if (apiLog.length > API_LOG_MAX) apiLog.splice(0, apiLog.length - API_LOG_MAX);
}

ipcMain.handle('get-api-log', () => apiLog.join('\n'));
ipcMain.handle('clear-api-log', () => { apiLog.length = 0; });
ipcMain.on('log-event', (event, msg) => logLine(`## ${msg}`));

// vMix API Request Handler (Avoids CORS issues from frontend)
ipcMain.handle('vmix-request', async (event, commandStr) => {
  const reqId = ++apiLogSeq;
  const startedAt = Date.now();
  logLine(`> vMix #${reqId} ${commandStr || 'XML State Request'}`);
  try {
    const ip = store.get('vmixIP') || '127.0.0.1:8088';
    const url = commandStr ? `http://${ip}/API/?${commandStr}` : `http://${ip}/API/`;
    console.log(`[${new Date().toISOString()}] [API CALL] vMix - Command: ${commandStr || 'XML State Request'}`);
    const response = await fetch(url);
    const text = await response.text();
    logLine(`< vMix #${reqId} ${response.ok ? 'ok' : 'HTTP ' + response.status} ${Date.now() - startedAt}ms`);
    return { success: response.ok, data: text };
  } catch (error) {
    logLine(`< vMix #${reqId} ERROR ${error.message} ${Date.now() - startedAt}ms`);
    console.error("vMix Error:", error);
    return { success: false, error: error.message };
  }
});

// Rundown Creator API Handler (Avoids CORS issues from frontend)
ipcMain.handle('rundown-request', async (event, action, params = {}) => {
  try {
    const station = store.get('rundownCreatorRadioStation');
    const apiKey = store.get('rundownCreatorAPIKey');
    const apiToken = store.get('rundownCreatorAPIToken');

    if (!station || !apiKey || !apiToken) {
      return { success: false, error: "Missing RundownCreator credentials in settings." };
    }

    const queryParams = new URLSearchParams({
      APIKey: apiKey,
      APIToken: apiToken,
      Action: action,
      ...params
    });

    const url = `https://www.rundowncreator.com/${station}/API.php?${queryParams.toString()}`;
    console.log(`[${new Date().toISOString()}] [API CALL] RundownCreator - Action: ${action} | RowID: ${params.RowID || 'N/A'}`);
    logLine(`> RundownCreator ${action} RowID=${params.RowID || 'N/A'}`);
    const response = await fetch(url);
    const serverDateHeader = response.headers.get('date');
    const textData = await response.text();
    let data;
    try {
      data = JSON.parse(textData);
      if (data && data.Error) {
        return { success: false, error: data.Error };
      }
    } catch (e) {
      if (textData.includes("You haven't made any changes")) {
        return { success: true, data: { message: "No changes made." }, serverDate: serverDateHeader };
      }
      return { success: false, error: textData.trim() };
    }
    return { success: true, data: data, serverDate: serverDateHeader };
  } catch (error) {
    console.error("RundownCreator API Error:", error);
    return { success: false, error: error.message };
  }
});

// Utility to load a local CSV directly (for startup auto-load)
ipcMain.handle('read-csv-file', async (event, filePath) => {
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf-8');
    return content;
  } catch (error) {
    console.error("Read CSV Error:", error);
    return null;
  }
});
