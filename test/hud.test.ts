import test from 'node:test';
import assert from 'node:assert/strict';
import { hudScaleFromConfig, hudScaleFromPersisted, skillBounds } from '../src/desktop/hud.js';
import { readFile } from 'node:fs/promises';
import { extractHudLayout } from '../src/core/hud-layout.js';
import { catalog } from './fixtures.js';

const source: Record<string, unknown> = JSON.parse(
  await readFile('test/fixtures/hud-player-frame.json', 'utf8'),
);
const layout = extractHudLayout(source);

test('ability layout is extracted from the published player-frame icon rectangles', () => {
  assert.equal(layout.referenceWidth, 1600);
  assert.equal(layout.referenceHeight, 1200);
  assert.deepEqual(layout.anchor, [0.5, 1]);
  assert.deepEqual(
    layout.slots.map((slot) => slot.position),
    [
      [545, 1054],
      [619, 1054],
      [693, 1054],
      [767, 1054],
    ],
  );
  assert.deepEqual(catalog.hud, layout);
  assert.throws(() => extractHudLayout({}), /invalid_type/);
});

test('HUD scale reads League config rather than unrelated sections, including both slider extremes', () => {
  assert.equal(hudScaleFromConfig('[General]\nGlobalScale=0.3\n[HUD]\nGlobalScale=1.0000'), 1);
  assert.equal(hudScaleFromConfig('[HUD]\r\nGlobalScale=0.0000\r\n'), 0);
  assert.equal(hudScaleFromConfig('[HUD]\nGlobalScale=0.6750'), 0.675);
  assert.equal(hudScaleFromConfig('[HUD]\nGlobalScale=5'), undefined);
  assert.equal(hudScaleFromConfig('[General]\nGlobalScale=1'), undefined);
  assert.equal(
    hudScaleFromPersisted({
      files: [
        {
          name: 'Game.cfg',
          sections: [{ name: 'HUD', settings: [{ name: 'GlobalScale', value: '0.2000' }] }],
        },
      ],
    }),
    0.2,
  );
  assert.equal(hudScaleFromPersisted({ files: [] }), undefined);
});

test('skill indicators track all four slots, HUD scale, viewport resizing and monitor origins', () => {
  const view = { x: 0, y: 0, width: 1920, height: 1080 };
  const q = skillBounds(view, 'Q', 1, layout),
    r = skillBounds(view, 'R', 1, layout);
  assert.ok(q.x < r.x);
  assert.equal(q.y, r.y);
  assert.equal(q.width, 64);
  assert.equal(q.y + q.height / 2, 977);
  assert.equal(q.x + q.width / 2, 759);
  assert.equal(r.x + r.width / 2, 959);
  assert.ok(q.y + q.height < 1020, 'marker must sit above the bottom health/resource bars');
  assert.ok(q.y > view.height * 0.85);
  assert.ok(skillBounds(view, 'Q', 0, layout).width < q.width);
  const moved = skillBounds({ ...view, x: -1920, y: 300 }, 'Q', 1, layout);
  assert.equal(moved.x, q.x - 1920);
  assert.equal(moved.y, q.y + 300);
  const scaled = skillBounds({ x: 0, y: 0, width: 3840, height: 2160 }, 'Q', 1, layout);
  assert.ok(Math.abs(scaled.x - q.x * 2) <= 1);
  assert.ok(Math.abs(scaled.y - q.y * 2) <= 1);
  assert.equal(scaled.width, q.width * 2);
  assert.throws(() => skillBounds(view, 'Z', 1, layout));
});

test('skill calibration moves all slots together while size preserves their centres', () => {
  const view = { x: -1920, y: 100, width: 1920, height: 1080 };
  for (const key of 'QWER') {
    const base = skillBounds(view, key, 1, layout);
    const adjusted = skillBounds(view, key, 1, layout, {
      skillOffsetX: 30,
      skillOffsetY: -20,
      skillSize: 1.5,
    });
    assert.equal(adjusted.x + adjusted.width / 2, base.x + base.width / 2 + 30);
    assert.equal(adjusted.y + adjusted.height / 2, base.y + base.height / 2 - 20);
    assert.equal(adjusted.width, base.width * 1.5);
  }
});

test('the 1440p maximum-HUD ability row stays left of centre at the native source positions', () => {
  const view = { x: 0, y: 0, width: 2560, height: 1440 };
  const centres = 'QWER'.split('').map((key) => {
    const bounds = skillBounds(view, key, 1, layout);

    return bounds.x + bounds.width / 2;
  });
  for (const [index, expected] of [1012.4, 1101.2, 1190, 1278.8].entries()) {
    assert.ok(Math.abs(centres[index] - expected) <= 0.5);
  }
  const wide = skillBounds({ ...view, width: 3440 }, 'Q', 1, layout);
  assert.ok(Math.abs(wide.x + wide.width / 2 - (1012.4 + 440)) <= 0.5);
});
