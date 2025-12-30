const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');

const DEFAULT_PORT = process.env.ELECTRON_PORT || process.env.PORT || 4000;
let mainWindow;

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
  process.env.DB_PATH = path.join(userDataPath, 'media-archive.db');
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
  const server = startServer({ port: DEFAULT_PORT });
  server.on('listening', () => {
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
