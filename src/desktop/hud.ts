import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { findLockfile } from '../integrations/local-api.js';

export function hudScaleFromConfig(text: string): number | undefined {
  let section = '';
  for (const line of text.split(/\r?\n/)) {
    const header = line.match(/^\s*\[([^\]]+)\]/);
    if (header) {
      section = header[1].toLowerCase();
    }
    const setting = line.match(/^\s*GlobalScale\s*=\s*([\d.]+)\s*$/i);
    if (section === 'hud' && setting) {
      const value = Number(setting[1]);
      if (Number.isFinite(value) && value >= 0 && value <= 1) {
        return value;
      }
    }
  }

  return undefined;
}

export function hudScaleFromPersisted(input: unknown): number | undefined {
  if (!input || typeof input !== 'object' || !('files' in input) || !Array.isArray(input.files)) {
    return undefined;
  }
  for (const file of input.files) {
    if (file?.name?.toLowerCase() !== 'game.cfg' || !Array.isArray(file.sections)) {
      continue;
    }
    for (const section of file.sections) {
      if (section?.name?.toLowerCase() !== 'hud' || !Array.isArray(section.settings)) {
        continue;
      }
      const setting = section.settings.find(
        (s: { name?: string }) => s?.name?.toLowerCase() === 'globalscale',
      );
      const value = Number(setting?.value);
      if (setting && Number.isFinite(value) && value >= 0 && value <= 1) {
        return value;
      }
    }
  }

  return undefined;
}

/** Read-only and refreshed during live play, including changes made in the game's settings. */
export class LeagueHud {
  scale = 0.5;
  private checkedAt = 0;
  private reading = false;
  async refresh(configured = '', executable = '') {
    if (this.reading || Date.now() - this.checkedAt < 2000) {
      return;
    }
    this.reading = true;
    this.checkedAt = Date.now();
    try {
      const lockfile = !configured && !executable ? await findLockfile() : undefined;
      const root = executable
        ? path.dirname(path.dirname(executable))
        : configured
          ? path.basename(configured).toLowerCase() === 'lockfile'
            ? path.dirname(configured)
            : configured
          : lockfile && path.dirname(lockfile);
      if (!root) {
        return;
      }
      const cfg = await readFile(path.join(root, 'Config/game.cfg'), 'utf8').catch(() => '');
      const value = hudScaleFromConfig(cfg);
      if (value !== undefined) {
        this.scale = value;

        return;
      }
      const persisted = await readFile(path.join(root, 'Config/PersistedSettings.json'), 'utf8');
      const fallback = hudScaleFromPersisted(JSON.parse(persisted));
      if (fallback !== undefined) {
        this.scale = fallback;
      }
    } catch {
      /* Missing or partially-written config: keep the last known scale. */
    } finally {
      this.reading = false;
    }
  }
}

export interface Viewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Bottom-centred skill row, in physical viewport pixels before converting to display DIPs. */
export function skillBounds(view: Viewport, key: string, hudScale: number): Viewport {
  const index = 'QWER'.indexOf(key);
  if (index < 0) {
    throw new Error('Unknown skill key');
  }
  const scale = (view.height / 1080) * (0.5 + Math.max(0, Math.min(1, hudScale)) * 0.5);
  // The ability icons sit below the health/resource bars. Anchor their centres to
  // the bottom edge; scaling the distance from the top shifts them off the HUD.
  const size = Math.max(1, Math.round(44 * scale));

  return {
    x: Math.round(view.x + view.width / 2 + (-92 + index * 48) * scale - size / 2),
    y: Math.round(view.y + view.height - 42 * scale - size / 2),
    width: size,
    height: size,
  };
}
