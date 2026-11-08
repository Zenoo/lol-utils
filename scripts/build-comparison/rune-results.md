# Current rune comparison

Public patch 26.22 (Data Dragon 16.22.1). Twelve champion/role cases, without live-game context. Baseline refreshed on 7 November 2026 for the prepared catalog; this is a reference point, not a claimed tuning improvement. Previous reports remain in Git history.

| Metric                    | Current |
| ------------------------- | ------: |
| Keystone agreement        |   83.3% |
| Primary-rune membership   |   60.4% |
| Secondary-rune membership |   16.7% |
| Shard slot agreement      |   66.7% |

Run `npx tsx scripts/build-comparison/run-runes.ts` to reproduce the source-level JSON in `artifacts/build-comparison/runes.json`. The baseline records the current catalog and engine hashes. Sources are averaged per champion case before averaging cases equally.

These figures measure agreement with captured source pages, not build quality, win probability, or independent validation. Kha'Zix and Malphite still disagree on keystones, and secondary choices remain a substantial gap. Source provenance and capture dates are retained in `rune-references.json`.
