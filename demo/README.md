# keyless-escrow demo

A live, browser-based showcase of the whole project on Solana **devnet** — no
mocks, real transactions. Three tabs, each a self-contained flow:

- **Keyless escrow** — generate buyer/seller/arbiter, mint a test token, open the
  keyless escrow (deposit → pre-sign the four fixed-destination outcomes →
  destroy the vault key), and resolve it. The point it makes visually: **there is
  no button, and no possible transaction, that pays the arbiter.**
- **Atomic swap** — Alice's token A for Bob's token B in one indivisible
  transaction; both sign, both legs settle or neither. No custody, no arbiter.
- **Moderator console** — the `nirholas/atomic` pattern: a master wallet funds the
  fee and the escrow key signs the release, atomically. **Moderators hold no key.**
  (This tab holds throwaway keys client-side to illustrate the mechanism; the real
  server-based console is [`apps/dashboard`](../apps/dashboard).)

## Run

```bash
npm install                        # from the repo root (workspaces)
npm run dev -w keyless-escrow-demo
# open http://localhost:5173
```

Devnet airdrops are rate-limited; if the airdrop step warns, fund the printed
wallets at [faucet.solana.com](https://faucet.solana.com) and re-run (the keyless
tab also accepts a funded buyer secret). Point it at any cluster with
`VITE_SOLANA_RPC` — e.g. a local validator for fast, unlimited testing:

```bash
VITE_SOLANA_RPC=http://127.0.0.1:8899 npm run dev -w keyless-escrow-demo
```

## Structure

```
src/
  main.ts            # tab shell — mounts each flow once, preserves state
  lib/ui.ts          # shared: connection, helpers, airdrop/mint utilities, logger
  flows/keyless.ts   # keyless escrow flow
  flows/swap.ts      # atomic swap flow
  flows/custodial.ts # moderator console flow
  style.css          # design system
```

## Build

```bash
npm run build -w keyless-escrow-demo   # → demo/dist (typechecked)
```

Verified by headless render: all three tabs, plus keyless and swap driven
end-to-end against a validator.

## License

MIT
