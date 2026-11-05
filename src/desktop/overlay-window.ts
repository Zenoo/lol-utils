import { BrowserWindow } from 'electron';
import path from 'node:path';

/** This renderer displays prepared text and cached item icons. It cannot focus, intercept clicks, or call the game APIs. */
export function createOverlayWindow(
  directory: string,
  kind: 'shop' | 'skill' = 'shop',
): BrowserWindow {
  const window = new BrowserWindow({
    width: kind === 'skill' ? 44 : 390,
    height: kind === 'skill' ? 44 : 480,
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
      backgroundThrottling: !process.argv.includes('--smoke-test'),
      offscreen: process.argv.includes('--smoke-test'),
      spellcheck: false,
    },
  });
  window.setIgnoreMouseEvents(true);
  window.setAlwaysOnTop(true, 'screen-saver');
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());

  return window;
}
