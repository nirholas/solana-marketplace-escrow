import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import bs58 from 'bs58';

/**
 * Jito Block Engine client — real bundle submission with tips and status.
 *
 * A Jito bundle delivers up to 5 fully-signed transactions to the leader
 * privately, executed sequentially, atomically, all-or-nothing, in one slot. To
 * be accepted it MUST include a **tip** to a Jito tip account (otherwise the
 * bundle is dropped) — this is the piece a naive `sendBundle` omits.
 *
 * What a bundle does / does NOT do:
 *  - DOES: atomic ordering + front-running protection (no searcher can interleave).
 *  - Does NOT change who must sign — every tx still carries its own signatures.
 *
 * We use bundles so a settlement or swap that spans multiple instructions/txs
 * lands indivisibly with no exploitable intermediate state.
 */

/** Public Jito Block Engine endpoints by region. */
export const JITO_BLOCK_ENGINES = {
  mainnet: 'https://mainnet.block-engine.jito.wtf',
  amsterdam: 'https://amsterdam.mainnet.block-engine.jito.wtf',
  frankfurt: 'https://frankfurt.mainnet.block-engine.jito.wtf',
  ny: 'https://ny.mainnet.block-engine.jito.wtf',
  tokyo: 'https://tokyo.mainnet.block-engine.jito.wtf',
} as const;

/** Jito mainnet tip accounts. Also fetchable at runtime via {@link getJitoTipAccounts}. */
export const JITO_TIP_ACCOUNTS = [
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
  'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
  'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
  'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
  'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
  'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
  '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
] as const;

/** Default bundle tip (0.0001 SOL). Raise it when the network is congested. */
export const DEFAULT_TIP_LAMPORTS = 100_000;

export interface JitoOptions {
  /** Block Engine base URL. Defaults to the global mainnet endpoint. */
  blockEngineUrl?: string;
  /** Optional fetch implementation (for runtime injection). */
  fetchImpl?: typeof fetch;
}

/** Pick a Jito tip account at random (spreads load; avoids a predictable target). */
export function randomTipAccount(): PublicKey {
  const b = new Uint8Array(1);
  globalThis.crypto.getRandomValues(b);
  return new PublicKey(JITO_TIP_ACCOUNTS[b[0]! % JITO_TIP_ACCOUNTS.length]!);
}

/** Build the tip transfer instruction that makes a bundle eligible to land. */
export function jitoTipInstruction(
  tipper: PublicKey,
  lamports: number = DEFAULT_TIP_LAMPORTS,
  tipAccount?: PublicKey,
): TransactionInstruction {
  return SystemProgram.transfer({
    fromPubkey: tipper,
    toPubkey: tipAccount ?? randomTipAccount(),
    lamports,
  });
}

async function rpc<T>(method: string, params: unknown[], options: JitoOptions): Promise<T> {
  const base = options.blockEngineUrl ?? JITO_BLOCK_ENGINES.mainnet;
  const doFetch = options.fetchImpl ?? fetch;
  const res = await doFetch(`${base}/api/v1/bundles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`Jito ${method} returned ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { result?: T; error?: { message: string } };
  if (body.error) throw new Error(`Jito ${method} error: ${body.error.message}`);
  if (body.result === undefined) throw new Error(`Jito ${method} returned no result`);
  return body.result;
}

/** Fetch the current tip accounts from the Block Engine. */
export function getJitoTipAccounts(options: JitoOptions = {}): Promise<string[]> {
  return rpc<string[]>('getTipAccounts', [], options);
}

export interface SendBundleOptions extends JitoOptions {}

/**
 * Submit fully-signed transactions as a single Jito bundle.
 *
 * At least one transaction in the bundle must contain a tip (see
 * {@link jitoTipInstruction}); otherwise the Block Engine drops it.
 *
 * @returns the bundle id assigned by the Block Engine.
 */
export async function sendJitoBundle(
  transactions: Transaction[],
  options: SendBundleOptions = {},
): Promise<string> {
  if (transactions.length === 0) throw new Error('cannot send an empty bundle');
  if (transactions.length > 5) throw new Error('a Jito bundle holds at most 5 transactions');
  const encoded = transactions.map((tx) =>
    bs58.encode(tx.serialize({ requireAllSignatures: true, verifySignatures: true })),
  );
  return rpc<string>('sendBundle', [encoded], options);
}

export interface BundleStatus {
  bundle_id: string;
  /** e.g. "Landed", "Pending", "Failed", "Invalid". */
  status: string;
  landed_slot: number | null;
}

/** Query the status of one or more bundles. */
export async function getBundleStatuses(
  bundleIds: string[],
  options: JitoOptions = {},
): Promise<BundleStatus[]> {
  const result = await rpc<{ value: BundleStatus[] }>('getBundleStatuses', [bundleIds], options);
  return result.value ?? [];
}

/**
 * Send a bundle and poll until it lands (or times out). Requires a live Block
 * Engine (mainnet); the `connection` is used only for slot-timeout pacing.
 */
export async function sendBundleAndConfirm(
  transactions: Transaction[],
  options: SendBundleOptions & { timeoutMs?: number } = {},
): Promise<{ bundleId: string; landedSlot: number | null }> {
  const bundleId = await sendJitoBundle(transactions, options);
  const deadline = Date.now() + (options.timeoutMs ?? 30_000);
  while (Date.now() < deadline) {
    const [status] = await getBundleStatuses([bundleId], options);
    if (status?.status === 'Landed') return { bundleId, landedSlot: status.landed_slot };
    if (status?.status === 'Failed' || status?.status === 'Invalid') {
      throw new Error(`Jito bundle ${bundleId} ${status.status}`);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`Jito bundle ${bundleId} not confirmed within timeout`);
}

/** Convenience: append a tip to `tipper` on the given tx (do this before signing). */
export function withTip(
  tx: Transaction,
  tipper: PublicKey,
  lamports: number = DEFAULT_TIP_LAMPORTS,
  tipAccount?: PublicKey,
): Transaction {
  tx.add(jitoTipInstruction(tipper, lamports, tipAccount));
  return tx;
}

// Kept for callers that only need the connection type re-exported.
export type { Connection };
