import {
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import type { Outcome, Parties } from './types.js';

/**
 * The canonical safe authorization model.
 *
 * Four outcomes, and only four, can ever happen to the funds:
 *
 *   release:by-buyer    buyer  pushes funds → seller   (happy path: buyer confirms delivery)
 *   release:by-arbiter  arbiter pushes funds → seller  (dispute resolved for the seller)
 *   refund:by-seller    seller pushes funds → buyer    (happy path: seller cancels / no-fault)
 *   refund:by-arbiter   arbiter pushes funds → buyer   (dispute resolved for the buyer)
 *
 * The asymmetry is the whole point:
 *  - The buyer can ONLY ever push funds toward the SELLER. They can never refund themselves.
 *  - The seller can ONLY ever push funds toward the BUYER. They can never pay themselves.
 *  - The arbiter can pick either party, but the destination of each outcome is FIXED —
 *    they can never redirect funds to a third address, including their own.
 *
 * No outcome lets any single party move the escrow to an address they choose at
 * settlement time. That property is what makes a moderator unable to steal.
 */
export function standardOutcomes(parties: Parties): Outcome[] {
  return [
    {
      id: 'release:by-buyer',
      kind: 'release',
      destinationOwner: parties.seller,
      authorizer: 'buyer',
      description: 'Buyer confirms delivery and releases the escrow to the seller.',
    },
    {
      id: 'release:by-arbiter',
      kind: 'release',
      destinationOwner: parties.seller,
      authorizer: 'arbiter',
      description: 'Arbiter resolves the dispute in favor of the seller.',
    },
    {
      id: 'refund:by-seller',
      kind: 'refund',
      destinationOwner: parties.buyer,
      authorizer: 'seller',
      description: 'Seller cancels and returns the escrow to the buyer.',
    },
    {
      id: 'refund:by-arbiter',
      kind: 'refund',
      destinationOwner: parties.buyer,
      authorizer: 'arbiter',
      description: 'Arbiter resolves the dispute in favor of the buyer.',
    },
  ];
}

/** Inputs to deterministically build one outcome transaction (pure, no RPC). */
export interface BuildOutcomeArgs {
  /** The ephemeral vault that owns the escrowed token account. */
  vault: PublicKey;
  /** Durable nonce account that anchors this transaction's lifetime. */
  nonceAccount: PublicKey;
  /** Durable nonce value (a base58 blockhash) read from the nonce account. */
  nonceValue: string;
  mint: PublicKey;
  decimals: number;
  amount: bigint;
  /** Wallet that receives the escrowed funds for this outcome. */
  destinationOwner: PublicKey;
  /** Party pubkey that must sign to settle; also the fee payer. */
  authorizer: PublicKey;
  /** Where the vault token-account rent is returned when it is closed (the buyer). */
  rentReclaimTo: PublicKey;
}

/**
 * Build the (unsigned) transaction for a single outcome.
 *
 * Instruction order is load-bearing:
 *   0. nonceAdvance       — REQUIRED first instruction of any durable-nonce tx.
 *                           Settling any outcome advances the nonce, which
 *                           atomically invalidates every other prepared outcome
 *                           (mutual exclusivity / no double-settle).
 *   1. createAtaIdempotent — ensure the destination token account exists.
 *   2. transferChecked    — move the entire escrow to the FIXED destination.
 *   3. closeAccount       — close the empty vault ATA, returning rent to the buyer.
 *
 * Required signers of the returned tx are exactly {vault, authorizer}. The vault
 * signature is applied at preparation time and then the vault key is destroyed;
 * the authorizer signature is applied at settlement time. Because the message
 * (fee payer + destinations + amount) is fixed before the vault signs, the
 * authorizer cannot alter where the money goes without invalidating the vault
 * signature.
 */
export function buildOutcomeTransaction(args: BuildOutcomeArgs): Transaction {
  const vaultAta = getAssociatedTokenAddressSync(args.mint, args.vault, true);
  const destinationAta = getAssociatedTokenAddressSync(args.mint, args.destinationOwner, true);

  const tx = new Transaction();
  tx.add(
    SystemProgram.nonceAdvance({
      noncePubkey: args.nonceAccount,
      authorizedPubkey: args.vault,
    }),
  );
  tx.add(
    createAssociatedTokenAccountIdempotentInstruction(
      args.authorizer,
      destinationAta,
      args.destinationOwner,
      args.mint,
    ),
  );
  tx.add(
    createTransferCheckedInstruction(
      vaultAta,
      args.mint,
      destinationAta,
      args.vault,
      args.amount,
      args.decimals,
    ),
  );
  tx.add(createCloseAccountInstruction(vaultAta, args.rentReclaimTo, args.vault));

  tx.feePayer = args.authorizer;
  tx.recentBlockhash = args.nonceValue;
  return tx;
}

/** Derive the associated token account for an owner + mint (allows off-curve owners). */
export function ataFor(mint: PublicKey, owner: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, owner, true);
}
