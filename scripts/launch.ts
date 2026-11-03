import { spawn } from 'node:child_process';
import electron from 'electron';
import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { z } from 'zod';
import { projectRelease } from './release.js';

// Coding environments can inherit this flag; Electron must run as the desktop runtime.
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
if (process.argv.includes('--smoke-test')) {
  environment.LOL_UTILS_SMOKE_DIR = path.resolve('artifacts');
}
const packaged = process.argv.includes('--packaged');
const info = packaged ? await projectRelease() : undefined;
const executable = info ? path.resolve('dist', info.filename) : (electron as unknown as string);
const args = process.argv.slice(2).filter((arg) => arg !== '--packaged');
const started = Date.now();
const child = spawn(executable, [...(packaged ? [] : ['.']), ...args], {
  env: environment,
  stdio: 'inherit',
  windowsHide: true,
});
let timedOut = false;
const watchdog = process.argv.includes('--smoke-test')
  ? setTimeout(() => {
      timedOut = true;
      console.error('Desktop smoke timed out');
      child.kill();
    }, 45_000)
  : undefined;
child.on('error', (error) => {
  clearTimeout(watchdog);
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  clearTimeout(watchdog);
  process.exitCode = timedOut ? 1 : (code ?? 1);
  if (!timedOut && code === 0 && info && process.argv.includes('--smoke-test')) {
    void verifyPackagedSmoke(info.version, started).catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
  }
});

async function verifyPackagedSmoke(version: string, started: number) {
  const file = 'artifacts/desktop-smoke.json';
  const report = z
    .object({ packaged: z.literal(true), version: z.literal(version) })
    .parse(JSON.parse(await readFile(file, 'utf8')));
  if ((await stat(file)).mtimeMs < started) {
    throw new Error('Packaged smoke did not produce a fresh report');
  }
  console.log(`Packaged executable smoke passed: ${report.version}`);
}
