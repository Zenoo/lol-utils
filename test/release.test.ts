import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checksumExecutable, releaseInfo } from '../scripts/release.js';

const pkg = (version = '1.2.3', artifactName = 'LoL-Utils-${version}-win-${arch}.${ext}') => ({
  version,
  build: { win: { artifactName } },
});
const lock = (version = '1.2.3') => ({ version, packages: { '': { version } } });

test('release versions and portable filenames agree with the tag and both lockfile version entries', () => {
  assert.deepEqual(releaseInfo(pkg(), lock(), 'v1.2.3'), {
    version: '1.2.3',
    tag: 'v1.2.3',
    filename: 'LoL-Utils-1.2.3-win-x64.exe',
  });
  assert.throws(() => releaseInfo(pkg(), lock(), 'v1.2.4'), /tag must be/);
  assert.throws(() => releaseInfo(pkg(), lock('1.2.4')), /versions must match/);
  assert.throws(
    () => releaseInfo(pkg(), { version: '1.2.3', packages: { '': { version: '1.2.4' } } }),
    /versions must match/,
  );
  assert.equal(
    releaseInfo(pkg('1.2.3-beta.1'), lock('1.2.3-beta.1'), 'v1.2.3-beta.1').tag,
    'v1.2.3-beta.1',
  );
  assert.throws(() => releaseInfo(pkg('invalid'), lock('invalid')));
});

test('release artifacts cannot escape dist or contain unresolved filename macros', () => {
  assert.throws(() => releaseInfo(pkg('1.2.3', '../app.exe'), lock()), /plain executable filename/);
  assert.throws(
    () => releaseInfo(pkg('1.2.3', 'app-${unknown}.exe'), lock()),
    /plain executable filename/,
  );
});

test('project release configuration produces the documented executable filename', async () => {
  const packageJson: unknown = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  );
  const lockJson: unknown = JSON.parse(
    await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'),
  );
  const info = releaseInfo(packageJson, lockJson);
  assert.equal(info.filename, `LoL-Utils-${info.version}-win-x64.exe`);
  const manifest: unknown = JSON.parse(
    await readFile(new URL('../.release-please-manifest.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(
    manifest,
    { '.': info.version },
    'Release Please tracks the current package version',
  );
});

test('release checksums hash the exact executable bytes and reject missing or non-executable artifacts', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'lol-utils-release-'));
  const file = path.join(directory, 'app.exe');
  t.after(async () => {
    await unlink(file);
    await rmdir(directory);
  });
  await assert.rejects(checksumExecutable(file), /ENOENT/);
  const bytes = Buffer.from('MZtest portable payload');
  await writeFile(file, bytes);
  assert.equal(
    await checksumExecutable(file),
    `${createHash('sha256').update(bytes).digest('hex')}  app.exe\n`,
  );
  await writeFile(file, 'not a Windows executable');
  await assert.rejects(checksumExecutable(file), /not a Windows executable/);
});
