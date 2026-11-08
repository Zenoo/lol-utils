import test from 'node:test';
import assert from 'node:assert/strict';
import {
  patchWarning,
  publishedVersions,
  shortVersion,
  publicPatch,
} from '../src/core/versions.js';

test('public patch labels distinguish the Riot year label from internal CDN versions', () => {
  assert.equal(publicPatch('16.22.1'), '26.22');
  assert.equal(publicPatch('16.22'), '26.22');
  assert.equal(publicPatch('15.1.1'), '25.1');
  assert.equal(publicPatch('14.24.1'), '14.24');
  assert.equal(publicPatch('16.22.123.456'), '26.22');
  assert.equal(publicPatch('unknown'), 'unknown');
});

test('patch messages use published revisions instead of long client build strings', () => {
  assert.equal(shortVersion('16.21.2'), '16.21.2');
  assert.equal(shortVersion('16.21.728.1234+branch.main', ['16.21.2']), '16.21.2');
  assert.equal(shortVersion('16.21.728.1234+branch.main'), '16.21');
  assert.equal(shortVersion('16.21.728.1234+branch.main', ['16.2.1']), '16.21');
  const warning = patchWarning('16.20.1', '16.21.728.1234+branch.main', ['16.21.2'], true);
  assert.match(warning, /16\.21\.2/);
  assert.ok(!warning.includes('728') && !warning.includes('main'));
});

test('closed-client warnings compare bundled data with the latest published version, including revision changes', () => {
  assert.match(patchWarning('16.21.1', '', ['16.22.1'], false), /outdated.*16\.22\.1/);
  assert.match(patchWarning('16.21.1', '', ['16.21.2'], false), /outdated.*16\.21\.2/);
  assert.equal(patchWarning('16.21.1', '', ['16.21.1'], false), '');
  assert.match(patchWarning('16.21.1', '', [], false, true), /could not be checked/);
});

test('published patch checks validate responses instead of accepting arbitrary version strings', async () => {
  assert.deepEqual(await publishedVersions(async () => Response.json(['16.21.2'])), ['16.21.2']);
  await assert.rejects(
    publishedVersions(async () => Response.json(['bad'])),
    /Invalid published/,
  );
  await assert.rejects(
    publishedVersions(async () => new Response('', { status: 503 })),
    /HTTP 503/,
  );
});
