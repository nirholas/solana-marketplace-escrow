import './style.css';
import { mount as mountKeyless } from './flows/keyless.js';
import { mount as mountSwap } from './flows/swap.js';
import { mount as mountCustodial } from './flows/custodial.js';

const view = document.querySelector('#view') as HTMLElement;
const tabs = ['keyless', 'swap', 'custodial'] as const;
type Tab = (typeof tabs)[number];

const containers: Record<Tab, HTMLElement> = {} as Record<Tab, HTMLElement>;
for (const id of tabs) {
  const c = document.createElement('div');
  c.className = 'view';
  c.dataset.tab = id;
  if (id !== 'keyless') c.classList.add('hidden');
  view.appendChild(c);
  containers[id] = c;
}

// Mount each flow once so switching tabs preserves in-progress state.
mountKeyless(containers.keyless);
mountSwap(containers.swap);
mountCustodial(containers.custodial);

document.querySelectorAll<HTMLButtonElement>('.tab').forEach((t) => {
  t.addEventListener('click', () => {
    const tab = t.dataset.tab as Tab;
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
    for (const id of tabs) containers[id].classList.toggle('hidden', id !== tab);
  });
});
