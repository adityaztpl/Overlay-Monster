import { app, BrowserWindow, clipboard, globalShortcut, ipcMain, WebContentsView } from 'electron';
import { autoUpdater } from 'electron-updater';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
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

type ClipboardRuntime = {
  readText: () => string | Promise<string>;
  readImage?: () => { isEmpty: () => boolean; toPNG: () => Buffer };
  availableFormats?: () => string[];
  readBuffer?: (format: string) => Buffer;
};

const runtimeClipboard = clipboard as unknown as ClipboardRuntime;

function normalizeUrl(input: string): string {
  const value = input.trim();
  if (/^https?:\/\//i.test(value)) return value;
  if (/^[\w.-]+\.[a-z]{2,}/i.test(value)) return `https://${value}`;
  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
}

function updateBrowserBounds(): void {
  if (!mainWindow || !browserView) return;
  const [width, height] = mainWindow.getContentSize();
  browserView.setBounds({ x: 0, y: 72, width, height: Math.max(0, height - 72) });
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
    const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 3000 }).trim();
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
  if (!mainWindow) { protectionStatus = 'pending'; return false; }
  if (process.platform !== 'win32') {
    protectionStatus = enabled ? 'unsupported' : 'disabled';
    sendOverlayState();
    return !enabled;
  }
  try {
    mainWindow.setContentProtection(enabled);
    if (!enabled) { protectionStatus = 'disabled'; sendOverlayState(); return true; }
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
      const selectors = [
        '[data-testid="prompt-textarea"]',
        '#prompt-textarea',
        '[contenteditable="true"][data-lexical-editor="true"]',
        'div[contenteditable="true"].ProseMirror',
        'textarea[placeholder*="Ask"]',
        'textarea[placeholder*="Message"]'
      ];
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

  // Electron versions expose image clipboard APIs differently in their TypeScript
  // declarations. Use the runtime compatibility layer above so CI does not depend
  // on a specific Electron declaration shape.
  if (runtimeClipboard.readImage) {
    try {
      const image = runtimeClipboard.readImage();
      if (!image.isEmpty()) {
        const hash = createHash('sha1').update(image.toPNG()).digest('hex');
        return { signature: `image:${hash}`, kind: 'image' };
      }
    } catch (error) {
      console.error('[Clipboard] Could not read image:', error);
    }
  }

  if (runtimeClipboard.availableFormats && runtimeClipboard.readBuffer) {
    try {
      const formats: string[] = runtimeClipboard.availableFormats();
      const imageFormat: string | undefined = formats.find((format: string) => format.toLowerCase().startsWith('image/'));
      if (imageFormat) {
        const imageBuffer = runtimeClipboard.readBuffer(imageFormat);
        if (imageBuffer.length > 0) {
          const hash = createHash('sha1').update(imageBuffer).digest('hex');
          return { signature: `image:${hash}`, kind: 'image' };
        }
      }
    } catch (error) {
      console.error('[Clipboard] Could not read image format:', error);
    }
  }

  if (text) return { signature: `text:${createHash('sha1').update(text, 'utf8').digest('hex')}`, kind: 'text' };
  return { signature: '', kind: null };
}

async function pasteClipboardIntoChatGpt(kind: 'text' | 'image'): Promise<void> {
  if (!browserView || !autoPasteEnabled || !isChatGptUrl()) return;
  if (Date.now() < ignoreClipboardUntil) return;

  const focused = await focusChatGptComposer();
  if (!focused) {
    console.warn(`[Clipboard] ChatGPT composer not found; ${kind} was not pasted.`);
    return;
  }

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

function createBrowserView(): void {
  if (!mainWindow || browserView) return;
  browserView = new WebContentsView({ webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  mainWindow.contentView.addChildView(browserView);
  browserView.webContents.setWindowOpenHandler(({ url }) => { void browserView?.webContents.loadURL(url); return { action: 'deny' }; });
  browserView.webContents.on('did-navigate', syncBrowserUrl);
  browserView.webContents.on('did-navigate-in-page', syncBrowserUrl);
  browserView.webContents.on('did-finish-load', syncBrowserUrl);
  browserView.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.control && input.key.toLowerCase() === 'c') {
      ignoreClipboardUntil = Date.now() + 1500;
    }
  });
  void browserView.webContents.loadURL('https://example.com');
  updateBrowserBounds();
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1100, minHeight: 700, show: false, alwaysOnTop, skipTaskbar: process.platform === 'win32', autoHideMenuBar: true,
    title: `Overlay Monster v${app.getVersion()}`,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  applyProtection(protectedMode);
  mainWindow.setAlwaysOnTop(alwaysOnTop);
  mainWindow.on('resize', updateBrowserBounds);

  const windowEvents = mainWindow as unknown as EventEmitter;
  windowEvents.on('minimize', (event: Electron.Event) => {
    if (!protectedMode || !overlayVisible) return;
    event.preventDefault();
    overlayVisible = false;
    mainWindow?.hide();
    sendOverlayState();
  });

  mainWindow.on('show', () => { overlayVisible = true; if (protectedMode) applyProtection(true); sendOverlayState(); });
  mainWindow.on('hide', () => { overlayVisible = false; sendOverlayState(); });
  mainWindow.webContents.on('did-finish-load', () => { createBrowserView(); sendOverlayState(); });
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => console.error(`Renderer failed to load: ${errorCode} ${errorDescription}`));
  mainWindow.once('ready-to-show', () => { applyProtection(protectedMode); mainWindow?.show(); });
  if (isDev) void mainWindow.loadURL('http://localhost:5173');
  else void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
}

