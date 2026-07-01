/**
 * End-to-end lifecycle against the on-chain `program` backend on devnet.
 *
 * Prerequisite: the program is deployed and DEFAULT_PROGRAM_ID (or PROGRAM_ID
 * below) matches. See program/README.md and scripts/deploy.sh.
 *
 * Run:  node --experimental-strip-types examples/program-devnet-lifecycle.ts
 */
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { createMint, getOrCreateAssociatedTokenAccount, mintTo, getAccount } from '@solana/spl-token';
import { ProgramBackend, DEFAULT_PROGRAM_ID } from '../packages/sdk/dist/index.js';

const RPC = process.env.SOLANA_RPC ?? 'https://api.devnet.solana.com';
const PROGRAM_ID = process.env.PROGRAM_ID ?? DEFAULT_PROGRAM_ID;
const DECIMALS = 6;
const AMOUNT = 1_000_000n;

async function airdrop(connection: Connection, to: Keypair, sol: number): Promise<void> {
  const sig = await connection.requestAirdrop(to.publicKey, sol * LAMPORTS_PER_SOL);
  const bh = await connection.getLatestBlockhash('confirmed');
  await connection.confirmTransaction({ signature: sig, ...bh }, 'confirmed');
}

async function main() {
  const connection = new Connection(RPC, 'confirmed');
  const buyer = Keypair.generate();
  const seller = Keypair.generate();
  const arbiter = Keypair.generate();

  console.log('program', PROGRAM_ID);
  console.log('buyer  ', buyer.publicKey.toBase58());

  await airdrop(connection, buyer, 2);
  await airdrop(connection, arbiter, 1);

  const mint = await createMint(connection, buyer, buyer.publicKey, null, DECIMALS);
  const buyerAta = await getOrCreateAssociatedTokenAccount(connection, buyer, mint, buyer.publicKey);
  await mintTo(connection, buyer, mint, buyerAta.address, buyer, AMOUNT);

  const svc = new ProgramBackend({ connection, programId: PROGRAM_ID });

  console.log('opening on-chain keyless escrow (PDA vault)…');
  const escrow = await svc.open(buyer, {
    parties: { buyer: buyer.publicKey, seller: seller.publicKey, arbiter: arbiter.publicKey },
    mint,
    amount: AMOUNT,
  });
  console.log('escrow PDA', escrow.escrow.toBase58(), '(off-curve, no key)');
  console.log('status    ', await svc.status(escrow));

  console.log('arbiter resolves the dispute for the SELLER…');
  const result = await svc.settle(escrow, 'release:by-arbiter', arbiter);
  console.log('settled   ', result.signature);

  const sellerAta = await getOrCreateAssociatedTokenAccount(connection, arbiter, mint, seller.publicKey);
  const sellerBal = (await getAccount(connection, sellerAta.address)).amount;
  if (sellerBal !== AMOUNT) throw new Error('seller did not receive the escrowed funds');
  console.log('\n✅ on-chain keyless escrow released to the seller via the arbiter — the vault never had a key.');
}

main().catch((err) => {
  console.error('\n❌', err);
  process.exit(1);
});
