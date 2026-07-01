# Non-Custodial Solana Escrow — a keyless vault where moderators can release funds but never steal them

**`solana-marketplace-escrow`** is a non-custodial, arbiter-mediated **escrow for
Solana**. The escrow vault has **no usable private key**, so a P2P marketplace
moderator can **release** funds to a participant but can **never steal** them.

> The escrow where the moderator can't run off with the money.

TypeScript SDK · Anchor PDA program · MCP server · x402 pay-per-use API · live demo.

---

## The problem

The naive way to run a marketplace with a human moderator is to hold funds in an
escrow wallet and hand the moderator that wallet's **private key** so they can pay
out dispute winners. That key can send funds **anywhere** — one leak, one
compromised laptop, one rogue moderator, and *every* escrow drains at once. A
`Keypair.fromSecretKey(...)` escrow is a loaded gun pointed at every user's money.

This is not hypothetical. It's how most "escrow" bots and many marketplace
backends actually work today: a hot key in an environment variable with unlimited
authority over pooled funds.

## The insight

You cannot leak a key that does not exist.

Put the funds where **no drainable key exists**, and reduce the moderator's power
from *"move money anywhere"* to *"pick one of a few outcomes the buyer fixed in
advance."* The moderator becomes a **referee, not a custodian**: they can declare
the winner, but the destinations were set at funding time and cannot be changed.

The safe authorization model, enforced by construction:

| Outcome              | Pays    | Authorized by | When |
|----------------------|---------|---------------|------|
| `release:by-buyer`   | seller  | buyer         | buyer confirms delivery (happy path) |
| `release:by-arbiter` | seller  | arbiter       | dispute resolved for the seller |
| `refund:by-seller`   | buyer   | seller        | seller cancels (happy path) |
| `refund:by-arbiter`  | buyer   | arbiter       | dispute resolved for the buyer |

- The **buyer** can only ever push funds **to the seller**. Never a self-refund.
- The **seller** can only ever push funds **to the buyer**. Never a self-payout.
- The **arbiter** can pick either party — but can **never** redirect funds to a
  third address, including their own. There is no instruction, in any outcome,
  that pays anyone else, and no key to forge a new one.

## Two backends, one API

| Backend     | Vault is keyless…    | Needs a deployed program? | Best for |
|-------------|----------------------|---------------------------|----------|
| **`presign`** | …by **convention**   | No — runs today, anywhere | Fast integration, zero deploy |
| **`program`** | …by **construction** | Yes — Anchor PDA program  | Production / maximal assurance |

**`presign`** — an ephemeral vault token account and a **durable nonce** hold the
funds. The vault key pre-signs the complete set of fixed-destination outcomes,
then is **destroyed**. From that moment, the only transactions that can ever move
the funds are those four — each missing exactly one signature (its authorizer's),
each paying a destination fixed at funding time. Settling one advances the nonce,
atomically voiding the rest.

**`program`** — funds live in a **Program Derived Address**, which is provably
off-curve: **no private key exists** for it. Only the escrow program can move the
funds, via `invoke_signed`, and only into a destination its code hardcodes. The
arbiter is a stored pubkey whose signature merely *triggers* a constrained
instruction. This is keyless *by construction* — nothing to leak, ever.

Both settle atomically, optionally as a **Jito bundle**, so a multi-step
resolution (release + fee + account close) lands indivisibly with no
front-running window.

## Why not just use…?

| Mechanism | What it actually gives you | Why it's not enough alone |
|-----------|----------------------------|---------------------------|
| **Jito bundle** | Atomic, ordered, front-run-proof execution | It's a delivery envelope, not authorization — every tx in it still needs a valid signature. It never changes *who can sign*. |
| **Atomic swap** | Trustless simultaneous exchange of two on-chain assets | Makes escrow *unnecessary* when both legs are simultaneous; useless the moment there's a time gap or a third-party dispute. |
| **Multisig** (e.g. Squads) | No *single* key controls the funds | Still key-based custody: a quorum can send funds *anywhere*. It bounds *how many* sign, not *where money goes*. A colluding quorum can steal. |
| **PDA escrow program** | The **program**, not any keyholder, decides where funds go | ✅ The right primitive. This is what makes "release but can't steal" structural. |

This project uses the keyless-vault model for **custody** and Jito bundles for
**atomic settlement** — the two layers the alternatives conflate.

## Quickstart

```bash
npm install keyless-escrow @solana/web3.js
```

```ts
import { Connection, PublicKey } from '@solana/web3.js';
import { PresignBackend } from 'keyless-escrow';

const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
const escrowSvc = new PresignBackend({ connection });

// Buyer opens + funds the escrow (buyer must already hold `amount` of `mint`).
const escrow = await escrowSvc.open(buyer, {
  parties: { buyer: buyer.publicKey, seller: SELLER, arbiter: ARBITER },
  mint: MINT,
  amount: 1_000_000n, // 1.0 of a 6-decimal token
});

escrow.vaultKeyDestroyed; // true — nothing can move the funds off-script now

// Dispute resolved for the seller. ONLY the arbiter can run this, and it can
// ONLY pay the seller — never the arbiter.
await escrowSvc.settle(escrow, 'release:by-arbiter', arbiter, { viaBundle: true });
```

Run the full lifecycle live on devnet:

```bash
node --experimental-strip-types examples/devnet-lifecycle.ts
```

## Repository layout

| Path | What it is | Status |
|------|-----------|--------|
| [`packages/sdk`](packages/sdk) | **`keyless-escrow`** — the TypeScript SDK (presign backend, Jito settlement, outcomes) | ✅ Ready — tested |
| [`program`](program) | Anchor PDA escrow program (the `program` backend) | 🚧 In progress |
| [`packages/mcp`](packages/mcp) | MCP server exposing the escrow lifecycle as agent tools | ✅ Ready — handshake verified |
| [`packages/x402`](packages/x402) | x402 pay-per-use escrow-as-a-service API | ✅ Ready — builds & serves |
| [`demo`](demo) | Browser demo of the full lifecycle on devnet | ✅ Ready — builds |
| [`examples`](examples) | Runnable end-to-end scripts | ✅ Devnet lifecycle |

## Security model

The SDK ships **offline security-invariant tests** (`npm test -w keyless-escrow`)
that prove the construction rather than assert it: required signers are exactly
`{vault, authorizer}`, destinations are fixed before the vault signs, any
destination change breaks the signed message (theft attempt fails), and only the
designated authorizer can complete each outcome.

**Trust note (presign backend):** the guarantee rests on the ephemeral vault key
actually being destroyed. The SDK generates it, never persists it, never returns
it, and overwrites it after signing — but JavaScript's managed memory cannot
*prove* zeroization. For a vault that is keyless *by construction*, use the
`program` backend (a PDA has no private key in existence).

## Development

```bash
npm install
npm test --workspaces --if-present   # run every package's tests
npm run build --workspaces --if-present
```

## License

MIT — see [LICENSE](LICENSE).
