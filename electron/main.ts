import { app, BrowserWindow, globalShortcut, ipcMain, WebContentsView } from 'electron';
import { autoUpdater } from 'electron-updater';
import path from 'node:path';

const isDev = !app.isPackaged;
let mainWindow: BrowserWindow | null = null;
let browserView: WebContentsView | null = null;
let protectedMode = true;
let protectionStatus: 'pending' | 'applied' | 'disabled' | 'unsupported' | 'error' = 'pending';
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

function sendOverlayState(): void {
  mainWindow?.webContents.send('overlay:state-changed', {
    protectedMode,
    protectionStatus,
    alwaysOnTop,
    visible: overlayVisible,
  });
}

function applyProtection(enabled: boolean): boolean {
  protectedMode = enabled;

  if (!mainWindow) {
    protectionStatus = 'pending';
    return false;
  }

  if (process.platform !== 'win32' && enabled) {
    protectionStatus = 'unsupported';
    return false;
  }

  try {
    mainWindow.setContentProtection(enabled);
    protectionStatus = enabled ? 'applied' : 'disabled';
    sendOverlayState();
    return true;
  } catch (error) {
    protectionStatus = 'error';
    console.error('Failed to apply content protection:', error);
    sendOverlayState();
    return false;
  }
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
    skipTaskbar: process.platform === 'win32',
    autoHideMenuBar: true,
    title: `Overlay Monster v${app.getVersion()}`,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  applyProtection(protectedMode);
  mainWindow.setAlwaysOnTop(alwaysOnTop);
  mainWindow.on('resize', updateBrowserBounds);

  // Electron typings in the installed version omit the Windows `minimize`
  // event from BrowserWindow's overload map. The runtime event is supported.
  mainWindow.on('minimize' as any, (event: Electron.Event) => {
    if (!protectedMode || !overlayVisible) return;
    event.preventDefault();
    overlayVisible = false;
    mainWindow?.hide();
    sendOverlayState();
  });

  mainWindow.on('show', () => {
    overlayVisible = true;
    sendOverlayState();
  });

  mainWindow.on('hide', () => {
    overlayVisible = false;
    sendOverlayState();
  });

  mainWindow.webContents.on('did-finish-load', () => {
    createBrowserView();
    sendOverlayState();
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error(`Renderer failed to load: ${errorCode} ${errorDescription}`);
  });

  mainWindow.once('ready-to-show', () => {
    applyProtection(protectedMode);
    mainWindow?.show();
  });

  if (isDev) void mainWindow.loadURL('http://localhost:5173');
  else void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
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

ipcMain.handle('overlay:get-state', () => ({
  protectedMode,
  protectionStatus,
  alwaysOnTop,
  visible: overlayVisible,
}));

ipcMain.handle('overlay:set-protection', (_event, enabled: boolean) => {
  applyProtection(enabled);
  return protectedMode;
});

ipcMain.handle('overlay:set-always-on-top', (_event, enabled: boolean) => {
  alwaysOnTop = enabled;
  mainWindow?.setAlwaysOnTop(enabled);
  sendOverlayState();
  return alwaysOnTop;
});

ipcMain.handle('overlay:toggle', () => {
  overlayVisible = !overlayVisible;
  if (overlayVisible) mainWindow?.show();
  else mainWindow?.hide();
  sendOverlayState();
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
    sendOverlayState();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
