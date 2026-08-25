import { contextBridge, ipcRenderer } from 'electron';
import type { OverlayAPI } from '../src/types';

const api: OverlayAPI = {
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

contextBridge.exposeInMainWorld('overlay', api);
