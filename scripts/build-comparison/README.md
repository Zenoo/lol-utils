# Development-only build comparisons

Run from the repository root:

```sh
npm run compare:builds
npm run compare:builds -- --champion=Shen
```

This runs the real engine with a champion and role, passing **no `LiveGame`**: no invented allies, opponents, inventories, kills, or lane opponent. Reports are written to `artifacts/build-comparison/current.json` and `current.md`. It requires no network access. The saved baseline is rescored against the same reference snapshots and metric implementation as the current engine. Catalog hashes prevent comparing different datasets under the same version label.

Nothing under this directory is imported by production code or included in the Electron package. External builds never become engine inputs. The normal test suite checks the comparison utilities, provenance, and runtime boundary, but does not download builds or enforce an external-build match percentage. Similarity is a diagnostic, not a product feature or a CI target to overfit.

## References and updates

`cases.json` declares twelve champion/role cases across different archetypes, split into development and validation groups. The validation group is a breadth check, not an untouched or statistically independent test set. `references.json` contains only small, normalized item facts, source URLs, patch/population/guide metadata, capture dates, and raw-page hashes where captured directly. It does not reproduce guide prose. Review references before changing them; a community guide can disagree with a statistics site's default.

The current sources are OP.GG, MOBAFire statistics and attributed community guides, and LoLalytics. MOBAFire's statistical tables can agree with OP.GG and must not be claimed as independent evidence. U.GG returned a challenge and its indexed pages were incomplete/stale; Blitz disallowed automated access. These failures are recorded in `access-notes.json`, not replaced with guessed builds. A Shen guide from 16.20 is retained for context and excluded from default 16.21 metrics. MOBAFire's 26.21 season label is recorded as 16.21 only when the underlying table or guide explicitly identifies that patch.

Refresh the public OP.GG facts explicitly:

```sh
npm run compare:capture -- --patch=16.21
```

This serially requests the rendered, public English champion build pages with a pause between requests. It fails on HTTP errors, missing item tables, or a different returned patch. It writes proposed facts and failures under `artifacts/`; it never overwrites reviewed source snapshots. No challenge bypass, proxy, or private endpoint is used. The parser has a regression for scripts preceding the rendered tables. Review the captured IDs, role, population, patch and source links before incorporating them. Add other providers through reviewed snapshots with the same schema. Availability is not guaranteed.

Before starting a new development cycle on an updated catalog, review/capture new references, then run `npm run compare:builds -- --record-baseline` **before editing the engine**. This explicitly replaces the saved baseline. Keep the engine revision or diff corresponding to its SHA-256 in version control. `--include-mismatched` is exploratory only and must not be used to claim patch-matched improvement.

## Metrics and limits

- Remove boots and role-quest rewards, then compare the first three purchased combat items. Ordinary gold-generating combat items remain eligible.
- **Core recall** is membership overlap with the best of up to three explicitly recorded reference paths. **Ordered recall** requires the same item in the same position of that selected path. This best-of-alternatives metric is optimistic; full JSON reports retain every source, selected path and first-item/boots checks.
- **Build recall** asks how much of that same reference core occurs anywhere in the six-slot result. It is not a six-item exact match: later items are situational.
- Average sources within a case, then average champion/role cases equally. Do not let champions with more source pages dominate the result. Missing or patch-mismatched references are reported, not scored as zero or silently treated as matching.

Tuning uses general rules from official item parameters and kit attributes: attack frequency versus a single empowered attack, normalized stat aliases, crit-damage synergy, diminishing marginal health/resistance and attack-speed value, ally healing chains, shields, armor shred, energized short trades and melee waveclear. There are no champion IDs, aliases, reference item sequences, win rates or provider lookups in the scoring rules. The weights remain model assumptions, not a combat simulation.

The checked-in [research results](results.md) record the observed improvements and remaining weak cases. Matching popular items does not establish that a build is optimal, that it adapts correctly to every matchup, or that its late-game order is good. Darius and Garen remain significant gaps; missing ability-specific crit/attack-speed scaling and incompletely modelled mobility/defensive passives should be investigated from official game data rather than patched with their reference builds.
