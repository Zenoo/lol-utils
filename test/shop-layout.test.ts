import test from 'node:test';
import assert from 'node:assert/strict';
import { shopBounds, loadShopLayout, relativeShopLayout } from '../src/desktop/shop-layout.js';
import { defaults, validateSettings } from '../src/desktop/settings.js';

test('shop placement survives monitor, viewport and DPI changes and remains reachable', () => {
  const view = { x: 0, y: 0, width: 1920, height: 1080 };
  const bounds = { x: 960, y: 216, width: 576, height: 648 };
  const saved = relativeShopLayout(bounds, view);
  assert.deepEqual(shopBounds(view, saved), bounds);
  assert.deepEqual(shopBounds({ x: -2560, y: 100, width: 2560, height: 1440 }, saved), {
    x: -1280,
    y: 388,
    width: 768,
    height: 864,
  });
  const small = { x: -800, y: 0, width: 800, height: 600 };
  const clamped = shopBounds(small, { x: 0.99, y: 0.99, width: 0.5, height: 0.5 });
  assert.equal(clamped.x + clamped.width, small.x + small.width);
  assert.equal(clamped.y + clamped.height, small.y + small.height);
  assert.equal(loadShopLayout({ x: 0, y: 0, width: NaN, height: 1 }), undefined);
  assert.equal(loadShopLayout({ x: 0, y: 0, width: -1, height: 1 }), undefined);
  assert.equal(loadShopLayout({ x: 0, y: 0, width: 0, height: 1 }), undefined);
});

test('old preferences get calibration defaults and invalid renderer inputs are rejected', () => {
  const old = { ...defaults };
  delete old.skillSize;
  delete old.skillOffsetX;
  delete old.skillOffsetY;
  assert.equal(validateSettings(old).skillSize, 1);
  for (const value of [NaN, Infinity, -1, 4, '2']) {
    assert.throws(() => validateSettings({ ...old, skillSize: value }));
  }
  assert.throws(() => validateSettings({ ...old, skillOffsetY: 501 }));
});
