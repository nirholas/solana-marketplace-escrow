import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

/**
 * Registry of the Solana keypairs this server is allowed to sign with.
 *
 * Keys are supplied out-of-band via the `KEYLESS_ESCROW_KEYS` environment
 * variable — a comma-separated list of base58 secret keys. The server can only
 * ever settle an outcome whose authorizer key it holds; it never accepts a raw
 * secret key inside a tool call. A moderator therefore runs this server with
 * *only* their arbiter key, and it can do nothing but resolve disputes.
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

  /** All public keys this server can sign for. */
  pubkeys(): string[] {
    return [...this.byPubkey.keys()];
  }

  /** The sole held key, if exactly one is configured (used as the default buyer). */
  soleKey(): Keypair | undefined {
    return this.byPubkey.size === 1 ? [...this.byPubkey.values()][0] : undefined;
  }
}
