import type { Settings } from '../core/types.js';
import { buildSources } from '../core/builds.js';
export const defaults: Settings = {
  flashSlot: 'F',
  autoImport: false,
  autoImportSource: 'Local',
  overlayEnabled: true,
  shopHotkey: 'P',
  leaguePath: '',
  role: 'MIDDLE',
  skillOffsetX: 0,
  skillOffsetY: 0,
  skillSize: 1,
};
export function validateSettings(input: unknown): Settings {
  if (!input || typeof input !== 'object') {
    throw new Error('Invalid settings');
  }
  const s = input as Settings;
  if (
    !['D', 'F'].includes(s.flashSlot) ||
    typeof s.autoImport !== 'boolean' ||
    (s.autoImportSource !== undefined && !buildSources.includes(s.autoImportSource)) ||
    typeof s.overlayEnabled !== 'boolean' ||
    typeof s.shopHotkey !== 'string' ||
    !/^(?:(?:Alt|Control|Shift)\+){0,3}[A-Z0-9]$/.test(s.shopHotkey) ||
    new Set(s.shopHotkey.split('+')).size !== s.shopHotkey.split('+').length ||
    typeof s.leaguePath !== 'string' ||
    s.leaguePath.length > 1024 ||
    !['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'].includes(s.role)
  ) {
    throw new Error('Invalid settings');
  }
  for (const [key, min, max] of [
    ['skillOffsetX', -500, 500],
    ['skillOffsetY', -500, 500],
    ['skillSize', 0.5, 3],
  ] as const) {
    const value = s[key];
    if (value !== undefined && (!Number.isFinite(value) || value < min || value > max)) {
      throw new Error(`Invalid ${key}`);
    }
  }

  return {
    flashSlot: s.flashSlot,
    autoImport: s.autoImport,
    autoImportSource: s.autoImportSource ?? 'Local',
    overlayEnabled: s.overlayEnabled,
    shopHotkey: s.shopHotkey,
    leaguePath: s.leaguePath,
    role: s.role,
    skillOffsetX: s.skillOffsetX ?? 0,
    skillOffsetY: s.skillOffsetY ?? 0,
    skillSize: s.skillSize ?? 1,
  };
}

export function loadSettings(input: unknown): Settings {
  const settings = validateSettings(input);

  return {
    ...settings,
    // A legacy boolean had no preferred source; require an explicit choice before enabling it.
    autoImport: settings.autoImport && !!(input as Settings).autoImportSource,
    shopHotkey: settings.shopHotkey === 'Alt+Shift+S' ? 'P' : settings.shopHotkey,
  };
}
