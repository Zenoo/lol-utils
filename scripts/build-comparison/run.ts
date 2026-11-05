import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { loadCatalog } from '../../src/core/data.js';
import { Engine } from '../../src/core/engine.js';
import { casesSchema, referencesSchema, compareBuild } from './model.js';

const { catalog } = await loadCatalog('data');
const engine = new Engine(catalog);
const selected = process.argv
  .find((arg) => arg.startsWith('--champion='))
  ?.slice('--champion='.length);
const cases = casesSchema
  .parse(JSON.parse(await readFile('scripts/build-comparison/cases.json', 'utf8')))
  .filter((entry) => !selected || entry.champion.toLowerCase() === selected.toLowerCase());
if (!cases.length) {
  throw new Error('No matching champion cases');
}
const references = referencesSchema.parse(
  JSON.parse(await readFile('scripts/build-comparison/references.json', 'utf8')),
);
const currentPatch = catalog.version.split('.').slice(0, 2).join('.');
const all = process.argv.includes('--include-mismatched');
const baselineSchema = z.object({
  dataVersion: z.string(),
  catalogSha256: z.string(),
  rows: z.array(z.object({ champion: z.string(), role: z.string(), ids: z.array(z.number()) })),
});
const baselineFile = 'scripts/build-comparison/baseline.json';
const baseline = process.argv.includes('--record-baseline')
  ? undefined
  : baselineSchema.parse(JSON.parse(await readFile(baselineFile, 'utf8')));
const catalogSha256 = createHash('sha256')
  .update(await readFile('data/catalog.json'))
  .digest('hex');
