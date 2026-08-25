import { app, BrowserWindow, globalShortcut, ipcMain, WebContentsView } from 'electron';
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
  browserView.setBounds({ x: Math.floor(width * 0.38), y: 72, width: Math.floor(width * 0.62), height: Math.max(0, height - 72) });
}

function createBrowserView(): void {
  if (!mainWindow) return;
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
    alwaysOnTop: alwaysOnTop,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.on('resize', updateBrowserBounds);
  mainWindow.once('ready-to-show', () => mainWindow?.show());

  if (isDev) void mainWindow.loadURL('http://localhost:5173');
  else void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  createBrowserView();
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
  if (overlayVisible) mainWindow?.show(); else mainWindow?.hide();
  return overlayVisible;
});
ipcMain.handle('browser:navigate', (_event, url: string) => {
  const target = normalizeUrl(url);
  void browserView?.webContents.loadURL(target);
  return target;
});
ipcMain.handle('browser:back', () => browserView?.webContents.canGoBack() && browserView.webContents.goBack());
ipcMain.handle('browser:forward', () => browserView?.webContents.canGoForward() && browserView.webContents.goForward());
ipcMain.handle('browser:reload', () => { browserView?.webContents.reload(); return true; });
ipcMain.handle('browser:get-url', () => browserView?.webContents.getURL() ?? '');

app.whenReady().then(() => {
  createWindow();
  globalShortcut.register('CommandOrControl+Shift+Space', () => {
    overlayVisible = !overlayVisible;
    if (overlayVisible) mainWindow?.show(); else mainWindow?.hide();
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
