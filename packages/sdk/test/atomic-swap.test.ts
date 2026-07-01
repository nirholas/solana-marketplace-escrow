import { describe, it, expect } from 'vitest';
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { buildAtomicSwapTransaction } from '../src/index.js';

const alice = Keypair.generate();
const bob = Keypair.generate();
const mintA = Keypair.generate().publicKey;
const mintB = Keypair.generate().publicKey;
const blockhash = Keypair.generate().publicKey.toBase58();
const ata = (m: PublicKey, o: PublicKey) => getAssociatedTokenAddressSync(m, o, true);

describe('buildAtomicSwapTransaction (SPL ↔ SPL)', () => {
  const tx = buildAtomicSwapTransaction(
    {
      a: { owner: alice.publicKey, mint: mintA, amount: 1_000_000n, decimals: 6 },
      b: { owner: bob.publicKey, mint: mintB, amount: 5_000_000_000n, decimals: 9 },
    },
    blockhash,
  );

  it('has both legs: A→B and B→A', () => {
    // [createAtaB, transferA→B, createAtaA, transferB→A]
    expect(tx.instructions).toHaveLength(4);
    const t1 = tx.instructions[1]!; // transferChecked A→B: [source, mint, dest, owner]
    const t2 = tx.instructions[3]!; // transferChecked B→A
    expect(t1.keys[2]!.pubkey.equals(ata(mintA, bob.publicKey))).toBe(true);
    expect(t1.keys[3]!.pubkey.equals(alice.publicKey)).toBe(true);
    expect(t2.keys[2]!.pubkey.equals(ata(mintB, alice.publicKey))).toBe(true);
    expect(t2.keys[3]!.pubkey.equals(bob.publicKey)).toBe(true);
  });

  it('requires BOTH parties to sign — neither can take without giving', () => {
    tx.serializeMessage(); // force compile → populate signatures
    const signers = tx.signatures.map((s) => s.publicKey.toBase58()).sort();
    expect(signers).toEqual([alice.publicKey.toBase58(), bob.publicKey.toBase58()].sort());
  });

  it('is not submittable until both have signed', () => {
    const t = buildAtomicSwapTransaction(
      {
        a: { owner: alice.publicKey, mint: mintA, amount: 1n, decimals: 6 },
        b: { owner: bob.publicKey, mint: mintB, amount: 1n, decimals: 9 },
      },
      blockhash,
    );
    t.partialSign(alice);
    expect(() => t.serialize()).toThrow(); // bob's signature still missing
    t.partialSign(bob);
    expect(() => t.serialize()).not.toThrow();
  });

  it('rejects an SPL leg without decimals', () => {
    expect(() =>
      buildAtomicSwapTransaction(
        { a: { owner: alice.publicKey, mint: mintA, amount: 1n }, b: { owner: bob.publicKey, mint: mintB, amount: 1n, decimals: 9 } },
        blockhash,
      ),
    ).toThrow(/decimals/);
  });
});

describe('buildAtomicSwapTransaction (SOL ↔ SPL)', () => {
  it('uses a system transfer for the native leg', () => {
    const tx = buildAtomicSwapTransaction(
      {
        a: { owner: alice.publicKey, amount: 1_000_000_000n }, // 1 SOL, no mint
        b: { owner: bob.publicKey, mint: mintB, amount: 1n, decimals: 9 },
      },
      blockhash,
    );
    const solLeg = tx.instructions[0]!;
    expect(solLeg.programId.equals(SystemProgram.programId)).toBe(true);
  });
});
