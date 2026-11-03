import { contextBridge, ipcRenderer } from 'electron';
import type { OverlayBridge, OverlayState } from '../core/types.js';
const bridge: OverlayBridge = {
  onUpdate: (callback) => {
    const listener = (_event: unknown, value: OverlayState) => callback(value);
    ipcRenderer.on('overlay', listener);

    return () => ipcRenderer.removeListener('overlay', listener);
  },
};
contextBridge.exposeInMainWorld('overlay', bridge);
