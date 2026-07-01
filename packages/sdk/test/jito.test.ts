import { describe, it, expect } from 'vitest';
import { Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import {
  JITO_TIP_ACCOUNTS,
  DEFAULT_TIP_LAMPORTS,
  jitoTipInstruction,
  randomTipAccount,
  withTip,
  sendJitoBundle,
} from '../src/index.js';

describe('Jito tip accounts', () => {
  it('are all valid pubkeys', () => {
    expect(JITO_TIP_ACCOUNTS.length).toBe(8);
    for (const a of JITO_TIP_ACCOUNTS) expect(() => new PublicKey(a)).not.toThrow();
  });
  it('randomTipAccount returns one of them', () => {
    const set = new Set<string>(JITO_TIP_ACCOUNTS);
    for (let i = 0; i < 20; i++) expect(set.has(randomTipAccount().toBase58())).toBe(true);
  });
});

describe('jitoTipInstruction', () => {
  const tipper = Keypair.generate().publicKey;

  it('is a system transfer from the tipper to a tip account', () => {
    const ix = jitoTipInstruction(tipper, 50_000);
    expect(ix.programId.equals(SystemProgram.programId)).toBe(true);
    expect(ix.keys[0]!.pubkey.equals(tipper)).toBe(true);
    expect(ix.keys[0]!.isSigner).toBe(true);
    expect(JITO_TIP_ACCOUNTS.includes(ix.keys[1]!.pubkey.toBase58() as (typeof JITO_TIP_ACCOUNTS)[number])).toBe(true);
  });

  it('defaults the tip to DEFAULT_TIP_LAMPORTS and honors a fixed account', () => {
    const acct = new PublicKey(JITO_TIP_ACCOUNTS[0]!);
    const ix = jitoTipInstruction(tipper, undefined, acct);
    expect(ix.keys[1]!.pubkey.equals(acct)).toBe(true);
    expect(DEFAULT_TIP_LAMPORTS).toBeGreaterThan(0);
  });

  it('withTip appends a tip instruction to a transaction', () => {
    const tx = new Transaction();
    withTip(tx, tipper, 1234);
    expect(tx.instructions).toHaveLength(1);
    expect(tx.instructions[0]!.programId.equals(SystemProgram.programId)).toBe(true);
  });
});

describe('sendJitoBundle guards', () => {
  it('rejects an empty or oversized bundle before hitting the network', async () => {
    await expect(sendJitoBundle([])).rejects.toThrow(/empty/);
    const many = Array.from({ length: 6 }, () => new Transaction());
    await expect(sendJitoBundle(many)).rejects.toThrow(/at most 5/);
  });
});
