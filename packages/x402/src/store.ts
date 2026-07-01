import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SerializedEscrow } from 'keyless-escrow';

/**
 * Durable store of opened escrows, keyed by vault address (the escrow id).
 * Persists to `KEYLESS_ESCROW_STORE` (JSON) when set, otherwise in-memory.
 */
export class EscrowStore {
  private readonly escrows = new Map<string, SerializedEscrow>();
  private readonly path: string | undefined;

  constructor(path?: string) {
    this.path = path;
    if (path && existsSync(path)) {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as SerializedEscrow[];
      for (const e of raw) this.escrows.set(e.vault, e);
    }
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): EscrowStore {
    return new EscrowStore(env.KEYLESS_ESCROW_STORE);
  }

  put(escrow: SerializedEscrow): string {
    this.escrows.set(escrow.vault, escrow);
    this.flush();
    return escrow.vault;
  }

  get(id: string): SerializedEscrow | undefined {
    return this.escrows.get(id);
  }

  list(): SerializedEscrow[] {
    return [...this.escrows.values()];
  }

  private flush(): void {
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify([...this.escrows.values()], null, 2));
  }
}
