import { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, session, WebContentsView } from 'electron';
import { autoUpdater } from 'electron-updater';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const isDev = !app.isPackaged;
let mainWindow: BrowserWindow | null = null;
let browserView: WebContentsView | null = null;
let protectedMode = true;
let protectionStatus: 'pending' | 'applied' | 'disabled' | 'unsupported' | 'error' = 'pending';
let alwaysOnTop = true;
let overlayVisible = true;
let autoPasteEnabled = true;
let updateInstallRequested = false;
let clipboardPollingTimer: NodeJS.Timeout | null = null;
let lastClipboardSignature = '';
let ignoreClipboardUntil = 0;
let clipboardCheckInProgress = false;

const startupLogPath = path.join(app.getPath('userData'), 'startup.log');

function logStartup(message: string, error?: unknown): void {
  const detail = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : error ? String(error) : '';
  const line = `[${new Date().toISOString()}] ${message}${detail ? ` ${detail}` : ''}\n`;
  try { fs.appendFileSync(startupLogPath, line, 'utf8'); } catch { /* logging must never block startup */ }
  console.log(line.trim());
}

process.on('uncaughtException', (error) => logStartup('uncaughtException', error));
process.on('unhandledRejection', (reason) => logStartup('unhandledRejection', reason));

app.disableHardwareAcceleration();

type ClipboardRuntime = {
  readText: () => string | Promise<string>;
  readImage?: () => { isEmpty: () => boolean; toPNG: () => Buffer };
  availableFormats?: () => string[];
  readBuffer?: (format: string) => Buffer;
};
const runtimeClipboard = clipboard as unknown as ClipboardRuntime;

function isTrustedRenderer(event: Electron.IpcMainInvokeEvent): boolean {
  return Boolean(mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents);
}

function isAllowedRemoteUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'https:') return true;
    return isDev && parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function normalizeUrl(input: string): string {
  const value = input.trim();
  if (/^https?:\/\//i.test(value)) {
    try {
      const parsed = new URL(value);
      if (parsed.protocol === 'http:' && !isDev) parsed.protocol = 'https:';
      return isAllowedRemoteUrl(parsed.toString()) ? parsed.toString() : `https://www.google.com/search?q=${encodeURIComponent(value)}`;
    } catch { /* fall through to search */ }
  }
  if (/^[\w.-]+\.[a-z]{2,}/i.test(value)) return `https://${value}`;
  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
}

function updateBrowserBounds(): void {
  if (!mainWindow || !browserView) return;
  const [width, height] = mainWindow.getContentSize();
  browserView.setBounds({ x: 0, y: 72, width, height: Math.max(0, height - 72) });
}

function syncBrowserUrl(): void {
  if (!mainWindow || !browserView || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('browser:url-changed', browserView.webContents.getURL());
}

function sendUpdateStatus(status: string, version?: string): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('app:update-status', { status, version });
}

function sendOverlayState(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('overlay:state-changed', {
    protectedMode,
    protectionStatus,
    alwaysOnTop,
    visible: overlayVisible,
    autoPasteEnabled,
  });
}

function getNativeWindowHandleHex(): string | null {
  if (!mainWindow) return null;
  const handle = mainWindow.getNativeWindowHandle();
  if (!handle.length) return null;
  const value = process.arch === 'ia32' ? BigInt(handle.readUInt32LE(0)) : handle.readBigUInt64LE(0);
  return value.toString(16);
}

function verifyWindowsCaptureExclusion(): boolean {
  if (process.platform !== 'win32' || !mainWindow) return false;
  const hwndHex = getNativeWindowHandleHex();
  if (!hwndHex) return false;
  const script = [
    '$signature = @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class CaptureProtection {',
    '  [DllImport("user32.dll", SetLastError = true)]',
    '  public static extern bool GetWindowDisplayAffinity(IntPtr hWnd, out uint affinity);',
    '}',
    '"@',
    'Add-Type -TypeDefinition $signature',
    `$hwnd = [IntPtr]::new([Convert]::ToInt64('${hwndHex}', 16))`,
    '$affinity = [uint32]0',
    '$ok = [CaptureProtection]::GetWindowDisplayAffinity($hwnd, [ref]$affinity)',
    'if ($ok) { [Console]::WriteLine($affinity) } else { [Console]::WriteLine("-1") }',
  ].join(';');
  try {
    const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 3000,
    }).trim();
    const affinity = Number.parseInt(output, 10);
    console.log(`[Protection] GetWindowDisplayAffinity = 0x${affinity.toString(16)}`);
    return affinity === 0x11;
  } catch (error) {
    console.error('[Protection] Native verification failed:', error);
    return false;
  }
}

