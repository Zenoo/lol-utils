import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, screen } from 'electron';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadCatalog } from '../core/data.js';
import { CompanionService } from './service.js';
import { defaults, loadSettings, validateSettings } from './settings.js';
import { championTooltips } from '../core/spell-tooltips.js';
import { LeagueHud, skillBounds } from './hud.js';
import { windowsForeground, windowsKeyDown } from './windows.js';
import { ShopShortcut, shortcutDown, registerShopShortcut } from './shop-shortcut.js';
import { createOverlayWindow } from './overlay-window.js';
import type { AppData, Plan, OverlayState, Settings } from '../core/types.js';
import { required } from '../core/assert.js';

// Smoke tests use an isolated profile and fail on errors instead of opening an unattended dialog.
const smokeMode = process.argv.includes('--smoke-test');
if (smokeMode) {
  app.setPath(
    'userData',
    path.join(process.env.LOL_UTILS_SMOKE_DIR ?? path.resolve('artifacts'), 'smoke-profile'),
  );
  app.commandLine.appendSwitch('disable-gpu');
  process.on('uncaughtException', (error) => {
    console.error(error);
    app.exit(1);
  });
  process.on('unhandledRejection', (error) => {
    console.error(error);
    app.exit(1);
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Let ESM evaluation finish before waiting for Electron's ready event.
  void start().catch((error: unknown) => {
    console.error(error);
    app.exit(1);
  });
}

async function start() {
  await app.whenReady();
  const root = app.getAppPath();
  const here = path.dirname(fileURLToPath(import.meta.url));
  const settingsFile = path.join(app.getPath('userData'), 'settings.json');
  let settings: Settings = await readFile(settingsFile, 'utf8')
    .then((t) => loadSettings(JSON.parse(t)))
    .catch(() => ({ ...defaults }));
  const overlays: Partial<Record<'shop' | 'skill', BrowserWindow>> = {};
  const hud = new LeagueHud();
  let latestOverlay: OverlayState | null = null,
    shopVisible = false,
    focusTimer: ReturnType<typeof setInterval> | undefined;
  // Fetch each patch-pinned icon once in the main process. The overlay only receives data URLs.
  const itemIcons = new Map<number, string>();
  const pendingIcons = new Set<number>();
  function loadIcons(state: OverlayState) {
    for (const buy of state.buys) {
      if (itemIcons.has(buy.id) || pendingIcons.has(buy.id)) {
        continue;
      }
      const item = catalog.items.find((entry) => entry.id === buy.id);
      if (!item) {
        continue;
      }
      pendingIcons.add(buy.id);
      const url = `https://ddragon.leagueoflegends.com/cdn/${manifest.version}/img/item/${encodeURIComponent(item.image.full)}`;
      void fetch(url, { signal: AbortSignal.timeout(5000) })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error('Icon unavailable');
          }
          itemIcons.set(
            buy.id,
            `data:image/png;base64,${Buffer.from(await response.arrayBuffer()).toString('base64')}`,
          );
          renderOverlay();
        })
        .catch(() => {
          itemIcons.set(buy.id, '');
        })
        .finally(() => pendingIcons.delete(buy.id));
    }
  }
  const lastOverlayPayload = { shop: '', skill: '' };
  let disposed = false;
  let overlayFailures = 0;
  let lastFocusCheck = 0;
  let keyDown: ReturnType<typeof windowsKeyDown>;
  let foreground: ReturnType<typeof windowsForeground> = () => null;
  try {
    foreground = windowsForeground();
    keyDown = windowsKeyDown();
  } catch {
    overlayFailures = 3;
    /* Main app remains available if native overlay bridge fails. */
  }
  const { catalog, manifest } = await loadCatalog(path.join(root, 'data')).catch(async (e) => {
    await dialog.showMessageBox({
      type: 'error',
      message: 'Game data could not be loaded. Run npm run data:update.',
      detail: String(e),
    });
    app.quit();
    throw e;
  });
  function secure(win: BrowserWindow) {
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false),
    );
  }
  function renderOverlay() {
    if (disposed) {
      return;
    }
    let rect = null;
    try {
      rect = foreground();
    } catch {
      overlayFailures = 3;
    }
    if (overlayFailures >= 3 || !settings.overlayEnabled || !rect || !latestOverlay) {
      Object.values(overlays).forEach((window) => window.hide());
      if (!rect) {
        shopVisible = false;
      }

      return;
    }
    void hud.refresh(settings.leaguePath, rect.executable);
    for (const kind of ['shop', 'skill'] as const) {
      const hasContent =
        kind === 'skill' ? latestOverlay.skill?.key : shopVisible && latestOverlay.buys.length;
      if (!hasContent) {
        overlays[kind]?.hide();
        continue;
      }
      let window = overlays[kind];
      if (!window) {
        window = createOverlayWindow(here, kind);
        overlays[kind] = window;
        secure(window);
        window.webContents.on('did-finish-load', () => {
          lastOverlayPayload[kind] = '';
          renderOverlay();
        });
        const failed = () => {
          overlayFailures++;
          overlays[kind]?.destroy();
          delete overlays[kind];
        };
        window.webContents.on('render-process-gone', failed);
        void window
          .loadFile(path.join(here, '../ui/overlay.html'), { query: { kind } })
          .catch(failed);
      }
      if (window.webContents.isLoading()) {
        continue;
      }
      const dip = screen.screenToDipRect(null, rect);
      const bounds =
        kind === 'skill'
          ? screen.screenToDipRect(
              null,
              skillBounds(rect, required(latestOverlay.skill.key), hud.scale),
            )
          : {
              x: Math.round(dip.x + 24),
              y: Math.round(dip.y + (dip.height - Math.min(480, dip.height)) / 2),
              width: Math.min(390, dip.width),
              height: Math.min(480, dip.height),
            };
      const old = window.getBounds();
      if (
        old.x !== bounds.x ||
        old.y !== bounds.y ||
        old.width !== bounds.width ||
        old.height !== bounds.height
      ) {
        window.setBounds(bounds, false);
      }
      const payload = {
        skill: kind === 'skill' ? latestOverlay.skill : { key: null, reason: '' },
        buys:
          kind === 'shop'
            ? latestOverlay.buys.map((buy) => ({ ...buy, icon: itemIcons.get(buy.id) ?? '' }))
            : [],
        champion: latestOverlay.champion,
      };
      const encoded = JSON.stringify(payload);
      if (lastOverlayPayload[kind] !== encoded) {
        lastOverlayPayload[kind] = encoded;
        window.webContents.send('overlay', payload);
      }
      if (!window.isVisible()) {
        window.showInactive();
      }
    }
  }
  const service = new CompanionService(
    catalog,
    () => settings,
    (state) => {
      if (!main.isDestroyed() && main.isVisible()) {
        main.webContents.send('state', state);
      }
    },
    (state) => {
      latestOverlay = state;
      if (state) {
        loadIcons(state);
      }
      if (state && !focusTimer) {
        focusTimer = setInterval(() => {
          try {
            if (keyDown) {
              shopShortcut.poll(shortcutDown(settings.shopHotkey, keyDown));
              if (keyDown(0x1b)) {
                shopVisible = false;
              }
            }
          } catch {
            keyDown = undefined;
          }
          if (Date.now() - lastFocusCheck >= 250) {
            lastFocusCheck = Date.now();
            renderOverlay();
          }
        }, 40);
      }
      if (!state) {
        clearInterval(focusTimer);
        focusTimer = undefined;
        shopVisible = false;
        shopShortcut.poll(false);
      }
      renderOverlay();
    },
  );
  const shopShortcut = new ShopShortcut(() => {
    if (foreground() && latestOverlay) {
      if (!settings.overlayEnabled) {
        return;
      }
      shopVisible = !shopVisible;
      renderOverlay();
    }
  });
  function bindShortcut(hotkey: string) {
    return registerShopShortcut(
      hotkey,
      Boolean(keyDown),
      (key, callback) => globalShortcut.register(key, callback),
      () => {
        if (keyDown) {
          shopShortcut.notify();
        } else if (foreground() && latestOverlay) {
          shopVisible = !shopVisible;
          renderOverlay();
        }
      },
    );
  }
  const main = new BrowserWindow({
    width: 1240,
    height: 850,
    show: !process.argv.includes('--smoke-test'),
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#0b121d',
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      offscreen: smokeMode,
    },
  });
  secure(main);
  Menu.setApplicationMenu(null);
  const hotkeyAvailable = bindShortcut(settings.shopHotkey);
  const authorize = (event: Electron.IpcMainInvokeEvent) => {
    if (event.sender !== main.webContents || event.senderFrame !== main.webContents.mainFrame) {
      throw new Error('Invalid IPC sender');
    }
  };
  ipcMain.handle('init', (event) => {
    authorize(event);

    return {
      settings,
      manifest,
      state: service.state(),
      hotkeyAvailable,
      champions: catalog.champions.map((c) => ({
        id: c.id,
        name: c.name,
        title: c.title,
        tags: c.tags,
        image: c.image,
      })),
      items: catalog.items.map((i) => ({
        id: i.id,
        name: i.name,
        gold: i.gold,
        tags: i.tags,
        image: i.image,
        maps: i.maps,
        tier: i.rules?.tier ?? 0,
        available: Boolean(i.gold.purchasable && i.source?.inStore),
        variant: i.source?.displayInItemSets === false,
        champion: i.source?.requiredChampion ?? '',
      })),
      runes: catalog.runeStyles.map((s) => ({
        ...s,
        slots: s.slots.map((slot) => ({
          runes: slot.perks.map((id) => required(catalog.perks.find((p) => p.id === id))),
        })),
      })),
      summoners: catalog.summoners,
      shardSlots: catalog.perkStyles.styles[0].slots
        .filter((slot) => slot.type === 'kStatMod')
        .map((slot) => slot.perks),
      shards: catalog.perks.filter((p) => p.id >= 5000 && p.id < 6000),
    } satisfies AppData;
  });
  const championDetails = new Map<number, ReturnType<typeof loadChampionDetail>>();
  async function loadChampionDetail(id: number) {
    const champion = catalog.champions.find((entry) => entry.id === id);
    if (!champion) {
      return undefined;
    }
    const raw: unknown = await readFile(
      path.join(root, 'data/raw/champions', `${champion.alias}.game.json`),
      'utf8',
    )
      .then((bytes) => JSON.parse(bytes))
      .catch(() => ({}));

    return championTooltips(champion, raw);
  }
  ipcMain.handle('detail', (event, kind, id) => {
    authorize(event);
    if (!Number.isInteger(id)) {
      throw new Error('Invalid ID');
    }
    if (kind === 'champions') {
      let detail = championDetails.get(id);
      if (!detail) {
        detail = loadChampionDetail(id);
        championDetails.set(id, detail);
        if (championDetails.size > 64) {
          championDetails.delete(required(championDetails.keys().next().value));
        }
      }

      return detail;
    }
    if (kind === 'items') {
      return catalog.items.find((i) => i.id === id);
    }
    if (kind === 'runes') {
      return catalog.perks.find((p) => p.id === id);
    }
    if (kind === 'summoners') {
      return catalog.summoners.find((s) => s.id === id);
    }
    throw new Error('Invalid detail kind');
  });
  ipcMain.handle('plan', (event, id) => {
    authorize(event);
    const champ = catalog.champions.find((c) => c.id === id);
    if (!champ) {
      throw new Error('Unknown champion');
    }
    const role =
      service.state().selectedId === champ.id
        ? service.state().role?.toUpperCase() || settings.role
        : settings.role;
    const game = service.planningGame(champ.id);

    return {
      starters: service.engine.starters(champ, Infinity, role).map((result) => result.item),
      questRewards: service.engine.roleRewards(champ, role).map((result) => result.item),
      build: service.engine
        .buildPlan(champ, 11, role, game)
        .map(({ item, reasons }) => ({ ...item, reasons })),
      ranked: service.engine
        .rank(champ, { limit: 6, role, game })
        .map((r) => ({ ...r, item: { id: r.item.id, name: r.item.name } })),
      runes: service.engine.runes(champ, role),
      summoners: service.engine.summoners(champ, role, settings.flashSlot),
    } satisfies Plan;
  });
  ipcMain.handle('settings', async (event, value) => {
    authorize(event);
    const next = validateSettings(value);
    if (next.shopHotkey !== settings.shopHotkey && !bindShortcut(next.shopHotkey)) {
      throw new Error('Hotkey is already in use');
    }
    try {
      await mkdir(path.dirname(settingsFile), { recursive: true });
      await writeFile(`${settingsFile}.tmp`, JSON.stringify(next, null, 2));
      await rename(`${settingsFile}.tmp`, settingsFile);
    } catch (e) {
      if (next.shopHotkey !== settings.shopHotkey) {
        globalShortcut.unregister(next.shopHotkey);
      }
      throw e;
    }
    if (next.shopHotkey !== settings.shopHotkey) {
      globalShortcut.unregister(settings.shopHotkey);
    }
    settings = next;
    shopShortcut.poll(false);
    service.settingsChanged();
    renderOverlay();

    return settings;
  });
  ipcMain.handle('pick-league', async (event) => {
    authorize(event);
    const result = await dialog.showOpenDialog(main, {
      title: 'Select League of Legends installation folder',
      properties: ['openDirectory'],
    });

    return result.filePaths[0];
  });
  ipcMain.handle('import', async (event) => {
    authorize(event);
    await service.importSelected();

    return service.state();
  });
  main.webContents.on('render-process-gone', () => {
    void main.reload();
  });
  main.on('restore', () => main.webContents.send('state', service.state()));
  await main.loadFile(path.join(here, '../ui/index.html'));
  if (process.argv.includes('--smoke-test')) {
    const { smoke } = await import('./smoke.js');
    await smoke(main, service.state());
  } else {
    service.start();
  }
  app.on('second-instance', () => {
    if (main.isMinimized()) {
      main.restore();
    }
    main.focus();
  });
  app.on('window-all-closed', () => app.quit());
  main.on('closed', () => app.quit());
  app.on('before-quit', () => {
    disposed = true;
    clearInterval(focusTimer);
    service.stop();
    globalShortcut.unregisterAll();
    Object.values(overlays).forEach((window) => window.destroy());
  });
}
