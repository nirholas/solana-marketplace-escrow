import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  type AccountMeta,
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import type { CreateEscrowParams, Outcome, Parties, Party } from '../types.js';
import { standardOutcomes } from '../outcomes.js';
import { jitoTipInstruction, sendBundleAndConfirm, type SendBundleOptions } from '../jito.js';

/**
 * Anchor instruction discriminators — the first 8 bytes of
 * `sha256("global:<name>")`. Hardcoded so this module stays browser-safe (no
 * `node:crypto`). Verified against the on-chain program.
 */
export const DISCRIMINATOR = {
  initialize: Uint8Array.from([175, 175, 109, 31, 13, 152, 155, 237]),
  release: Uint8Array.from([253, 249, 15, 206, 28, 127, 193, 241]),
  refund: Uint8Array.from([2, 96, 183, 251, 63, 208, 46, 46]),
} as const;

/** Default on-chain program id. Override via `ProgramBackendOptions.programId`. */
export const DEFAULT_PROGRAM_ID = 'E8SpoXKxgfKA8m2YVnsNSUHW5boBtK9RjWKaWKYDCkda';

function u64le(n: bigint): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, n, true);
  return b;
}

function randomSeed(): bigint {
  const b = new Uint8Array(8);
  globalThis.crypto.getRandomValues(b);
  return new DataView(b.buffer).getBigUint64(0, true);
}

function concatBytes(...parts: Uint8Array[]): Buffer {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return Buffer.from(out);
}

const ro = (pubkey: PublicKey, isSigner = false): AccountMeta => ({ pubkey, isSigner, isWritable: false });
const rw = (pubkey: PublicKey, isSigner = false): AccountMeta => ({ pubkey, isSigner, isWritable: true });

/** A live handle to an on-chain (PDA-backed) keyless escrow. */
export interface ProgramEscrow {
  backend: 'program';
  programId: PublicKey;
  /** Escrow state PDA (also the vault authority — provably keyless). */
  escrow: PublicKey;
  /** Vault token account, owned by the escrow PDA. */
  vault: PublicKey;
  parties: Parties;
  mint: PublicKey;
  amount: bigint;
  seed: bigint;
  outcomes: Outcome[];
}

export interface ProgramBackendOptions {
  connection: Connection;
  programId?: PublicKey | string;
  /** SPL Token program (default) or Token-2022. */
  tokenProgramId?: PublicKey;
}

/**
 * The production backend: funds live in a PDA-owned vault of an on-chain escrow
 * program. The vault is keyless **by construction** — a Program Derived Address
 * has no private key in existence — and the program hard-codes each outcome's
 * destination, so the arbiter can release but can never redirect funds.
 *
 * The instruction builders (`initializeInstruction`, `settleInstruction`) are
 * pure and RPC-free — they are what the offline tests exercise.
 */
export class ProgramBackend {
  readonly backend = 'program' as const;
  private readonly connection: Connection;
  readonly programId: PublicKey;
  readonly tokenProgramId: PublicKey;

  constructor(options: ProgramBackendOptions) {
    this.connection = options.connection;
    this.programId = new PublicKey(options.programId ?? DEFAULT_PROGRAM_ID);
    this.tokenProgramId = options.tokenProgramId ?? TOKEN_PROGRAM_ID;
  }

