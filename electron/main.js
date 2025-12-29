const { app, BrowserWindow } = require('electron');
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
  const { startServer, stopServer, closeDatabase } = require('../server');
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