function setupAutoUpdater(): void {
  if (isDev) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('checking-for-update', () => { console.log('[Updater] checking-for-update'); sendUpdateStatus('checking'); });
  autoUpdater.on('update-available', (info) => { console.log(`[Updater] update-available: ${info.version}`); sendUpdateStatus('available', info.version); });
  autoUpdater.on('update-not-available', (info) => { console.log(`[Updater] update-not-available: ${info.version}`); sendUpdateStatus('current', info.version); });
  autoUpdater.on('download-progress', (progress) => { console.log(`[Updater] download-progress: ${progress.percent.toFixed(1)}%`); sendUpdateStatus(`downloading:${Math.round(progress.percent)}`); });
  autoUpdater.on('update-downloaded', (info) => {
    const currentVersion = app.getVersion();
    console.log(`[Updater] update-downloaded: ${info.version}; current=${currentVersion}`);
    if (info.version === currentVersion || updateInstallRequested) {
      console.log('[Updater] ignoring duplicate/cached update');
      sendUpdateStatus('current', currentVersion);
      return;
    }
    updateInstallRequested = true;
    sendUpdateStatus('downloaded', info.version);
    setTimeout(() => {
      if (!app.isReady()) return;
      console.log(`[Updater] installing ${info.version}`);
      autoUpdater.quitAndInstall(false, true);
    }, 1000);
  });
  autoUpdater.on('error', (error) => { console.error('[Updater] error:', error); updateInstallRequested = false; sendUpdateStatus('error'); });
  setTimeout(() => { void autoUpdater.checkForUpdates().catch((error) => { console.error('[Updater] check failed:', error); sendUpdateStatus('error'); }); }, 3000);
}

ipcMain.handle('overlay:get-state', () => ({ protectedMode, protectionStatus, alwaysOnTop, visible: overlayVisible, autoPasteEnabled }));
ipcMain.handle('overlay:set-protection', (_event, enabled: boolean) => { applyProtection(enabled); return protectedMode; });
ipcMain.handle('overlay:set-always-on-top', (_event, enabled: boolean) => { alwaysOnTop = enabled; mainWindow?.setAlwaysOnTop(enabled); sendOverlayState(); return alwaysOnTop; });
ipcMain.handle('overlay:set-auto-paste', (_event, enabled: boolean) => { autoPasteEnabled = enabled; sendOverlayState(); return autoPasteEnabled; });
ipcMain.handle('overlay:toggle', () => { overlayVisible = !overlayVisible; if (overlayVisible) mainWindow?.show(); else mainWindow?.hide(); sendOverlayState(); return overlayVisible; });
ipcMain.handle('browser:navigate', (_event, url: string) => { const target = normalizeUrl(url); void browserView?.webContents.loadURL(target); return target; });
ipcMain.handle('browser:back', () => browserView?.webContents.canGoBack() && browserView.webContents.goBack());
ipcMain.handle('browser:forward', () => browserView?.webContents.canGoForward() && browserView.webContents.goForward());
ipcMain.handle('browser:reload', () => { browserView?.webContents.reload(); return true; });
ipcMain.handle('browser:get-url', () => browserView?.webContents.getURL() ?? '');
ipcMain.handle('app:get-version', () => app.getVersion());
ipcMain.handle('app:check-for-updates', async () => { if (isDev) return { status: 'dev' }; await autoUpdater.checkForUpdates(); return { status: 'checking' }; });
ipcMain.handle('app:install-update', () => { if (!isDev) autoUpdater.quitAndInstall(false, true); return true; });

app.whenReady().then(() => {
  createWindow();
  startClipboardMonitor();
  setupAutoUpdater();
  globalShortcut.register('CommandOrControl+Shift+Space', () => { overlayVisible = !overlayVisible; if (overlayVisible) mainWindow?.show(); else mainWindow?.hide(); sendOverlayState(); });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('will-quit', () => {
  stopClipboardMonitor();
  globalShortcut.unregisterAll();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