if (
  baseline &&
  (baseline.dataVersion !== catalog.version || baseline.catalogSha256 !== catalogSha256)
) {
  throw new Error(
    'Baseline and catalog versions differ; record a fresh baseline before tuning a new patch',
  );
}
const rows = cases.map((entry) => {
  const champion = catalog.champions.find((champion) => champion.alias === entry.champion);
  if (!champion) {
    throw new Error(`Unknown champion: ${entry.champion}`);
  }
  // Deliberately pass no game: no fabricated players, opponents, allies or inventories.
  const build = engine.buildPlan(champion, 11, entry.role);
  const ids = build.map((result) => result.item.id);
  const matches = references.filter(
    (reference) => reference.champion === entry.champion && reference.role === entry.role,
  );
  const scored = matches
    .filter((reference) => all || reference.patch === currentPatch)
    .map((reference) => {
      for (const id of [...reference.coreBuilds.flat(), ...reference.boots]) {
        if (!engine.items.has(id)) {
          throw new Error(`Reference ${reference.url} has unknown item ${id}`);
        }
      }

      return {
        provider: reference.provider,
        url: reference.url,
        patch: reference.patch,
        ...compareBuild(ids, reference, engine.items),
      };
    });
  const average = (values: typeof scored, key: 'coreRecall' | 'buildRecall' | 'orderedRecall') =>
    values.length ? values.reduce((total, row) => total + row[key], 0) / values.length : null;
  const before = baseline?.rows.find(
    (row) => row.champion === entry.champion && row.role === entry.role,
  );
  if (baseline && !before) {
    throw new Error(
      `Baseline is missing ${entry.champion}/${entry.role}; record all cases before tuning`,
    );
  }
  const beforeScores = before
    ? matches
        .filter((reference) => all || reference.patch === currentPatch)
        .map((reference) => ({
          provider: reference.provider,
          url: reference.url,
          patch: reference.patch,
          ...compareBuild(before.ids, reference, engine.items),
        }))
    : [];
  const mean = (key: 'coreRecall' | 'buildRecall' | 'orderedRecall') => average(scored, key);

  return {
    ...entry,
    ids,
    baseline: {
      ids: before?.ids ?? [],
      coreRecall: average(beforeScores, 'coreRecall'),
      buildRecall: average(beforeScores, 'buildRecall'),
      orderedRecall: average(beforeScores, 'orderedRecall'),
    },
    items: build.map((result) => ({ name: result.item.name, reasons: result.reasons })),
    sources: scored,
    excludedSources: matches
      .filter((reference) => !all && reference.patch !== currentPatch)
      .map((reference) => reference.url),
    coreRecall: mean('coreRecall'),
    buildRecall: mean('buildRecall'),
    orderedRecall: mean('orderedRecall'),
  };
});
const aggregate = (group: string) => {
  const included = rows.filter(
    (row) => (group === 'all' || row.group === group) && row.coreRecall !== null,
  );

  if (!included.length) {
    return {
      cases: 0,
      baselineCoreRecall: null,
      baselineOrderedRecall: null,
      orderedRecall: null,
      baselineBuildRecall: null,
      coreRecall: null,
      buildRecall: null,
    };
  }

  return {
    cases: included.length,
    baselineCoreRecall:
      included.reduce((total, row) => total + (row.baseline.coreRecall ?? 0), 0) /
      Math.max(1, included.length),
    baselineOrderedRecall:
      included.reduce((total, row) => total + (row.baseline.orderedRecall ?? 0), 0) /
      Math.max(1, included.length),
    orderedRecall:
      included.reduce((total, row) => total + (row.orderedRecall ?? 0), 0) /
      Math.max(1, included.length),
    baselineBuildRecall:
      included.reduce((total, row) => total + (row.baseline.buildRecall ?? 0), 0) /
      Math.max(1, included.length),
    coreRecall:
      included.reduce((total, row) => total + (row.coreRecall ?? 0), 0) /
      Math.max(1, included.length),
    buildRecall:
      included.reduce((total, row) => total + (row.buildRecall ?? 0), 0) /
      Math.max(1, included.length),
  };
};
const report = {
  dataVersion: catalog.version,
  catalogSha256,
  engineSha256: createHash('sha256')
    .update(await readFile('src/core/engine.ts'))
    .digest('hex'),
  generatedAt: new Date().toISOString(),
  referencesSha256: createHash('sha256')
    .update(await readFile('scripts/build-comparison/references.json'))
    .digest('hex'),
  mode: 'champion-only; no LiveGame passed',
  summary: {
    all: aggregate('all'),
    development: aggregate('development'),
    validation: aggregate('validation'),
  },
  rows,
};
await mkdir('artifacts/build-comparison', { recursive: true });
const output = process.argv.includes('--record-baseline')
  ? 'scripts/build-comparison/baseline.json'
  : 'artifacts/build-comparison/current.json';
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.table(
  rows.map((row) => ({
    champion: row.champion,
    group: row.group,
    sources: row.sources.length,
    before: row.baseline.coreRecall?.toFixed(2) ?? 'n/a',
    core: row.coreRecall?.toFixed(2) ?? 'n/a',
    ordered: row.orderedRecall?.toFixed(2) ?? 'n/a',
    inSix: row.buildRecall?.toFixed(2) ?? 'n/a',
    build: row.items.map((item) => item.name).join(' / '),
  })),
);
console.log(JSON.stringify(report.summary, null, 2));

if (!process.argv.includes('--record-baseline')) {
  const pct = (value: number | null) => (value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`);
  const names = (ids: number[]) =>
    ids.map((id) => engine.items.get(id)?.name ?? String(id)).join(' / ');
  const markdown = [
    '# Champion-only build comparison',
    '',
    `Data: ${report.dataVersion}. ${cases.length} selected cases, no live game or team context.`,
    '',
    `Best-of-listed-reference core overlap: ${pct(report.summary.all.baselineCoreRecall)} -> ${pct(report.summary.all.coreRecall)}. This is descriptive overlap, not build quality or win probability.`,
    '',
    '| Champion | Group | Before core | Current core | Ordered core | Core present in six | Current build |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map(
      (row) =>
        `| ${row.champion} | ${row.group} | ${pct(row.baseline.coreRecall)} | ${pct(row.coreRecall)} | ${pct(row.orderedRecall)} | ${pct(row.buildRecall)} | ${names(row.ids)} |`,
    ),
    '',
    '## References',
    '',
    ...rows.flatMap((row) =>
      row.sources.map(
        (source) =>
          `- ${row.champion}: [${source.provider}](${source.url}), patch ${source.patch}.`,
      ),
    ),
    '',
    'Patch-mismatched references are excluded by default. Access failures are recorded in scripts/build-comparison/access-notes.json. Source tables/guide choices can disagree, and late items are situational. The validation group is a separate archetype check, not a statistically independent held-out dataset.',
    '',
  ].join('\n');
  await writeFile('artifacts/build-comparison/current.md', markdown);
}
