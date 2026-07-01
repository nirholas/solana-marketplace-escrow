import { Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { PresignBackend, type KeylessEscrow, type Party } from 'keyless-escrow';
import {
  connection, RPC, DECIMALS, addrLink, txLink, short, fmt, errMsg,
  makeLogger, setBusy, $, airdrop, makeMint, balanceOf,
} from '../lib/ui.js';

const AMOUNT = 1_000_000n;
const svc = new PresignBackend({ connection });
const PARTY_LABEL: Record<Party, string> = { buyer: 'Buyer', seller: 'Seller', arbiter: 'Arbiter' };

export function mount(root: HTMLElement) {
  root.innerHTML = `
    <div class="view-head">
      <h2>Keyless escrow</h2>
      <p>The vault key is destroyed after funding. A moderator can <em>release</em> to a party but the
        destinations are frozen — there is no button, and no possible transaction, that pays the arbiter.</p>
    </div>

    <section class="panel">
      <div class="panel-head"><h3><span class="step-num">1</span> Set up a scenario</h3></div>
      <p class="desc">Generate three fresh wallets, fund the buyer, and mint a throwaway test token.</p>
      <div class="row">
        <label class="field" style="flex:2">
          <span>Buyer secret key (base58) — optional</span>
          <input id="k-secret" type="password" placeholder="leave blank to generate + airdrop" />
        </label>
        <button id="k-setup" class="btn-primary">Run setup</button>
      </div>
      <div id="k-actors" class="actors hidden"></div>
    </section>

    <section id="k-open-panel" class="panel hidden">
      <div class="panel-head"><h3><span class="step-num">2</span> Open the keyless escrow</h3></div>
      <p class="desc">Deposit the token, pre-sign the four fixed-destination outcomes, then destroy the vault key.</p>
      <button id="k-open" class="btn-primary">Open &amp; fund escrow</button>
      <div id="k-vault" class="hidden"></div>
    </section>

    <section id="k-resolve-panel" class="panel hidden">
      <div class="panel-head"><h3><span class="step-num">3</span> Resolve it</h3>
        <span class="hint">each outcome pays a fixed party</span></div>
      <div id="k-outcomes" class="outcomes"></div>
      <div id="k-balances" class="balances"></div>
    </section>

    <section class="panel activity">
      <div class="panel-head"><h3>Activity</h3></div>
      <div id="k-log" class="log"></div>
    </section>`;

  const log = makeLogger($(root, '#k-log'));
  let scenario: { buyer: Keypair; seller: Keypair; arbiter: Keypair; mint: PublicKey } | null = null;
  let escrow: KeylessEscrow | null = null;
  const kp = () => ({ buyer: scenario!.buyer, seller: scenario!.seller, arbiter: scenario!.arbiter });

  log(`Connected to ${RPC}. Run a scenario to begin.`);

  $<HTMLButtonElement>(root, '#k-setup').addEventListener('click', async () => {
    const btn = $<HTMLButtonElement>(root, '#k-setup');
    setBusy(btn, true, 'Working…');
    try {
      const secret = $<HTMLInputElement>(root, '#k-secret').value.trim();
      const buyer = secret ? Keypair.fromSecretKey(bs58.decode(secret)) : Keypair.generate();
      const seller = Keypair.generate();
      const arbiter = Keypair.generate();
      log(`Generated wallets. Buyer ${addrLink(buyer.publicKey.toBase58())}.`);
      if (!secret) {
        log('Requesting devnet airdrop for buyer + arbiter…');
        try { await airdrop(buyer.publicKey, 2); await airdrop(arbiter.publicKey, 1); log('Airdrop confirmed.', 'ok'); }
        catch { log('Airdrop rate-limited — fund the buyer at <a href="https://faucet.solana.com" target="_blank" rel="noreferrer">faucet.solana.com</a> and re-run, or paste a funded secret.', 'warn'); }
      } else {
        try { await airdrop(arbiter.publicKey, 1); } catch { /* fees handled below */ }
      }
      log('Creating a throwaway SPL mint + minting 1.0 to the buyer…');
      const mint = await makeMint(buyer, buyer.publicKey, AMOUNT);
      log(`Mint ready: ${addrLink(mint.toBase58())}`, 'ok');
      scenario = { buyer, seller, arbiter, mint };
      renderActors(root, scenario);
      $(root, '#k-open-panel').classList.remove('hidden');
    } catch (e) { log(`Setup failed: ${errMsg(e)}`, 'err'); }
    finally { setBusy(btn, false, 'Run setup'); }
  });

  $<HTMLButtonElement>(root, '#k-open').addEventListener('click', async () => {
    const btn = $<HTMLButtonElement>(root, '#k-open');
    setBusy(btn, true, 'Opening…');
    try {
      const { buyer, seller, arbiter, mint } = scenario!;
      log('Depositing, pre-signing four outcomes, destroying the vault key…');
      escrow = await svc.open(buyer, { parties: { buyer: buyer.publicKey, seller: seller.publicKey, arbiter: arbiter.publicKey }, mint, amount: AMOUNT });
      log(`Escrow open. Vault ${addrLink(escrow.vault.toBase58())} — <strong>key destroyed</strong>.`, 'ok');
      renderVault(root, escrow.vault.toBase58());
      renderOutcomes(root, escrow, log, kp);
      $(root, '#k-resolve-panel').classList.remove('hidden');
      await refreshBalances(root, scenario!, escrow);
    } catch (e) { log(`Open failed: ${errMsg(e)}`, 'err'); }
    finally { setBusy(btn, false, 'Open & fund escrow'); }
  });
}

function renderActors(root: HTMLElement, s: { buyer: Keypair; seller: Keypair; arbiter: Keypair }) {
  const el = $(root, '#k-actors');
  el.classList.remove('hidden');
  const rows: [string, string, string, string][] = [
    ['Buyer', 'funds the escrow', s.buyer.publicKey.toBase58(), 'buyer'],
    ['Seller', 'is paid on success', s.seller.publicKey.toBase58(), 'seller'],
    ['Arbiter', 'the moderator', s.arbiter.publicKey.toBase58(), 'arbiter'],
  ];
  el.innerHTML = rows.map(([role, sub, addr, cls]) =>
    `<div class="actor ${cls}"><div class="role">${role}</div><div class="sub">${sub}</div><div class="addr">${addrLink(addr)}</div></div>`).join('');
}

function renderVault(root: HTMLElement, vault: string) {
  const el = $(root, '#k-vault');
  el.classList.remove('hidden');
  el.innerHTML = `
    <div class="callout">
      <div class="icon">🔒<small>no key</small></div>
      <div><div class="title">Vault ${addrLink(vault)}</div>
        <div class="sub">Holds 1.0 token. The only transactions that can ever move it are the four below.</div></div>
      <div class="flag">key destroyed ✓</div>
    </div>`;
}

function renderOutcomes(root: HTMLElement, escrow: KeylessEscrow, log: ReturnType<typeof makeLogger>, kp: () => Record<Party, Keypair>) {
  const wrap = $(root, '#k-outcomes');
  wrap.innerHTML = escrow.outcomes.map((o) => {
    const paysSeller = o.kind === 'release';
    return `<div class="outcome ${o.authorizer}" data-id="${o.id}">
      <div class="top"><code>${o.id}</code><span class="pill ${paysSeller ? 'to-seller' : 'to-buyer'}">pays ${paysSeller ? 'seller' : 'buyer'}</span></div>
      <div class="why">${o.description}</div>
      <div class="bottom"><span>by <strong>${PARTY_LABEL[o.authorizer as Party]}</strong></span>
        <button class="btn-mini settle" data-id="${o.id}">Settle as ${PARTY_LABEL[o.authorizer as Party]}</button></div>
    </div>`;
  }).join('');

  wrap.querySelectorAll<HTMLButtonElement>('button.settle').forEach((b) => b.addEventListener('click', async () => {
    setBusy(b, true, 'Settling…');
    try {
      const o = escrow.outcomes.find((x) => x.id === b.dataset.id)!;
      const authorizer = kp()[o.authorizer as Party];
      log(`${PARTY_LABEL[o.authorizer as Party]} settling <code>${o.id}</code>…`);
      const res = await svc.settle(escrow, o.id, authorizer);
      log(`Settled — <a href="${txLink(res.signature)}" target="_blank" rel="noreferrer">${short(res.signature)}</a>. Funds went to the fixed ${o.kind === 'release' ? 'seller' : 'buyer'}, not whoever signed.`, 'ok');
      wrap.querySelectorAll<HTMLButtonElement>('button.settle').forEach((x) => (x.disabled = true));
      wrap.querySelector(`.outcome[data-id="${o.id}"]`)?.classList.add('done');
    } catch (e) { log(`Settle failed: ${errMsg(e)}`, 'err'); setBusy(b, false, 'Settle'); }
  }));
}

async function refreshBalances(root: HTMLElement, s: { buyer: Keypair; seller: Keypair; mint: PublicKey }, escrow: KeylessEscrow) {
  const [buyerBal, sellerBal] = await Promise.all([balanceOf(s.mint, s.buyer.publicKey), balanceOf(s.mint, s.seller.publicKey)]);
  const status = await svc.status(escrow).catch(() => null);
  $(root, '#k-balances').innerHTML = `
    <div class="bal"><span>Buyer</span><b>${fmt(buyerBal)}</b></div>
    <div class="bal"><span>Seller</span><b>${fmt(sellerBal)}</b></div>
    <div class="bal"><span>Vault</span><b>${status ? fmt(status.balance) : '—'}</b></div>`;
}
