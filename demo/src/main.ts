import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
} from '@solana/spl-token';
import bs58 from 'bs58';
import { PresignBackend, type KeylessEscrow, type Party } from 'keyless-escrow';
import './style.css';

const RPC = import.meta.env.VITE_SOLANA_RPC ?? 'https://api.devnet.solana.com';
const DECIMALS = 6;
const AMOUNT = 1_000_000n; // 1.0 token

const connection = new Connection(RPC, 'confirmed');
const svc = new PresignBackend({ connection });

interface Scenario {
  buyer: Keypair;
  seller: Keypair;
  arbiter: Keypair;
  mint: PublicKey;
}
let scenario: Scenario | null = null;
let escrow: KeylessEscrow | null = null;
const keypairs = () => ({
  buyer: scenario!.buyer,
  seller: scenario!.seller,
  arbiter: scenario!.arbiter,
});

/* ---------- tiny DOM helpers ---------- */
const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const short = (s: string) => `${s.slice(0, 4)}…${s.slice(-4)}`;
const addrLink = (a: string) =>
  `<a href="https://explorer.solana.com/address/${a}?cluster=devnet" target="_blank" rel="noreferrer">${short(a)}</a>`;
const txLink = (s: string) =>
  `https://explorer.solana.com/tx/${s}?cluster=devnet`;

function log(message: string, kind: 'info' | 'ok' | 'warn' | 'err' = 'info') {
  const el = document.createElement('div');
  el.className = `log-line ${kind}`;
  el.innerHTML = message;
  $('#log').prepend(el);
}

function setBusy(btn: HTMLButtonElement, busy: boolean, label?: string) {
  btn.disabled = busy;
  if (label) btn.textContent = label;
}

/* ---------- step 1: setup ---------- */
async function airdrop(to: PublicKey, sol: number) {
  const sig = await connection.requestAirdrop(to, sol * LAMPORTS_PER_SOL);
  const bh = await connection.getLatestBlockhash('confirmed');
  await connection.confirmTransaction({ signature: sig, ...bh }, 'confirmed');
}

