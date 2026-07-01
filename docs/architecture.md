# Architecture

keyless-escrow is a small SDK with two interchangeable backends and three
consumers, over one authorization model.

```
                         ┌──────────────────────────────────────┐
                         │            keyless-escrow SDK          │
                         │                                        │
   standardOutcomes ─────┤  outcomes.ts   (the 4-outcome model)   │
                         │                                        │
        ┌────────────────┤  PresignBackend   ProgramBackend       │
        │                │   (durable-nonce   (on-chain PDA)       │
        │                │    pre-signed)                          │
        │                └───────┬───────────────────┬────────────┘
        │                        │                   │
   serializeEscrow          Jito bundle          E8Spo… program
   (JSON wire form)          (settlement)         (Anchor, SBF)
        │
        ▼
 ┌──────────────┐   ┌──────────────────┐   ┌──────────────┐
 │ keyless-mcp  │   │ keyless-x402     │   │ demo (Vite)  │
 │ (agent tools)│   │ (pay-per-use API)│   │ (devnet UI)  │
 └──────────────┘   └──────────────────┘   └──────────────┘
```

## The one model, two enforcements

Everything is organized around the four-outcome authorization model
([specs/protocol.md §2](../specs/protocol.md)). Both backends expose the same
lifecycle — `open` → `settle(outcomeId, authorizer)` → `status` — and the same
`standardOutcomes(parties)`. They differ only in *how* the fixed-destination
guarantee is enforced:

- **`presign`** enforces it with cryptography off-chain: the vault pre-signs the
  four transactions with their destinations baked in, then its key is destroyed.
- **`program`** enforces it on-chain: destinations are pinned by account
  constraints and only the program (via a keyless PDA) can move the vault.

Because the model and the API are shared, the MCP server, the x402 API, and the
demo are written once against the SDK and work with either backend.

## Data flow: opening an escrow (`presign`)

1. Buyer calls `PresignBackend.open(buyer, { parties, mint, amount })`.
2. SDK creates a durable nonce (authority = ephemeral vault `V`), deposits the
   tokens into `V`'s ATA.
3. SDK builds + `V`-signs the four outcome transactions against the nonce.
4. SDK destroys `V`'s key and returns a `KeylessEscrow` (serialize with
   `serializeEscrow` to persist).

## Data flow: settling

1. A consumer calls `settle(escrow, outcomeId, authorizer)`.
2. The SDK verifies `authorizer` is the outcome's designated party, adds its
   signature to the pre-signed transaction (`presign`) or builds the
   `release`/`refund` instruction (`program`).
3. It submits directly, or as a Jito bundle for atomic, front-run-proof delivery.

## Consumers

- **MCP** (`packages/mcp`) — an escrow operator server; a moderator runs it with
  only their arbiter key and it can do nothing but resolve disputes.
- **x402** (`packages/x402`) — the same operations behind an x402 paywall so
  other agents pay per call; settles payment natively on Solana.
- **demo** (`demo`) — a devnet walkthrough that makes the "no button pays the
  arbiter" property visible.

## Related

- [specs/protocol.md](../specs/protocol.md) — the normative model + wire formats.
- [docs/security-model.md](security-model.md) — threat model and trust
  assumptions.
