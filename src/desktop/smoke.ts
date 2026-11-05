import { app, BrowserWindow } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOverlayWindow } from './overlay-window.js';
import type { ServiceState } from '../core/types.js';

/** Exercise the actual renderer and preload bridge without touching League. */
export async function smoke(main: BrowserWindow, initialState: ServiceState) {
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
    main.webContents.send('state', {
      ...initialState,
      patchWarning: 'Test patch mismatch: guidance continues',
    });
    await waitFor('!document.querySelector("#patch-warning").hidden');
    await evaluate('document.querySelector("[data-view=settings]").click()');
    if (await evaluate('document.querySelectorAll("select, datalist").length')) {
      throw new Error('Native select remains in settings');
    }
    await evaluate(
      'document.querySelector("#fallback-role").dispatchEvent(new FocusEvent("focus"))',
    );
    await alphabetical('#fallback-role-options [role=option]');
    await evaluate(`(() => {
      const input = document.querySelector('#fallback-role');
      input.value = 'unknown role'; input.dispatchEvent(new Event('input'));
    })()`);
    if (
      !(await evaluate(
        `!document.querySelector('#fallback-role').checkValidity() && document.querySelector('[name=role]').value === ''`,
      ))
    ) {
      throw new Error('Autocomplete accepted an unknown role');
    }
    await evaluate(`(() => {
      const input = document.querySelector('#fallback-role');
      input.value = 'mid'; input.dispatchEvent(new Event('input'));
      document.querySelector('#fallback-role-options [role=option]').click();
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
      throw new Error('Autocomplete submitted a label instead of the setting value');
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
      'window.companion.init().then(data => data.settings.role === "MIDDLE" && data.settings.flashSlot === "D")',
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
    await waitFor('document.querySelectorAll("#plan .build-item").length >= 6');
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