async function runSetup() {
  const btn = $('#setup-btn') as HTMLButtonElement;
  setBusy(btn, true, 'Working…');
  try {
    const secret = ($('#buyer-secret') as HTMLInputElement).value.trim();
    const buyer = secret ? Keypair.fromSecretKey(bs58.decode(secret)) : Keypair.generate();
    const seller = Keypair.generate();
    const arbiter = Keypair.generate();

    log(`Generated wallets. Buyer ${addrLink(buyer.publicKey.toBase58())}.`);

    if (!secret) {
      log('Requesting devnet airdrop for buyer + arbiter…');
      try {
        await airdrop(buyer.publicKey, 2);
        await airdrop(arbiter.publicKey, 1);
        log('Airdrop confirmed.', 'ok');
      } catch {
        log(
          'Airdrop was rate-limited. Fund the buyer from ' +
            '<a href="https://faucet.solana.com" target="_blank" rel="noreferrer">faucet.solana.com</a> ' +
            'and re-run, or paste a funded buyer secret above.',
          'warn',
        );
      }
    } else {
      log('Using your funded buyer key; airdropping arbiter for fees…');
      try { await airdrop(arbiter.publicKey, 1); } catch { /* arbiter fee handled below */ }
    }

    log('Creating a throwaway SPL mint + minting 1.0 to the buyer…');
    const mint = await createMint(connection, buyer, buyer.publicKey, null, DECIMALS);
    const buyerAta = await getOrCreateAssociatedTokenAccount(connection, buyer, mint, buyer.publicKey);
    await mintTo(connection, buyer, mint, buyerAta.address, buyer, AMOUNT);
    log(`Mint ready: ${addrLink(mint.toBase58())}`, 'ok');

    scenario = { buyer, seller, arbiter, mint };
    renderParties();
    $('#escrow-panel').classList.remove('hidden');
    $('#escrow-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (err) {
    log(`Setup failed: ${errMsg(err)}`, 'err');
  } finally {
    setBusy(btn, false, 'Run setup');
  }
}

function renderParties() {
  const { buyer, seller, arbiter } = scenario!;
  const p = $('#parties');
  p.classList.remove('hidden');
  const rows: Array<[string, string, string, string]> = [
    ['Buyer', 'funds the escrow', buyer.publicKey.toBase58(), 'buyer'],
    ['Seller', 'is paid on success', seller.publicKey.toBase58(), 'seller'],
    ['Arbiter', 'the moderator', arbiter.publicKey.toBase58(), 'arbiter'],
  ];
  p.innerHTML = rows
    .map(
      ([role, sub, addr, cls]) => `
      <div class="party ${cls}">
        <div class="party-role">${role}</div>
        <div class="party-sub">${sub}</div>
        <div class="party-addr">${addrLink(addr)}</div>
      </div>`,
    )
    .join('');
}

/* ---------- step 2: open escrow ---------- */
async function openEscrow() {
  const btn = $('#open-btn') as HTMLButtonElement;
  setBusy(btn, true, 'Opening…');
  try {
    const { buyer, seller, arbiter, mint } = scenario!;
    log('Depositing, pre-signing four fixed-destination outcomes, destroying the vault key…');
    escrow = await svc.open(buyer, {
      parties: { buyer: buyer.publicKey, seller: seller.publicKey, arbiter: arbiter.publicKey },
      mint,
      amount: AMOUNT,
    });
    log(
      `Escrow open. Vault ${addrLink(escrow.vault.toBase58())} — <strong>key destroyed</strong>.`,
      'ok',
    );
    renderVault();
    renderOutcomes();
    $('#outcomes-panel').classList.remove('hidden');
    await refreshBalances();
    $('#outcomes-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (err) {
    log(`Open failed: ${errMsg(err)}`, 'err');
  } finally {
    setBusy(btn, false, 'Open & fund escrow');
  }
}

function renderVault() {
  const v = $('#vault');
  v.classList.remove('hidden');
  v.innerHTML = `
    <div class="vault-card">
      <div class="vault-key">🔒<span>no private key</span></div>
      <div>
        <div class="vault-title">Vault ${addrLink(escrow!.vault.toBase58())}</div>
        <div class="vault-sub">Holds 1.0 token. The only transactions that can ever move it are the four below.</div>
      </div>
      <div class="vault-flag">key destroyed ✓</div>
    </div>`;
}

/* ---------- step 3: outcomes ---------- */
const PARTY_LABEL: Record<Party, string> = { buyer: 'Buyer', seller: 'Seller', arbiter: 'Arbiter' };

function renderOutcomes() {
  const wrap = $('#outcomes');
  wrap.innerHTML = escrow!.outcomes
    .map((o) => {
      const paysSeller = o.kind === 'release';
      return `
      <div class="outcome ${o.authorizer}" data-id="${o.id}">
        <div class="outcome-head">
          <code>${o.id}</code>
          <span class="pill ${paysSeller ? 'to-seller' : 'to-buyer'}">pays ${paysSeller ? 'seller' : 'buyer'}</span>
        </div>
        <div class="outcome-desc">${o.description}</div>
        <div class="outcome-foot">
          <span>authorized by <strong>${PARTY_LABEL[o.authorizer as Party]}</strong></span>
          <button class="settle" data-id="${o.id}">Settle as ${PARTY_LABEL[o.authorizer as Party]}</button>
        </div>
      </div>`;
    })
    .join('');

  wrap.querySelectorAll<HTMLButtonElement>('button.settle').forEach((b) =>
    b.addEventListener('click', () => settle(b.dataset.id!, b)),
  );
}

async function settle(outcomeId: string, btn: HTMLButtonElement) {
  setBusy(btn, true, 'Settling…');
  try {
    const outcome = escrow!.outcomes.find((o) => o.id === outcomeId)!;
    const authorizer = keypairs()[outcome.authorizer as Party];
    log(`${PARTY_LABEL[outcome.authorizer as Party]} settling <code>${outcomeId}</code>…`);
    const result = await svc.settle(escrow!, outcomeId, authorizer);
    log(
      `Settled — <a href="${txLink(result.signature)}" target="_blank" rel="noreferrer">${short(result.signature)}</a>. ` +
        `Funds went to the fixed ${outcome.kind === 'release' ? 'seller' : 'buyer'}, not to whoever signed.`,
      'ok',
    );
    // Escrow is now spent — settling any other outcome will fail (nonce advanced).
    $('#outcomes').querySelectorAll<HTMLButtonElement>('button.settle').forEach((b) => (b.disabled = true));
    $('#outcomes').querySelector(`.outcome[data-id="${outcomeId}"]`)?.classList.add('settled');
    await refreshBalances();
  } catch (err) {
    log(`Settle failed: ${errMsg(err)}`, 'err');
    setBusy(btn, false, `Settle`);
  }
}

async function refreshBalances() {
  if (!scenario || !escrow) return;
  const { buyer, seller, mint } = scenario;
  const read = async (owner: PublicKey) => {
    try {
      const ata = await getOrCreateAssociatedTokenAccount(connection, buyer, mint, owner);
      return (await getAccount(connection, ata.address)).amount;
    } catch {
      return 0n;
    }
  };
  const [buyerBal, sellerBal] = await Promise.all([read(buyer.publicKey), read(seller.publicKey)]);
  const status = await svc.status(escrow).catch(() => null);
  $('#balances').innerHTML = `
    <div class="bal"><span>Buyer</span><b>${fmt(buyerBal)}</b></div>
    <div class="bal"><span>Seller</span><b>${fmt(sellerBal)}</b></div>
    <div class="bal"><span>Vault</span><b>${status ? fmt(status.balance) : '—'}${status?.settled ? ' · settled' : ''}</b></div>`;
}

/* ---------- utils ---------- */
const fmt = (atomics: bigint) => (Number(atomics) / 10 ** DECIMALS).toFixed(2);
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/* ---------- wire up ---------- */
$('#setup-btn').addEventListener('click', runSetup);
$('#open-btn').addEventListener('click', openEscrow);
$('#status-btn').addEventListener('click', () => refreshBalances());
log(`Connected to ${RPC}. Run a scenario to begin.`);
