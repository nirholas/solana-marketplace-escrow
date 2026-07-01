import {
  Connection,
  Keypair,
  NONCE_ACCOUNT_LENGTH,
  NonceAccount,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';

/**
 * Create and initialize a durable nonce account whose authority is `authority`.
 *
 * Durable nonces decouple a transaction's lifetime from the ~2-minute blockhash
 * window: a transaction that uses the nonce stays valid until the nonce is
 * advanced. That is exactly what lets us pre-sign escrow outcomes now and settle
 * one of them days later — without the vault key still existing.
 *
 * @returns the new nonce account's public key.
 */
export async function createNonceAccount(
  connection: Connection,
  payer: Keypair,
  authority: PublicKey,
): Promise<PublicKey> {
  const nonce = Keypair.generate();
  const lamports = await connection.getMinimumBalanceForRentExemption(NONCE_ACCOUNT_LENGTH);

  const tx = new Transaction().add(
    SystemProgram.createNonceAccount({
      fromPubkey: payer.publicKey,
      noncePubkey: nonce.publicKey,
      authorizedPubkey: authority,
      lamports,
    }),
  );

  await sendAndConfirmTransaction(connection, tx, [payer, nonce], {
    commitment: 'confirmed',
  });
  return nonce.publicKey;
}

/** Read the current durable nonce value (a base58 blockhash) from a nonce account. */
export async function readNonce(
  connection: Connection,
  nonceAccount: PublicKey,
): Promise<string> {
  const info = await connection.getAccountInfo(nonceAccount, 'confirmed');
  if (!info) throw new Error(`nonce account ${nonceAccount.toBase58()} not found`);
  return NonceAccount.fromAccountData(info.data).nonce;
}
