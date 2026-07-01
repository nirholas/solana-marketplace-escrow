import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';

export const RPC = import.meta.env.VITE_SOLANA_RPC ?? 'https://api.devnet.solana.com';
export const DECIMALS = 6;
export const connection = new Connection(RPC, 'confirmed');

export const short = (s: string) => (s ? `${s.slice(0, 4)}…${s.slice(-4)}` : '');
export const cluster = () =>
  RPC.includes('devnet') ? 'devnet' : RPC.includes('127.0.0.1') || RPC.includes('localhost') ? 'custom' : 'mainnet-beta';
export const addrLink = (a: string) =>
  `<a class="mono" target="_blank" rel="noreferrer" href="https://explorer.solana.com/address/${a}?cluster=${cluster()}">${short(a)}</a>`;
export const txLink = (s: string) => `https://explorer.solana.com/tx/${s}?cluster=${cluster()}`;
export const fmt = (atomics: bigint, decimals = DECIMALS) => (Number(atomics) / 10 ** decimals).toFixed(2);
export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export type LogKind = 'info' | 'ok' | 'warn' | 'err';
export function makeLogger(logEl: HTMLElement) {
  return (message: string, kind: LogKind = 'info') => {
    const d = document.createElement('div');
    d.className = `log-line ${kind}`;
    d.innerHTML = message;
    logEl.prepend(d);
  };
}

export function setBusy(btn: HTMLButtonElement, busy: boolean, label?: string) {
  btn.disabled = busy;
  if (label !== undefined) btn.textContent = label;
}

export const $ = <T extends HTMLElement>(root: ParentNode, sel: string) => root.querySelector(sel) as T;

/** Request a devnet/localnet airdrop and confirm it. */
export async function airdrop(to: PublicKey, sol: number): Promise<void> {
  const sig = await connection.requestAirdrop(to, sol * LAMPORTS_PER_SOL);
  const bh = await connection.getLatestBlockhash('confirmed');
  await connection.confirmTransaction({ signature: sig, ...bh }, 'confirmed');
}

/** Create a throwaway SPL mint and mint `amount` to `owner`. */
export async function makeMint(payer: Keypair, owner: PublicKey, amount: bigint): Promise<PublicKey> {
  const mint = await createMint(connection, payer, payer.publicKey, null, DECIMALS);
  const ata = await getOrCreateAssociatedTokenAccount(connection, payer, mint, owner);
  await mintTo(connection, payer, mint, ata.address, payer, amount);
  return mint;
}

/** Read a token balance (0 if the account doesn't exist). */
export async function balanceOf(mint: PublicKey, owner: PublicKey): Promise<bigint> {
  try {
    const ata = getAssociatedTokenAddressSync(mint, owner, true);
    return BigInt((await getAccount(connection, ata)).amount.toString());
  } catch {
    return 0n;
  }
}
