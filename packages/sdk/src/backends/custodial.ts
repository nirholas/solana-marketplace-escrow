import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  getMint,
} from '@solana/spl-token';
import bs58 from 'bs58';
import { jitoTipInstruction, sendBundleAndConfirm, type SendBundleOptions } from '../jito.js';

/**
 * The `nirholas/atomic`-style backend: a **master** wallet holds SOL and the
 * platform holds each escrow wallet's key. A moderator triggers a release from
 * the UI and the backend fires **one atomic transaction** in which the master
 * pays the fee (+ Jito tip) and the escrow key signs the token transfer — the
 * master acting *on behalf of* the escrow wallet. The moderator holds no keys.
 *
 * Trust model: custodial at the PLATFORM level. The backend holds the escrow
 * key, so the platform is trusted (moderators are not, and never hold a key).
 * For a trust-free vault use the `program` / `presign` backends instead.
 */
export interface CustodialEscrow {
  backend: 'custodial';
  /** Escrow wallet public key (platform-held). */
  escrow: string;
  /** Base58 secret key of the escrow wallet — STORE THIS SERVER-SIDE ONLY. */
  escrowSecret: string;
  buyer: string;
  seller: string;
  mint: string;
  amount: string;
}

const ata = (mint: PublicKey, owner: PublicKey) => getAssociatedTokenAddressSync(mint, owner, true);

/** Inputs to build a master-funded, escrow-signed settlement (pure, RPC-free). */
export interface CustodialSettleArgs {
  master: PublicKey;
  escrow: PublicKey;
  mint: PublicKey;
  decimals: number;
  amount: bigint;
  destination: PublicKey;
  tipLamports?: number;
}

/**
 * Build the atomic settlement transaction: master is fee payer (+ optional Jito
 * tip), escrow is the transfer authority. Required signers are exactly
 * {master, escrow} — both platform-held; the moderator is not a signer.
 */
export function buildCustodialSettle(args: CustodialSettleArgs): Transaction {
  const escrowAta = ata(args.mint, args.escrow);
  const destAta = ata(args.mint, args.destination);
  const tx = new Transaction();
  // master pays the destination ATA rent
  tx.add(createAssociatedTokenAccountIdempotentInstruction(args.master, destAta, args.destination, args.mint));
  // escrow signs the release of its tokens
  tx.add(createTransferCheckedInstruction(escrowAta, args.mint, destAta, args.escrow, args.amount, args.decimals));
  // close the escrow ATA, returning rent to the master
  tx.add(createCloseAccountInstruction(escrowAta, args.master, args.escrow));
  if (args.tipLamports !== undefined) tx.add(jitoTipInstruction(args.master, args.tipLamports));
  tx.feePayer = args.master;
  return tx;
}

export class CustodialBackend {
  readonly backend = 'custodial' as const;
  private readonly connection: Connection;
  private readonly master: Keypair;

  constructor(options: { connection: Connection; master: Keypair }) {
    this.connection = options.connection;
    this.master = options.master;
  }

  /** Master wallet address (fund it with SOL for fees + tips). */
  get masterAddress(): PublicKey {
    return this.master.publicKey;
  }

  /**
   * Open a custodial escrow: mint a fresh escrow wallet (platform-held) and let
   * the buyer deposit the tokens into it. Returns a record whose `escrowSecret`
   * the platform must store server-side.
   */
  async open(
    funder: Keypair,
    params: { seller: PublicKey; mint: PublicKey; amount: bigint },
  ): Promise<CustodialEscrow> {
    if (params.amount <= 0n) throw new Error('amount must be positive');
    const escrow = Keypair.generate();
    const { decimals } = await getMint(this.connection, params.mint);
    const escrowAta = ata(params.mint, escrow.publicKey);
    const funderAta = ata(params.mint, funder.publicKey);

    const tx = new Transaction()
      .add(createAssociatedTokenAccountIdempotentInstruction(funder.publicKey, escrowAta, escrow.publicKey, params.mint))
      .add(createTransferCheckedInstruction(funderAta, params.mint, escrowAta, funder.publicKey, params.amount, decimals));
    tx.feePayer = funder.publicKey;
    await sendAndConfirmTransaction(this.connection, tx, [funder], { commitment: 'confirmed' });

    return {
      backend: 'custodial',
      escrow: escrow.publicKey.toBase58(),
      escrowSecret: bs58.encode(escrow.secretKey),
      buyer: funder.publicKey.toBase58(),
      seller: params.seller.toBase58(),
      mint: params.mint.toBase58(),
      amount: params.amount.toString(),
    };
  }

  /** Release to the seller (`release`) or return to the buyer (`refund`). */
  async settle(
    record: CustodialEscrow,
    kind: 'release' | 'refund',
    options: { viaBundle?: boolean; tipLamports?: number; bundle?: SendBundleOptions } = {},
  ): Promise<{ kind: string; signature: string; viaBundle: boolean }> {
    const escrow = Keypair.fromSecretKey(bs58.decode(record.escrowSecret));
    const mint = new PublicKey(record.mint);
    const destination = new PublicKey(kind === 'release' ? record.seller : record.buyer);
    const { decimals } = await getMint(this.connection, mint);

    // Drain the full live balance so a donation can't block the close.
    const balInfo = await this.connection.getTokenAccountBalance(ata(mint, escrow.publicKey));
    const amount = BigInt(balInfo.value.amount);

    const tx = buildCustodialSettle({
      master: this.master.publicKey,
      escrow: escrow.publicKey,
      mint,
      decimals,
      amount,
      destination,
      tipLamports: options.viaBundle ? (options.tipLamports ?? undefined) : undefined,
    });

    if (options.viaBundle) {
      tx.recentBlockhash = (await this.connection.getLatestBlockhash('confirmed')).blockhash;
      tx.sign(this.master, escrow);
      const { bundleId } = await sendBundleAndConfirm([tx], options.bundle);
      return { kind, signature: bundleId, viaBundle: true };
    }
    const signature = await sendAndConfirmTransaction(this.connection, tx, [this.master, escrow], {
      commitment: 'confirmed',
    });
    return { kind, signature, viaBundle: false };
  }
}