  /** Derive the escrow state PDA for a buyer + seed. */
  escrowPda(buyer: PublicKey, seed: bigint): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('escrow'), buyer.toBuffer(), u64le(seed)],
      this.programId,
    )[0];
  }

  private ata(mint: PublicKey, owner: PublicKey): PublicKey {
    return getAssociatedTokenAddressSync(mint, owner, true, this.tokenProgramId);
  }

  /** Build the `initialize` instruction and the addresses it creates (pure). */
  initializeInstruction(
    buyer: PublicKey,
    params: CreateEscrowParams,
    seed: bigint,
  ): { instruction: TransactionInstruction; escrow: PublicKey; vault: PublicKey } {
    const escrow = this.escrowPda(buyer, seed);
    const vault = this.ata(params.mint, escrow);
    const buyerAta = this.ata(params.mint, buyer);
    const keys: AccountMeta[] = [
      rw(buyer, true),
      ro(params.parties.seller),
      ro(params.parties.arbiter),
      ro(params.mint),
      rw(escrow),
      rw(vault),
      rw(buyerAta),
      ro(this.tokenProgramId),
      ro(ASSOCIATED_TOKEN_PROGRAM_ID),
      ro(SystemProgram.programId),
    ];
    const data = concatBytes(DISCRIMINATOR.initialize, u64le(seed), u64le(params.amount));
    return {
      instruction: new TransactionInstruction({ programId: this.programId, keys, data }),
      escrow,
      vault,
    };
  }

  /** Build a `release`/`refund` instruction for one outcome (pure). */
  settleInstruction(
    escrow: ProgramEscrow,
    outcomeId: string,
    authorizer: PublicKey,
  ): TransactionInstruction {
    const outcome = escrow.outcomes.find((o) => o.id === outcomeId);
    if (!outcome) throw new Error(`unknown outcome '${outcomeId}'`);
    const expected = escrow.parties[outcome.authorizer as Party];
    if (!authorizer.equals(expected)) {
      throw new Error(
        `outcome '${outcomeId}' must be authorized by the ${outcome.authorizer} (${expected.toBase58()})`,
      );
    }
    const isRelease = outcome.kind === 'release';
    const destinationOwner = isRelease ? escrow.parties.seller : escrow.parties.buyer;
    const keys: AccountMeta[] = [
      rw(authorizer, true),
      rw(escrow.escrow),
      rw(escrow.vault),
      ro(escrow.mint),
      ro(destinationOwner),
      rw(this.ata(escrow.mint, destinationOwner)),
      rw(escrow.parties.buyer), // rent recipient
      ro(this.tokenProgramId),
      ro(ASSOCIATED_TOKEN_PROGRAM_ID),
      ro(SystemProgram.programId),
    ];
    const data = Buffer.from(isRelease ? DISCRIMINATOR.release : DISCRIMINATOR.refund);
    return new TransactionInstruction({ programId: this.programId, keys, data });
  }

  /** Open and fund an on-chain keyless escrow. */
  async open(
    buyer: Keypair,
    params: CreateEscrowParams,
    options: { seed?: bigint } = {},
  ): Promise<ProgramEscrow> {
    if (!buyer.publicKey.equals(params.parties.buyer)) throw new Error('funder must be the buyer');
    if (params.amount <= 0n) throw new Error('escrow amount must be positive');

    const seed = options.seed ?? randomSeed();
    const { instruction, escrow, vault } = this.initializeInstruction(buyer.publicKey, params, seed);
    await sendAndConfirmTransaction(this.connection, new Transaction().add(instruction), [buyer], {
      commitment: 'confirmed',
    });

    return {
      backend: 'program',
      programId: this.programId,
      escrow,
      vault,
      parties: params.parties,
      mint: params.mint,
      amount: params.amount,
      seed,
      outcomes: standardOutcomes(params.parties),
    };
  }

  /**
   * Settle one outcome on-chain (the program also enforces the authorizer).
   * Optionally delivered atomically via a Jito bundle (tip embedded in the tx).
   */
  async settle(
    escrow: ProgramEscrow,
    outcomeId: string,
    authorizer: Keypair,
    options: { viaBundle?: boolean; tipLamports?: number; bundle?: SendBundleOptions } = {},
  ): Promise<{ outcomeId: string; signature: string; viaBundle: boolean }> {
    const instruction = this.settleInstruction(escrow, outcomeId, authorizer.publicKey);
    const tx = new Transaction().add(instruction);

    if (options.viaBundle) {
      tx.add(jitoTipInstruction(authorizer.publicKey, options.tipLamports));
      tx.feePayer = authorizer.publicKey;
      tx.recentBlockhash = (await this.connection.getLatestBlockhash('confirmed')).blockhash;
      tx.sign(authorizer);
      const { bundleId } = await sendBundleAndConfirm([tx], options.bundle);
      return { outcomeId, signature: bundleId, viaBundle: true };
    }

    const signature = await sendAndConfirmTransaction(this.connection, tx, [authorizer], {
      commitment: 'confirmed',
    });
    return { outcomeId, signature, viaBundle: false };
  }

  /** Read the on-chain escrow state. */
  async status(escrow: ProgramEscrow): Promise<{
    active: boolean;
    released: boolean;
    refunded: boolean;
    amount: bigint;
  }> {
    const info = await this.connection.getAccountInfo(escrow.escrow, 'confirmed');
    if (!info) throw new Error('escrow account not found (never opened or already closed)');
    // layout: 8 disc + 4×32 pubkeys + amount(8) + seed(8) + bump(1) + state(1)
    const amount = info.data.readBigUInt64LE(136);
    const state = info.data.readUInt8(153);
    return { active: state === 0, released: state === 1, refunded: state === 2, amount };
  }
}
