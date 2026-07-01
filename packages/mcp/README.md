# keyless-escrow-mcp

An [MCP](https://modelcontextprotocol.io) server that exposes the
[`keyless-escrow`](../sdk) lifecycle as agent tools. A moderator or an AI agent
can open, inspect, and **resolve** non-custodial Solana escrows — and, by design,
can **never steal** the funds.

The server can only ever settle an outcome whose **authorizer key it holds**. Run
it with just the arbiter key and it becomes a pure dispute-resolution tool: it can
declare the winner but cannot move funds anywhere the buyer didn't pre-authorize.

## Configuration

Environment variables:

| Var | Required | Purpose |
|-----|----------|---------|
| `KEYLESS_ESCROW_KEYS` | yes | Comma-separated base58 Solana secret keys the server may sign with. |
| `SOLANA_RPC` | no | RPC endpoint (default `https://api.devnet.solana.com`). |
| `KEYLESS_ESCROW_STORE` | no | JSON file path to persist opened escrows across restarts. |

The server never accepts a raw secret key inside a tool call — keys come only from
`KEYLESS_ESCROW_KEYS`.

## Install into a client

```jsonc
// e.g. claude_desktop_config.json / any MCP client
{
  "mcpServers": {
    "keyless-escrow": {
      "command": "npx",
      "args": ["-y", "keyless-escrow-mcp"],
      "env": {
        "KEYLESS_ESCROW_KEYS": "<arbiter_base58_secret>",
        "SOLANA_RPC": "https://api.devnet.solana.com",
        "KEYLESS_ESCROW_STORE": "/var/lib/keyless-escrow/store.json"
      }
    }
  }
}
```

## Tools

| Tool | What it does |
|------|--------------|
| `escrow_signers` | List the public keys this server holds. |
| `escrow_open` | Open + fund an escrow (buyer must be a held key). Returns the escrow id. |
| `escrow_list` | List all escrows this server has opened. |
| `escrow_get` | Full escrow record + which outcomes this server can settle. |
| `escrow_status` | Live on-chain status: funded balance, settled or not. |
| `escrow_settle` | Complete one outcome (`release:by-arbiter`, etc.), optionally as a Jito bundle. |

### Example: a moderator resolves a dispute for the seller

```jsonc
// tool call
{ "name": "escrow_settle",
  "arguments": { "escrowId": "<vault>", "outcomeId": "release:by-arbiter", "viaBundle": true } }
```

If the server does not hold the arbiter key, it refuses:

```
this server does not hold the arbiter key (…) required to settle 'release:by-arbiter'.
Only the party controlling that key can authorize this outcome.
```

## Build & run

```bash
npm run build -w keyless-escrow-mcp
KEYLESS_ESCROW_KEYS=<base58_secret> node packages/mcp/dist/index.js
```

## License

MIT
