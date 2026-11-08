import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { casesSchema, parseOpgg } from './model.js';
import { manifestSchema } from '../../src/core/schema.js';
import { parseOpggRunes } from './runes.js';

const requestedPatch =
  process.argv.find((arg) => /^--patch=/.test(arg))?.slice('--patch='.length) ??
  manifestSchema
    .parse(JSON.parse(await readFile('data/manifest.json', 'utf8')))
    .version.split('.')
    .slice(0, 2)
    .join('.');
if (!/^\d+\.\d+$/.test(requestedPatch)) {
  throw new Error('Use --patch=major.minor');
}
const cases = casesSchema.parse(
  JSON.parse(await readFile('scripts/build-comparison/cases.json', 'utf8')),
);
const roles: Record<string, string> = {
  TOP: 'top',
  MIDDLE: 'mid',
  BOTTOM: 'adc',
  JUNGLE: 'jungle',
  UTILITY: 'support',
};
const references = [];
const failures = [];
const runeReferences = [];
await mkdir('artifacts/build-comparison', { recursive: true });
for (const entry of cases) {
  const url = `https://op.gg/lol/champions/${entry.champion.toLowerCase()}/build/${roles[entry.role]}?patch=${requestedPatch}&region=global&tier=emerald_plus&type=ranked`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const html = await response.text();
    const parsed = parseOpgg(html);
    if (parsed.patch !== requestedPatch) {
      throw new Error(`Requested ${requestedPatch}, received ${parsed.patch}`);
    }
    runeReferences.push({
      champion: entry.champion,
      role: entry.role,
      provider: 'op.gg',
      url,
      patch: parsed.patch,
      observedAt: new Date().toISOString(),
      population: 'Global Emerald+, ranked solo/duo; first displayed rune page',
      sourceSha256: createHash('sha256').update(html).digest('hex'),
      selectedPerkIds: parseOpggRunes(html),
    });
    references.push({
      ...entry,
      provider: 'op.gg',
      url,
      ...parsed,
      observedAt: new Date().toISOString(),
      population:
        'Global Emerald+, ranked solo/duo; first three displayed core alternatives and top two boots',
      kind: 'statistics',
      sourceSha256: createHash('sha256').update(html).digest('hex'),
    });
    console.log(
      `${entry.champion}: ${parsed.coreBuilds.map((build) => build.join('/')).join(' | ')}`,
    );
  } catch (error) {
    failures.push({ champion: entry.champion, url, error: String(error) });
  }
  await new Promise((resolve) => setTimeout(resolve, 400));
}
await writeFile(
  'artifacts/build-comparison/captured-runes.json',
  JSON.stringify(runeReferences, null, 2) + '\n',
);
await writeFile(
  'artifacts/build-comparison/captured.json',
  JSON.stringify(references, null, 2) + '\n',
);
await writeFile(
  'artifacts/build-comparison/capture-failures.json',
  JSON.stringify(failures, null, 2) + '\n',
);
if (failures.length) {
  console.error(failures);
  process.exitCode = 1;
}
