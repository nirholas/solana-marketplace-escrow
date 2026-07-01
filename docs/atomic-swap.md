# Atomic swaps

An **atomic swap** exchanges two assets between two parties in **one
transaction** — either both legs settle or neither does. There is no custody
window and no arbiter: it is the trustless happy path for a simultaneous
on-chain trade.

Use it when both sides of the trade are on-chain and available *now* (token ↔
token, or token ↔ SOL). Use the [escrow](../specs/protocol.md) instead when the
exchange is asynchronous (goods/services delivered later) or a dispute may need a
moderator — the case an atomic swap cannot express.

Verified on-chain: Alice's 1.0 token A ↔ Bob's 2.0 token B settled in a single
transaction; neither party could take without giving.

## API

```ts
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { AtomicSwapClient } from 'keyless-escrow';

const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
const swap = new AtomicSwapClient({ connection });

// Alice gives 1.0 of tokenA, Bob gives 2.0 of tokenB — atomically.
const { signature } = await swap.execute(
  {
    a: { owner: alice.publicKey, mint: tokenA, amount: 1_000_000n },
    b: { owner: bob.publicKey,   mint: tokenB, amount: 2_000_000_000n },
    feePayer: alice.publicKey,
  },
  [alice, bob], // BOTH parties sign — that's the atomicity guarantee
);
```

Native SOL as a leg — just omit `mint` (amount is lamports):

```ts
await swap.execute(
  {
    a: { owner: alice.publicKey, amount: 1_000_000_000n },        // 1 SOL
    b: { owner: bob.publicKey, mint: tokenB, amount: 500_000n },  // 0.5 tokenB
  },
  [alice, bob],
);
```

Deliver it front-run-proof as a Jito bundle (see [jito.md](jito.md)):

```ts
await swap.execute(params, [alice, bob], { viaBundle: true, tipLamports: 100_000 });
```

## Pure builder

`buildAtomicSwapTransaction(params, recentBlockhash)` returns the unsigned
transaction (RPC-free) — useful for offline construction, inspection, or
multi-party signing flows. This is what the invariant tests exercise: both owners
are required signers, and each leg's destination is the counterparty's associated
token account.

## MCP

The MCP server exposes `atomic_swap` (executes when it holds both owner keys) —
see [../packages/mcp/README.md](../packages/mcp/README.md).
