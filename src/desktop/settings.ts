import type { Settings } from '../core/types.js';
export const defaults: Settings = {
  flashSlot: 'F',
  autoImport: true,
  overlayEnabled: true,
  shopHotkey: 'P',
  leaguePath: '',
  role: 'MIDDLE',
};
export function validateSettings(input: unknown): Settings {
  if (!input || typeof input !== 'object') {
    throw new Error('Invalid settings');
  }
  const s = input as Settings;
  if (
    !['D', 'F'].includes(s.flashSlot) ||
    typeof s.autoImport !== 'boolean' ||
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

  return {
    flashSlot: s.flashSlot,
    autoImport: s.autoImport,
    overlayEnabled: s.overlayEnabled,
    shopHotkey: s.shopHotkey,
    leaguePath: s.leaguePath,
    role: s.role,
  };
}

export function loadSettings(input: unknown): Settings {
  const settings = validateSettings(input);

  return {
    ...settings,
    shopHotkey: settings.shopHotkey === 'Alt+Shift+S' ? 'P' : settings.shopHotkey,
  };
}
