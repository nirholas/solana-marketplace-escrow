import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getMint,
} from '@solana/spl-token';
import bs58 from 'bs58';
import type {
  CreateEscrowParams,
  KeylessEscrow,
  Party,
  PreparedOutcome,
  SettlementResult,
} from '../types.js';
import { ataFor, buildOutcomeTransaction, standardOutcomes } from '../outcomes.js';
import { createNonceAccount, readNonce } from '../nonce.js';
import { jitoTipInstruction, sendBundleAndConfirm, type SendBundleOptions } from '../jito.js';

export interface PresignBackendOptions {
  connection: Connection;
}

/**
 * Zero a captured secret-key buffer and drop the reference.
 *
 * Best-effort: JavaScript's managed heap cannot guarantee that no copy of the
 * bytes survives in GC memory. The security guarantee of this backend therefore
 * rests on the *convention* that the ephemeral vault key is generated here,
 * never persisted, never returned, and overwritten immediately after signing.
 * For a vault that is keyless *by construction* (a Program Derived Address with
 * no private key in existence), use the `program` backend instead.
 */
function destroySecret(secret: Uint8Array): void {
  secret.fill(0);
}

/**
 * The zero-deploy, runs-anywhere backend.
 *
 * Holds funds in an ephemeral vault token account, pre-signs the complete set of
 * fixed-destination outcomes against a durable nonce, then destroys the vault
 * key. From that moment the only transactions that can ever move the funds are
 * the prepared outcomes — each requiring its authorizer's signature, each paying
 * a destination the buyer fixed at funding time.
 */
export class PresignBackend {
  readonly backend = 'presign' as const;
  private readonly connection: Connection;

  constructor(options: PresignBackendOptions) {
    this.connection = options.connection;
  }

  /**
   * Open and fund a keyless escrow in one shot.
   *
   * @param funder the buyer's wallet — pays rent + fees and deposits the tokens.
   *               Must already hold at least `params.amount` of `params.mint`.
   */
  async open(funder: Keypair, params: CreateEscrowParams): Promise<KeylessEscrow> {
    if (!funder.publicKey.equals(params.parties.buyer)) {
      throw new Error('funder must be the buyer (the depositing party)');
    }
    if (params.amount <= 0n) throw new Error('escrow amount must be positive');

    const vault = Keypair.generate();
    const vaultSecret = vault.secretKey; // captured copy we control and will zero
    const mintInfo = await getMint(this.connection, params.mint);
    const decimals = mintInfo.decimals;

    // 1. Durable nonce whose authority is the vault — only the vault can advance
    //    it, and advancing it on settlement invalidates all other outcomes.
    const nonceAccount = await createNonceAccount(this.connection, funder, vault.publicKey);
    const nonceValue = await readNonce(this.connection, nonceAccount);

    // 2. Deposit: create the vault token account and move the escrow into it.
    const vaultAta = ataFor(params.mint, vault.publicKey);
    const funderAta = ataFor(params.mint, funder.publicKey);
    const deposit = new Transaction()
      .add(
        createAssociatedTokenAccountIdempotentInstruction(
          funder.publicKey,
          vaultAta,
          vault.publicKey,
          params.mint,
        ),
      )
      .add(
        createTransferCheckedInstruction(
          funderAta,
          params.mint,
          vaultAta,
          funder.publicKey,
          params.amount,
          decimals,
        ),
      );
    deposit.feePayer = funder.publicKey;
    deposit.recentBlockhash = (await this.connection.getLatestBlockhash('confirmed')).blockhash;
    deposit.sign(funder);
    const depositSig = await this.connection.sendRawTransaction(deposit.serialize());
    await this.confirm(depositSig);

    // 3. Pre-sign the complete set of fixed-destination outcomes with the vault key.
    const outcomes: PreparedOutcome[] = standardOutcomes(params.parties).map((o) => {
      const authorizerPubkey = params.parties[o.authorizer];
      const tx = buildOutcomeTransaction({
        vault: vault.publicKey,
        nonceAccount,
        nonceValue,
        mint: params.mint,
        decimals,
        amount: params.amount,
        destinationOwner: o.destinationOwner,
        authorizer: authorizerPubkey,
        rentReclaimTo: params.parties.buyer,
      });
      tx.partialSign(vault);
      return {
        ...o,
        transaction: tx,
        serialized: bs58.encode(tx.serialize({ requireAllSignatures: false, verifySignatures: false })),
        destinationAta: ataFor(params.mint, o.destinationOwner),
      };
    });

    // 4. Destroy the vault key. No new transaction from the vault can ever exist.
    destroySecret(vaultSecret);

    return {
      backend: 'presign',
      vault: vault.publicKey,
      nonceAccount,
      parties: params.parties,
      mint: params.mint,
      amount: params.amount,
      outcomes,
      vaultKeyDestroyed: true,
      memo: params.memo,
    };
  }

