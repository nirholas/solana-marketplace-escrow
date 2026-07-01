# Jito bundles

A **Jito bundle** delivers up to 5 fully-signed transactions to the block leader
privately, executed **sequentially, atomically, all-or-nothing, in one slot**. No
searcher can interleave a transaction between the legs, so a multi-step
settlement (or an atomic swap) lands with no exploitable intermediate state and
no front-running.

Two things people get wrong, and this SDK gets right:

1. **A bundle needs a tip.** Every bundle must transfer a tip to a Jito tip
   account, or the Block Engine drops it. `jitoTipInstruction(...)` builds it and
   the settle/swap paths add it automatically.
2. **A bundle is not authorization.** It changes delivery only — every
   transaction still carries all required signatures. Custody in this project
   comes from the keyless vault and the fixed-destination outcomes, never from
   bundling.

## API

```ts
import {
  jitoTipInstruction, sendBundleAndConfirm, getBundleStatuses,
  getJitoTipAccounts, JITO_TIP_ACCOUNTS, JITO_BLOCK_ENGINES,
} from 'keyless-escrow';

// Add a tip to a transaction before signing:
tx.add(jitoTipInstruction(payer.publicKey, 100_000)); // 0.0001 SOL

// Send a bundle and wait for it to land:
const { bundleId, landedSlot } = await sendBundleAndConfirm([tx1, tx2], {
  blockEngineUrl: JITO_BLOCK_ENGINES.ny,
});

// Or poll status yourself:
const [status] = await getBundleStatuses([bundleId]);
```

Tip accounts are shipped statically (`JITO_TIP_ACCOUNTS`) and can be refreshed at
runtime via `getJitoTipAccounts()`. `randomTipAccount()` spreads load and avoids a
predictable target.

## Where it's used

- **Escrow settlement** — `settle(escrow, outcomeId, authorizer, { viaBundle: true })`.
  For the `presign` backend the tip rides in a separate authorizer-signed tx (the
  pre-signed outcome must not be modified); for the `program` backend the tip is
  embedded in the settle tx.
- **Atomic swaps** — `swap.execute(params, signers, { viaBundle: true })`.

## Notes

- Bundles require a live Block Engine (mainnet). On devnet/localnet, use the
  direct (non-bundle) path; the bundle construction (tip + assembly) is covered
  by offline tests.
- Raise `tipLamports` when the network is congested to compete for inclusion.
