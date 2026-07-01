import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  getMint,
} from '@solana/spl-token';
import { sendBundleAndConfirm, withTip, type SendBundleOptions } from './jito.js';

/**
 * One side of an atomic swap. Omit `mint` for a native SOL leg.
 *
 * For an SPL leg, `decimals` is required by the pure builder; the
 * {@link AtomicSwapClient} fetches it from the mint if you don't supply it.
 */
export interface SwapLeg {
  owner: PublicKey;
  mint?: PublicKey;
  amount: bigint;
  decimals?: number;
}

export interface AtomicSwapParams {
  a: SwapLeg;
  b: SwapLeg;
  /** Fee payer / tipper. Defaults to `a.owner`. */
  feePayer?: PublicKey;
}

function ata(mint: PublicKey, owner: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, owner, true);
}

/**
 * Build the (unsigned) atomic swap transaction.
 *
 * Party A gives its asset to B and party B gives its asset to A **in one
 * transaction** — so either both legs execute or neither does. There is no
 * custody window and no arbiter: it is the trustless happy path for a
 * simultaneous on-chain trade. Both owners (and the fee payer, if different) are
 * required signers — neither party can take without giving.
 */
export function buildAtomicSwapTransaction(params: AtomicSwapParams, recentBlockhash: string): Transaction {
  const { a, b } = params;
  const feePayer = params.feePayer ?? a.owner;
  const tx = new Transaction();

  // Leg 1: A's asset → B.
  if (a.mint) {
    if (a.decimals === undefined) throw new Error('SPL leg a requires decimals');
    const dest = ata(a.mint, b.owner);
    tx.add(createAssociatedTokenAccountIdempotentInstruction(feePayer, dest, b.owner, a.mint));
    tx.add(createTransferCheckedInstruction(ata(a.mint, a.owner), a.mint, dest, a.owner, a.amount, a.decimals));
  } else {
    tx.add(SystemProgram.transfer({ fromPubkey: a.owner, toPubkey: b.owner, lamports: Number(a.amount) }));
  }

  // Leg 2: B's asset → A.
  if (b.mint) {
    if (b.decimals === undefined) throw new Error('SPL leg b requires decimals');
    const dest = ata(b.mint, a.owner);
    tx.add(createAssociatedTokenAccountIdempotentInstruction(feePayer, dest, a.owner, b.mint));
    tx.add(createTransferCheckedInstruction(ata(b.mint, b.owner), b.mint, dest, b.owner, b.amount, b.decimals));
  } else {
    tx.add(SystemProgram.transfer({ fromPubkey: b.owner, toPubkey: a.owner, lamports: Number(b.amount) }));
  }

  tx.feePayer = feePayer;
  tx.recentBlockhash = recentBlockhash;
  return tx;
}

export interface AtomicSwapResult {
  signature: string;
  viaBundle: boolean;
}

/** Executes atomic swaps against a cluster; optionally via a Jito bundle. */
export class AtomicSwapClient {
  private readonly connection: Connection;
  constructor(options: { connection: Connection }) {
    this.connection = options.connection;
  }

  private async resolveLeg(leg: SwapLeg): Promise<SwapLeg> {
    if (!leg.mint || leg.decimals !== undefined) return leg;
    const { decimals } = await getMint(this.connection, leg.mint);
    return { ...leg, decimals };
  }

  /**
   * Execute an atomic swap. `signers` must cover both owners (and the fee payer
   * if it is a third party).
   */
  async execute(
    params: AtomicSwapParams,
    signers: Keypair[],
    options: { viaBundle?: boolean; tipLamports?: number; bundle?: SendBundleOptions } = {},
  ): Promise<AtomicSwapResult> {
    const a = await this.resolveLeg(params.a);
    const b = await this.resolveLeg(params.b);
    const feePayer = params.feePayer ?? a.owner;
    const { blockhash } = await this.connection.getLatestBlockhash('confirmed');
    const tx = buildAtomicSwapTransaction({ a, b, feePayer }, blockhash);

    if (options.viaBundle) withTip(tx, feePayer, options.tipLamports);
    for (const s of signers) tx.partialSign(s);

    if (options.viaBundle) {
      const { bundleId } = await sendBundleAndConfirm([tx], options.bundle);
      return { signature: bundleId, viaBundle: true };
    }
    const signature = await this.connection.sendRawTransaction(tx.serialize());
    await this.confirm(signature);
    return { signature, viaBundle: false };
  }

  private async confirm(signature: string): Promise<void> {
    const deadline = Date.now() + 60_000;
    while (true) {
      const { value } = await this.connection.getSignatureStatuses([signature]);
      const s = value[0];
      if (s?.err) throw new Error(`swap ${signature} failed: ${JSON.stringify(s.err)}`);
      if (s && (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized')) return;
      if (Date.now() > deadline) throw new Error(`timed out confirming ${signature}`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}
