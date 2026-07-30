# solana-marketplace-escrow examples

Non-custodial Solana escrow SDK — a keyless vault where moderators can release funds but never steal them. Anchor PDA program, durable-nonce pre-signing, atomic Jito settlement. SDK + MCP + x402.

## Example 1

```bash
git clone https://github.com/nirholas/solana-marketplace-escrow.git
cd solana-marketplace-escrow
npm install && npm run build
```

## Example 2

```bash
node --experimental-strip-types examples/devnet-lifecycle.ts
```

## Example 3

```bash
npm install
npm test --workspaces --if-present   # run every package's tests
npm run build --workspaces --if-present
```


Every snippet above is taken from the [repository documentation](https://github.com/nirholas/solana-marketplace-escrow#readme).
