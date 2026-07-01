import { Keypair, PublicKey } from '@solana/web3.js';
import { AtomicSwapClient } from 'keyless-escrow';
import {
  connection, RPC, addrLink, txLink, short, fmt, errMsg,
  makeLogger, setBusy, $, airdrop, makeMint, balanceOf,
} from '../lib/ui.js';

const A_AMOUNT = 1_000_000n;      // 1.0 token A
const B_AMOUNT = 2_000_000n;      // 2.0 token B
const swap = new AtomicSwapClient({ connection });

export function mount(root: HTMLElement) {
  root.innerHTML = `
    <div class="view-head">
      <h2>Atomic swap</h2>
      <p>When a trade is simultaneous and on-chain you don't need escrow at all. Both assets move in
        <em>one transaction</em>, both parties sign — either both legs execute or neither does.</p>
    </div>

    <section class="panel">
      <div class="panel-head"><h3><span class="step-num">1</span> Set up two traders</h3></div>
      <p class="desc">Alice gets 1.0 of token A, Bob gets 2.0 of token B — throwaway devnet mints.</p>
      <button id="s-setup" class="btn-primary">Run setup</button>
      <div id="s-actors" class="actors hidden" style="grid-template-columns:repeat(2,1fr)"></div>
    </section>

    <section id="s-do-panel" class="panel hidden">
      <div class="panel-head"><h3><span class="step-num">2</span> Swap atomically</h3></div>
      <p class="desc">Alice's 1.0 A for Bob's 2.0 B, in a single indivisible transaction.</p>
      <div class="swap-legs">
        <div class="callout" style="margin:0"><div class="icon">🅰️</div><div><div class="title">Alice → Bob</div><div class="sub">1.0 token A</div></div></div>
        <div class="swap-arrow">⇄</div>
        <div class="callout" style="margin:0"><div class="icon">🅱️</div><div><div class="title">Bob → Alice</div><div class="sub">2.0 token B</div></div></div>
      </div>
      <div class="row" style="margin-top:14px"><button id="s-do" class="btn-primary">Execute atomic swap</button></div>
      <div id="s-balances" class="balances"></div>
    </section>

    <section class="panel activity">
      <div class="panel-head"><h3>Activity</h3></div>
      <div id="s-log" class="log"></div>
    </section>`;

  const log = makeLogger($(root, '#s-log'));
  let st: { alice: Keypair; bob: Keypair; mintA: PublicKey; mintB: PublicKey } | null = null;
  log(`Connected to ${RPC}. Run a scenario to begin.`);

  $<HTMLButtonElement>(root, '#s-setup').addEventListener('click', async () => {
    const btn = $<HTMLButtonElement>(root, '#s-setup');
    setBusy(btn, true, 'Working…');
    try {
      const alice = Keypair.generate();
      const bob = Keypair.generate();
      log(`Alice ${addrLink(alice.publicKey.toBase58())} · Bob ${addrLink(bob.publicKey.toBase58())}`);
      log('Airdropping devnet SOL to both…');
      try { await airdrop(alice.publicKey, 2); await airdrop(bob.publicKey, 2); log('Airdrop confirmed.', 'ok'); }
      catch { log('Airdrop rate-limited — fund the printed wallets at faucet.solana.com and re-run.', 'warn'); }
      log('Minting 1.0 A to Alice and 2.0 B to Bob…');
      const mintA = await makeMint(alice, alice.publicKey, A_AMOUNT);
      const mintB = await makeMint(bob, bob.publicKey, B_AMOUNT);
      log(`Token A ${addrLink(mintA.toBase58())} · Token B ${addrLink(mintB.toBase58())}`, 'ok');
      st = { alice, bob, mintA, mintB };
      renderActors(root, st);
      $(root, '#s-do-panel').classList.remove('hidden');
      await refresh(root, st);
    } catch (e) { log(`Setup failed: ${errMsg(e)}`, 'err'); }
    finally { setBusy(btn, false, 'Run setup'); }
  });

  $<HTMLButtonElement>(root, '#s-do').addEventListener('click', async () => {
    const btn = $<HTMLButtonElement>(root, '#s-do');
    setBusy(btn, true, 'Swapping…');
    try {
      const { alice, bob, mintA, mintB } = st!;
      log('Executing atomic swap — both legs sign, both settle or neither…');
      const res = await swap.execute(
        { a: { owner: alice.publicKey, mint: mintA, amount: A_AMOUNT }, b: { owner: bob.publicKey, mint: mintB, amount: B_AMOUNT }, feePayer: alice.publicKey },
        [alice, bob],
      );
      log(`Swapped — <a href="${txLink(res.signature)}" target="_blank" rel="noreferrer">${short(res.signature)}</a>. No custody window, no arbiter.`, 'ok');
      btn.disabled = true;
      await refresh(root, st!);
    } catch (e) { log(`Swap failed: ${errMsg(e)}`, 'err'); setBusy(btn, false, 'Execute atomic swap'); }
  });
}

function renderActors(root: HTMLElement, s: { alice: Keypair; bob: Keypair }) {
  const el = $(root, '#s-actors');
  el.classList.remove('hidden');
  el.innerHTML = `
    <div class="actor buyer"><div class="role">Alice</div><div class="sub">holds token A</div><div class="addr">${addrLink(s.alice.publicKey.toBase58())}</div></div>
    <div class="actor seller"><div class="role">Bob</div><div class="sub">holds token B</div><div class="addr">${addrLink(s.bob.publicKey.toBase58())}</div></div>`;
}

async function refresh(root: HTMLElement, s: { alice: Keypair; bob: Keypair; mintA: PublicKey; mintB: PublicKey }) {
  const [aA, aB, bA, bB] = await Promise.all([
    balanceOf(s.mintA, s.alice.publicKey), balanceOf(s.mintB, s.alice.publicKey),
    balanceOf(s.mintA, s.bob.publicKey), balanceOf(s.mintB, s.bob.publicKey),
  ]);
  $(root, '#s-balances').innerHTML = `
    <div class="bal ${aB > 0n ? 'up' : ''}"><span>Alice · A / B</span><b>${fmt(aA)} / ${fmt(aB)}</b></div>
    <div class="bal ${bA > 0n ? 'up' : ''}"><span>Bob · A / B</span><b>${fmt(bA)} / ${fmt(bB)}</b></div>`;
}
