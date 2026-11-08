import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Engine } from '../../src/core/engine.js';
import { loadCatalog } from '../../src/core/data.js';
import { required } from '../../src/core/assert.js';
import { casesSchema } from './model.js';
import { compareRunes, runeReferencesSchema } from './runes.js';

const { catalog } = await loadCatalog('data');
const engine = new Engine(catalog);
const cases = casesSchema.parse(
  JSON.parse(await readFile('scripts/build-comparison/cases.json', 'utf8')),
);
const hash = async (file: string) =>
  createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
const catalogSha256 = await hash('data/catalog.json');
const rows = cases.map((entry) => ({
  ...entry,
  ids: engine.runes(required(catalog.champions.find((c) => c.alias === entry.champion)), entry.role)
    .selectedPerkIds,
}));
const baselineFile = 'scripts/build-comparison/rune-baseline.json';
if (process.argv.includes('--record-baseline')) {
  await writeFile(
    baselineFile,
    JSON.stringify(
      {
        dataVersion: catalog.version,
        catalogSha256,
        engineSha256: await hash('src/core/engine.ts'),
        referencesSha256: await hash('scripts/build-comparison/rune-references.json'),
        rows,
      },
      null,
      2,
    ) + '\n',
  );
} else {
  const baseline = z
    .object({
      catalogSha256: z.string(),
      rows: z.array(
        z.object({ champion: z.string(), role: z.string(), ids: z.array(z.number()).length(9) }),
      ),
    })
    .parse(JSON.parse(await readFile(baselineFile, 'utf8')));
  if (baseline.catalogSha256 !== catalogSha256) {
    throw new Error('Rune baseline catalog differs; record a fresh baseline before tuning');
  }
  const references = runeReferencesSchema.parse(
    JSON.parse(await readFile('scripts/build-comparison/rune-references.json', 'utf8')),
  );
  const patch = catalog.version.split('.').slice(0, 2).join('.');
  const report = rows.map((row) => ({
    ...row,
    names: row.ids.map((id) => required(catalog.perks.find((p) => p.id === id)).name),
    sources: references
      .filter((r) => r.champion === row.champion && r.role === row.role && r.patch === patch)
      .map((r) => ({
        url: r.url,
        provider: r.provider,
        before: compareRunes(
          required(baseline.rows.find((b) => b.champion === row.champion && b.role === row.role))
            .ids,
          r.selectedPerkIds,
        ),
        after: compareRunes(row.ids, r.selectedPerkIds),
      })),
  }));
  await mkdir('artifacts/build-comparison', { recursive: true });
  await writeFile(
    'artifacts/build-comparison/runes.json',
    JSON.stringify(
      {
        dataVersion: catalog.version,
        catalogSha256,
        engineSha256: await hash('src/core/engine.ts'),
        generatedAt: new Date().toISOString(),
        rows: report,
      },
      null,
      2,
    ) + '\n',
  );
  console.table(
    report.map((r) => ({
      champion: r.champion,
      keystone: r.names[0],
      before: r.sources[0]?.before.keystone,
      after: r.sources[0]?.after.keystone,
      sources: r.sources.length,
    })),
  );
}
