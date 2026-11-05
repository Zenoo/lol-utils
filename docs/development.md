# Development

Use Node.js 24 on Windows. Install dependencies with `npm ci`; `npm start` builds and launches the Electron app.

## Checks and packaging

`npm run check` runs type checking, lint, formatting checks, archived data validation, regression tests, and the engine performance benchmark. The individual commands are:

```sh
npm run typecheck
npm run lint
npm run format:check
npm run data:validate
npm test
npm run test:performance
```

Use `npm run format` to apply formatting. `npm run smoke` builds the app and runs hidden Electron UI checks, writing screenshots and metrics to `artifacts`. See [testing and real-client acceptance](testing.md) for validation scope and required manual checks.

`npm run build` compiles the app, `npm run pack` creates an unpacked Windows app, and `npm run dist` creates a portable Windows executable.

Release Please maintains a version and changelog PR from Conventional Commits. Merging that PR creates the tag and release draft, then builds and tests the portable executable in the same workflow. See [Windows releases](releases.md) for setup, packaged-app checks, checksums, and publication.

## Conventions and structure

TypeScript uses full `strict` mode. ESLint forbids `any`, non-null assertions, definite-assignment assertions, and type-check suppression comments. API and static-data boundaries validate unknown JSON with runtime schemas. Prettier enforces two-space indentation, semicolons, single quotes, and a 100-column target. Both tools are required in CI. Comments document invariants and non-obvious decisions.

- `src/core`: pure data and recommendation logic.
- `src/integrations`: loopback API transport and client imports.
- `src/desktop`: Electron lifecycle, persistence, polling, and Windows foreground detection.
- `src/ui`: desktop and overlay renderers.

No remote content receives Node privileges. Credentials stay in the main process and are never persisted or sent to a renderer.

## Game data and automation

The current game data is included at fixed paths: `data/catalog.json`, `data/raw/`, and `data/manifest.json`. The manifest records the version, source URLs, and checksums. `npm run data:update` replaces this data for a newer patch; `npm run data:update -- --force` refreshes the same patch. Previous versions are not retained or shipped. `npm run data:validate` checks the catalog and every source checksum, and rejects obsolete version directories. See [the recommendation model](recommendations.md) for scoring and assumptions.

Updates download and validate into a temporary sibling `.data-staging-*` directory, then swap the complete data directory into place. A temporary `.data-backup` enables rollback if the swap fails and is deleted after success. The updater lock lives outside `data/`. After an interrupted process, confirm no updater is running, remove the stale `.data-update-lock` directory, and rerun; the next run restores an interrupted swap and removes abandoned staging directories. These temporary directories are ignored by Git and excluded from app packages.

GitHub Actions validates changes and builds Windows artifacts. A separate six-hour workflow checks Riot's published version, downloads a complete matching snapshot, runs validation, and proposes a data PR. Enable **Allow GitHub Actions to create pull requests** in repository settings. Generated PRs use the repository token, which does not trigger another workflow; the updater therefore runs the checks itself before opening the PR. Merging updates subsequent app builds; installed portable apps do not silently replace themselves or their game data.

## License and distribution

The project is licensed under **PolyForm Noncommercial 1.0.0**. Game assets remain Riot's property. See [LICENSE](../LICENSE) and [NOTICE](../NOTICE).

Riot's policies restrict live apps that dictate decisions and session-specific information previously unknown to the player. **The adaptive overlay requires Riot review before public distribution.** LCU is unsupported and must be registered with Riot. This implementation offers options and exposes estimates; it is not a claim of Riot approval. See [Riot documentation and policies](https://developer.riotgames.com/docs/lol).

The scheduled data workflow first runs `node scripts/check-data-version.ts` using Node 24, before installing dependencies. An unchanged Data Dragon version skips installation, rebuilding, validation and PR creation. A matching open patch PR also skips that work. Otherwise, it refreshes and verifies the data, builds the app, and proposes an update. The patch push reads the current remote branch SHA and uses an explicit force-with-lease so shallow checkouts work while concurrent changes remain protected. `test/refresh.test.ts` covers unchanged/new versions, retries, replacing an existing patch branch without a tracking ref, and a racing writer.
