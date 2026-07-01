#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Connection, PublicKey } from '@solana/web3.js';
import {
  PresignBackend,
  serializeEscrow,
  deserializeEscrow,
  type Party,
} from 'keyless-escrow';
import { z } from 'zod';
import { SignerRegistry } from './keys.js';
import { EscrowStore } from './store.js';

const RPC = process.env.SOLANA_RPC ?? 'https://api.devnet.solana.com';
const connection = new Connection(RPC, 'confirmed');
const signers = SignerRegistry.fromEnv();
const store = EscrowStore.fromEnv();
const svc = new PresignBackend({ connection });

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

const ok = (data: unknown): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
});
const fail = (message: string): ToolResult => ({
  content: [{ type: 'text', text: message }],
  isError: true,
});

/** Wrap a handler so thrown errors surface as tool errors, not crashes. */
function guard<A extends unknown[]>(
  fn: (...args: A) => Promise<ToolResult>,
): (...args: A) => Promise<ToolResult> {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  };
}

const server = new McpServer({ name: 'keyless-escrow', version: '0.1.0' });

server.registerTool(
  'escrow_signers',
  {
    title: 'List signer keys',
    description:
      'List the Solana public keys this server holds. The server can only settle an outcome ' +
      'whose authorizer key appears here — e.g. a moderator running with only their arbiter key ' +
      'can resolve disputes but can do nothing else.',
    inputSchema: {},
  },
  guard(async () => ok({ rpc: RPC, signers: signers.pubkeys() })),
);

server.registerTool(
  'escrow_open',
  {
    title: 'Open and fund a keyless escrow',
    description:
      'Open a non-custodial escrow: create the keyless vault, deposit the tokens, pre-sign the ' +
      'four fixed-destination outcomes, and destroy the vault key. The buyer/funder must be a key ' +
      'this server holds. Returns the escrow id (the vault address).',
    inputSchema: {
      seller: z.string().describe('Seller (beneficiary) wallet address'),
      arbiter: z.string().describe('Arbiter (moderator) wallet address'),
      mint: z.string().describe('SPL token mint to escrow'),
      amount: z.string().describe('Amount in the mint base units (atomics), as a string'),
      buyer: z
        .string()
        .optional()
        .describe('Buyer/funder wallet address (must be a held key; defaults to the sole held key)'),
      memo: z.string().optional().describe('Optional reference (order id / invoice / terms CID)'),
    },
  },
  guard(async ({ seller, arbiter, mint, amount, buyer, memo }) => {
    const funder = buyer ? signers.get(buyer) : signers.soleKey();
    if (!funder) {
      return fail(
        buyer
          ? `this server does not hold the buyer key ${buyer}`
          : `specify 'buyer': this server holds ${signers.pubkeys().length} keys, not exactly one`,
      );
    }
    const parties = {
      buyer: funder.publicKey,
      seller: new PublicKey(seller),
      arbiter: new PublicKey(arbiter),
    };
    const escrow = await svc.open(funder, { parties, mint: new PublicKey(mint), amount: BigInt(amount), memo });
    const id = store.put(serializeEscrow(escrow));
    return ok({
      escrowId: id,
      vault: escrow.vault.toBase58(),
      vaultKeyDestroyed: escrow.vaultKeyDestroyed,
      mint: escrow.mint.toBase58(),
      amount: escrow.amount.toString(),
      parties: {
        buyer: parties.buyer.toBase58(),
        seller: parties.seller.toBase58(),
        arbiter: parties.arbiter.toBase58(),
      },
      outcomes: escrow.outcomes.map((o) => ({
        id: o.id,
        pays: o.destinationOwner.toBase58(),
        authorizedBy: o.authorizer,
        settleableByThisServer: signers.has(parties[o.authorizer as Party].toBase58()),
      })),
    });
  }),
);

server.registerTool(
  'escrow_list',
  {
    title: 'List stored escrows',
    description: 'List every escrow this server has opened, with a one-line summary each.',
    inputSchema: {},
  },
  guard(async () =>
    ok(
      store.list().map((e) => ({
        escrowId: e.vault,
        mint: e.mint,
        amount: e.amount,
        buyer: e.parties.buyer,
        seller: e.parties.seller,
        arbiter: e.parties.arbiter,
      })),
    ),
  ),
);

server.registerTool(
  'escrow_get',
  {
    title: 'Get an escrow',
    description: 'Return the full escrow record, including which outcomes this server can settle.',
    inputSchema: { escrowId: z.string().describe('Escrow id (vault address)') },
  },
  guard(async ({ escrowId }) => {
    const e = store.get(escrowId);
    if (!e) return fail(`unknown escrow '${escrowId}'`);
    return ok({
      ...e,
      settleableOutcomes: e.outcomes
        .filter((o) => signers.has(e.parties[o.authorizer]))
        .map((o) => o.id),
    });
  }),
);

server.registerTool(
  'escrow_status',
  {
    title: 'Escrow on-chain status',
    description: 'Check the live on-chain status of an escrow: funded balance and whether it has settled.',
    inputSchema: { escrowId: z.string().describe('Escrow id (vault address)') },
  },
  guard(async ({ escrowId }) => {
    const e = store.get(escrowId);
    if (!e) return fail(`unknown escrow '${escrowId}'`);
    const status = await svc.status(deserializeEscrow(e));
    return ok({ escrowId, funded: status.funded, settled: status.settled, balance: status.balance.toString() });
  }),
);

server.registerTool(
  'escrow_settle',
  {
    title: 'Settle an escrow outcome',
    description:
      'Complete one outcome (e.g. release:by-arbiter). The server signs with the held key that the ' +
      'outcome designates as authorizer; it refuses outcomes whose key it does not hold. Optionally ' +
      'delivers the settlement atomically via a Jito bundle.',
    inputSchema: {
      escrowId: z.string().describe('Escrow id (vault address)'),
      outcomeId: z
        .enum(['release:by-buyer', 'release:by-arbiter', 'refund:by-seller', 'refund:by-arbiter'])
        .describe('Which fixed-destination outcome to settle'),
      viaBundle: z.boolean().optional().describe('Deliver atomically as a Jito bundle'),
    },
  },
  guard(async ({ escrowId, outcomeId, viaBundle }) => {
    const e = store.get(escrowId);
    if (!e) return fail(`unknown escrow '${escrowId}'`);
    const escrow = deserializeEscrow(e);
    const outcome = escrow.outcomes.find((o) => o.id === outcomeId);
    if (!outcome) return fail(`unknown outcome '${outcomeId}'`);

    const authorizerPubkey = escrow.parties[outcome.authorizer as Party].toBase58();
    const signer = signers.get(authorizerPubkey);
    if (!signer) {
      return fail(
        `this server does not hold the ${outcome.authorizer} key (${authorizerPubkey}) required ` +
          `to settle '${outcomeId}'. Only the party controlling that key can authorize this outcome.`,
      );
    }
    const result = await svc.settle(escrow, outcomeId, signer, { viaBundle });
    return ok({ settled: outcomeId, signature: result.signature, viaBundle: result.viaBundle });
  }),
);

async function main() {
  await server.connect(new StdioServerTransport());
  // stderr only — stdout is the MCP transport channel.
  process.stderr.write(
    `keyless-escrow MCP server ready (rpc=${RPC}, signers=${signers.pubkeys().length})\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
