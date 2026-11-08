# Development-only build comparisons

Run from the repository root:

```sh
npm run compare:builds
npm run compare:builds -- --champion=Shen
npx tsx scripts/build-comparison/run-runes.ts
```

This runs the real engine with a champion and role, passing **no `LiveGame`**: no invented allies, opponents, inventories, kills, or lane opponent. Reports are written to `artifacts/build-comparison/current.json` and `current.md`. It requires no network access. The saved baseline is rescored against the same reference snapshots and metric implementation as the current engine. Catalog hashes prevent comparing different datasets under the same version label.

Nothing under this directory is imported by production code or included in the Electron package. External builds never become engine inputs. The normal test suite checks the comparison utilities, provenance, and runtime boundary, but does not download builds or enforce an external-build match percentage. Similarity is a diagnostic, not a product feature or a CI target to overfit.

## References and updates

`cases.json` declares twelve champion/role cases across different archetypes, split into development and validation groups. The validation group is a breadth check, not an untouched or statistically independent test set. `references.json` contains only small, normalized item facts, source URLs, patch/population/guide metadata, capture dates, and raw-page hashes where captured directly. It does not reproduce guide prose. Review references before changing them; a community guide can disagree with a statistics site's default.

Refresh the public OP.GG facts explicitly:

```sh
npm run compare:capture -- --patch=16.22
```

This serially requests the rendered, public English champion build pages with a pause between requests. It fails on HTTP errors, missing item tables, or a different returned patch. It writes proposed facts and failures under `artifacts/`; it never overwrites reviewed source snapshots. No challenge bypass, proxy, or private endpoint is used. The parser has a regression for scripts preceding the rendered tables. Review the captured IDs, role, population, patch and source links before incorporating them. Add other providers through reviewed snapshots with the same schema. Availability is not guaranteed.

Capture also writes `captured-runes.json`, extracting only the first displayed selected page and preserving duplicate stat shards. Rune facts live in `rune-references.json`; rune baselines and reports are separate from item baselines. Before tuning runes on a new catalog, run `npx tsx scripts/build-comparison/run-runes.ts --record-baseline`. The rune report is `artifacts/build-comparison/runes.json`, with source-level before/after agreement and catalog, engine and reference hashes. Twelve OP.GG cases and an additional LoLalytics Shen page currently have patch-matched rune snapshots. Minor slots, secondary choices and shards are reported separately; matching a keystone does not imply a matching full page.

Before starting a new development cycle on an updated catalog, review/capture new references, then run `npm run compare:builds -- --record-baseline` **before editing the engine**. This explicitly replaces the saved baseline; use Git history for previous baselines and reports rather than accumulating patch-named copies. Keep the engine revision or diff corresponding to its SHA-256 in version control. `--include-mismatched` is exploratory only and must not be used to claim patch-matched improvement.

## Metrics and limits

- Remove boots and role-quest rewards, then compare the first three purchased combat items. Ordinary gold-generating combat items remain eligible.
- **Core recall** is membership overlap with the best of up to three explicitly recorded reference paths. **Ordered recall** requires the same item in the same position of that selected path. This best-of-alternatives metric is optimistic; full JSON reports retain every source, selected path and first-item/boots checks.
- **Build recall** asks how much of that same reference core occurs anywhere in the six-slot result. It is not a six-item exact match: later items are situational.
- Average sources within a case, then average champion/role cases equally. Do not let champions with more source pages dominate the result. Missing or patch-mismatched references are reported, not scored as zero or silently treated as matching.

Tuning uses general rules from official item parameters and kit attributes: attack frequency versus a single empowered attack, normalized stat aliases, crit-damage synergy, diminishing marginal health/resistance and attack-speed value, ally healing chains, shields, armor shred, energized short trades and melee waveclear. There are no champion IDs, aliases, reference item sequences, win rates or provider lookups in the scoring rules. The weights remain model assumptions, not a combat simulation.

The checked-in [research results](results.md) record the observed improvements and remaining weak cases. Matching popular items does not establish that a build is optimal, that it adapts correctly to every matchup, or that its late-game order is good. Darius remains a significant gap; Garen's ability-specific crit/attack-speed scaling is now extracted from official game data. Mobility and defensive passives still need refinement from official parameters rather than champion-specific reference builds.