function applyProtection(enabled: boolean): boolean {
  protectedMode = enabled;
  if (!mainWindow) {
    protectionStatus = 'pending';
    return false;
  }
  if (process.platform !== 'win32') {
    protectionStatus = enabled ? 'unsupported' : 'disabled';
    sendOverlayState();
    return !enabled;
  }
  try {
    mainWindow.setContentProtection(enabled);
    if (!enabled) {
      protectionStatus = 'disabled';
      sendOverlayState();
      return true;
    }
    const verified = verifyWindowsCaptureExclusion();
    protectionStatus = verified ? 'applied' : 'error';
    if (!verified) console.error('[Protection] Windows did not report WDA_EXCLUDEFROMCAPTURE.');
    sendOverlayState();
    return verified;
  } catch (error) {
    protectionStatus = 'error';
    console.error('[Protection] Failed to apply content protection:', error);
    sendOverlayState();
    return false;
  }
}

function isChatGptUrl(): boolean {
  if (!browserView) return false;
  try {
    const hostname = new URL(browserView.webContents.getURL()).hostname.toLowerCase();
    return hostname === 'chatgpt.com' || hostname === 'www.chatgpt.com' || hostname === 'chat.openai.com';
  } catch {
    return false;
  }
}

async function focusChatGptComposer(): Promise<boolean> {
  if (!browserView || browserView.webContents.isDestroyed() || !isChatGptUrl()) return false;
  try {
    return Boolean(await browserView.webContents.executeJavaScript(`(() => {
      const selectors = ['[data-testid="prompt-textarea"]', '#prompt-textarea', '[contenteditable="true"][data-lexical-editor="true"]', 'div[contenteditable="true"].ProseMirror', 'textarea[placeholder*="Ask"]', 'textarea[placeholder*="Message"]'];
      const element = selectors.map((selector) => document.querySelector(selector)).find(Boolean);
      if (!element) return false;
      const editable = element as HTMLElement;
      editable.focus();
      editable.scrollIntoView({ block: 'nearest' });
      return document.activeElement === editable || editable.contains(document.activeElement);
    })()`));
  } catch (error) {
    console.error('[Clipboard] Could not focus ChatGPT composer:', error);
    return false;
  }
}

async function getClipboardSignature(): Promise<{ signature: string; kind: 'text' | 'image' | null }> {
  const text = await Promise.resolve(runtimeClipboard.readText());
  if (runtimeClipboard.readImage) {
    try {
      const image = runtimeClipboard.readImage();
      if (!image.isEmpty()) return { signature: `image:${createHash('sha1').update(image.toPNG()).digest('hex')}`, kind: 'image' };
    } catch (error) {
      console.error('[Clipboard] Could not read image:', error);
    }
  }
  if (runtimeClipboard.availableFormats && runtimeClipboard.readBuffer) {
    try {
      const formats = runtimeClipboard.availableFormats();
      const imageFormat = formats.find((format) => format.toLowerCase().startsWith('image/'));
      if (imageFormat) {
        const imageBuffer = runtimeClipboard.readBuffer(imageFormat);
        if (imageBuffer.length > 0) return { signature: `image:${createHash('sha1').update(imageBuffer).digest('hex')}`, kind: 'image' };
      }
    } catch (error) {
      console.error('[Clipboard] Could not read image format:', error);
    }
  }
  if (text) return { signature: `text:${createHash('sha1').update(text, 'utf8').digest('hex')}`, kind: 'text' };
  return { signature: '', kind: null };
}

async function pasteClipboardIntoChatGpt(kind: 'text' | 'image'): Promise<void> {
  if (!browserView || !autoPasteEnabled || !isChatGptUrl() || Date.now() < ignoreClipboardUntil) return;
  if (!await focusChatGptComposer()) return;
  try {
    browserView.webContents.paste();
    console.log(`[Clipboard] Auto-pasted ${kind} into ChatGPT.`);
  } catch (error) {
    console.error(`[Clipboard] Failed to paste ${kind} into ChatGPT:`, error);
  }
}

async function checkClipboard(): Promise<void> {
  if (clipboardCheckInProgress || !autoPasteEnabled || !isChatGptUrl()) return;
  clipboardCheckInProgress = true;
  try {
    const current = await getClipboardSignature();
    if (!current.signature || current.signature === lastClipboardSignature) return;
    lastClipboardSignature = current.signature;
    if (current.kind) await pasteClipboardIntoChatGpt(current.kind);
  } catch (error) {
    console.error('[Clipboard] Monitor check failed:', error);
  } finally {
    clipboardCheckInProgress = false;
  }
}

function startClipboardMonitor(): void {
  if (clipboardPollingTimer) return;
  void getClipboardSignature().then((initial) => { lastClipboardSignature = initial.signature; }).catch((error) => console.error('[Clipboard] Initial read failed:', error));
  clipboardPollingTimer = setInterval(() => { void checkClipboard(); }, 750);
}

