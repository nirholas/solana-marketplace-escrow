import express, { type Express, type Request, type Response } from 'express';
import { Connection, PublicKey } from '@solana/web3.js';
import {
  PresignBackend,
  serializeEscrow,
  deserializeEscrow,
  standardOutcomes,
  type Party,
} from 'keyless-escrow';
import { paymentMiddleware, x402ResourceServer } from '@x402/express';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { ExactSvmScheme } from '@x402/svm/exact/server';
import { SignerRegistry } from './keys.js';
import { EscrowStore } from './store.js';

/** CAIP-2 network identifier, e.g. `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`. */
export type Caip2 = `${string}:${string}`;

export interface X402Config {
  rpc: string;
  /** Solana address that receives x402 payments. When unset, routes are free (dev mode). */
  payTo?: string;
  /** CAIP-2 network id for settlement (default Solana mainnet). */
  network: Caip2;
  facilitatorUrl: string;
  openPrice: string;
  settlePrice: string;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): X402Config {
  return {
    rpc: env.SOLANA_RPC ?? 'https://api.devnet.solana.com',
    payTo: env.X402_PAY_TO,
    network: (env.X402_NETWORK ?? 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp') as Caip2,
    facilitatorUrl: env.X402_FACILITATOR ?? 'https://facilitator.x402.org',
    openPrice: env.X402_OPEN_PRICE ?? '$0.10',
    settlePrice: env.X402_SETTLE_PRICE ?? '$0.05',
  };
}

/**
 * Build the escrow-as-a-service Express app.
 *
 * Paid endpoints (via x402):
 *   POST /escrow/open    — open + fund a keyless escrow
 *   POST /escrow/settle  — settle one fixed-destination outcome
 * Free endpoints:
 *   GET  /               — service info + pricing
 *   GET  /outcomes       — the four-outcome authorization model
 *   GET  /escrow         — list escrows this operator opened
 *   GET  /escrow/get     — ?id= full escrow record
 *   GET  /escrow/status  — ?id= live on-chain status
 */
export function createApp(config: X402Config = configFromEnv()): Express {
  const connection = new Connection(config.rpc, 'confirmed');
  const signers = SignerRegistry.fromEnv();
  const store = EscrowStore.fromEnv();
  const svc = new PresignBackend({ connection });

  const app = express();
  app.use(express.json());

  // Attach the x402 paywall to the value-producing routes when a payee is set.
  if (config.payTo) {
    const facilitator = new HTTPFacilitatorClient({ url: config.facilitatorUrl });
    const resourceServer = new x402ResourceServer(facilitator).register(
      config.network,
      new ExactSvmScheme(),
    );
    app.use(
      paymentMiddleware(
        {
          'POST /escrow/open': {
            accepts: { scheme: 'exact', price: config.openPrice, network: config.network, payTo: config.payTo },
            description: 'Open and fund a keyless, non-custodial Solana escrow',
          },
          'POST /escrow/settle': {
            accepts: { scheme: 'exact', price: config.settlePrice, network: config.network, payTo: config.payTo },
            description: 'Settle one fixed-destination escrow outcome',
          },
        },
        resourceServer,
      ),
    );
  }

  const fail = (res: Response, code: number, message: string) => res.status(code).json({ error: message });

  app.get('/', (_req: Request, res: Response) => {
    res.json({
      service: 'keyless-escrow-x402',
      description: 'Non-custodial Solana escrow as a pay-per-use API. A moderator can release funds but never steal them.',
      network: config.network,
      paywall: config.payTo ? 'x402 enabled' : 'disabled (dev mode — set X402_PAY_TO)',
      pricing: { 'POST /escrow/open': config.openPrice, 'POST /escrow/settle': config.settlePrice },
      endpoints: ['GET /outcomes', 'POST /escrow/open', 'GET /escrow', 'GET /escrow/get?id=', 'GET /escrow/status?id=', 'POST /escrow/settle'],
      signers: signers.pubkeys(),
    });
  });

  app.get('/outcomes', (_req: Request, res: Response) => {
    const parties = { buyer: PublicKey.default, seller: PublicKey.default, arbiter: PublicKey.default };
    res.json({
      model: 'Only these four outcomes can ever happen. Destinations are fixed at funding time.',
      outcomes: standardOutcomes(parties).map((o) => ({
        id: o.id,
        pays: o.kind === 'release' ? 'seller' : 'buyer',
        authorizedBy: o.authorizer,
        when: o.description,
      })),
    });
  });

  app.post('/escrow/open', async (req: Request, res: Response) => {
    try {
      const { seller, arbiter, mint, amount, buyer, memo } = req.body ?? {};
      if (!seller || !arbiter || !mint || !amount) {
        return fail(res, 400, 'seller, arbiter, mint and amount are required');
      }
      const funder = buyer ? signers.get(buyer) : signers.soleKey();
      if (!funder) {
        return fail(res, 400, buyer ? `operator does not hold buyer key ${buyer}` : 'specify buyer (operator holds != 1 key)');
      }
      const parties = { buyer: funder.publicKey, seller: new PublicKey(seller), arbiter: new PublicKey(arbiter) };
      const escrow = await svc.open(funder, { parties, mint: new PublicKey(mint), amount: BigInt(amount), memo });
      const id = store.put(serializeEscrow(escrow));
      res.json({
        escrowId: id,
        vault: escrow.vault.toBase58(),
        vaultKeyDestroyed: escrow.vaultKeyDestroyed,
        amount: escrow.amount.toString(),
        outcomes: escrow.outcomes.map((o) => ({ id: o.id, pays: o.destinationOwner.toBase58(), authorizedBy: o.authorizer })),
      });
    } catch (err) {
      fail(res, 500, err instanceof Error ? err.message : String(err));
    }
  });

  app.post('/escrow/settle', async (req: Request, res: Response) => {
    try {
      const { escrowId, outcomeId, viaBundle } = req.body ?? {};
      const stored = store.get(escrowId);
      if (!stored) return fail(res, 404, `unknown escrow '${escrowId}'`);
      const escrow = deserializeEscrow(stored);
      const outcome = escrow.outcomes.find((o) => o.id === outcomeId);
      if (!outcome) return fail(res, 400, `unknown outcome '${outcomeId}'`);
      const authorizerPubkey = escrow.parties[outcome.authorizer as Party].toBase58();
      const signer = signers.get(authorizerPubkey);
      if (!signer) {
        return fail(res, 403, `operator does not hold the ${outcome.authorizer} key (${authorizerPubkey}) required to settle '${outcomeId}'`);
      }
      const result = await svc.settle(escrow, outcomeId, signer, { viaBundle: Boolean(viaBundle) });
      res.json({ settled: outcomeId, signature: result.signature, viaBundle: result.viaBundle });
    } catch (err) {
      fail(res, 500, err instanceof Error ? err.message : String(err));
    }
  });

  app.get('/escrow', (_req: Request, res: Response) => {
    res.json(store.list().map((e) => ({ escrowId: e.vault, mint: e.mint, amount: e.amount, parties: e.parties })));
  });

  app.get('/escrow/get', (req: Request, res: Response) => {
    const stored = store.get(String(req.query.id ?? ''));
    if (!stored) return fail(res, 404, 'unknown escrow');
    res.json(stored);
  });

  app.get('/escrow/status', async (req: Request, res: Response) => {
    try {
      const stored = store.get(String(req.query.id ?? ''));
      if (!stored) return fail(res, 404, 'unknown escrow');
      const status = await svc.status(deserializeEscrow(stored));
      res.json({ escrowId: stored.vault, funded: status.funded, settled: status.settled, balance: status.balance.toString() });
    } catch (err) {
      fail(res, 500, err instanceof Error ? err.message : String(err));
    }
  });

  return app;
}
