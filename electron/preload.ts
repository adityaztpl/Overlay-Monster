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
};

contextBridge.exposeInMainWorld('overlay', overlay);
contextBridge.exposeInMainWorld('browser', browser);
