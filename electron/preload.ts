import { contextBridge, ipcRenderer } from 'electron';

type OverlayAPI = {
  getState(): Promise<{ protectedMode: boolean; alwaysOnTop: boolean; visible: boolean }>;
  setProtection(enabled: boolean): Promise<boolean>;
  setAlwaysOnTop(enabled: boolean): Promise<boolean>;
  toggle(): Promise<boolean>;
  onShortcutToggle(callback: () => void): () => void;
};

type BrowserAPI = {
  navigate(url: string): Promise<string>;
  back(): Promise<boolean>;
  forward(): Promise<boolean>;
  reload(): Promise<boolean>;
  getUrl(): Promise<string>;
  onUrlChanged(callback: (url: string) => void): () => void;
};

type AppAPI = {
  getVersion(): Promise<string>;
  checkForUpdates(): Promise<{ status: string }>;
  installUpdate(): Promise<boolean>;
  onUpdateStatus(callback: (payload: { status: string; version?: string }) => void): () => void;
};

const overlay: OverlayAPI = {
  getState: () => ipcRenderer.invoke('overlay:get-state'),
  setProtection: (enabled) => ipcRenderer.invoke('overlay:set-protection', enabled),
  setAlwaysOnTop: (enabled) => ipcRenderer.invoke('overlay:set-always-on-top', enabled),
  toggle: () => ipcRenderer.invoke('overlay:toggle'),
  onShortcutToggle: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('overlay:shortcut-toggle', listener);
    return () => ipcRenderer.removeListener('overlay:shortcut-toggle', listener);
  },
};

const browser: BrowserAPI = {
  navigate: (url) => ipcRenderer.invoke('browser:navigate', url),
  back: () => ipcRenderer.invoke('browser:back'),
  forward: () => ipcRenderer.invoke('browser:forward'),
  reload: () => ipcRenderer.invoke('browser:reload'),
  getUrl: () => ipcRenderer.invoke('browser:get-url'),
  onUrlChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, url: string) => callback(url);
    ipcRenderer.on('browser:url-changed', listener);
    return () => ipcRenderer.removeListener('browser:url-changed', listener);
  },
};

const appApi: AppAPI = {
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  checkForUpdates: () => ipcRenderer.invoke('app:check-for-updates'),
  installUpdate: () => ipcRenderer.invoke('app:install-update'),
  onUpdateStatus: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { status: string; version?: string }) => callback(payload);
    ipcRenderer.on('app:update-status', listener);
    return () => ipcRenderer.removeListener('app:update-status', listener);
  },
};

contextBridge.exposeInMainWorld('overlay', overlay);
contextBridge.exposeInMainWorld('browser', browser);
contextBridge.exposeInMainWorld('appApi', appApi);
