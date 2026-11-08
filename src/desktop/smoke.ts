import { app, BrowserWindow, ipcMain } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOverlayWindow } from './overlay-window.js';
import type { ServiceState, ImportPart, SourceBuilds } from '../core/types.js';
import { publicPatch } from '../core/versions.js';

/** Exercise the actual renderer and preload bridge without touching League. */
export async function smoke(main: BrowserWindow, initialState: ServiceState) {
  // Exercise source choice and component imports deterministically, without public sites or LCU.
  let importedParts: ImportPart[] = [];
  let importedSource = '';
  ipcMain.removeHandler('source-builds');
  ipcMain.handle(
    'source-builds',
    (_event, championId: number, role: string) =>
      ({
        fetchedAt: new Date().toISOString(),
        errors: [],
        builds: [
          {
            id: 'smoke-tank',
            label: 'Tank',
            items: [3068, 6665, 3075],
            itemOrder: 'inventory' as const,
          },
          {
            id: 'smoke-ap',
            label: 'AP',
            items: [3100, 4645, 3089],
            itemOrder: 'purchase' as const,
          },
          {
            id: 'smoke-tank-copy',
            label: 'Same tank build from another provider',
            items: [3075, 6665, 3068],
            itemOrder: 'inventory' as const,
          },
        ].map((variant) => ({
          ...variant,
          championId,
          role,
          provider: variant.id === 'smoke-tank-copy' ? 'LoLalytics' : 'OP.GG',
          url: 'https://op.gg/',
          patch: '16.22',
          stats: 'Fixture',
          runes: {
            selectedPerkIds: [8230, 8226, 8210, 8237, 8345, 8347, 5008, 5008, 5001],
            primaryStyleId: 8200,
            subStyleId: 8300,
            name: 'LoL Utils test',
            current: true,
          },
          summoners: { spell1Id: 4, spell2Id: 12 },
        })),
      }) satisfies SourceBuilds,
  );
  ipcMain.removeHandler('import-source-build');
  ipcMain.handle('import-source-build', (_event, id: string, parts: ImportPart[]) => {
    importedSource = id;
    importedParts = parts;

    return {
      ...initialState,
      selectedId: 1,
      role: 'middle',
      imports: Object.fromEntries(parts.map((part) => [part, 'Imported'])),
    };
  });
  main.webContents.setBackgroundThrottling(false);
  const errors: string[] = [];
  main.webContents.on('console-message', (details) => {
    if (details.level === 'error' && !details.message.includes('ERR_INTERNET_DISCONNECTED')) {
      errors.push(details.message);
    }
  });
  async function evaluate(code: string) {
    return main.webContents.executeJavaScript(code);
  }
  async function waitFor(expression: string) {
    const deadline = Date.now() + 10_000;
    while (!(await evaluate(expression))) {
      if (Date.now() > deadline) {
        throw new Error(`Smoke check timed out: ${expression}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  async function alphabetical(selector: string) {
    const ordered = await evaluate(`(() => {
      const names = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).map((node) => node.textContent.trim());
      const collator = new Intl.Collator('en', {sensitivity:'base',numeric:true});
      return names.length > 0 && names.every((name,i) => i === 0 || collator.compare(names[i-1],name) <= 0);
    })()`);
    if (!ordered) {
      throw new Error(`Options are not alphabetical: ${selector}`);
    }
  }
  const artifacts = path.resolve(process.env.LOL_UTILS_SMOKE_DIR ?? 'artifacts');
  await mkdir(artifacts, { recursive: true });
  try {
    await waitFor('Boolean(document.querySelector("#champion"))');
    const displayedPatch = await evaluate('document.querySelector("#patch").textContent');
    const version = await evaluate('window.companion.init().then(data => data.manifest.version)');
    if (displayedPatch !== `PATCH ${publicPatch(String(version))}`) {
      throw new Error('App patch label must use Riot public patch naming');
    }
    main.webContents.send('state', {
      ...initialState,
      patchWarning: 'Test patch mismatch: guidance continues',
    });
    await waitFor('!document.querySelector("#patch-warning").hidden');
    await evaluate('document.querySelector("[data-view=settings]").click()');
    if (await evaluate('document.querySelectorAll("select, datalist").length')) {
      throw new Error('Native select remains in settings');
    }
    await evaluate(`(() => {
      document.querySelector('#role-picker [data-role="TOP"]').click();
      document.querySelector('#role-picker [data-role="MIDDLE"]').click();
      document.querySelector('#auto-import-sources [data-source="OP.GG"]').click();
      document.querySelector('[name=autoImport]').checked = true;
      const flash = document.querySelector('#flash-slot');
      flash.dispatchEvent(new FocusEvent('focus'));
      flash.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}));
      flash.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    })()`);
    if (
      !(await evaluate(
        `new FormData(document.querySelector('#settings-form')).get('role') === 'MIDDLE' && new FormData(document.querySelector('#settings-form')).get('flashSlot') === 'D'`,
      ))
    ) {
      throw new Error('Role icons or Flash picker submitted the wrong setting value');
    }
    if (
      !(await evaluate(
        'document.querySelector("#patch-warning").textContent.includes("guidance continues") && !document.querySelector("#patch-warning").hidden',
      ))
    ) {
      throw new Error('Patch warning did not survive navigation');
    }
    main.webContents.send('state', initialState);
    await waitFor('document.querySelector("#patch-warning").hidden');
    await evaluate('document.querySelector("#settings-form").requestSubmit()');
    await waitFor(
      'window.companion.init().then(data => data.settings.role === "MIDDLE" && data.settings.flashSlot === "D" && data.settings.autoImportSource === "OP.GG" && data.settings.autoImport === true)',
    );
    await evaluate('document.querySelector("[data-view=companion]").click()');
    await evaluate(
      `(() => {
        const input = document.querySelector('#champion');
        input.dispatchEvent(new FocusEvent('focus'));
      })()`,
    );
    await alphabetical('#champion-options [role=option]');
    await evaluate(`(() => {
      const input = document.querySelector('#champion');
      input.value = 'zzzzunmatched'; input.dispatchEvent(new Event('input'));
    })()`);
    if (
      !(await evaluate(
        `document.querySelector('#champion-options .autocomplete-empty')?.textContent.includes('No matching')`,
      ))
    ) {
      throw new Error('Autocomplete empty-state regression');
    }
    await evaluate(`(() => {
      const input = document.querySelector('#champion');
      input.value = 'Annie'; input.dispatchEvent(new Event('input'));
      input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    })()`);
    await waitFor(
      `document.querySelector('#champion').value === 'Annie' && document.querySelector('#champion').getAttribute('aria-expanded') === 'false'`,
    );
    await waitFor('document.querySelectorAll(".build-choice").length === 3');
    if (
      !(await evaluate(
        `Array.from(document.querySelectorAll('.build-choice')).every(row => row.querySelectorAll('[data-asset-kind=item]').length === 6 && row.querySelectorAll('[data-asset-kind=rune]').length === 6 && row.querySelectorAll('[data-asset-kind=summoner]').length === 2 && row.querySelector('.source-icon')) && document.querySelector('[data-build-id="local-1-MIDDLE"] [data-asset-kind=item] img')`,
      ))
    ) {
      throw new Error('Unified build rows are missing source, item, rune, or summoner icons');
    }
    await evaluate('document.querySelector("[data-build-id=smoke-tank]").click()');
    if (
      !(await evaluate(
        '!document.querySelector("[data-build-id=smoke-tank-copy]") && document.querySelector("#source-preview").textContent.includes("LoLalytics")',
      ))
    ) {
      throw new Error('Duplicate builds were not merged with source attribution');
    }
    for (const kind of ['item', 'rune', 'summoner']) {
      const selector = `[data-build-id=smoke-ap] [data-asset-kind=${kind}][data-kind]`;
      const name = await evaluate(
        `document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-label')`,
      );
      await evaluate(
        `document.querySelector(${JSON.stringify(selector)}).querySelector('img').dispatchEvent(new PointerEvent('pointerover', {bubbles:true}))`,
      );
      await waitFor(
        `!document.querySelector('#game-tooltip').hidden && document.querySelector('#game-tooltip strong').textContent === ${JSON.stringify(name)} && document.querySelector('#game-tooltip .tooltip-description').textContent.length > 10`,
      );
    }
    // A hidden/offscreen window does not emit native focusin; exercise the same
    // delegated focus event used by keyboard navigation in the visible app.
    await evaluate(
      'document.querySelector("[data-build-id=smoke-ap] [data-asset-kind=rune]").focus({preventScroll:true}); document.querySelector("[data-build-id=smoke-ap] [data-asset-kind=rune]").dispatchEvent(new FocusEvent("focusin", {bubbles:true}))',
    );
    await waitFor(
      '!document.querySelector("#game-tooltip").hidden && document.activeElement.getAttribute("aria-describedby") === "game-tooltip"',
    );
    await evaluate(
      'document.querySelector("[data-build-id=smoke-tank] .build-provider").focus({preventScroll:true}); document.querySelector("[data-build-id=smoke-tank] .build-provider").dispatchEvent(new FocusEvent("focusin", {bubbles:true}))',
    );
    await waitFor(
      '!document.querySelector("#game-tooltip").hidden && document.querySelector("#game-tooltip strong").textContent.includes("LoLalytics")',
    );
    await evaluate(
      'document.querySelector("[data-build-id=smoke-tank] .unspecified").focus({preventScroll:true}); document.querySelector("[data-build-id=smoke-tank] .unspecified").dispatchEvent(new FocusEvent("focusin", {bubbles:true}))',
    );
    await waitFor(
      '!document.querySelector("#game-tooltip").hidden && document.querySelector("#game-tooltip strong").textContent === "Not supplied by this source"',
    );
    await evaluate(
      'document.querySelector("[data-build-id=smoke-ap] [data-asset-kind=item]").click()',
    );
    await waitFor('document.querySelector("#detail").open');
    if (
      !(await evaluate(
        'document.querySelector("[data-build-id=smoke-tank]").dataset.selected === "true"',
      ))
    ) {
      throw new Error('Inspecting an icon changed the selected build');
    }
    await evaluate('document.querySelector("#close-detail").click()');
    if (
      !(await evaluate(
        'document.querySelector("#source-preview").textContent.includes("purchase order is not known") && document.querySelector("[data-build-id=smoke-tank]").textContent.includes("OP.GG")',
      ))
    ) {
      throw new Error('Source provenance or inventory-order warning is missing');
    }
    if (!(await evaluate('document.querySelector("#import-source").disabled'))) {
      throw new Error('Source browsing enabled an import without a client selection');
    }
    main.webContents.send('state', { ...initialState, selectedId: 1, role: 'middle' });
    await waitFor(
      'document.querySelector("#import-source") && !document.querySelector("#import-source").disabled',
    );
    await waitFor(
      'document.querySelector("#source-builds [data-role=MIDDLE]").getAttribute("aria-pressed") === "true"',
    );
    await evaluate('document.querySelector("#source-builds [data-role=TOP]").click()');
    await waitFor('Boolean(document.querySelector("[data-build-id=local-1-TOP]"))');
    if (!(await evaluate('document.querySelector("#import-source").disabled'))) {
      throw new Error('Browsing another role enabled a mismatched import');
    }
    main.webContents.send('state', { ...initialState, selectedId: 1, role: 'bottom' });
    await waitFor(
      'Boolean(document.querySelector("[data-build-id=local-1-BOTTOM]")) && document.querySelector("#source-builds [data-role=BOTTOM]").getAttribute("aria-pressed") === "true"',
    );
    main.webContents.send('state', { ...initialState, selectedId: 1, role: 'middle' });
    await waitFor(
      'Boolean(document.querySelector("[data-build-id=local-1-MIDDLE]")) && document.querySelectorAll(".build-choice").length === 3',
    );
    await evaluate(`(() => {
      document.querySelector('[data-build-id=smoke-ap]').click();
      document.querySelector('#source-parts [value=items]').checked = false;
      document.querySelector('#source-parts [value=summoners]').checked = false;
      document.querySelector('#source-parts [value=runes]').checked = true;
      document.querySelector('#import-source').click();
    })()`);
    await waitFor('document.querySelector("[data-import=runes]").classList.contains("success")');
    if (importedSource !== 'smoke-ap' || importedParts.join(',') !== 'runes') {
      throw new Error('Source variant or selected import parts were not preserved');
    }
    await waitFor('document.querySelectorAll("#plan .build-item").length >= 6');
    await evaluate('document.querySelector("#plan").closest("details").open = true');
    if (
      !(await evaluate(
        `Array.from(document.querySelectorAll('#plan .build-reason')).length === 6 && Array.from(document.querySelectorAll('#plan .build-reason')).every(node => node.textContent.trim().length > 10)`,
      ))
    ) {
      throw new Error('Build progression explanations are missing');
    }

    if (
      !(await evaluate(
        `Array.from(document.querySelectorAll('#plan .build-item')).slice(0, 6).every((row, i) => row.dataset.step === String(i + 1) && Boolean(row.querySelector('button img')) && Boolean(row.querySelector('button')?.getAttribute('aria-label')))`,
      ))
    ) {
      throw new Error('Completed progression numbering is not continuous');
    }
    if (
      !(await evaluate(
        'document.querySelectorAll("#plan .icon-button[data-slot]").length === 5 && document.querySelectorAll("#plan .rune-choice.selected img").length === 6',
      ))
    ) {
      throw new Error('Skill or rune icons are missing');
    }
    const originalSize = main.getSize();
    for (const width of [900, 1240, 1600]) {
      main.setSize(width, 900);
      await evaluate(
        'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
      );
      const fits = await evaluate(`(() => {
        const trees = Array.from(document.querySelectorAll('#plan .rune-tree'));
        const rects = trees.map(tree => tree.getBoundingClientRect());
        return trees.length === 2 && trees.every(tree => {
          const bounds = tree.getBoundingClientRect();
          const icons = Array.from(tree.querySelectorAll('.icon-button')).map(icon => icon.getBoundingClientRect());
          return icons.every((r, i) => r.width === 34 && r.height === 34 &&
            r.left >= bounds.left && r.right <= bounds.right && r.top >= bounds.top && r.bottom <= bounds.bottom &&
            icons.every((other, j) => i === j || r.right <= other.left || r.left >= other.right || r.bottom <= other.top || r.top >= other.bottom));
        }) && (rects[0].right <= rects[1].left || rects[0].bottom <= rects[1].top);
      })()`);
      const rowsFit =
        await evaluate(`Array.from(document.querySelectorAll('.build-choice')).every(row => {
        const bounds = row.getBoundingClientRect();
        return row.scrollWidth <= row.clientWidth && Array.from(row.querySelectorAll('.build-asset')).every(icon => {const rect = icon.getBoundingClientRect(); return rect.left >= bounds.left && rect.right <= bounds.right;});
      })`);
      if (!rowsFit) {
        throw new Error('Build rows overflow at width ' + width);
      }
      if (!fits) {
        const geometry = await evaluate(
          `Array.from(document.querySelectorAll('#plan .rune-tree')).map(tree => ({tree:tree.getBoundingClientRect().toJSON(),icons:Array.from(tree.querySelectorAll('.icon-button')).map(icon=>icon.getBoundingClientRect().toJSON())}))`,
        );
        await writeFile(
          path.join(artifacts, 'rune-layout-failure.json'),
          JSON.stringify(geometry, null, 2),
        );
        await writeFile(
          path.join(artifacts, 'rune-layout-failure.png'),
          (await main.webContents.capturePage()).toPNG(),
        );
        throw new Error('Companion rune tree icons overlap or overflow at width ' + width);
      }
    }
    await evaluate('document.querySelector("#plan .rune-trees").scrollIntoView({block:"center"})');
    await evaluate(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
    await writeFile(
      path.join(artifacts, 'companion-runes.png'),
      (await main.webContents.capturePage()).toPNG(),
    );
    await evaluate('window.scrollTo(0,0)');
    main.setSize(originalSize[0], originalSize[1]);
    await evaluate(
      'document.querySelector("#plan .build-item button").dispatchEvent(new PointerEvent("pointerover", {bubbles:true}))',
    );
    await waitFor(
      'Boolean(document.querySelector("#game-tooltip:not([hidden]) .tooltip-description")?.textContent)',
    );
    await evaluate(
      'document.dispatchEvent(new KeyboardEvent("keydown", {key:"Escape",bubbles:true}))',
    );
    await waitFor('document.querySelector("#game-tooltip").hidden');
    await evaluate(
      `document.querySelector('#plan [data-slot="0"]').dispatchEvent(new FocusEvent('focusin', {bubbles:true}))`,
    );
    await waitFor(
      '!document.querySelector("#game-tooltip").hidden && document.querySelector("#game-tooltip").textContent.includes("Disintegrate")',
    );
    await evaluate(
      `document.querySelector('#plan [data-slot="0"]').dispatchEvent(new FocusEvent('focusout', {bubbles:true}))`,
    );
    main.webContents.send('state', {
      ...initialState,
      selectedId: 1,
      role: 'middle',
      imports: { runes: 'Imported', summoners: 'Importing', items: 'Test import failure' },
    });
    await waitFor(
      'document.querySelectorAll(".import-status.success").length === 1 && document.querySelectorAll(".import-status.pending").length === 1 && document.querySelectorAll(".import-status.error").length === 1',
    );
    if (
      !(await evaluate(
        'document.querySelector("[data-import=runes] input").checked && !document.querySelector("[data-import=items] input").checked',
      ))
    ) {
      throw new Error('Import checkboxes do not reflect actual success');
    }
    main.webContents.send('state', {
      ...initialState,
      selectedId: 1,
      role: 'middle',
      imports: { runes: 'Imported', summoners: 'Imported', items: 'Imported' },
    });
    await waitFor('document.querySelectorAll(".import-status.success").length === 3');
    // Client selection must populate the plan even when the local picker was cleared.
    await evaluate(`(() => {
      const input = document.querySelector('#champion');
      input.value = ''; input.dispatchEvent(new Event('input'));
    })()`);
    main.webContents.send('state', { ...initialState, selectedId: 98, role: 'top' });
    await waitFor(
      `document.querySelector('#champion').value === 'Shen' && document.querySelectorAll('#plan .build-item').length === 6 && !document.querySelector('#plan .empty')`,
    );
    // DOM changes precede Chromium's next paint in a hidden window.
    await evaluate(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))',
    );
    await writeFile(
      path.join(artifacts, 'companion.png'),
      (await main.webContents.capturePage()).toPNG(),
    );
    await evaluate('document.querySelector("[data-view=champions]").click()');
    const championCount = await evaluate('document.querySelectorAll("#results .card").length');
    await alphabetical('#results .card strong');
    if (championCount < 100) {
      throw new Error('Champion encyclopedia failed');
    }
    await evaluate(`document.querySelector('#results [data-id="30"]').click()`);
    await waitFor(
      `document.querySelector('#detail').open && document.querySelector('#detail-content h2').textContent.includes('Karthus')`,
    );
    if (
      !(await evaluate(
        `document.querySelectorAll('.ability')[0].textContent.includes('35% AP') && !document.querySelectorAll('.ability')[0].textContent.includes('qdamage:')`,
      ))
    ) {
      throw new Error('Damage tooltip did not resolve archived formulas');
    }
    await evaluate(
      `document.querySelector('#close-detail').click(); document.querySelector('#results [data-id="1"]').click()`,
    );
    await waitFor(
      'document.querySelector("#detail").open && document.querySelectorAll(".ability").length === 4',
    );
    if (
      !(await evaluate(
        `Array.from(document.querySelectorAll('#champ-stats .stat span')).map(node => node.textContent).includes('Magic resistance') && !Array.from(document.querySelectorAll('#champ-stats .stat span')).some(node => ['hp', 'mp', 'spellblock', 'attackspeed'].includes(node.textContent))`,
      ))
    ) {
      throw new Error('Champion stats expose raw keys');
    }
    await evaluate(
      'document.querySelector("#champ-level").value = "18"; document.querySelector("#champ-level").dispatchEvent(new Event("input"))',
    );
    await writeFile(
      path.join(artifacts, 'champion-detail.png'),
      (await main.webContents.capturePage()).toPNG(),
    );
    await evaluate(
      'document.querySelector("#close-detail").click(); document.querySelector("[data-view=items]").click()',
    );
    const itemCount = await evaluate('document.querySelectorAll("#results .card").length');
    await evaluate(`document.querySelector('#results [data-id="3003"]').click()`);
    await waitFor(
      `document.querySelector('#detail').open && document.querySelector('#detail-content h2').textContent.includes('Archangel')`,
    );
    if (
      !(await evaluate(
        `Array.from(document.querySelectorAll('#detail-content .stat span')).every(node => !/FlatMPPoolMod|FlatMagicDamageMod/.test(node.textContent)) && document.querySelector('#detail-content').textContent.includes('Finishing cost is the extra gold') && document.querySelectorAll('.category-tag').length > 0 && !document.querySelector('.category-tags').textContent.includes('SpellDamage')`,
      ))
    ) {
      throw new Error('Item modal repeats raw stats or raw category keys');
    }
    if (
      !(await evaluate(
        `getComputedStyle(document.querySelector('#detail')).overflow === 'hidden' && getComputedStyle(document.querySelector('.modal-scroll')).overflowY === 'auto' && document.querySelector('.modal-scroll').clientHeight < document.querySelector('#detail').clientHeight`,
      ))
    ) {
      throw new Error('Modal scrollbar is not inset from its border');
    }
    await evaluate(`document.querySelector('#detail-content h2').click()`);
    if (!(await evaluate(`document.querySelector('#detail').open`))) {
      throw new Error('Inside click closed the modal');
    }
    main.webContents.sendInputEvent({
      type: 'mouseDown',
      x: 4,
      y: 4,
      button: 'left',
      clickCount: 1,
    });
    main.webContents.sendInputEvent({ type: 'mouseUp', x: 4, y: 4, button: 'left', clickCount: 1 });
    await waitFor(`!document.querySelector('#detail').open`);
    await evaluate(`document.querySelector('#results [data-id="3003"]').click()`);
    await waitFor(`document.querySelector('#detail').open`);
    await evaluate(
      `Array.from(document.querySelectorAll('.category-tag')).find(button => button.textContent === 'Ability power').click()`,
    );
    await waitFor(
      `!document.querySelector('#detail').open && document.querySelector('#item-tag').value === 'Ability power'`,
    );
    if (
      !(await evaluate(
        `Boolean(document.querySelector('#results [data-id="3003"]')) && !document.querySelector('#results [data-id="1036"]')`,
      ))
    ) {
      throw new Error('Category click did not apply the item filter');
    }
    await evaluate(
      `document.querySelector('#item-tag').value = ''; document.querySelector('#item-tag').dispatchEvent(new Event('input')); document.querySelector('#item-map').value = '12'; document.querySelector('#item-map').dispatchEvent(new Event('input')); document.querySelector('#results [data-id="1028"]').click()`,
    );
    await waitFor(`document.querySelector('#detail').open`);
    const upgradesMatchMode = await evaluate(`(async () => {
      const ids = Array.from(document.querySelectorAll('#item-upgrades [data-id]')).map(node => Number(node.dataset.id));
      if (!ids.length) { return false; }
      const items = await Promise.all(ids.map(id => window.companion.detail('items', id)));
      return items.every(item => item.maps['12']);
    })()`);
    if (!upgradesMatchMode) {
      throw new Error('Builds-into entries ignore the selected mode');
    }
    await evaluate(
      `document.querySelector('#close-detail').click(); document.querySelector('[data-view=champions]').click(); document.querySelector('[data-view=items]').click()`,
    );

    if (
      !(await evaluate(
        `document.querySelector('#item-map').value === '11' && !document.querySelector('#item-variants').checked && (() => { const names = Array.from(document.querySelectorAll('#results strong')).map(x => x.textContent); return names.length === new Set(names).size; })()`,
      ))
    ) {
      throw new Error('Default Rift view contains duplicate variants');
    }
    await evaluate(
      `document.querySelector('#item-tier').value = '5'; document.querySelector('#item-tier').dispatchEvent(new Event('input'))`,
    );
    if (
      !(await evaluate(
        `document.querySelectorAll('#results .card').length > 50 && !document.querySelector('#results [data-id="1028"]')`,
      ))
    ) {
      throw new Error('Legendary filter failed');
    }
    await evaluate(
      `document.querySelector('#item-tier').value = '0'; document.querySelector('#item-tier').dispatchEvent(new Event('input'))`,
    );
    if (
      !(await evaluate(
        `Boolean(document.querySelector('#results [data-id="1028"]')) && !document.querySelector('#results [data-id="1031"]')`,
      ))
    ) {
      throw new Error('Basic tier filter failed');
    }
    await evaluate(
      `document.querySelector('#item-tier').value = '4'; document.querySelector('#item-tier').dispatchEvent(new Event('input'))`,
    );
    if (
      !(await evaluate(
        `Boolean(document.querySelector('#results [data-id="1031"]')) && !document.querySelector('#results [data-id="1028"]')`,
      ))
    ) {
      throw new Error('Epic tier filter failed');
    }
    await evaluate(
      `document.querySelector('#item-tier').value = ''; document.querySelector('#item-tier').dispatchEvent(new Event('input'))`,
    );
    await evaluate(
      `document.querySelector('#item-variants').checked = true; document.querySelector('#item-unavailable').checked = true; document.querySelector('#item-unavailable').dispatchEvent(new Event('input')); document.querySelector('#results [data-id="3901"]').click()`,
    );
    await waitFor(
      `document.querySelector('#detail').open && document.querySelector('#detail-content h2').textContent.includes('Fire at Will')`,
    );
    if (
      await evaluate(
        `document.querySelector('#detail-content h2').textContent.includes('<rarityLegendary>')`,
      )
    ) {
      throw new Error('Item name leaked markup');
    }
    await evaluate(
      `document.querySelector('#close-detail').click(); document.querySelector('#item-variants').checked = false; document.querySelector('#item-unavailable').checked = false; document.querySelector('#item-unavailable').dispatchEvent(new Event('input'))`,
    );

    await alphabetical('#results .card strong');
    await evaluate(
      `document.querySelector('#search').value = 'boots'; document.querySelector('#search').dispatchEvent(new Event('input'))`,
    );
    await alphabetical('#results .card strong');
    await evaluate(
      `document.querySelector('#search').value = ''; document.querySelector('#search').dispatchEvent(new Event('input'))`,
    );
    if (itemCount < 100) {
      throw new Error('Item encyclopedia failed');
    }
    await evaluate('document.querySelector(\'#results [data-id="3089"]\').click()');
    await waitFor(
      'document.querySelector("#detail").open && document.querySelector("#detail-content").textContent.includes("Rabadon")',
    );
    await evaluate(
      'document.querySelector("#close-detail").click(); document.querySelector("[data-view=runes]").click()',
    );
    if ((await evaluate('document.querySelectorAll("[data-kind=runes]").length')) < 50) {
      throw new Error('Rune encyclopedia failed');
    }
    if (
      !(await evaluate(
        'document.querySelectorAll(".rune-tree").length === 5 && document.querySelectorAll(".rune-tree .rune-slot").length === 20',
      ))
    ) {
      throw new Error('Rune tree slots do not match the five official paths');
    }
    await evaluate('document.querySelector("[data-view=summoners]").click()');
    await alphabetical('#results .card strong');
    await evaluate('document.querySelector("[data-view=settings]").click()');
    await waitFor('Boolean(document.querySelector("[name=flashSlot]"))');
    const directory = path.dirname(fileURLToPath(import.meta.url));
    const overlay = createOverlayWindow(directory);
    try {
      await overlay.loadFile(path.join(directory, '../ui/overlay.html'));
      if (overlay.isFocusable() || overlay.isVisible()) {
        throw new Error('Overlay stole focus or became visible during the hidden test');
      }
      if (!overlay.isResizable()) {
        throw new Error('Shop overlay cannot be resized');
      }
      overlay.setBounds({ x: 50, y: 70, width: 520, height: 600 });
      if (overlay.getBounds().width !== 520 || overlay.getBounds().height !== 600) {
        throw new Error('Shop overlay did not accept custom bounds');
      }
      const before = app
        .getAppMetrics()
        .find((metric) => metric.pid === overlay.webContents.getOSProcessId())?.memory;
      for (let i = 0; i < 200; i++) {
        overlay.webContents.send('overlay', {
          champion: 'Test',
          skill: { key: i % 2 ? 'Q' : null, label: 'Attack speed', reason: 'Smoke fixture' },
          buys: ['Thornmail', 'Titanic Hydra', 'Dusk and Dawn'].map((name, index) => ({
            id: index + 1,
            name,
            icon: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=',
            cost: 2450 + index * 200,
            affordable: false,
            reasons: [
              'Armor reduces incoming physical damage',
              'Healing reduction against enemy sustain; taunt forces attacks to trigger it',
            ],
          })),
        });
      }
      const rows = await overlay.webContents.executeJavaScript(
        'document.querySelectorAll(".buy").length',
      );
      if (
        !(await overlay.webContents.executeJavaScript(
          `Boolean(document.querySelector('.buy img[src^="data:image/png;base64,"]')) && document.querySelector('.buy-reasons').textContent.includes('taunt forces attacks')`,
        ))
      ) {
        throw new Error('Overlay item icon or explanation missing');
      }
      if (
        !(await overlay.webContents.executeJavaScript(
          `Array.from(document.querySelectorAll('.buy')).every(row => row.getBoundingClientRect().bottom <= innerHeight)`,
        ))
      ) {
        throw new Error('Overlay explanations are clipped');
      }
      if (rows !== 3) {
        throw new Error('Overlay repeated-update regression');
      }
      const skillText: unknown = await overlay.webContents.executeJavaScript(
        'document.querySelector("#skill").getAttribute("aria-label")',
      );
      if (
        typeof skillText !== 'string' ||
        !skillText.includes('Attack speed') ||
        skillText.includes('patch')
      ) {
        throw new Error('Overlay stat label or warning isolation regression');
      }
      const after = app
        .getAppMetrics()
        .find((metric) => metric.pid === overlay.webContents.getOSProcessId())?.memory;
      await writeFile(
        path.join(artifacts, 'overlay-memory.json'),
        JSON.stringify({ before, after, updates: 200 }, null, 2),
      );
      await overlay.webContents.executeJavaScript(`document.querySelector('#skill').hidden = true`);
      await overlay.webContents.executeJavaScript(
        'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))',
      );
      await writeFile(
        path.join(artifacts, 'overlay.png'),
        (await overlay.webContents.capturePage()).toPNG(),
      );
    } finally {
      overlay.destroy();
    }
    const marker = createOverlayWindow(directory, 'skill');
    try {
      await marker.loadFile(path.join(directory, '../ui/overlay.html'), {
        query: { kind: 'skill' },
      });
      marker.webContents.send('overlay', {
        champion: 'Annie',
        skill: { key: 'Q', reason: 'Smoke' },
        buys: [],
      });
      if (
        !(await marker.webContents.executeJavaScript(
          `document.body.classList.contains('skill-marker') && document.querySelector('#skill').dataset.key === 'Q' && !document.querySelector('#skill').hidden && document.querySelector('#shop').hidden`,
        ))
      ) {
        throw new Error('Skill marker isolation failed');
      }
      if (marker.isFocusable() || marker.isVisible()) {
        throw new Error('Skill marker focus regression');
      }
      await writeFile(
        path.join(artifacts, 'skill-marker.png'),
        (await marker.webContents.capturePage()).toPNG(),
      );
      marker.webContents.send('overlay', {
        champion: 'Annie',
        skill: { key: null, reason: 'Spent' },
        buys: [],
      });
      if (
        !(await marker.webContents.executeJavaScript(`document.querySelector('#skill').hidden`))
      ) {
        throw new Error('Spent skill point marker was not hidden');
      }
    } finally {
      marker.destroy();
    }
    const report = {
      packaged: app.isPackaged,
      version: app.getVersion(),
      championCount,
      itemCount,
      errors,
      metrics: app.getAppMetrics(),
      scope: 'Hidden desktop renderer smoke; no game or overlay FPS measurement',
    };
    await writeFile(path.join(artifacts, 'desktop-smoke.json'), JSON.stringify(report, null, 2));
    if (errors.some((error) => !error.includes('ERR_'))) {
      throw new Error(errors.join('\n'));
    }
    console.log(`Desktop smoke passed: ${championCount} champions, ${itemCount} items`);
    app.exit(0);
  } catch (error) {
    await writeFile(path.join(artifacts, 'smoke-error.txt'), String(error));
    console.error(error);
    app.exit(1);
  }
}
