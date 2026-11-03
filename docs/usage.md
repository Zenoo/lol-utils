# Using LoL Utils

## Champion selection and imports

Select a champion in the League client to import runes, summoner spells, and an item set automatically. Settings let you turn automatic imports off, put Flash on D or F, and select a nonstandard League installation folder. Browsing a champion in the app previews a plan; it does not change your client selection.

Existing personal rune pages and item sets are preserved. Rune import reports an error if you have no free or app-owned editable page. Import cards distinguish waiting, progress, success, and errors. The item build refreshes against both complete teams after the final champion is selected.

## In-game guidance

Use borderless or windowed mode. The overlay highlights the suggested skill on the bottom skill bar while a point is available. It reads your saved League HUD scale automatically. Skills are suggested, never cast or levelled by the app.

**P** toggles purchase suggestions alongside League's shop without consuming the key; Escape hides the panel. Riot's documented API does not expose shop-open state, so mouse shop clicks and other game keybinds are not tracked. Change the companion shortcut if you remap the game's shop key. No memory reading, injection, screen capture, or simulated game input is used.

The overlay hides when League loses focus. Closing the main window quits the entire app.

## Browsing and offline use

The app shows item, rune, spell, and skill icons with hover and keyboard-focus tooltips. The encyclopedia includes English champion records, base and growth statistics, passives, spells, items, recipes, rune trees, stat shards, summoner spells, maps, and raw provenance records.

Browsing lists and autocomplete results are alphabetical. Champion, role, and Flash-side choices use searchable autocomplete fields: type to filter, choose an option with the mouse or arrow keys and Enter, or press Escape to cancel the search. Rune and summoner-spell pages also support name searches. Build progression, skill keys, and rune-page slots retain their gameplay order.

A League account, Riot API key, and network connection are not required to browse the included encyclopedia. Portraits and icons load from Riot and CommunityDragon when online; icons have text fallbacks when unavailable. Official wording and raw fields are preserved. Some live tooltip expressions cannot be resolved from public data; these are labelled rather than filled with invented numbers.

## Supported modes and limitations

Automatic imports and live guidance support **Summoner's Rift, Classic**. Jungle companions and support quest items are included for their assigned roles. Selection considers published income, regeneration, vision, clearing, and conditional quest-reward effects. Support reward choices require the completed quest item during live play; automatic quest transformations are not presented as purchases. A support's eventual six-item plan reserves one slot for the selected reward. Other game-mode data can be inspected, but recommendations abstain.

Item suggestions use champion damage and attack profiles, published stats, estimated enemy defenses, enemy kit sustain and control, observed inventories, level, kills and assists, owned components, gold, slot capacity, and some passive interactions. Rune selection uses Riot's perk descriptors and current slot definitions. Summoner selection uses role, available spells, level, and descriptions. These are heuristics, not a combat simulator or a proven optimal build. See [the recommendation model](recommendations.md).

Skill guidance supports standard and nonstandard progression, including free starting ranks, transformation abilities, six-rank basics, four basic stances, and Aphelios's stat upgrades. Rank gates come from champion game records; script-controlled progression semantics are decoded separately. Automatic ranks do not consume the player's point budget and are never suggested as purchases.

A different or unverifiable game patch displays a persistent warning in the main app only. Imports and live guidance continue using the bundled snapshot. A Data Dragon publication can lag the actual game patch, so recently changed mechanics may differ until data refreshes.

Local API contracts and native overlay behavior must still be validated against a running current client. Automated mocks do not prove that LCU writes succeed in a real lobby. Skill-marker alignment, real-match FPS, fullscreen behavior, multiple monitors, and long-session GPU and memory stability require the [manual acceptance checks](testing.md).

For code conventions, data updates, automation, licensing, and distribution requirements, see [development](development.md).
