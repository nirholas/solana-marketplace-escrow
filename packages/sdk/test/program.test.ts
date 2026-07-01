import { describe, it, expect } from 'vitest';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { ProgramBackend, standardOutcomes, type Parties } from '../src/index.js';
import { DISCRIMINATOR, type ProgramEscrow } from '../src/backends/program.js';

const programId = new PublicKey('E8SpoXKxgfKA8m2YVnsNSUHW5boBtK9RjWKaWKYDCkda');
const buyer = Keypair.generate();
const seller = Keypair.generate();
const arbiter = Keypair.generate();
const mint = Keypair.generate().publicKey;
const parties: Parties = { buyer: buyer.publicKey, seller: seller.publicKey, arbiter: arbiter.publicKey };

// The pure instruction builders never touch the connection.
const backend = new ProgramBackend({ connection: {} as unknown as Connection, programId });
const AMOUNT = 1_000_000n;
const SEED = 42n;
const ataOf = (owner: PublicKey) => getAssociatedTokenAddressSync(mint, owner, true, TOKEN_PROGRAM_ID);

const escrowHandle = (): ProgramEscrow => {
  const { escrow, vault } = backend.initializeInstruction(buyer.publicKey, { parties, mint, amount: AMOUNT }, SEED);
  return { backend: 'program', programId, escrow, vault, parties, mint, amount: AMOUNT, seed: SEED, outcomes: standardOutcomes(parties) };
};

describe('escrow PDA', () => {
  it('is deterministic and off-curve (no private key exists)', () => {
    const a = backend.escrowPda(buyer.publicKey, SEED);
    const b = backend.escrowPda(buyer.publicKey, SEED);
    expect(a.equals(b)).toBe(true);
    expect(PublicKey.isOnCurve(a.toBytes())).toBe(false);
  });
  it('differs per seed', () => {
    expect(backend.escrowPda(buyer.publicKey, 1n).equals(backend.escrowPda(buyer.publicKey, 2n))).toBe(false);
  });
});

describe('initialize instruction', () => {
  const { instruction, escrow, vault } = backend.initializeInstruction(buyer.publicKey, { parties, mint, amount: AMOUNT }, SEED);

  it('carries the initialize discriminator + seed + amount', () => {
    expect([...instruction.data.subarray(0, 8)]).toEqual([...DISCRIMINATOR.initialize]);
    expect(instruction.data.readBigUInt64LE(8)).toBe(SEED);
    expect(instruction.data.readBigUInt64LE(16)).toBe(AMOUNT);
  });

  it('orders accounts to match the Anchor context', () => {
    const owners = instruction.keys.map((k) => k.pubkey.toBase58());
    expect(owners.slice(0, 7)).toEqual([
      buyer.publicKey.toBase58(),
      seller.publicKey.toBase58(),
      arbiter.publicKey.toBase58(),
      mint.toBase58(),
      escrow.toBase58(),
      vault.toBase58(),
      ataOf(buyer.publicKey).toBase58(),
    ]);
  });

  it('only the buyer signs; escrow + vault are writable PDAs, not signers', () => {
    expect(instruction.keys[0]!.isSigner && instruction.keys[0]!.isWritable).toBe(true);
    expect(instruction.keys.filter((k) => k.isSigner)).toHaveLength(1);
    expect(instruction.keys[4]!.isWritable).toBe(true);
    expect(instruction.keys[4]!.isSigner).toBe(false); // escrow PDA
    expect(instruction.keys[5]!.isSigner).toBe(false); // vault PDA
  });
});

describe('settle instruction — the arbiter can pick a party but never a destination', () => {
  it('release:by-arbiter pays the SELLER, signed by the arbiter', () => {
    const ix = backend.settleInstruction(escrowHandle(), 'release:by-arbiter', arbiter.publicKey);
    expect([...ix.data]).toEqual([...DISCRIMINATOR.release]);
    // authority
    expect(ix.keys[0]!.pubkey.equals(arbiter.publicKey)).toBe(true);
    expect(ix.keys[0]!.isSigner).toBe(true);
    // destination OWNER is the seller — NOT the arbiter who signed
    expect(ix.keys[4]!.pubkey.equals(seller.publicKey)).toBe(true);
    expect(ix.keys[4]!.pubkey.equals(arbiter.publicKey)).toBe(false);
    // destination ATA is the seller's ATA
    expect(ix.keys[5]!.pubkey.equals(ataOf(seller.publicKey))).toBe(true);
  });

  it('refund:by-arbiter pays the BUYER, signed by the arbiter', () => {
    const ix = backend.settleInstruction(escrowHandle(), 'refund:by-arbiter', arbiter.publicKey);
    expect([...ix.data]).toEqual([...DISCRIMINATOR.refund]);
    expect(ix.keys[4]!.pubkey.equals(buyer.publicKey)).toBe(true);
    expect(ix.keys[5]!.pubkey.equals(ataOf(buyer.publicKey))).toBe(true);
  });

  it('rejects a signer who is not the outcome authorizer', () => {
    expect(() => backend.settleInstruction(escrowHandle(), 'release:by-arbiter', buyer.publicKey)).toThrow();
    expect(() => backend.settleInstruction(escrowHandle(), 'refund:by-seller', arbiter.publicKey)).toThrow();
  });

  it('never routes any outcome to the arbiter', () => {
    for (const o of standardOutcomes(parties)) {
      const ix = backend.settleInstruction(escrowHandle(), o.id, parties[o.authorizer]);
      expect(ix.keys[4]!.pubkey.equals(arbiter.publicKey)).toBe(false);
    }
  });
});
