import test from 'node:test';
import assert from 'node:assert/strict';
import { ShopShortcut, shortcutDown, registerShopShortcut } from '../src/desktop/shop-shortcut.js';
import { defaults, loadSettings, validateSettings } from '../src/desktop/settings.js';

test('Alt+Shift+S native fallback requires the entire chord and exact modifiers', () => {
  const pressed = new Set([0x12, 0x10, 0x53]);
  const down = (key: number) => pressed.has(key);
  assert.equal(shortcutDown('Alt+Shift+S', down), true);
  pressed.delete(0x53);
  assert.equal(shortcutDown('Alt+Shift+S', down), false);
  pressed.add(0x53);
  pressed.add(0x11);
  assert.equal(shortcutDown('Alt+Shift+S', down), false);
});

test('native polling and Electron events toggle once per press, including holds and either event order', () => {
  let toggles = 0;
  const shortcut = new ShopShortcut(() => toggles++);
  shortcut.notify();
  shortcut.poll(true);
  shortcut.notify();
  shortcut.poll(true);
  assert.equal(toggles, 1);
  shortcut.poll(false);
  shortcut.poll(true);
  shortcut.notify();
  assert.equal(toggles, 2);
  shortcut.poll(false);
  shortcut.poll(true);
  assert.equal(toggles, 3);
});

test('P passes through to League without global registration and observes only an unmodified press', () => {
  const registered: string[] = [];
  const register = (key: string) => {
    registered.push(key);

    return true;
  };
  assert.equal(
    registerShopShortcut('P', true, register, () => {}),
    true,
  );
  assert.deepEqual(registered, []);
  assert.equal(
    registerShopShortcut('P', false, register, () => {}),
    false,
  );
  registerShopShortcut('Alt+Shift+S', true, register, () => {});
  assert.deepEqual(registered, ['Alt+Shift+S']);
  const down = new Set([0x50]);
  assert.equal(
    shortcutDown('P', (key) => down.has(key)),
    true,
  );
  down.add(0x11);
  assert.equal(
    shortcutDown('P', (key) => down.has(key)),
    false,
  );
});

test('P is the default, old default settings migrate, and custom shortcuts survive loading', () => {
  assert.equal(defaults.shopHotkey, 'P');
  assert.equal(validateSettings({ ...defaults, shopHotkey: 'P' }).shopHotkey, 'P');
  assert.equal(loadSettings({ ...defaults, shopHotkey: 'Alt+Shift+S' }).shopHotkey, 'P');
  assert.equal(loadSettings({ ...defaults, shopHotkey: 'Control+J' }).shopHotkey, 'Control+J');
});
