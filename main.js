const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const Store = require('electron-store');
const fs = require('fs');

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
        fs.appendFileSync(path.join(__dirname, 'debug-log.txt'), 'Duration Error for ' + filePath + ': ' + error.message + '\n');
        return resolve(null);
      }
      const duration = parseFloat(stdout);
      resolve(isNaN(duration) ? null : duration);
    });
  });
});

let mainWindow;
let fallbackDictionary = {};

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

  // Scan defaults directory on startup if it exists
  const defaultsDir = store.get('defaultsDirectory');
  if (defaultsDir) {
    scanDefaultsDirectory(defaultsDir);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handlers

// Settings
ipcMain.handle('get-settings', () => {
  return store.store;
});

ipcMain.handle('save-settings', (event, settings) => {
  store.set(settings);
  if (settings.defaultsDirectory && settings.defaultsDirectory !== store.get('defaultsDirectory')) {
    scanDefaultsDirectory(settings.defaultsDirectory);
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

function isFileReady(filePath) {
  if (!fs.existsSync(filePath)) return false;
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

// File Management & Fallbacks
function deepScanFiles(dir, fileList = []) {
  if (!fs.existsSync(dir)) return fileList;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      deepScanFiles(filePath, fileList);
    } else {
      const ext = getExt(file);
      if (validExts.includes(ext)) {
        fileList.push(filePath);
      }
    }
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

ipcMain.handle('scan-defaults-now', () => {
  const dir = store.get('defaultsDirectory');
  scanDefaultsDirectory(dir);
  return Object.keys(fallbackDictionary).length;
});



ipcMain.handle('resolve-media', (event, filename) => {
  if (!filename) return null;

  const showDir = store.get('showDirectory');

  // Check if filename is an absolute path
  if (path.isAbsolute(filename)) {
    if (isFileReady(filename)) return { path: filename, isFallback: false };
    filename = path.basename(filename);
  }

  const ext = getExt(filename);
  let candidates = [];
  if (ext) {
    candidates.push(filename);
  } else {
    validExts.forEach(e => candidates.push(`${filename}.${e}`));
  }

  // 1. Check Show Directory
  if (showDir && fs.existsSync(showDir)) {
    for (const cand of candidates) {
      const showPath = path.join(showDir, cand);
      if (isFileReady(showPath)) {
        return { path: showPath, isFallback: false };
      }
    }
  }

  // 2. Check Defaults Fallback
  for (const cand of candidates) {
    const lowerFilename = cand.toLowerCase();
    if (fallbackDictionary[lowerFilename]) {
      const fallbackPath = fallbackDictionary[lowerFilename];
      if (isFileReady(fallbackPath)) {
        return { path: fallbackPath, isFallback: true };
      }
    }
  }

  // 3. Not found
  return null;
});

// vMix API Request Handler (Avoids CORS issues from frontend)
ipcMain.handle('vmix-request', async (event, commandStr) => {
  try {
    const ip = store.get('vmixIP') || '127.0.0.1:8088';
    const url = commandStr ? `http://${ip}/API/?${commandStr}` : `http://${ip}/API/`;
    console.log(`[${new Date().toISOString()}] [API CALL] vMix - Command: ${commandStr || 'XML State Request'}`);
    const response = await fetch(url);
    const text = await response.text();
    return { success: response.ok, data: text };
  } catch (error) {
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
