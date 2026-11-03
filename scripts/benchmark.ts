import { required } from '../src/core/assert.js';
import { performance } from 'node:perf_hooks';
import { mkdir, writeFile } from 'node:fs/promises';
import { Engine } from '../src/core/engine.js';
import { catalog, catalogLoadMs, game, player } from '../test/fixtures.js';

const start = performance.now();
const engine = new Engine(catalog);
const setupMs = performance.now() - start;
const champ = required(catalog.champions.find((c) => c.alias === 'Annie'));
const live = game(
  ['Jinx', 'Veigar', 'Malphite', 'Soraka', 'LeeSin'].map((alias) => player(alias, 'CHAOS')),
);
live.allPlayers[0].items = [
  { itemID: 1058, count: 1, slot: 0 },
  { itemID: 1001, count: 1, slot: 1 },
];
for (let i = 0; i < 30; i++) {
  engine.nextBuys(champ, live);
}
const times: number[] = [];
const heapBefore = process.memoryUsage().heapUsed;
const cpuBefore = process.cpuUsage();
for (let i = 0; i < 200; i++) {
  const at = performance.now();
  engine.nextBuys(champ, live);
  times.push(performance.now() - at);
}
times.sort((a, b) => a - b);
const report = {
  version: catalog.version,
  samples: times.length,
  setupMs,
  catalogLoadMs,
  p50Ms: times[100],
  p95Ms: times[190],
  maxMs: times.at(-1),
  cpu: process.cpuUsage(cpuBefore),
  heapDeltaMiB: (process.memoryUsage().heapUsed - heapBefore) / 1024 ** 2,
  rssMiB: process.memoryUsage().rss / 1024 ** 2,
  scope: 'Engine only; does not measure game FPS, desktop GPU, or overlay renderer memory',
};
await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/benchmark.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (report.p95Ms > 50 || setupMs > 2000) {
  throw new Error('Recommendation performance budget exceeded');
}
