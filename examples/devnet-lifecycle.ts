/**
 * End-to-end keyless-escrow lifecycle on Solana devnet.
 *
 * Creates a throwaway SPL mint (so the example references no third-party token),
 * funds three fresh wallets, opens a keyless escrow, and resolves a dispute in
 * favour of the seller — proving that the arbiter can release the funds while
 * the vault key no longer exists.
 *
 * Run:  node --experimental-strip-types examples/devnet-lifecycle.ts
 *
 * Devnet airdrops are rate-limited; if an airdrop fails, fund the printed buyer
 * address from https://faucet.solana.com and re-run.
 */
import { Connection, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
} from '@solana/spl-token';
import { PresignBackend } from '../packages/sdk/dist/index.js';

const RPC = process.env.SOLANA_RPC ?? 'https://api.devnet.solana.com';
const DECIMALS = 6;
const AMOUNT = 1_000_000n; // 1.0 token

async function airdrop(connection: Connection, to: Keypair, sol: number): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const sig = await connection.requestAirdrop(to.publicKey, sol * LAMPORTS_PER_SOL);
      const bh = await connection.getLatestBlockhash('confirmed');
      await connection.confirmTransaction({ signature: sig, ...bh }, 'confirmed');
      return;
    } catch (err) {
      if (attempt === 4) throw err;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

async function main() {
  const connection = new Connection(RPC, 'confirmed');
  const buyer = Keypair.generate();
  const seller = Keypair.generate();
  const arbiter = Keypair.generate();

  console.log('buyer  ', buyer.publicKey.toBase58());
  console.log('seller ', seller.publicKey.toBase58());
  console.log('arbiter', arbiter.publicKey.toBase58());

  console.log('\nairdropping devnet SOL…');
  await airdrop(connection, buyer, 2);
  await airdrop(connection, arbiter, 1);

  console.log('creating a throwaway SPL mint…');
  const mint = await createMint(connection, buyer, buyer.publicKey, null, DECIMALS);
  const buyerAta = await getOrCreateAssociatedTokenAccount(connection, buyer, mint, buyer.publicKey);
  await mintTo(connection, buyer, mint, buyerAta.address, buyer, AMOUNT);
  console.log('mint   ', mint.toBase58());

  const escrowSvc = new PresignBackend({ connection });

  console.log('\nopening keyless escrow (deposit + pre-sign outcomes + destroy vault key)…');
  const escrow = await escrowSvc.open(buyer, {
    parties: { buyer: buyer.publicKey, seller: seller.publicKey, arbiter: arbiter.publicKey },
    mint,
    amount: AMOUNT,
  });
  console.log('vault            ', escrow.vault.toBase58());
  console.log('vaultKeyDestroyed', escrow.vaultKeyDestroyed);
  console.log('outcomes         ', escrow.outcomes.map((o) => o.id).join(', '));

  const before = await escrowSvc.status(escrow);
  console.log('status (funded)  ', before);

  console.log('\nsimulating a dispute resolved for the SELLER (arbiter signs)…');
  const result = await escrowSvc.settle(escrow, 'release:by-arbiter', arbiter);
  console.log('settled          ', result.signature);

  const sellerAta = await getOrCreateAssociatedTokenAccount(connection, arbiter, mint, seller.publicKey);
  const sellerBal = (await getAccount(connection, sellerAta.address)).amount;
  console.log('seller balance   ', sellerBal.toString(), '(expected', AMOUNT.toString() + ')');

  if (sellerBal !== AMOUNT) throw new Error('seller did not receive the escrowed funds');
  console.log('\n✅ keyless escrow released to the seller — and the vault key never existed at settlement.');
}

main().catch((err) => {
  console.error('\n❌', err);
  process.exit(1);
});
