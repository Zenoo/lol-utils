# Using LoL Utils

## Champion selection and imports

Picking a champion shows a unified list of Local, OP.GG, LoLalytics, LOLValue, and MetaBot builds. Click a row to select it: each row shows its source icon, six main-item slots, six main runes, and both summoner spells. Check **Items**, **Runes**, and/or **Summoners**, then click **Import selected build**. The local plan appears immediately while external sources load. Browsing a champion or another role does not change your client selection; imports must match your champion and role in League.

Identical loadouts share one row, with the other sources listed in the source tooltip and selected-build note. Matching ignores item order and the D/F order of a summoner pair; different rune shards, early components, or missing data remain separate. The original source records are preserved, so automatic imports still use your preferred source's order and metadata. Hover or focus item, rune, or summoner icons for the same detailed tooltips as the encyclopedia; click an icon to inspect its entry without changing the selected row. Source icons show attribution, and empty slots explain that the source supplied no recommendation.

Click a role icon to browse Top, Jungle, Mid, Bot, or Support builds. A new client role assignment automatically selects its icon and reloads the builds. Manual role browsing remains active until another assignment arrives. Settings also uses role icons for the fallback role and lets you put Flash on D or F and select a nonstandard League installation folder.

To automate imports, enable **Automatic build import** in Settings and choose a preferred source, including Local. After a champion is selected in League, the main process imports that source's first available build, including all available parts. Hover/preselection does not import anything. A slow provider cannot apply a previous pick, a manual import takes precedence for that selection, and an unavailable preferred source never silently falls back to another. Successful imports are not repeated on each client poll. Existing installations without a saved preferred source remain in manual mode.

The picker keeps distinct source paths and labels their item stats as Tank, AP, AP / durability, AD, or utility, rather than assigning one build type to a champion. Only variants actually displayed by the sources appear; a rare tank build may be absent. Local builds and MetaBot's full inventory have six main items. Sources that provide only a core leave the other slots visibly empty; no local items are inserted into an external build. Early components stay in the imported source order but are excluded from the main-item row. LOLValue and MetaBot's full build report inventories rather than a known purchase order; these are labelled in the preview and imported item set. Source populations are shown separately. Rune and summoner defaults belong to the source's champion/role page and may be shared across item variants. You can deselect either import part.

Existing personal rune pages and item sets are preserved. Rune import reports an error if you have no free or app-owned editable page. Import cards distinguish waiting, progress, success, and errors. Draft changes do not overwrite your chosen source build. Source requests run in the main process with a ten-minute cache; errors are retryable and one unavailable source does not discard results from the other. External builds need internet access and may use a different patch, which is labelled in the picker. The experimental local plan and live overlay still use the generated engine.

## In-game guidance

Use borderless or windowed mode. The overlay highlights the suggested skill on the bottom skill bar while a point is available. It reads your saved League HUD scale automatically. Skills are suggested, never cast or levelled by the app.

**P** toggles purchase suggestions alongside League's shop without consuming the key; Escape hides the panel. Riot's documented API does not expose shop-open state, so mouse shop clicks and other game keybinds are not tracked. Change the companion shortcut if you remap the game's shop key. No memory reading, injection, screen capture, or simulated game input is used.

The overlay hides when League loses focus. Closing the main window quits the entire app.

## Browsing and offline use

The app shows item, rune, spell, and skill icons with hover and keyboard-focus tooltips. The encyclopedia includes English champion records, base and growth statistics, passives, spells, items, recipes, rune trees, stat shards, summoner spells, maps, and raw provenance records.

Browsing lists and autocomplete results are alphabetical. Champion and Flash-side choices use searchable autocomplete fields: type to filter, choose an option with the mouse or arrow keys and Enter, or press Escape to cancel the search. Roles use clickable icons, and build rows are buttons that also work with Tab and Enter or Space. Rune and summoner-spell pages also support name searches. Build progression, skill keys, and rune-page slots retain their gameplay order.

A League account, Riot API key, and network connection are not required to browse the included encyclopedia. Portraits and icons load from Riot and CommunityDragon when online; icons have text fallbacks when unavailable. Official wording and raw fields are preserved. Some live tooltip expressions cannot be resolved from public data; these are labelled rather than filled with invented numbers.

## Supported modes and limitations

Imports and live guidance support **Summoner's Rift, Classic**. Jungle companions and support quest items are included for their assigned roles. Selection considers published income, regeneration, vision, clearing, and conditional quest-reward effects. Support reward choices require the completed quest item during live play; automatic quest transformations are not presented as purchases. A support's eventual six-item plan reserves one slot for the selected reward. Other game-mode data can be inspected, but recommendations abstain.

Item suggestions use champion damage and attack profiles, published stats, estimated enemy defenses, enemy kit sustain and control, observed inventories, level, kills and assists, owned components, gold, slot capacity, and some passive interactions. Rune selection uses Riot's perk descriptors and current slot definitions. Summoner selection uses role, available spells, level, and descriptions. These are heuristics, not a combat simulator or a proven optimal build. See [the recommendation model](recommendations.md).

Skill guidance supports standard and nonstandard progression, including free starting ranks, transformation abilities, six-rank basics, four basic stances, and Aphelios's stat upgrades. Rank gates come from champion game records; script-controlled progression semantics are decoded separately. Automatic ranks do not consume the player's point budget and are never suggested as purchases.

A different or unverifiable game patch displays a persistent warning in the main app only. Imports and live guidance continue using the bundled snapshot. A Data Dragon publication can lag the actual game patch, so recently changed mechanics may differ until data refreshes.

Local API contracts and native overlay behavior must still be validated against a running current client. Automated mocks do not prove that LCU writes succeed in a real lobby. Skill-marker alignment, real-match FPS, fullscreen behavior, multiple monitors, and long-session GPU and memory stability require the [manual acceptance checks](testing.md).

For code conventions, data updates, automation, licensing, and distribution requirements, see [development](development.md).

The item browser opens on Summoner's Rift each time. Filter by tier, boots, stat/category, or maximum gold; hidden variants and unavailable entries are opt-in. With variants hidden, same-name entries use the lowest-ID representative available for the selected map. The rune browser groups the five paths into keystone and minor rows, followed by the three official stat-shard rows.

Hovering a champion in League champion select previews source choices and the experimental local plan. Changing or clearing that preselection updates the preview. Importing requires a selected champion and an explicit choice of build parts.

The shop overlay appears at centre left with completed target items, cached icons, short explanations, and remaining recipe costs. Drag its header to move it and drag its edges to resize it; the app saves the layout relative to the game viewport and keeps it within view when resolutions or monitors change. The shop accepts mouse input without taking game focus; the skill marker remains click-through. Low gold labels a target as a saving option. Starter choices remain in the pregame plan.

Click outside a detail dialog or press Escape to close it. Item categories appear as clickable tags: choosing one closes the dialog and filters the item browser. Recipe upgrades follow the browser's selected game mode. The finishing cost is the extra gold paid after owning every recipe component, and is already included in the total price.

Patch status also checks Data Dragon's published versions while League is closed. An outdated bundled snapshot produces a warning; a failed public check is labelled as unverified. Checks run asynchronously, are cached for six hours, and retry after one minute on failure. Long client build identifiers are shortened to the matching published patch when available, or to the major/minor patch when the exact revision is unknown. Version warnings do not block imports or guidance.

The app displays Riot's public patch name, such as **26.22**. Data provenance separately shows the internal Data Dragon version, such as **16.22.1**. These identify the same patch; CDN addresses and compatibility checks keep the internal version.
