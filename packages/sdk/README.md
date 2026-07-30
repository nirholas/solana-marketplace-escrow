# keyless-escrow

**Non-custodial, arbiter-mediated escrow for Solana.** The escrow vault has no
usable private key, so a moderator can **release** funds to a participant but can
**never steal** them.

```bash
git clone https://github.com/nirholas/solana-marketplace-escrow.git
cd solana-marketplace-escrow
npm install && npm run build
```

`keyless-escrow` is not published to npm yet, so install it from source and
depend on `packages/sdk` (a workspace link, `file:` reference, or git URL).

## The problem this solves

The naive way to run a P2P marketplace with a human moderator is: put the funds in
an escrow wallet, and give the moderator that wallet's private key so they can pay
out the winner of a dispute. That key can send funds **anywhere** — one leak, one
compromised laptop, one rogue moderator, and every escrow on the platform drains.
A `Keypair.fromSecretKey(...)` escrow is a loaded gun.

`keyless-escrow` removes the gun. The moderator never holds a key that can move
money to an arbitrary address. Their entire power is reduced to **selecting one of
a few outcomes the buyer fixed in advance** — release to the seller, or refund to
the buyer. The destinations are immutable; the moderator only picks which one fires.

## How it works

Two interchangeable backends, one API:

| Backend     | Vault is keyless… | Needs a deployed program? | Use when |
|-------------|-------------------|---------------------------|----------|
| `presign`   | …by **convention**  | No — runs anywhere today  | Fast integration, no on-chain deploy |
| `program`   | …by **construction** | Yes — Anchor PDA program | Production / maximal assurance |

### `presign` backend (this package's default)

1. Generate an **ephemeral vault** token account and a **durable nonce** account.
2. The buyer deposits the tokens into the vault.
3. The vault key pre-signs the **complete set of fixed-destination outcomes**:

   | Outcome              | Pays    | Authorized by | When |
   |----------------------|---------|---------------|------|
   | `release:by-buyer`   | seller  | buyer         | buyer confirms delivery |
   | `release:by-arbiter` | seller  | arbiter       | dispute → seller |
   | `refund:by-seller`   | buyer   | seller        | seller cancels |
   | `refund:by-arbiter`  | buyer   | arbiter       | dispute → buyer |

4. The vault key is **destroyed**. From here, the *only* transactions that can
   ever move the funds are those four — each missing exactly one signature: its
   authorizer's. A durable nonce keeps them valid indefinitely, and settling any
   one of them advances the nonce, atomically voiding the other three.

The asymmetry is the safety property: the **buyer can only ever push funds to the
seller**, the **seller can only ever push funds to the buyer**, and the **arbiter
can pick either party but can never redirect funds to a third address** — there is
no instruction in any prepared outcome that pays anyone else, and no key to forge
a new one.

> **Trust note (presign):** the guarantee rests on the vault key actually being
> destroyed. This SDK generates it ephemerally, never persists it, never returns
> it, and overwrites it after signing — but JavaScript's managed memory cannot
> *prove* zeroization. For a vault that is keyless *by construction* (a PDA, which
> has no private key in existence), use the `program` backend.

### Atomic settlement (Jito)

Settlement can be delivered as a **Jito bundle** so a multi-step resolution
(release + protocol fee + account close) lands indivisibly, in order, with no
front-running window. A bundle is the *delivery van* — it never changes who must
sign. Authorization comes entirely from the keyless-vault model above.

## Usage

```ts
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { PresignBackend } from 'keyless-escrow';

const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
const escrowSvc = new PresignBackend({ connection });

// Buyer opens + funds the escrow. `buyer` must already hold `amount` of `mint`.
const escrow = await escrowSvc.open(buyer, {
  parties: {
    buyer: buyer.publicKey,
    seller: new PublicKey(SELLER),
    arbiter: new PublicKey(ARBITER),
  },
  mint: new PublicKey(MINT),
  amount: 1_000_000n, // 1.0 of a 6-decimal token
});

console.log(escrow.vaultKeyDestroyed); // true — nothing can move funds off-script now

// Happy path: buyer confirms delivery, releasing to the seller.
await escrowSvc.settle(escrow, 'release:by-buyer', buyer);

// Dispute path: only the arbiter can run this, and it can ONLY pay the seller.
await escrowSvc.settle(escrow, 'release:by-arbiter', arbiter, { viaBundle: true });

// Check state at any time.
const { funded, settled, balance } = await escrowSvc.status(escrow);
```

The SDK refuses to settle an outcome with the wrong key:

```ts
// throws: outcome 'release:by-arbiter' must be authorized by the arbiter …
await escrowSvc.settle(escrow, 'release:by-arbiter', buyer);
```

## API

- `new PresignBackend({ connection })`
- `open(funder, params) → KeylessEscrow` — set up vault + nonce, deposit, pre-sign all outcomes, destroy the vault key.
- `settle(escrow, outcomeId, authorizer, { viaBundle? }) → SettlementResult` — complete one outcome; optionally via a Jito bundle.
- `status(escrow) → { funded, settled, balance }`
- `standardOutcomes(parties)` — the four-outcome safe authorization model.
- `buildOutcomeTransaction(args)` — the pure, RPC-free transaction builder (what the invariant tests exercise).
- `sendJitoBundle(transactions, options)` — submit fully-signed txs as one atomic bundle.

## Running the example

```bash
# Funds two throwaway devnet keypairs, runs the full open → settle lifecycle.
node --experimental-strip-types examples/devnet-lifecycle.ts
```

See [`examples/devnet-lifecycle.ts`](../../examples/devnet-lifecycle.ts).

## Tests

```bash
npm test   # offline security-invariant tests — no RPC, no funds
```

The suite proves the construction is sound: required signers are exactly
`{vault, authorizer}`, destinations are fixed before the vault signs, a
destination change breaks the signed message (theft attempt fails), and only the
designated authorizer can complete each outcome.

## License

MIT
