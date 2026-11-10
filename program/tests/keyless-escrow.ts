import * as anchor from '@coral-xyz/anchor';
import { Program, BN } from '@coral-xyz/anchor';
import { PublicKey, Keypair } from '@solana/web3.js';
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { assert } from 'chai';
import type { KeylessEscrow } from '../target/types/keyless_escrow';

describe('keyless-escrow', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.keylessEscrow as Program<KeylessEscrow>;
  const payer = (provider.wallet as anchor.Wallet).payer;

  const AMOUNT = new BN(1_000_000);

  async function scenario() {
    const buyer = payer; // wallet funds fees + deposit
    const seller = Keypair.generate();
    const arbiter = Keypair.generate();
    const seed = new BN(Math.floor(Math.random() * 1e12));

    // The arbiter and seller sign as `authority`, which pays rent for the
    // destination ATA (init_if_needed), so they need lamports of their own.
    for (const kp of [seller, arbiter]) {
      const sig = await provider.connection.requestAirdrop(kp.publicKey, anchor.web3.LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction({ signature: sig, ...(await provider.connection.getLatestBlockhash()) });
    }

    const mint = await createMint(provider.connection, buyer, buyer.publicKey, null, 6);
    const buyerAta = await getOrCreateAssociatedTokenAccount(provider.connection, buyer, mint, buyer.publicKey);
    await mintTo(provider.connection, buyer, mint, buyerAta.address, buyer, BigInt(AMOUNT.toString()));

    const [escrow] = PublicKey.findProgramAddressSync(
      [Buffer.from('escrow'), buyer.publicKey.toBuffer(), seed.toArrayLike(Buffer, 'le', 8)],
      program.programId,
    );
    const vault = getAssociatedTokenAddressSync(mint, escrow, true);

    await program.methods
      .initialize(seed, AMOUNT)
      .accounts({ buyer: buyer.publicKey, seller: seller.publicKey, arbiter: arbiter.publicKey, mint, tokenProgram: TOKEN_PROGRAM_ID })
      .rpc();

    return { buyer, seller, arbiter, mint, escrow, vault };
  }

  const bal = async (mint: PublicKey, owner: PublicKey) => {
    const ata = getAssociatedTokenAddressSync(mint, owner, true);
    try {
      return BigInt((await getAccount(provider.connection, ata)).amount.toString());
    } catch {
      return 0n;
    }
  };

  it('releases to the seller when the buyer confirms', async () => {
    const { buyer, seller, mint, escrow } = await scenario();
    await program.methods
      .release()
      .accounts({ authority: buyer.publicKey, escrow, mint, seller: seller.publicKey, rentRecipient: buyer.publicKey, tokenProgram: TOKEN_PROGRAM_ID })
      .rpc();
    assert.equal((await bal(mint, seller.publicKey)).toString(), AMOUNT.toString());
    assert.deepEqual((await program.account.escrow.fetch(escrow)).state, 1);
  });

  it('lets the arbiter release to the seller (dispute won by seller)', async () => {
    const { buyer, seller, arbiter, mint, escrow } = await scenario();
    await program.methods
      .release()
      .accounts({ authority: arbiter.publicKey, escrow, mint, seller: seller.publicKey, rentRecipient: buyer.publicKey, tokenProgram: TOKEN_PROGRAM_ID })
      .signers([arbiter])
      .rpc();
    assert.equal((await bal(mint, seller.publicKey)).toString(), AMOUNT.toString());
  });

  it('lets the arbiter refund the buyer (dispute won by buyer)', async () => {
    const { buyer, arbiter, mint, escrow } = await scenario();
    const before = await bal(mint, buyer.publicKey);
    await program.methods
      .refund()
      .accounts({ authority: arbiter.publicKey, escrow, mint, buyer: buyer.publicKey, rentRecipient: buyer.publicKey, tokenProgram: TOKEN_PROGRAM_ID })
      .signers([arbiter])
      .rpc();
    assert.equal((await bal(mint, buyer.publicKey)) - before, BigInt(AMOUNT.toString()));
  });

  it('rejects an unauthorized signer (the seller cannot release to themselves)', async () => {
    const { buyer, seller, mint, escrow } = await scenario();
    let code: string | undefined;
    try {
      await program.methods
        .release()
        .accounts({ authority: seller.publicKey, escrow, mint, seller: seller.publicKey, rentRecipient: buyer.publicKey, tokenProgram: TOKEN_PROGRAM_ID })
        .signers([seller])
        .rpc();
    } catch (err) {
      code = (err as anchor.AnchorError).error?.errorCode?.code;
    }
    assert.equal(code, 'Unauthorized', 'seller must be rejected by the program, not by a missing account or fee');
  });

  it('cannot be locked by a donation to the vault (drains the full balance)', async () => {
    const { buyer, seller, mint, escrow, vault } = await scenario();
    // Attacker donates dust straight into the vault ATA.
    await mintTo(provider.connection, buyer, mint, vault, buyer, 500_000n);
    await program.methods
      .release()
      .accounts({ authority: buyer.publicKey, escrow, mint, seller: seller.publicKey, rentRecipient: buyer.publicKey, tokenProgram: TOKEN_PROGRAM_ID })
      .rpc();
    // Release drains deposit + donation and still closes the vault.
    assert.equal((await bal(mint, seller.publicKey)).toString(), '1500000');
  });
});
