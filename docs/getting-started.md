# Getting started with solana-marketplace-escrow

Non-custodial Solana escrow SDK — a keyless vault where moderators can release funds but never steal them. Anchor PDA program, durable-nonce pre-signing, atomic Jito settlement. SDK + MCP + x402.

## Install

```bash
npm install && npm run build
```

## Verify the install

Clone the repository and run its checks to confirm everything works on your machine:

```bash
git clone https://github.com/nirholas/solana-marketplace-escrow.git
cd solana-marketplace-escrow
```

Available commands:

| Command | Runs |
|---|---|
| `npm run build` | `npm run build -w keyless-escrow && npm run build --workspaces --if-present` |
| `npm run test` | `npm run test --workspaces --if-present` |

## Next steps

- [Examples](./examples.md) shows runnable snippets.
- The [README](https://github.com/nirholas/solana-marketplace-escrow#readme) is the complete reference.
- Found a problem? [Open an issue](https://github.com/nirholas/solana-marketplace-escrow/issues).
