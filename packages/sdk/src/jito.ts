import { Transaction } from '@solana/web3.js';
import bs58 from 'bs58';

/**
 * Minimal Jito Block Engine client.
 *
 * A Jito bundle delivers a list of fully-signed transactions to the leader
 * privately, executed sequentially, atomically, all-or-nothing, in one slot.
 *
 * IMPORTANT — what a bundle does and does NOT do:
 *  - It DOES guarantee ordering, atomicity, and front-running protection.
 *  - It does NOT change who must sign. Every transaction in the bundle must
 *    already carry all required signatures. The bundle is the delivery van; the
 *    escrow's authorization rules (the keyless vault + fixed-destination
 *    outcomes) are the vault and the lock.
 *
 * We use bundles here so a settlement that spans multiple instructions/txs
 * (e.g. release + protocol fee + account close, or a cross-program step) lands
 * indivisibly with no exploitable intermediate state and no searcher able to
 * interleave a transaction between the legs.
 */

/** Public Jito Block Engine endpoints by region. */
export const JITO_BLOCK_ENGINES = {
  mainnet: 'https://mainnet.block-engine.jito.wtf',
  amsterdam: 'https://amsterdam.mainnet.block-engine.jito.wtf',
  frankfurt: 'https://frankfurt.mainnet.block-engine.jito.wtf',
  ny: 'https://ny.mainnet.block-engine.jito.wtf',
  tokyo: 'https://tokyo.mainnet.block-engine.jito.wtf',
} as const;

export interface SendBundleOptions {
  /** Block Engine base URL. Defaults to the global mainnet endpoint. */
  blockEngineUrl?: string;
  /** Optional fetch implementation (for non-browser/runtime injection). */
  fetchImpl?: typeof fetch;
}

/**
 * Submit fully-signed transactions as a single Jito bundle.
 *
 * @param transactions up to 5 fully-signed transactions, executed in order.
 * @returns the bundle id assigned by the Block Engine.
 */
export async function sendJitoBundle(
  transactions: Transaction[],
  options: SendBundleOptions = {},
): Promise<string> {
  if (transactions.length === 0) throw new Error('cannot send an empty bundle');
  if (transactions.length > 5) throw new Error('a Jito bundle holds at most 5 transactions');

  const base = options.blockEngineUrl ?? JITO_BLOCK_ENGINES.mainnet;
  const doFetch = options.fetchImpl ?? fetch;

  const encoded = transactions.map((tx) =>
    bs58.encode(tx.serialize({ requireAllSignatures: true, verifySignatures: true })),
  );

  const res = await doFetch(`${base}/api/v1/bundles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'sendBundle',
      params: [encoded],
    }),
  });

  if (!res.ok) {
    throw new Error(`Jito block engine returned ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as { result?: string; error?: { message: string } };
  if (body.error) throw new Error(`Jito sendBundle error: ${body.error.message}`);
  if (!body.result) throw new Error('Jito sendBundle returned no bundle id');
  return body.result;
}
