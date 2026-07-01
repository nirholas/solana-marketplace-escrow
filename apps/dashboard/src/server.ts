import express, { type Request, type Response, type NextFunction } from 'express';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { CustodialBackend, type CustodialEscrow } from 'keyless-escrow';

const __dirname = dirname(fileURLToPath(import.meta.url));

/* ---------- config ---------- */
const RPC = process.env.SOLANA_RPC ?? 'https://api.devnet.solana.com';
const PORT = Number(process.env.PORT ?? 4040);
const STORE = process.env.DASHBOARD_STORE ?? join(__dirname, '..', '.escrows.json');
const ADMIN_PASSCODE = process.env.ADMIN_PASSCODE ?? 'admin';
const MOD_PASSCODE = process.env.MODERATOR_PASSCODE ?? 'mod';

const connection = new Connection(RPC, 'confirmed');
const master = process.env.MASTER_SECRET
  ? Keypair.fromSecretKey(bs58.decode(process.env.MASTER_SECRET))
  : Keypair.generate();
const funder = process.env.BUYER_SECRET ? Keypair.fromSecretKey(bs58.decode(process.env.BUYER_SECRET)) : null;
const backend = new CustodialBackend({ connection, master });

if (!process.env.MASTER_SECRET) {
  process.stderr.write(`[dashboard] no MASTER_SECRET — generated ephemeral master ${master.publicKey.toBase58()} (fund it with SOL)\n`);
}
if (ADMIN_PASSCODE === 'admin' || MOD_PASSCODE === 'mod') {
  process.stderr.write('[dashboard] WARNING: using default passcodes — set ADMIN_PASSCODE and MODERATOR_PASSCODE\n');
}

/* ---------- store (records incl. escrowSecret live SERVER-SIDE only) ---------- */
type Record = CustodialEscrow & { id: string; status: 'active' | 'released' | 'refunded'; createdAt: number; signature?: string };
const db: Record[] = existsSync(STORE) ? JSON.parse(readFileSync(STORE, 'utf8')) : [];
const persist = () => { mkdirSync(dirname(STORE), { recursive: true }); writeFileSync(STORE, JSON.stringify(db, null, 2)); };
const redact = (r: Record) => ({ id: r.id, buyer: r.buyer, seller: r.seller, mint: r.mint, amount: r.amount, escrow: r.escrow, status: r.status, createdAt: r.createdAt, signature: r.signature });

/* ---------- auth ---------- */
type Role = 'admin' | 'moderator';
const roleFor = (passcode: string | undefined): Role | null =>
  passcode === ADMIN_PASSCODE ? 'admin' : passcode === MOD_PASSCODE ? 'moderator' : null;

function auth(required: Role | 'any') {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    const role = roleFor(token);
    if (!role) return res.status(401).json({ error: 'unauthorized' });
    if (required !== 'any' && role !== required) return res.status(403).json({ error: `requires ${required}` });
    (req as Request & { role: Role }).role = role;
    next();
  };
}

/* ---------- app ---------- */
const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, '..', 'public')));

app.post('/api/login', (req: Request, res: Response) => {
  const role = roleFor(req.body?.passcode);
  if (!role) return res.status(401).json({ error: 'invalid passcode' });
  res.json({ role, token: req.body.passcode });
});

app.get('/api/session', auth('any'), (req: Request, res: Response) => {
  res.json({ role: (req as Request & { role: Role }).role, master: master.publicKey.toBase58(), rpc: RPC, canCreate: !!funder });
});

app.get('/api/escrows', auth('any'), (_req: Request, res: Response) => {
  res.json(db.map(redact));
});

// Admin creates + funds an escrow (buyer = configured BUYER_SECRET wallet).
app.post('/api/escrows', auth('admin'), async (req: Request, res: Response) => {
  try {
    if (!funder) return res.status(400).json({ error: 'set BUYER_SECRET to create escrows from the dashboard' });
    const { seller, mint, amount } = req.body ?? {};
    if (!seller || !mint || !amount) return res.status(400).json({ error: 'seller, mint, amount required' });
    const record = await backend.open(funder, { seller: new PublicKey(seller), mint: new PublicKey(mint), amount: BigInt(amount) });
    const row: Record = { ...record, id: record.escrow, status: 'active', createdAt: Date.now() };
    db.unshift(row); persist();
    res.json(redact(row));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Moderators (or admins) settle. This fires the master-funded atomic release.
function settleHandler(kind: 'release' | 'refund') {
  return async (req: Request, res: Response) => {
    try {
      const row = db.find((r) => r.id === req.params.id);
      if (!row) return res.status(404).json({ error: 'unknown escrow' });
      if (row.status !== 'active') return res.status(409).json({ error: `escrow already ${row.status}` });
      const result = await backend.settle(row, kind, { viaBundle: Boolean(req.body?.viaBundle) });
      row.status = kind === 'release' ? 'released' : 'refunded';
      row.signature = result.signature;
      persist();
      res.json({ ...redact(row), viaBundle: result.viaBundle });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  };
}
app.post('/api/escrows/:id/release', auth('any'), settleHandler('release'));
app.post('/api/escrows/:id/refund', auth('any'), settleHandler('refund'));

app.listen(PORT, () => {
  process.stderr.write(`[dashboard] http://localhost:${PORT}  (rpc=${RPC}, master=${master.publicKey.toBase58()})\n`);
});
