import { BrowserWindow } from 'electron';
import path from 'node:path';

/** Prepared content only. The shop accepts drag/resize input without taking game focus. */
export function createOverlayWindow(
  directory: string,
  kind: 'shop' | 'skill' = 'shop',
): BrowserWindow {
  const window = new BrowserWindow({
    width: kind === 'skill' ? 64 : 390,
    height: kind === 'skill' ? 64 : 480,
    show: false,
    transparent: true,
    frame: false,
    focusable: false,
    skipTaskbar: true,
    resizable: kind === 'shop',
    minWidth: kind === 'shop' ? 260 : 1,
    minHeight: kind === 'shop' ? 180 : 1,
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
  window.setIgnoreMouseEvents(kind === 'skill');
  window.setAlwaysOnTop(true, 'screen-saver');
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());

  return window;
}
