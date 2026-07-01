import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SerializedEscrow } from 'keyless-escrow';

/**
 * Durable store of opened escrows, keyed by vault address (the escrow id).
 *
 * `open` and `settle` happen in separate tool calls (often minutes or days
 * apart), so the pre-signed outcomes must be persisted. If `KEYLESS_ESCROW_STORE`
 * points at a file path, the store is written through to disk as JSON on every
 * mutation and reloaded on start; otherwise it lives in memory for the session.
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

  /** The vault address doubles as the escrow id — unique and stable. */
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
