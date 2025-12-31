const { app, BrowserWindow, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Ensure dev-mode uses the same userData folder as packaged builds,
// so DB + uploads are shared across electron:dev and the installed app.
let PRODUCT_NAME = 'MediArchive Pro';
try {
  const pkg = require('../package.json');
  PRODUCT_NAME = pkg?.build?.productName || pkg?.productName || PRODUCT_NAME;
} catch {
  // ignore
}

if (!app.isPackaged) {
  // Capture Electron's default dev userData path (often "Electron") for migration.
  let legacyUserDataPath = '';
  try {
    legacyUserDataPath = app.getPath('userData');
  } catch {
    legacyUserDataPath = '';
  }

  try {
    app.setName(PRODUCT_NAME);
    // On macOS, app.getPath('appData') => ~/Library/Application Support
    // This matches the packaged app's userData base directory.
    app.setPath('userData', path.join(app.getPath('appData'), PRODUCT_NAME));
  } catch {
    // ignore
  }

  // Stash for whenReady migration.
  process.env.__LEGACY_USER_DATA = legacyUserDataPath;
}

const DEFAULT_PORT = process.env.ELECTRON_PORT || process.env.PORT || 4000;
const DEFAULT_HOST = process.env.ELECTRON_HOST || process.env.HOST || (app.isPackaged ? '0.0.0.0' : '127.0.0.1');
let mainWindow;

function listLanUrls(actualPort) {
  const ifaces = os.networkInterfaces();
  const urls = [];
  for (const name of Object.keys(ifaces)) {
    for (const addr of ifaces[name] || []) {
      if (!addr || addr.family !== 'IPv4') continue;
      if (addr.internal) continue;
      urls.push(`http://${addr.address}:${actualPort}`);
    }
  }
  return urls;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadURL(`http://localhost:${DEFAULT_PORT}`);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  const userDataPath = app.getPath('userData');
  process.env.DATA_DIR = userDataPath;
  process.env.DB_PATH = path.join(userDataPath, 'media-archive.db');

  // One-time migration: if dev mode previously wrote data into a different userData dir,
  // copy DB + uploads into the unified directory (only when unified dir is empty).
  try {
    const legacy = process.env.__LEGACY_USER_DATA || '';
    if (!app.isPackaged && legacy && legacy !== userDataPath) {
      const legacyDb = path.join(legacy, 'media-archive.db');
      const legacyUploads = path.join(legacy, 'uploads');
      const targetDb = process.env.DB_PATH;
      const targetUploads = path.join(userDataPath, 'uploads');

      const hasTargetDb = fs.existsSync(targetDb);
      const hasLegacyDb = fs.existsSync(legacyDb);

      if (!hasTargetDb && hasLegacyDb) {
        fs.mkdirSync(userDataPath, { recursive: true });
        fs.copyFileSync(legacyDb, targetDb);
      }

      const hasTargetUploads = fs.existsSync(targetUploads);
      const hasLegacyUploads = fs.existsSync(legacyUploads);
      if (!hasTargetUploads && hasLegacyUploads) {
        fs.mkdirSync(targetUploads, { recursive: true });
        // Node 16+ supports fs.cpSync
        if (typeof fs.cpSync === 'function') {
          fs.cpSync(legacyUploads, targetUploads, { recursive: true, force: false, errorOnExist: false });
        }
      }
    }
  } catch {
    // ignore
  }
  let startServer;
  let stopServer;
  let closeDatabase;
  try {
    ({ startServer, stopServer, closeDatabase } = require('../server'));
  } catch (error) {
    const message = [
      '启动本地服务失败：原生依赖可能与 Electron ABI 不匹配（常见于 better-sqlite3）。',
      '',
      '请在项目根目录执行：',
      '  npm run rebuild:electron',
      '',
      '如果你刚运行过 npm run rebuild:node，也需要重新执行 rebuild:electron 再启动桌面版。',
      '',
      `详细错误：${error?.message || error}`
    ].join('\n');
    console.error('[electron] failed to load server:', error);
    try {
      dialog.showErrorBox('MediArchive Pro 启动失败', message);
    } catch {}
    app.quit();
    return;
  }
  const server = startServer({ port: DEFAULT_PORT, host: DEFAULT_HOST });
  server.on('listening', () => {
    try {
      if (DEFAULT_HOST === '0.0.0.0') {
        const actualPort = server?.address?.()?.port ?? DEFAULT_PORT;
        const urls = listLanUrls(actualPort);
        if (urls.length) {
          dialog.showMessageBox({
            type: 'info',
            title: '手机访问地址',
            message: '同一 Wi‑Fi 下可用手机浏览器访问：',
            detail: urls.join('\n')
          }).catch(() => {});
        }
      }
    } catch {}
    createWindow();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  app.on('before-quit', () => {
    stopServer();
    closeDatabase();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
