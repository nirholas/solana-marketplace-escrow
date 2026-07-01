import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

/**
 * Registry of Solana keypairs this operator may sign with, loaded from the
 * `KEYLESS_ESCROW_KEYS` environment variable (comma-separated base58 secrets).
 * The service can only ever settle an outcome whose authorizer key it holds.
 */
export class SignerRegistry {
  private readonly byPubkey = new Map<string, Keypair>();

  constructor(secrets: string[]) {
    for (const secret of secrets) {
      const trimmed = secret.trim();
      if (!trimmed) continue;
      const kp = Keypair.fromSecretKey(bs58.decode(trimmed));
      this.byPubkey.set(kp.publicKey.toBase58(), kp);
    }
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): SignerRegistry {
    return new SignerRegistry((env.KEYLESS_ESCROW_KEYS ?? '').split(','));
  }

  get(pubkey: string): Keypair | undefined {
    return this.byPubkey.get(pubkey);
  }

  has(pubkey: string): boolean {
    return this.byPubkey.has(pubkey);
  }

  pubkeys(): string[] {
    return [...this.byPubkey.keys()];
  }

  soleKey(): Keypair | undefined {
    return this.byPubkey.size === 1 ? [...this.byPubkey.values()][0] : undefined;
  }
}
