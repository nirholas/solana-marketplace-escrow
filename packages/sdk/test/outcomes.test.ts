import { describe, it, expect } from 'vitest';
import { Keypair, PublicKey } from '@solana/web3.js';
import {
  standardOutcomes,
  buildOutcomeTransaction,
  ataFor,
  type Parties,
} from '../src/index.js';

// Synthetic, offline-only fixtures. No RPC, no funds — these tests prove the
// cryptographic *construction* of the primitive is sound and deterministic.
const buyer = Keypair.generate();
const seller = Keypair.generate();
const arbiter = Keypair.generate();
const vault = Keypair.generate();
const mint = Keypair.generate().publicKey;
const nonceAccount = Keypair.generate().publicKey;
// A durable nonce value is a 32-byte base58 blockhash; any pubkey works as a stand-in.
const nonceValue = Keypair.generate().publicKey.toBase58();

const parties: Parties = {
  buyer: buyer.publicKey,
  seller: seller.publicKey,
  arbiter: arbiter.publicKey,
};
const partyKeypair = { buyer, seller, arbiter } as const;

const DECIMALS = 6;
const AMOUNT = 1_000_000n;

function buildFor(outcome: ReturnType<typeof standardOutcomes>[number]) {
  const tx = buildOutcomeTransaction({
    vault: vault.publicKey,
    nonceAccount,
    nonceValue,
    mint,
    decimals: DECIMALS,
    amount: AMOUNT,
    destinationOwner: outcome.destinationOwner,
    authorizer: parties[outcome.authorizer],
    rentReclaimTo: parties.buyer,
  });
  tx.partialSign(vault);
  return tx;
}

describe('standardOutcomes — the safe authorization model', () => {
  const outcomes = standardOutcomes(parties);

  it('defines exactly four outcomes', () => {
    expect(outcomes.map((o) => o.id).sort()).toEqual([
      'refund:by-arbiter',
      'refund:by-seller',
      'release:by-arbiter',
      'release:by-buyer',
    ]);
  });

  it('NEVER lets a party direct funds to itself', () => {
    for (const o of outcomes) {
      const destination = o.destinationOwner;
      const authorizerPk = parties[o.authorizer];
      // The party who signs must never be the party who receives.
      expect(destination.equals(authorizerPk)).toBe(false);
    }
  });

  it('buyer can only ever push funds to the seller', () => {
    const buyerOutcomes = outcomes.filter((o) => o.authorizer === 'buyer');
    expect(buyerOutcomes.length).toBeGreaterThan(0);
    for (const o of buyerOutcomes) expect(o.destinationOwner.equals(seller.publicKey)).toBe(true);
  });

  it('seller can only ever push funds to the buyer', () => {
    const sellerOutcomes = outcomes.filter((o) => o.authorizer === 'seller');
    expect(sellerOutcomes.length).toBeGreaterThan(0);
    for (const o of sellerOutcomes) expect(o.destinationOwner.equals(buyer.publicKey)).toBe(true);
  });

  it('arbiter can pick either party but only those two', () => {
    const arbiterDests = outcomes
      .filter((o) => o.authorizer === 'arbiter')
      .map((o) => o.destinationOwner.toBase58())
      .sort();
    expect(arbiterDests).toEqual([buyer.publicKey.toBase58(), seller.publicKey.toBase58()].sort());
  });
});

describe('buildOutcomeTransaction — signer and destination invariants', () => {
  const outcomes = standardOutcomes(parties);

  it('requires exactly {vault, authorizer} and nothing else', () => {
    for (const o of outcomes) {
      const tx = buildFor(o);
      const signers = tx.signatures.map((s) => s.publicKey.toBase58()).sort();
      expect(signers).toEqual([vault.publicKey.toBase58(), parties[o.authorizer].toBase58()].sort());
    }
  });

  it('is pre-signed by the vault and missing ONLY the authorizer signature', () => {
    for (const o of outcomes) {
      const tx = buildFor(o);
      const vaultSig = tx.signatures.find((s) => s.publicKey.equals(vault.publicKey));
      const authSig = tx.signatures.find((s) => s.publicKey.equals(parties[o.authorizer]));
      expect(vaultSig?.signature).not.toBeNull();
      expect(authSig?.signature).toBeNull();
    }
  });

  it('routes funds to the fixed destination ATA (not a settlement-time choice)', () => {
    for (const o of outcomes) {
      const tx = buildFor(o);
      const expectedDestAta = ataFor(mint, o.destinationOwner);
      // transferChecked is instruction index 2: [source, mint, destination, owner].
      const transferIx = tx.instructions[2]!;
      const destKey = transferIx.keys[2]!.pubkey;
      expect(destKey.equals(expectedDestAta)).toBe(true);
    }
  });

  it('anchors every outcome to the same nonce — settling one voids the rest', () => {
    const blockhashes = new Set(outcomes.map((o) => buildFor(o).recentBlockhash));
    expect(blockhashes).toEqual(new Set([nonceValue]));
  });
});

describe('immutability under the vault signature', () => {
  it('an arbiter cannot redirect funds: any destination change breaks the message', () => {
    const release = standardOutcomes(parties).find((o) => o.id === 'release:by-arbiter')!;
    const legit = buildFor(release);

    // Arbiter tries to redirect the same release to themselves.
    const tampered = buildOutcomeTransaction({
      vault: vault.publicKey,
      nonceAccount,
      nonceValue,
      mint,
      decimals: DECIMALS,
      amount: AMOUNT,
      destinationOwner: arbiter.publicKey, // <-- theft attempt
      authorizer: parties.arbiter,
      rentReclaimTo: parties.buyer,
    });

    // The signed message differs, so the vault's signature over `legit` cannot
    // authorize `tampered`. The arbiter has no vault key to re-sign with.
    expect(Buffer.compare(legit.serializeMessage(), tampered.serializeMessage())).not.toBe(0);
  });
});

describe('settlement requires the exact designated authorizer', () => {
  it('completing with the right authorizer finalizes the transaction', () => {
    const o = standardOutcomes(parties).find((x) => x.id === 'release:by-arbiter')!;
    const tx = buildFor(o);
    // Before the authorizer signs, the tx cannot be serialized for submission.
    expect(() => tx.serialize()).toThrow();
    tx.partialSign(partyKeypair[o.authorizer]);
    // Now both required signatures are present.
    expect(() => tx.serialize()).not.toThrow();
  });

  it('rejects a non-authorizer key — only the designated party is a valid signer', () => {
    const o = standardOutcomes(parties).find((x) => x.id === 'release:by-arbiter')!;
    const tx = buildFor(o);
    const stranger = Keypair.generate();
    // The stranger is not a required signer; web3.js refuses to sign.
    expect(() => tx.partialSign(stranger)).toThrow();
  });
});

describe('ataFor', () => {
  it('is deterministic for an owner + mint', () => {
    const a = ataFor(mint, buyer.publicKey);
    const b = ataFor(mint, buyer.publicKey);
    expect(a.equals(b)).toBe(true);
    expect(a).toBeInstanceOf(PublicKey);
  });
});
