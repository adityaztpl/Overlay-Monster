import { app, BrowserWindow, globalShortcut, ipcMain, WebContentsView } from 'electron';
import { autoUpdater } from 'electron-updater';
import path from 'node:path';

const isDev = !app.isPackaged;
let mainWindow: BrowserWindow | null = null;
let browserView: WebContentsView | null = null;
let protectedMode = true;
let alwaysOnTop = true;
let overlayVisible = true;

function normalizeUrl(input: string): string {
  const value = input.trim();
  if (/^https?:\/\//i.test(value)) return value;
  if (/^[\w.-]+\.[a-z]{2,}/i.test(value)) return `https://${value}`;
  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
}

function updateBrowserBounds(): void {
  if (!mainWindow || !browserView) return;
  const [width, height] = mainWindow.getContentSize();
  browserView.setBounds({
    x: Math.floor(width * 0.38),
    y: 72,
    width: Math.floor(width * 0.62),
    height: Math.max(0, height - 72),
  });
}

function syncBrowserUrl(): void {
  if (!mainWindow || !browserView) return;
  mainWindow.webContents.send('browser:url-changed', browserView.webContents.getURL());
}

function sendUpdateStatus(status: string, version?: string): void {
  mainWindow?.webContents.send('app:update-status', { status, version });
}

function setupAutoUpdater(): void {
  if (isDev) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => sendUpdateStatus('checking'));
  autoUpdater.on('update-available', (info) => sendUpdateStatus('available', info.version));
  autoUpdater.on('update-not-available', () => sendUpdateStatus('current', app.getVersion()));
  autoUpdater.on('download-progress', (progress) => {
    sendUpdateStatus(`downloading:${Math.round(progress.percent)}`);
  });
  autoUpdater.on('update-downloaded', (info) => sendUpdateStatus('downloaded', info.version));
  autoUpdater.on('error', (error) => {
    console.error('Auto update failed:', error);
    sendUpdateStatus('error');
  });

  setTimeout(() => {
    void autoUpdater.checkForUpdatesAndNotify().catch((error) => {
      console.error('Auto update check failed:', error);
      sendUpdateStatus('error');
    });
  }, 5000);
}

function createBrowserView(): void {
  if (!mainWindow || browserView) return;

  browserView = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.contentView.addChildView(browserView);

  browserView.webContents.setWindowOpenHandler(({ url }) => {
    void browserView?.webContents.loadURL(url);
    return { action: 'deny' };
  });

  browserView.webContents.on('did-navigate', syncBrowserUrl);
  browserView.webContents.on('did-navigate-in-page', syncBrowserUrl);
  browserView.webContents.on('did-finish-load', syncBrowserUrl);

  void browserView.webContents.loadURL('https://example.com');
  updateBrowserBounds();
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    alwaysOnTop,
    autoHideMenuBar: true,
    title: `Overlay Monster v${app.getVersion()}`,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.on('resize', updateBrowserBounds);

  mainWindow.webContents.on('did-finish-load', () => {
    createBrowserView();
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error(`Renderer failed to load: ${errorCode} ${errorDescription}`);
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  if (isDev) void mainWindow.loadURL('http://localhost:5173');
  else void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
}

ipcMain.handle('overlay:get-state', () => ({ protectedMode, alwaysOnTop, visible: overlayVisible }));
ipcMain.handle('overlay:set-protection', (_event, enabled: boolean) => {
  protectedMode = enabled;
  mainWindow?.setContentProtection(enabled);
  return protectedMode;
});
ipcMain.handle('overlay:set-always-on-top', (_event, enabled: boolean) => {
  alwaysOnTop = enabled;
  mainWindow?.setAlwaysOnTop(enabled);
  return alwaysOnTop;
});
ipcMain.handle('overlay:toggle', () => {
  overlayVisible = !overlayVisible;
  if (overlayVisible) mainWindow?.show();
  else mainWindow?.hide();
  return overlayVisible;
});
ipcMain.handle('browser:navigate', (_event, url: string) => {
  const target = normalizeUrl(url);
  void browserView?.webContents.loadURL(target);
  return target;
});
ipcMain.handle('browser:back', () => browserView?.webContents.canGoBack() && browserView.webContents.goBack());
ipcMain.handle('browser:forward', () => browserView?.webContents.canGoForward() && browserView.webContents.goForward());
ipcMain.handle('browser:reload', () => {
  browserView?.webContents.reload();
  return true;
});
ipcMain.handle('browser:get-url', () => browserView?.webContents.getURL() ?? '');
ipcMain.handle('app:get-version', () => app.getVersion());
ipcMain.handle('app:check-for-updates', async () => {
  if (isDev) return { status: 'dev' };
  await autoUpdater.checkForUpdates();
  return { status: 'checking' };
});
ipcMain.handle('app:install-update', () => {
  if (!isDev) autoUpdater.quitAndInstall();
  return true;
});

app.whenReady().then(() => {
  createWindow();
  setupAutoUpdater();

  globalShortcut.register('CommandOrControl+Shift+Space', () => {
    overlayVisible = !overlayVisible;
    if (overlayVisible) mainWindow?.show();
    else mainWindow?.hide();
    mainWindow?.webContents.send('overlay:shortcut-toggle', overlayVisible);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
