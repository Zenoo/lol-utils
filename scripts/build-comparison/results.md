# Champion-only refinement results

Recorded 2026-11-05 against the unchanged official 16.21.1 catalog. Twelve champion/role cases, no teammates, opponents or live-game state. Baseline IDs and engine hash are retained in `baseline.json`; current reports are reproducible with `npm run compare:builds`. The reference fixture records source URLs, populations, guide authors where applicable, patch labels, and capture hashes.

Mean best-listed-path core membership: **25.0% -> 72.2%**. Exact-position overlap: **2.8% -> 52.8%**. Reference cores present anywhere in the six slots: **27.8% -> 76.4%**. These are diagnostics, not win rates or a full-build equivalence claim.

| Champion / role  | Group       | Before core | After core | Ordered core | Current first three combat items                       |
| ---------------- | ----------- | ----------- | ---------- | ------------ | ------------------------------------------------------ |
| Shen / TOP       | development | 66.7%       | 66.7%      | 66.7%        | Titanic Hydra / Dusk and Dawn / Hollow Radiance        |
| Annie / MIDDLE   | development | 33.3%       | 100.0%     | 66.7%        | Malignance / Shadowflame / Stormsurge                  |
| Jinx / BOTTOM    | development | 33.3%       | 100.0%     | 100.0%       | Hexoptics C44 / Runaan's Hurricane / Infinity Edge     |
| Leona / UTILITY  | development | 0.0%        | 100.0%     | 100.0%       | Locket of the Iron Solari / Knight's Vow / Bandlepipes |
| Darius / TOP     | development | 0.0%        | 0.0%       | 0.0%         | Black Cleaver / Eclipse / Stridebreaker                |
| LeeSin / JUNGLE  | development | 0.0%        | 66.7%      | 0.0%         | Black Cleaver / Eclipse / Sundered Sky                 |
| Ahri / MIDDLE    | validation  | 66.7%       | 66.7%      | 66.7%        | Malignance / Shadowflame / Stormsurge                  |
| Garen / TOP      | validation  | 0.0%        | 33.3%      | 0.0%         | Black Cleaver / Eclipse / Stridebreaker                |
| Soraka / UTILITY | validation  | 33.3%       | 100.0%     | 100.0%       | Moonstone Renewer / Redemption / Dawncore              |
| Khazix / JUNGLE  | validation  | 0.0%        | 66.7%      | 66.7%        | Umbral Glaive / Voltaic Cyclosword / Black Cleaver     |
| Malphite / TOP   | validation  | 0.0%        | 66.7%      | 66.7%        | Sunfire Aegis / Protoplasm Harness / Frozen Heart      |
| Kayle / TOP      | validation  | 66.7%       | 100.0%     | 0.0%         | Dusk and Dawn / Shadowflame / Nashor's Tooth           |

## What changed

- One empowered attack no longer implies sustained auto-attacks. Attack-speed reductions on enemies cannot be read as self steroids across unrelated spells. This removes the crit-carry treatment of assassins and the attack-carry treatment of engage supports.
- Mana-regeneration and heal/shield aliases are normalized once. Crit damage and percentage armor penetration have a value; crit damage interacts with existing crit chance instead of being ignored. Attack speed and defensive stats account for owned stats.
- Support tanks and ally-healers value shields, redirected damage and healing chains. Offensive supports retain their offensive profile.
- Generic passive parameters add waveclear, short-trade shields, armor shred, energized damage, movement utility and ally attack-speed auras. Tank offense saturation counts offensive items rather than counting an early defensive response as an offensive purchase.

## Source coverage and limits

OP.GG supplied patch-pinned rendered item tables for all twelve cases. Reviewed MOBAFire references cover Annie, Jinx, Leona, Garen and Soraka; the Shen 16.20+ guide is excluded by default. LoLalytics supplies an additional Shen reference. U.GG returned HTTP 403 and indexed results omitted item names or had other patch labels; Blitz blocked automated access. Neither contributes invented reference builds. See `access-notes.json` and `references.json`.