function stopClipboardMonitor(): void {
  if (!clipboardPollingTimer) return;
  clearInterval(clipboardPollingTimer);
  clipboardPollingTimer = null;
}

function configureRemoteSession(): void {
  const remoteSession = session.defaultSession;

  remoteSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) => {
    if (!requestingOrigin.startsWith('https://') && !(isDev && requestingOrigin.startsWith('http://localhost'))) return false;
    if (permission === 'fullscreen') return true;
    if (permission === 'media') return Boolean(details?.isMainFrame !== false);
    return false;
  });

  remoteSession.setPermissionRequestHandler((webContents, permission, callback) => {
    let parsed: URL;
    try {
      parsed = new URL(webContents.getURL());
    } catch {
      callback(false);
      return;
    }
    if (parsed.protocol !== 'https:' && !(isDev && parsed.hostname === 'localhost')) {
      callback(false);
      return;
    }
    if (permission === 'fullscreen') {
      callback(true);
      return;
    }
    if (permission !== 'media') {
      callback(false);
      return;
    }
    if (!mainWindow || mainWindow.isDestroyed()) {
      callback(false);
      return;
    }

    void dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: ['Allow', 'Deny'],
      defaultId: 1,
      cancelId: 1,
      title: 'Permission request',
      message: `${parsed.hostname} wants access to your camera or microphone.`,
      detail: 'Allow only if you trust this site and need the device for the current task.',
    }).then(({ response }) => callback(response === 0)).catch(() => callback(false));
  });
}

function createBrowserView(): void {
  if (!mainWindow || browserView) return;
  browserView = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  mainWindow.contentView.addChildView(browserView);

  browserView.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedRemoteUrl(url)) void browserView?.webContents.loadURL(url);
    return { action: 'deny' };
  });

  browserView.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedRemoteUrl(url)) event.preventDefault();
  });
  browserView.webContents.on('will-redirect', (event, url) => {
    if (!isAllowedRemoteUrl(url)) event.preventDefault();
  });
  browserView.webContents.on('did-navigate', syncBrowserUrl);
  browserView.webContents.on('did-navigate-in-page', syncBrowserUrl);
  browserView.webContents.on('did-finish-load', syncBrowserUrl);
  browserView.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.control && input.key.toLowerCase() === 'c') ignoreClipboardUntil = Date.now() + 1500;
  });
  browserView.webContents.on('render-process-gone', (_event, details) => logStartup(`browserView render-process-gone: ${details.reason}`));

  void browserView.webContents.loadURL('https://example.com').catch((error) => logStartup('Failed to load initial browser page', error));
  updateBrowserBounds();
}

function createWindow(): void {
  logStartup(`createWindow: packaged=${app.isPackaged}, version=${app.getVersion()}, appPath=${app.getAppPath()}`);
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: true,
    alwaysOnTop,
    skipTaskbar: process.platform === 'win32',
    autoHideMenuBar: true,
    title: `Overlay Monster v${app.getVersion()}`,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.on('closed', () => {
    browserView?.webContents.close();
    browserView = null;
    mainWindow = null;
  });
  mainWindow.on('resize', updateBrowserBounds);
  mainWindow.on('minimize' as any, (event: Electron.Event) => {
    if (!protectedMode || !overlayVisible) return;
    event.preventDefault();
    overlayVisible = false;
    mainWindow?.hide();
    sendOverlayState();
  });
  mainWindow.on('show', () => {
    overlayVisible = true;
    if (protectedMode) applyProtection(true);
    sendOverlayState();
  });
  mainWindow.on('hide', () => {
    overlayVisible = false;
    sendOverlayState();
  });
  mainWindow.webContents.on('did-finish-load', () => {
    logStartup('renderer did-finish-load');
    createBrowserView();
    sendOverlayState();
  });
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    logStartup(`renderer did-fail-load: ${errorCode} ${errorDescription} ${validatedURL}`);
    mainWindow?.show();
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    logStartup(`renderer render-process-gone: ${details.reason}`);
    mainWindow?.show();
  });

  const rendererPath = path.join(__dirname, '../renderer/index.html');
  if (!isDev && !fs.existsSync(rendererPath)) {
    const message = `Renderer file missing: ${rendererPath}`;
    logStartup(message);
    void dialog.showErrorBox('Overlay Monster startup error', `${message}\n\nOpen startup.log from the app data folder.`);
    return;
  }

  const loadPromise = isDev
    ? mainWindow.loadURL('http://localhost:5173')
    : mainWindow.loadFile(rendererPath);
  void loadPromise.catch((error) => logStartup('Failed to load renderer', error));

  applyProtection(protectedMode);
}

