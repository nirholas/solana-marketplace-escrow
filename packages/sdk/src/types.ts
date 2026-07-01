import type { PublicKey, Transaction } from '@solana/web3.js';

/**
 * The three roles in an escrow agreement.
 *
 * - `buyer`   — funds the escrow (a.k.a. the maker / depositor / payer).
 * - `seller`  — delivers the good/service and is paid on success (the beneficiary).
 * - `arbiter` — the neutral moderator who resolves disputes. Critically, the
 *               arbiter can only *select* a pre-authorized outcome; they can
 *               never redirect funds to a third address.
 */
export type Party = 'buyer' | 'seller' | 'arbiter';

/** Whether an outcome pays the seller (`release`) or returns funds to the buyer (`refund`). */
export type OutcomeKind = 'release' | 'refund';

/**
 * A single pre-authorized terminal state of an escrow.
 *
 * Every outcome has a FIXED destination (chosen by the buyer at funding time)
 * and a SINGLE authorizer (the party whose signature is required to settle it).
 * The set of outcomes defines the complete universe of things that can ever
 * happen to the escrowed funds — nothing outside this set is possible.
 */
export interface Outcome {
  /** Stable identifier, e.g. `release:by-buyer` or `refund:by-arbiter`. */
  id: string;
  kind: OutcomeKind;
  /** The wallet that receives the funds when this outcome settles. */
  destinationOwner: PublicKey;
  /** The party whose signature is required to settle this outcome. */
  authorizer: Party;
  /** Human-readable description of when this outcome applies. */
  description: string;
}

/** Public-key identities of the parties to an escrow. */
export interface Parties {
  buyer: PublicKey;
  seller: PublicKey;
  arbiter: PublicKey;
}

/** Parameters for creating a new escrow agreement. */
export interface CreateEscrowParams {
  parties: Parties;
  /** SPL token mint being escrowed (supplied at runtime; the protocol is coin-agnostic). */
  mint: PublicKey;
  /** Amount in the mint's base units (atomics). */
  amount: bigint;
  /** Optional opaque reference (order id, invoice, IPFS CID of the agreement terms). */
  memo?: string;
}

/**
 * A pre-signed, ready-to-settle outcome.
 *
 * The transaction is already signed by the (now-destroyed) vault key and is
 * missing exactly ONE signature: the authorizer's. Whoever holds this object
 * cannot alter its destination — doing so invalidates the vault signature —
 * they can only complete it by adding the authorizer signature, or discard it.
 */
export interface PreparedOutcome extends Outcome {
  /** Vault-pre-signed durable-nonce transaction, missing only the authorizer signature. */
  transaction: Transaction;
  /** Base58 wire-serialized form (partial signatures), safe to store off-chain. */
  serialized: string;
  /** The destination associated-token-account that will receive funds. */
  destinationAta: PublicKey;
}

/**
 * The full handle to a prepared keyless escrow.
 *
 * Once `vaultKeyDestroyed` is true, the only transactions that can ever move
 * the escrowed funds are the ones in `outcomes` — each requiring its
 * authorizer's signature, each paying a fixed destination.
 */
export interface KeylessEscrow {
  backend: 'presign' | 'program';
  /** The vault token account owner (an ephemeral address whose key is destroyed). */
  vault: PublicKey;
  /** Durable nonce account that keeps the pre-signed outcomes valid indefinitely. */
  nonceAccount: PublicKey;
  parties: Parties;
  mint: PublicKey;
  amount: bigint;
  outcomes: PreparedOutcome[];
  /** True once the ephemeral vault secret key has been zeroized in memory. */
  vaultKeyDestroyed: boolean;
  memo?: string;
}

/** Result of submitting a settlement. */
export interface SettlementResult {
  outcomeId: string;
  /** Confirmed transaction signature, or the Jito bundle id when submitted as a bundle. */
  signature: string;
  /** True when the settlement was delivered atomically via a Jito bundle. */
  viaBundle: boolean;
}
