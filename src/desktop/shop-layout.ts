import type { Viewport } from './hud.js';

/** Fractions of the game viewport, independent of Windows DPI and monitor origin. */
export interface ShopLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}
export function loadShopLayout(input: unknown): ShopLayout | undefined {
  if (!input || typeof input !== 'object') {
    return undefined;
  }
  const layout = input as ShopLayout;
  if (
    Object.keys({ x: 0, y: 0, width: 0, height: 0 }).some((key) => {
      const value = layout[key as keyof ShopLayout];

      return !Number.isFinite(value) || value < 0 || value > 1;
    }) ||
    layout.width === 0 ||
    layout.height === 0
  ) {
    return undefined;
  }

  return { x: layout.x, y: layout.y, width: layout.width, height: layout.height };
}
export function shopBounds(view: Viewport, layout?: ShopLayout): Viewport {
  const width = Math.min(
    view.width,
    Math.max(260, Math.round(layout ? layout.width * view.width : 390)),
  );
  const height = Math.min(
    view.height,
    Math.max(180, Math.round(layout ? layout.height * view.height : 480)),
  );

  return {
    x:
      view.x +
      Math.round(Math.max(0, Math.min(view.width - width, layout ? layout.x * view.width : 24))),
    y:
      view.y +
      Math.round(
        Math.max(
          0,
          Math.min(
            view.height - height,
            layout ? layout.y * view.height : (view.height - height) / 2,
          ),
        ),
      ),
    width,
    height,
  };
}
export function relativeShopLayout(bounds: Viewport, view: Viewport): ShopLayout {
  return {
    x: Math.max(0, Math.min(1, (bounds.x - view.x) / view.width)),
    y: Math.max(0, Math.min(1, (bounds.y - view.y) / view.height)),
    width: Math.min(1, bounds.width / view.width),
    height: Math.min(1, bounds.height / view.height),
  };
}
