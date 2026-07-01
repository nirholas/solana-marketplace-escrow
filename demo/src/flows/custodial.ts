import { Keypair, PublicKey } from '@solana/web3.js';
import { CustodialBackend, type CustodialEscrow } from 'keyless-escrow';
import {
  connection, RPC, addrLink, txLink, short, fmt, errMsg,
  makeLogger, setBusy, $, airdrop, makeMint, balanceOf,
} from '../lib/ui.js';

const AMOUNT = 1_000_000n;

export function mount(root: HTMLElement) {
  root.innerHTML = `
    <div class="view-head">
      <h2>Moderator console</h2>
      <p>The <em>nirholas/atomic</em> pattern: the platform holds a master wallet (SOL) and the escrow key.
        A moderator clicks release and the backend fires one atomic transaction — master pays the fee, the
        escrow key signs the transfer. <strong>Moderators hold no key.</strong></p>
    </div>

    <section class="panel">
      <div class="panel-head"><h3><span class="step-num">1</span> Platform setup</h3></div>
      <p class="desc">Create the platform master wallet (holds SOL) and fund a buyer with a test token.</p>
      <button id="c-setup" class="btn-primary">Run setup</button>
      <div id="c-actors" class="actors hidden"></div>
    </section>

    <section id="c-open-panel" class="panel hidden">
      <div class="panel-head"><h3><span class="step-num">2</span> Buyer opens an escrow</h3></div>
      <p class="desc">The buyer deposits into a fresh escrow wallet whose key the <strong>platform</strong> holds.</p>
      <button id="c-open" class="btn-primary">Open escrow</button>
      <div id="c-vault" class="hidden"></div>
    </section>

    <section id="c-mod-panel" class="panel hidden">
      <div class="panel-head"><h3><span class="step-num">3</span> Moderator resolves</h3>
        <span class="hint">signed by {master, escrow} — not the moderator</span></div>
      <div class="row">
        <button id="c-release" class="btn-mini">Release → seller</button>
        <button id="c-refund" class="btn-mini">Refund → buyer</button>
        <label class="checkbox"><input type="checkbox" id="c-bundle" /> via Jito bundle</label>
      </div>
      <div id="c-balances" class="balances"></div>
      <div class="note"><b>In production</b> these keys live in the platform backend, not the browser — see
        <a href="https://github.com/nirholas/solana-marketplace-escrow/tree/main/apps/dashboard" target="_blank" rel="noreferrer">apps/dashboard</a>.
        This demo holds throwaway keys client-side to illustrate the mechanism.</div>
    </section>

    <section class="panel activity">
      <div class="panel-head"><h3>Activity</h3></div>
      <div id="c-log" class="log"></div>
    </section>`;

  const log = makeLogger($(root, '#c-log'));
  let master: Keypair | null = null;
  let backend: CustodialBackend | null = null;
  let st: { buyer: Keypair; seller: Keypair; mint: PublicKey } | null = null;
  let record: CustodialEscrow | null = null;
  log(`Connected to ${RPC}. Run a scenario to begin.`);

  $<HTMLButtonElement>(root, '#c-setup').addEventListener('click', async () => {
    const btn = $<HTMLButtonElement>(root, '#c-setup');
    setBusy(btn, true, 'Working…');
    try {
      master = Keypair.generate();
      const buyer = Keypair.generate();
      const seller = Keypair.generate();
      log('Airdropping SOL to the platform master + buyer…');
      try { await airdrop(master.publicKey, 2); await airdrop(buyer.publicKey, 2); log('Airdrop confirmed.', 'ok'); }
      catch { log('Airdrop rate-limited — fund the master + buyer at faucet.solana.com and re-run.', 'warn'); }
      log('Minting 1.0 to the buyer…');
      const mint = await makeMint(buyer, buyer.publicKey, AMOUNT);
      backend = new CustodialBackend({ connection, master });
      st = { buyer, seller, mint };
      renderActors(root, master.publicKey.toBase58(), buyer.publicKey.toBase58(), seller.publicKey.toBase58());
      $(root, '#c-open-panel').classList.remove('hidden');
    } catch (e) { log(`Setup failed: ${errMsg(e)}`, 'err'); }
    finally { setBusy(btn, false, 'Run setup'); }
  });

  $<HTMLButtonElement>(root, '#c-open').addEventListener('click', async () => {
    const btn = $<HTMLButtonElement>(root, '#c-open');
    setBusy(btn, true, 'Opening…');
    try {
      record = await backend!.open(st!.buyer, { seller: st!.seller.publicKey, mint: st!.mint, amount: AMOUNT });
      log(`Escrow opened. Platform-held escrow wallet ${addrLink(record.escrow)}.`, 'ok');
      $(root, '#c-vault').classList.remove('hidden');
      $(root, '#c-vault').innerHTML = `
        <div class="callout"><div class="icon">🏦<small>platform</small></div>
          <div><div class="title">Escrow wallet ${addrLink(record!.escrow)}</div>
            <div class="sub">Holds 1.0 token. Its key lives with the platform — the moderator never sees it.</div></div>
          <div class="flag" style="color:var(--master)">custodial</div></div>`;
      $(root, '#c-mod-panel').classList.remove('hidden');
      await refresh(root);
    } catch (e) { log(`Open failed: ${errMsg(e)}`, 'err'); }
    finally { setBusy(btn, false, 'Open escrow'); }
  });

  const settle = async (kind: 'release' | 'refund', btn: HTMLButtonElement) => {
    setBusy(btn, true, kind === 'release' ? 'Releasing…' : 'Refunding…');
    try {
      const viaBundle = $<HTMLInputElement>(root, '#c-bundle').checked;
      log(`Moderator triggers <code>${kind}</code> — master funds, escrow signs, atomic…`);
      const res = await backend!.settle(record!, kind, { viaBundle });
      log(`${kind === 'release' ? 'Released to seller' : 'Refunded to buyer'} — <a href="${txLink(res.signature)}" target="_blank" rel="noreferrer">${short(res.signature)}</a>. Moderator held no key.`, 'ok');
      $<HTMLButtonElement>(root, '#c-release').disabled = true;
      $<HTMLButtonElement>(root, '#c-refund').disabled = true;
      await refresh(root);
    } catch (e) { log(`${kind} failed: ${errMsg(e)}`, 'err'); setBusy(btn, false, kind === 'release' ? 'Release → seller' : 'Refund → buyer'); }
  };
  $<HTMLButtonElement>(root, '#c-release').addEventListener('click', (e) => settle('release', e.currentTarget as HTMLButtonElement));
  $<HTMLButtonElement>(root, '#c-refund').addEventListener('click', (e) => settle('refund', e.currentTarget as HTMLButtonElement));

  async function refresh(r: HTMLElement) {
    if (!st || !master) return;
    const [buyerBal, sellerBal] = await Promise.all([balanceOf(st.mint, st.buyer.publicKey), balanceOf(st.mint, st.seller.publicKey)]);
    $(r, '#c-balances').innerHTML = `
      <div class="bal"><span>Buyer</span><b>${fmt(buyerBal)}</b></div>
      <div class="bal"><span>Seller</span><b>${fmt(sellerBal)}</b></div>`;
  }
}

function renderActors(root: HTMLElement, master: string, buyer: string, seller: string) {
  const el = $(root, '#c-actors');
  el.classList.remove('hidden');
  el.innerHTML = `
    <div class="actor master"><div class="role">Master</div><div class="sub">platform · pays fees + tip</div><div class="addr">${addrLink(master)}</div></div>
    <div class="actor buyer"><div class="role">Buyer</div><div class="sub">deposits funds</div><div class="addr">${addrLink(buyer)}</div></div>
    <div class="actor seller"><div class="role">Seller</div><div class="sub">paid on release</div><div class="addr">${addrLink(seller)}</div></div>`;
}
