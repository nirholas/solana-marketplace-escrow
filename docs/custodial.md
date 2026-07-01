# Custodial backend & the admin/moderator console

The `custodial` backend is the `nirholas/atomic` pattern applied to escrow: a
**master wallet** holds SOL, the **platform** holds each escrow wallet's key, and
a release is **one atomic transaction** in which the master pays the fee (+ Jito
tip) and the escrow key signs the token transfer — the master acting *on behalf
of* the escrow wallet, so the escrow never needs its own SOL and nothing rests
exposed.

This is what powers the [admin/moderator dashboard](../apps/dashboard): a
moderator clicks **"Release → seller"** in the web UI, and the server fires the
release. **Moderators hold no keys.**

## Trust model

Custodial **at the platform level**: the backend holds the escrow keys, so the
*platform* is trusted — not the moderators, who never hold a key. This is the
same trust model as `nirholas/atomic` (which holds `CREATOR_SECRET`). For a
trust-free vault where *nobody* — not even the platform — can steal, use the
`program` or `presign` backends.

## API

```ts
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { CustodialBackend } from 'keyless-escrow';

const backend = new CustodialBackend({ connection, master }); // master: funded Keypair

// Buyer deposits into a fresh, platform-held escrow wallet.
const record = await backend.open(buyer, { seller, mint, amount: 1_000_000n });
// record.escrowSecret is stored SERVER-SIDE ONLY.

// Later, a moderator triggers a release from the UI:
await backend.settle(record, 'release');                    // → seller
await backend.settle(record, 'refund',  { viaBundle: true });// → buyer, as a Jito bundle
```

`settle` builds one transaction: **fee payer = master**, **transfer authority =
escrow key**, plus an optional master-paid Jito tip. The only signers are
`{master, escrow}` — both platform-held. It drains the full vault balance and
closes the escrow account, returning rent to the master.

Verified end-to-end on a validator: master funded, escrow signed, seller paid,
moderator not a signer — including through the dashboard's HTTP API (admin create
→ moderator release → seller balance confirmed).

## When to use which

- **Simultaneous on-chain trade?** No escrow — use an [atomic swap](atomic-swap.md).
- **Moderated marketplace, platform is trusted to hold keys?** `custodial` + the dashboard.
- **Nobody should be able to steal, ever?** `program` (PDA) or `presign`.
