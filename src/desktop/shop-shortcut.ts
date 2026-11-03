/** Poll only key state; never install input hooks or synthesize game input. */
export function shortcutDown(hotkey: string, keyDown: (key: number) => boolean): boolean {
  const keys = hotkey.split('+');
  const modifiers: Record<string, number> = { Alt: 0x12, Control: 0x11, Shift: 0x10 };

  return (
    Object.entries(modifiers).every(([name, code]) => keyDown(code) === keys.includes(name)) &&
    keyDown(keys[keys.length - 1].charCodeAt(0))
  );
}

export function registerShopShortcut(
  hotkey: string,
  nativeAvailable: boolean,
  register: (hotkey: string, callback: () => void) => boolean,
  callback: () => void,
): boolean {
  // Reserving P with a global hotkey would stop League receiving its own shop key.
  return hotkey.includes('+') ? register(hotkey, callback) : nativeAvailable;
}

/** Native polling and Electron notifications may report the same press in either order. */
export class ShopShortcut {
  private pressed = false;
  constructor(private readonly toggle: () => void) {}
  notify() {
    if (!this.pressed) {
      this.pressed = true;
      this.toggle();
    }
  }
  poll(down: boolean) {
    if (down) {
      this.notify();
    } else {
      this.pressed = false;
    }
  }
}
