import { BrowserWindow } from 'electron';
import path from 'node:path';

/** This renderer owns only text. It cannot focus, intercept clicks, or call the game APIs. */
export function createOverlayWindow(
  directory: string,
  kind: 'shop' | 'skill' = 'shop',
): BrowserWindow {
  const window = new BrowserWindow({
    width: kind === 'skill' ? 52 : 330,
    height: kind === 'skill' ? 52 : 260,
    show: false,
    transparent: true,
    frame: false,
    focusable: false,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(directory, 'overlay-preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: true,
      spellcheck: false,
    },
  });
  window.setIgnoreMouseEvents(true);
  window.setAlwaysOnTop(true, 'screen-saver');
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());

  return window;
}