Core recall selects the best of the explicitly stored paths for each source, which is more generous than comparing only its first path. Sources are averaged within a case, then cases are averaged equally. MOBAFire statistical tables need not be independent of other providers. The six validation cases were used to inspect breadth during iteration; they are not an untouched holdout or evidence of statistical generalization.

Darius remains 0% against the captured default core and Garen is 33%; the model still misses mobility-driven and ability-specific item synergies. Kayle matches core membership but not order. Mage late slots can still overvalue additional mana or generic damage items, and late tank choices remain approximate. We did not force these cases into reference sequences with champion IDs or per-champion item overrides.

Improved similarity is evidence of correcting specific modelling mistakes, not proof that the algorithm matches real-game decisions. Opponent-specific and inventory legality regressions remain separate checks. Runtime code does not load these references.

## References

- Shen: [op.gg](https://op.gg/lol/champions/shen/build/top?patch=16.21&region=global&tier=emerald_plus&type=ranked) (patch 16.21).
- Shen: [lolalytics.com](https://lolalytics.com/lol/shen/build/) (patch 16.21).
- Annie: [op.gg](https://op.gg/lol/champions/annie/build/mid?patch=16.21&region=global&tier=emerald_plus&type=ranked) (patch 16.21).
- Annie: [mobafire.com](https://www.mobafire.com/league-of-legends/champion/annie-1) (patch 16.21).
- Jinx: [op.gg](https://op.gg/lol/champions/jinx/build/adc?patch=16.21&region=global&tier=emerald_plus&type=ranked) (patch 16.21).
- Jinx: [mobafire.com](https://www.mobafire.com/league-of-legends/build/s2026-21-easy-to-read-simple-1v9-live-ama-full-guide-updated-650672) (patch 16.21).
- Leona: [op.gg](https://op.gg/lol/champions/leona/build/support?patch=16.21&region=global&tier=emerald_plus&type=ranked) (patch 16.21).
- Leona: [mobafire.com](https://www.mobafire.com/league-of-legends/champion/leona-79?page=2) (patch 16.21).
- Darius: [op.gg](https://op.gg/lol/champions/darius/build/top?patch=16.21&region=global&tier=emerald_plus&type=ranked) (patch 16.21).
- LeeSin: [op.gg](https://op.gg/lol/champions/leesin/build/jungle?patch=16.21&region=global&tier=emerald_plus&type=ranked) (patch 16.21).
- Ahri: [op.gg](https://op.gg/lol/champions/ahri/build/mid?patch=16.21&region=global&tier=emerald_plus&type=ranked) (patch 16.21).
- Garen: [op.gg](https://op.gg/lol/champions/garen/build/top?patch=16.21&region=global&tier=emerald_plus&type=ranked) (patch 16.21).
- Garen: [mobafire.com](https://www.mobafire.com/league-of-legends/build/26-21-challenger-garen-top-guide-642197) (patch 16.21).
- Soraka: [op.gg](https://op.gg/lol/champions/soraka/build/support?patch=16.21&region=global&tier=emerald_plus&type=ranked) (patch 16.21).
- Soraka: [mobafire.com](https://www.mobafire.com/league-of-legends/build/26-21-actioners-soraka-support-guide-638014) (patch 16.21).
- Khazix: [op.gg](https://op.gg/lol/champions/khazix/build/jungle?patch=16.21&region=global&tier=emerald_plus&type=ranked) (patch 16.21).
- Malphite: [op.gg](https://op.gg/lol/champions/malphite/build/top?patch=16.21&region=global&tier=emerald_plus&type=ranked) (patch 16.21).
- Kayle: [op.gg](https://op.gg/lol/champions/kayle/build/top?patch=16.21&region=global&tier=emerald_plus&type=ranked) (patch 16.21).
