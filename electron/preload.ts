import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('overlayAPI', {
  platform: process.platform,
});