function setupAutoUpdater(): void {
  if (isDev) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('checking-for-update', () => sendUpdateStatus('checking'));
  autoUpdater.on('update-available', (info) => sendUpdateStatus('available', info.version));
  autoUpdater.on('update-not-available', (info) => sendUpdateStatus('current', info.version));
  autoUpdater.on('download-progress', (progress) => sendUpdateStatus(`downloading:${Math.round(progress.percent)}`));
  autoUpdater.on('update-downloaded', (info) => {
    const currentVersion = app.getVersion();
    if (info.version === currentVersion || updateInstallRequested) {
      sendUpdateStatus('current', currentVersion);
      return;
    }
    updateInstallRequested = true;
    sendUpdateStatus('downloaded', info.version);
    setTimeout(() => {
      if (app.isReady()) autoUpdater.quitAndInstall(false, true);
    }, 1000);
  });
  autoUpdater.on('error', (error) => {
    console.error('[Updater] error:', error);
    updateInstallRequested = false;
    sendUpdateStatus('error');
  });
  setTimeout(() => {
    void autoUpdater.checkForUpdates().catch((error) => {
      console.error('[Updater] check failed:', error);
      sendUpdateStatus('error');
    });
  }, 3000);
}

ipcMain.handle('overlay:get-state', (event) => {
  if (!isTrustedRenderer(event)) return null;
  return { protectedMode, protectionStatus, alwaysOnTop, visible: overlayVisible, autoPasteEnabled };
});
ipcMain.handle('overlay:set-protection', (event, enabled: boolean) => {
  if (!isTrustedRenderer(event) || typeof enabled !== 'boolean') return protectedMode;
  applyProtection(enabled);
  return protectedMode;
});
ipcMain.handle('overlay:set-always-on-top', (event, enabled: boolean) => {
  if (!isTrustedRenderer(event) || typeof enabled !== 'boolean') return alwaysOnTop;
  alwaysOnTop = enabled;
  mainWindow?.setAlwaysOnTop(enabled);
  sendOverlayState();
  return alwaysOnTop;
});
ipcMain.handle('overlay:set-auto-paste', (event, enabled: boolean) => {
  if (!isTrustedRenderer(event) || typeof enabled !== 'boolean') return autoPasteEnabled;
  autoPasteEnabled = enabled;
  sendOverlayState();
  return autoPasteEnabled;
});
ipcMain.handle('overlay:toggle', (event) => {
  if (!isTrustedRenderer(event)) return overlayVisible;
  overlayVisible = !overlayVisible;
  if (overlayVisible) mainWindow?.show(); else mainWindow?.hide();
  sendOverlayState();
  return overlayVisible;
});
ipcMain.handle('browser:navigate', (event, url: string) => {
  if (!isTrustedRenderer(event) || typeof url !== 'string' || !browserView) return browserView?.webContents.getURL() ?? '';
  const target = normalizeUrl(url);
  void browserView.webContents.loadURL(target);
  return target;
});
ipcMain.handle('browser:back', (event) => {
  if (!isTrustedRenderer(event) || !browserView || !browserView.webContents.canGoBack()) return false;
  browserView.webContents.goBack();
  return true;
});
ipcMain.handle('browser:forward', (event) => {
  if (!isTrustedRenderer(event) || !browserView || !browserView.webContents.canGoForward()) return false;
  browserView.webContents.goForward();
  return true;
});
ipcMain.handle('browser:reload', (event) => {
  if (!isTrustedRenderer(event) || !browserView) return false;
  browserView.webContents.reload();
  return true;
});
ipcMain.handle('browser:get-url', (event) => {
  if (!isTrustedRenderer(event)) return '';
  return browserView?.webContents.getURL() ?? '';
});
ipcMain.handle('app:get-version', (event) => isTrustedRenderer(event) ? app.getVersion() : '');
ipcMain.handle('app:check-for-updates', async (event) => {
  if (!isTrustedRenderer(event)) return { status: 'denied' };
  if (isDev) return { status: 'dev' };
  await autoUpdater.checkForUpdates();
  return { status: 'checking' };
});
ipcMain.handle('app:install-update', (event) => {
  if (!isTrustedRenderer(event)) return false;
  if (!isDev) autoUpdater.quitAndInstall(false, true);
  return true;
});

app.whenReady().then(() => {
  logStartup(`app ready: version=${app.getVersion()}`);
  configureRemoteSession();
  createWindow();
  startClipboardMonitor();
  setupAutoUpdater();

  globalShortcut.register('CommandOrControl+Shift+Space', () => {
    overlayVisible = !overlayVisible;
    if (overlayVisible) mainWindow?.show(); else mainWindow?.hide();
    sendOverlayState();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((error) => {
  logStartup('app.whenReady failed', error);
  void dialog.showErrorBox('Overlay Monster startup error', String(error));
});

app.on('will-quit', () => {
  stopClipboardMonitor();
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
