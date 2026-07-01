import { describe, it, expect } from 'vitest';
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { buildCustodialSettle } from '../src/index.js';

const master = Keypair.generate();
const escrow = Keypair.generate();
const seller = Keypair.generate();
const moderator = Keypair.generate(); // the UI actor — must NEVER be a signer
const mint = Keypair.generate().publicKey;
const ata = (o: PublicKey) => getAssociatedTokenAddressSync(mint, o, true);

describe('custodial atomic settle — master funds, escrow signs, moderator holds nothing', () => {
  const tx = buildCustodialSettle({
    master: master.publicKey,
    escrow: escrow.publicKey,
    mint,
    decimals: 6,
    amount: 1_000_000n,
    destination: seller.publicKey,
    tipLamports: 100_000,
  });
  tx.recentBlockhash = Keypair.generate().publicKey.toBase58();

  it('requires exactly {master, escrow} to sign — never the moderator', () => {
    tx.serializeMessage();
    const signers = tx.signatures.map((s) => s.publicKey.toBase58()).sort();
    expect(signers).toEqual([master.publicKey.toBase58(), escrow.publicKey.toBase58()].sort());
    expect(signers).not.toContain(moderator.publicKey.toBase58());
  });

  it('the master pays fees (fee payer)', () => {
    expect(tx.feePayer?.equals(master.publicKey)).toBe(true);
  });

  it('the escrow key is the token-transfer authority', () => {
    // instructions: [createAtaIdempotent, transferChecked, closeAccount, tip]
    const transfer = tx.instructions[1]!; // [source, mint, dest, owner]
    expect(transfer.keys[3]!.pubkey.equals(escrow.publicKey)).toBe(true);
    expect(transfer.keys[2]!.pubkey.equals(ata(seller.publicKey))).toBe(true);
  });

  it('includes a master-paid Jito tip when requested', () => {
    const tip = tx.instructions[3]!;
    expect(tip.programId.equals(SystemProgram.programId)).toBe(true);
    expect(tip.keys[0]!.pubkey.equals(master.publicKey)).toBe(true);
  });

  it('a refund routes to the buyer, not the seller', () => {
    const buyer = Keypair.generate();
    const rtx = buildCustodialSettle({
      master: master.publicKey, escrow: escrow.publicKey, mint, decimals: 6,
      amount: 1n, destination: buyer.publicKey,
    });
    expect(rtx.instructions[1]!.keys[2]!.pubkey.equals(ata(buyer.publicKey))).toBe(true);
  });
});
