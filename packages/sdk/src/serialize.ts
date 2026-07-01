import { PublicKey, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';
import type { KeylessEscrow, OutcomeKind, Party, PreparedOutcome } from './types.js';

/**
 * A JSON-safe representation of a {@link KeylessEscrow}.
 *
 * A live escrow contains `Transaction` objects and `bigint`/`PublicKey` values
 * that don't survive `JSON.stringify`. This form is what you store in a database,
 * return from an HTTP/MCP boundary, or hand to another process. It is complete:
 * `deserializeEscrow` reconstructs a fully-functional escrow (including the
 * vault-pre-signed outcome transactions) from it.
 */
export interface SerializedEscrow {
  backend: 'presign' | 'program';
  vault: string;
  nonceAccount: string;
  parties: { buyer: string; seller: string; arbiter: string };
  mint: string;
  amount: string;
  vaultKeyDestroyed: boolean;
  memo?: string;
  outcomes: Array<{
    id: string;
    kind: OutcomeKind;
    authorizer: Party;
    destinationOwner: string;
    destinationAta: string;
    description: string;
    serialized: string;
  }>;
}

/** Convert a live escrow into a JSON-safe form (for storage / transport). */
export function serializeEscrow(escrow: KeylessEscrow): SerializedEscrow {
  return {
    backend: escrow.backend,
    vault: escrow.vault.toBase58(),
    nonceAccount: escrow.nonceAccount.toBase58(),
    parties: {
      buyer: escrow.parties.buyer.toBase58(),
      seller: escrow.parties.seller.toBase58(),
      arbiter: escrow.parties.arbiter.toBase58(),
    },
    mint: escrow.mint.toBase58(),
    amount: escrow.amount.toString(),
    vaultKeyDestroyed: escrow.vaultKeyDestroyed,
    memo: escrow.memo,
    outcomes: escrow.outcomes.map((o) => ({
      id: o.id,
      kind: o.kind,
      authorizer: o.authorizer,
      destinationOwner: o.destinationOwner.toBase58(),
      destinationAta: o.destinationAta.toBase58(),
      description: o.description,
      serialized: o.serialized,
    })),
  };
}

/** Reconstruct a live escrow (with pre-signed outcome transactions) from its JSON form. */
export function deserializeEscrow(s: SerializedEscrow): KeylessEscrow {
  const outcomes: PreparedOutcome[] = s.outcomes.map((o) => ({
    id: o.id,
    kind: o.kind,
    authorizer: o.authorizer,
    destinationOwner: new PublicKey(o.destinationOwner),
    destinationAta: new PublicKey(o.destinationAta),
    description: o.description,
    serialized: o.serialized,
    transaction: Transaction.from(bs58.decode(o.serialized)),
  }));

  return {
    backend: s.backend,
    vault: new PublicKey(s.vault),
    nonceAccount: new PublicKey(s.nonceAccount),
    parties: {
      buyer: new PublicKey(s.parties.buyer),
      seller: new PublicKey(s.parties.seller),
      arbiter: new PublicKey(s.parties.arbiter),
    },
    mint: new PublicKey(s.mint),
    amount: BigInt(s.amount),
    vaultKeyDestroyed: s.vaultKeyDestroyed,
    memo: s.memo,
    outcomes,
  };
}
