import test from 'node:test';
import assert from 'node:assert/strict';
import { hudScaleFromConfig, hudScaleFromPersisted, skillBounds } from '../src/desktop/hud.js';

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
  const q = skillBounds(view, 'Q', 1),
    r = skillBounds(view, 'R', 1);
  assert.ok(q.x < r.x);
  assert.equal(q.y, r.y);
  assert.ok(q.y > view.height * 0.85);
  assert.ok(skillBounds(view, 'Q', 0).width < q.width);
  const moved = skillBounds({ ...view, x: -1920, y: 300 }, 'Q', 1);
  assert.equal(moved.x, q.x - 1920);
  assert.equal(moved.y, q.y + 300);
  const scaled = skillBounds({ x: 0, y: 0, width: 3840, height: 2160 }, 'Q', 1);
  assert.equal(scaled.x, q.x * 2);
  assert.equal(scaled.y, q.y * 2);
  assert.equal(scaled.width, q.width * 2);
  assert.throws(() => skillBounds(view, 'Z', 1));
});
