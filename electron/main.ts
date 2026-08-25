import { app, BrowserWindow, globalShortcut, ipcMain } from 'electron';
import path from 'node:path';

const isDev = !app.isPackaged;
let mainWindow: BrowserWindow | null = null;
let protectedMode = true;
let overlayVisible = true;

function applyWindowPolicy(window: BrowserWindow): void {
  window.setAlwaysOnTop(true, 'floating');
  window.setContentProtection(protectedMode);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Overlay Monster',
    backgroundColor: '#0b1020',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  applyWindowPolicy(mainWindow);
  mainWindow.setMenuBarVisibility(false);

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (isDev) {
    void mainWindow.loadURL('http://localhost:5173');
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

function registerIpc(): void {
  ipcMain.handle('overlay:get-state', () => ({
    protectedMode,
    alwaysOnTop: mainWindow?.isAlwaysOnTop() ?? false,
    visible: overlayVisible,
  }));

  ipcMain.handle('overlay:set-protection', (_event, enabled: boolean) => {
    protectedMode = Boolean(enabled);
    if (mainWindow) mainWindow.setContentProtection(protectedMode);
    return protectedMode;
  });

  ipcMain.handle('overlay:set-always-on-top', (_event, enabled: boolean) => {
    mainWindow?.setAlwaysOnTop(Boolean(enabled), 'floating');
    return mainWindow?.isAlwaysOnTop() ?? false;
  });

  ipcMain.handle('overlay:toggle', () => {
    if (!mainWindow) return false;
    overlayVisible = !overlayVisible;
    if (overlayVisible) mainWindow.show();
    else mainWindow.hide();
    return overlayVisible;
  });
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();

  globalShortcut.register('CommandOrControl+Shift+Space', () => {
    void mainWindow?.webContents.send('overlay:shortcut-toggle');
    if (mainWindow) {
      overlayVisible = !overlayVisible;
      if (overlayVisible) mainWindow.show();
      else mainWindow.hide();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => globalShortcut.unregisterAll());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