  /**
   * Settle the escrow by completing one prepared outcome.
   *
   * The `authorizer` must be the exact party the outcome designates — the SDK
   * refuses to sign an outcome with the wrong key. Optionally delivers the
   * settlement atomically via a Jito bundle.
   */
  async settle(
    escrow: KeylessEscrow,
    outcomeId: string,
    authorizer: Keypair,
    options: { viaBundle?: boolean; tipLamports?: number; bundle?: SendBundleOptions } = {},
  ): Promise<SettlementResult> {
    const outcome = escrow.outcomes.find((o) => o.id === outcomeId);
    if (!outcome) throw new Error(`unknown outcome '${outcomeId}'`);

    const expected = escrow.parties[outcome.authorizer as Party];
    if (!authorizer.publicKey.equals(expected)) {
      throw new Error(
        `outcome '${outcomeId}' must be authorized by the ${outcome.authorizer} ` +
          `(${expected.toBase58()}), not ${authorizer.publicKey.toBase58()}`,
      );
    }

    // Rehydrate from the wire form so the in-memory object can't smuggle state,
    // then add the authorizer signature to the vault-pre-signed transaction.
    const tx = Transaction.from(bs58.decode(outcome.serialized));
    tx.partialSign(authorizer);

    if (options.viaBundle) {
      // The pre-signed outcome tx must not be modified (that would break the
      // vault signature), so the required Jito tip rides in a separate tx signed
      // by the authorizer; the two land atomically as one bundle.
      const tip = new Transaction().add(jitoTipInstruction(authorizer.publicKey, options.tipLamports));
      tip.feePayer = authorizer.publicKey;
      tip.recentBlockhash = (await this.connection.getLatestBlockhash('confirmed')).blockhash;
      tip.sign(authorizer);
      const { bundleId } = await sendBundleAndConfirm([tx, tip], options.bundle);
      return { outcomeId, signature: bundleId, viaBundle: true };
    }

    const sig = await this.connection.sendRawTransaction(tx.serialize());
    await this.confirm(sig);
    return { outcomeId, signature: sig, viaBundle: false };
  }

  /** Current escrow status: funded balance + whether it has already settled. */
  async status(escrow: KeylessEscrow): Promise<{
    funded: boolean;
    settled: boolean;
    balance: bigint;
  }> {
    const vaultAta = ataFor(escrow.mint, escrow.vault);
    const info = await this.connection.getTokenAccountBalance(vaultAta).catch(() => null);
    const balance = info ? BigInt(info.value.amount) : 0n;
    // The vault ATA is closed on settlement, so a missing/empty account that was
    // funded indicates the escrow has settled.
    return {
      funded: balance >= escrow.amount,
      settled: info === null,
      balance,
    };
  }

  private async confirm(signature: string): Promise<void> {
    const deadline = Date.now() + 60_000;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { value } = await this.connection.getSignatureStatuses([signature]);
      const status = value[0];
      if (status?.err) throw new Error(`transaction ${signature} failed: ${JSON.stringify(status.err)}`);
      if (status && (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized')) {
        return;
      }
      if (Date.now() > deadline) throw new Error(`timed out confirming ${signature}`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

export { PublicKey };
