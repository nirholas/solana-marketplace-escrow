# Non-Custodial Solana Escrow — a keyless vault where moderators can release funds but never steal them

**`solana-marketplace-escrow`** is a non-custodial, arbiter-mediated **escrow for
Solana**. The escrow vault has **no usable private key**, so a P2P marketplace
moderator can **release** funds to a participant but can **never steal** them.

> The escrow where the moderator can't run off with the money.

TypeScript SDK · Anchor PDA program · MCP server · x402 pay-per-use API · live demo.

**▸ Live demo:** https://nirholas.github.io/solana-marketplace-escrow/ — keyless escrow, atomic swaps, and the moderator console, running real devnet transactions in your browser.

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

## Three backends, one API

| Backend     | Trust model | Needs a deployed program? | Best for |
|-------------|-------------|---------------------------|----------|
| **`presign`** | keyless by **convention** (ephemeral key destroyed) | No — runs today, anywhere | Fast integration, zero deploy |
| **`program`** | keyless by **construction** (PDA has no key) | Yes — Anchor PDA program  | Production / maximal assurance |
| **`custodial`** | **platform-custodial** (backend holds keys) | No | Admin/moderator console; master-funded atomic release (the `nirholas/atomic` pattern) |

The first two are **keyless** — nobody can steal, not even the platform. The
third, **`custodial`**, is the pattern you may actually want for a moderated
marketplace: the **platform** holds a master wallet (SOL) + each escrow key, and
a **moderator releases from a web console** — the backend fires **one atomic
transaction** where the master pays the fee and the escrow key signs the
transfer (the master acting *on behalf of* the escrow wallet). Moderators hold no
keys. See [`apps/dashboard`](apps/dashboard) and [docs/custodial.md](docs/custodial.md).
Verified end-to-end: admin creates an escrow → moderator clicks release → seller paid.

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

## Custody vs. atomicity — which layer solves what?

A common instinct is to reach for Jito bundles or atomic swaps to stop a
moderator stealing. They're the wrong *layer* for **custody** — but they're
exactly right for their own layer, and **this SDK ships both** (see
[Atomic swaps & Jito bundles](#atomic-swaps--jito-bundles)). The point below isn't
"don't use them" — it's "use each for the job it actually does."

| Mechanism | Layer it solves | Stops a moderator stealing? | In this repo |
|-----------|-----------------|-----------------------------|--------------|
| **Jito bundle** | delivery — atomic, ordered, front-run-proof | ❌ a delivery envelope, not authorization; every tx still needs its own signatures | ✅ used for atomic settlement — `{ viaBundle: true }` |
| **Atomic swap** | simultaneous trade — both legs or neither | ❌ n/a — it removes the *need* for escrow when the trade is instant | ✅ first-class `AtomicSwapClient` |
| **Multisig** (Squads) | key threshold — no single key | ❌ a quorum can still send funds anywhere | recommended for the arbiter / upgrade authority |
| **Keyless vault** (PDA / presign) | **custody — destination is fixed, not chosen** | ✅ **yes, structurally** | ✅ the core primitive |

So: **keyless vault** for custody, **Jito bundles** for atomic settlement,
**atomic swaps** for the instant-trade happy path — each doing the one job it's
good at, all in this SDK.

## Atomic swaps & Jito bundles

Escrow is for the *asynchronous* trade. When a trade is **simultaneous and fully
on-chain**, you don't need escrow at all — settle it as an **atomic swap**: both
assets move in one transaction, both parties sign, either both legs execute or
neither does. No custody, no arbiter. (Verified on-chain: 1.0 token A ↔ 2.0 token
B in a single tx.)

```ts
import { AtomicSwapClient } from 'keyless-escrow';
const swap = new AtomicSwapClient({ connection });
await swap.execute(
  { a: { owner: alice.publicKey, mint: tokenA, amount: 1_000_000n },
    b: { owner: bob.publicKey,   mint: tokenB, amount: 2_000_000_000n } },
  [alice, bob],                          // both sign — the atomicity guarantee
  { viaBundle: true },                   // optional: front-run-proof via Jito
);
```

And **Jito bundles** are a real, tipped integration — a settlement or swap can be
delivered as an atomic, front-run-proof bundle (with the required tip to a Jito
tip account, which a naive `sendBundle` omits):

```ts
await escrowSvc.settle(escrow, 'release:by-arbiter', arbiter, { viaBundle: true });
```

See [docs/atomic-swap.md](docs/atomic-swap.md) and [docs/jito.md](docs/jito.md).

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
| [`program`](program) | Anchor PDA escrow program (the `program` backend) | ✅ Compiles + on-chain lifecycle verified (`E8Spo…Ckda`) |
| [`packages/mcp`](packages/mcp) | MCP server exposing the escrow lifecycle as agent tools | ✅ Ready — handshake verified |
| [`packages/x402`](packages/x402) | x402 pay-per-use escrow-as-a-service API | ✅ Ready — builds & serves |
| [`apps/dashboard`](apps/dashboard) | Admin/moderator web console (custodial atomic release) | ✅ Ready — E2E verified |
| [`demo`](demo) | Browser demo of the full lifecycle on devnet | ✅ Ready — builds |
| [`examples`](examples) | Runnable end-to-end scripts | ✅ Devnet lifecycle |

## Documentation

- [specs/protocol.md](specs/protocol.md) — the normative authorization model + wire formats
- [docs/architecture.md](docs/architecture.md) — how the pieces fit together
- [docs/atomic-swap.md](docs/atomic-swap.md) — custody-free P2P swaps · [docs/jito.md](docs/jito.md) — atomic bundle settlement
- [docs/custodial.md](docs/custodial.md) — the custodial backend + admin/moderator console (`nirholas/atomic` pattern)
- [docs/security-model.md](docs/security-model.md) — threat model + trust assumptions
- [program/AUDIT.md](program/AUDIT.md) — audit scope + invariants · [docs/deployment.md](docs/deployment.md) — mainnet runbook
- [SECURITY.md](SECURITY.md) · [CONTRIBUTING.md](CONTRIBUTING.md) · [CHANGELOG.md](CHANGELOG.md)

## Security model

The SDK ships **offline security-invariant tests** (`npm test -w keyless-escrow`)
that prove the construction rather than assert it: required signers are exactly
`{vault, authorizer}`, destinations are fixed before the vault signs, any
destination change breaks the signed message (theft attempt fails), and only the
designated authorizer can complete each outcome.

The on-chain `program` backend is verified end-to-end against a Solana validator:
opening deposits into the keyless PDA vault, the arbiter releases to the seller,
and an **unauthorized signer attempting to release is rejected by the program**
(the seller cannot pay themselves).

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

All rights reserved. See [LICENSE](LICENSE).
