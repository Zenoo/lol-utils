import { required } from '../core/assert.js';
const skillBox = required(document.querySelector<HTMLElement>('#skill'));
const shopBox = required(document.querySelector<HTMLElement>('#shop'));
const buysBox = required(document.querySelector('#buys'));
document.body.classList.toggle(
  'skill-marker',
  new URLSearchParams(location.search).get('kind') === 'skill',
);
// No animation loop, network requests, or game-state calculations in this renderer.
window.overlay.onUpdate((state) => {
  skillBox.hidden = !state.skill?.key;
  skillBox.textContent = state.skill?.key ? '+' : '';
  skillBox.setAttribute(
    'aria-label',
    state.skill?.key
      ? `Level ${state.skill.key}${state.skill.label ? ` · ${state.skill.label}` : ''}`
      : '',
  );
  skillBox.dataset.key = state.skill?.key ?? '';
  shopBox.hidden = !state.buys.length;
  buysBox.replaceChildren(
    ...state.buys.map((item) => {
      const row = document.createElement('div');
      row.className = 'buy';
      const name = document.createElement('span');
      name.textContent = item.name;
      const cost = document.createElement('span');
      cost.className = 'cost';
      cost.textContent = `${item.affordable ? '' : 'Save · '}${Math.ceil(item.cost)}g`;
      const image = document.createElement('img');
      image.alt = '';
      image.width = image.height = 42;
      if (item.icon?.startsWith('data:image/png;base64,')) {
        image.src = item.icon;
      } else {
        image.hidden = true;
      }
      const details = document.createElement('div');
      details.className = 'buy-details';
      const reason = document.createElement('p');
      reason.className = 'buy-reasons';
      reason.textContent = item.reasons.slice(-2).join(' / ');
      details.append(name, cost, reason);
      row.append(image, details);

      return row;
    }),
  );
});
