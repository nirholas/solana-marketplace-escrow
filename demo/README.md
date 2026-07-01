# keyless-escrow demo

A live, browser-based walkthrough of the full keyless-escrow lifecycle on Solana
**devnet** — no mocks, real transactions.

It generates three throwaway wallets (buyer, seller, arbiter), mints a test
token, opens a keyless escrow (deposit → pre-sign the four fixed-destination
outcomes → destroy the vault key), and lets you resolve it. The point it makes
visually: **there is no button — and no possible transaction — that pays the
arbiter.** A moderator can pick the winner, never redirect the funds.

## Run

```bash
npm install                     # from the repo root (workspaces)
npm run dev -w keyless-escrow-demo
# open http://localhost:5173
```

Devnet airdrops are rate-limited. If the airdrop step warns, fund the printed
buyer address at [faucet.solana.com](https://faucet.solana.com) and re-run, or
paste a funded buyer secret key into the setup field.

Point it at another cluster/RPC with `VITE_SOLANA_RPC`:

```bash
VITE_SOLANA_RPC=https://api.devnet.solana.com npm run dev -w keyless-escrow-demo
```

## Build

```bash
npm run build -w keyless-escrow-demo   # outputs demo/dist
```

## License

MIT
