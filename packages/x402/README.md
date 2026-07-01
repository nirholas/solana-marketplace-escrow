# keyless-escrow-x402

Escrow-as-a-service over HTTP, monetized with the [x402](https://x402.org)
payment protocol. Other agents (or apps) **pay per call** to open and resolve
non-custodial Solana escrows — and, by construction, the operator can release
funds but never steal them.

Built on x402 **v2** (`@x402/express`, `@x402/core`, `@x402/svm`) with native
**Solana** settlement (SPL/USDC) via the `exact` scheme.

## Endpoints

| Method & path | Price | Description |
|---------------|-------|-------------|
| `GET /` | free | Service info + pricing |
| `GET /outcomes` | free | The four-outcome authorization model |
| `POST /escrow/open` | `$0.10` | Open + fund a keyless escrow → returns escrow id |
| `POST /escrow/settle` | `$0.05` | Settle one fixed-destination outcome |
| `GET /escrow` | free | List escrows this operator opened |
| `GET /escrow/get?id=` | free | Full escrow record |
| `GET /escrow/status?id=` | free | Live on-chain status |

Paid routes return **HTTP 402** with payment instructions until a valid
`X-PAYMENT` header is supplied; an x402 client (`@x402/fetch`, `@x402/axios`)
handles that automatically.

## Configuration

| Var | Required | Default | Purpose |
|-----|----------|---------|---------|
| `X402_PAY_TO` | for paid mode | — | Solana address that receives payments. Unset ⇒ paywall off (dev mode). |
| `X402_NETWORK` | no | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` (mainnet) | CAIP-2 network id. Devnet: `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`. |
| `X402_FACILITATOR` | no | `https://facilitator.x402.org` | x402 facilitator URL. |
| `X402_OPEN_PRICE` / `X402_SETTLE_PRICE` | no | `$0.10` / `$0.05` | Per-call prices. |
| `KEYLESS_ESCROW_KEYS` | yes (to act) | — | Comma-separated base58 operator secret keys. |
| `KEYLESS_ESCROW_STORE` | no | in-memory | JSON file to persist opened escrows. |
| `SOLANA_RPC` | no | devnet | Escrow RPC endpoint. |
| `PORT` | no | `4021` | HTTP port. |

## Run

```bash
npm run build -w keyless-escrow-x402

# Dev mode (no paywall) — great for local testing:
KEYLESS_ESCROW_KEYS=<base58_secret> node packages/x402/dist/index.js

# Paid mode:
X402_PAY_TO=<your_solana_address> \
X402_NETWORK=solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1 \
KEYLESS_ESCROW_KEYS=<base58_secret> \
node packages/x402/dist/index.js
```

## Example (dev mode)

```bash
curl -s localhost:4021/outcomes | jq
curl -s -X POST localhost:4021/escrow/open -H 'content-type: application/json' \
  -d '{"seller":"<pk>","arbiter":"<pk>","mint":"<mint>","amount":"1000000"}'
```

In paid mode, call the same routes with an x402-aware client so the `$0.10` /
`$0.05` charge is paid on Solana automatically.

## Programmatic use

```ts
import { createApp, configFromEnv } from 'keyless-escrow-x402';
createApp(configFromEnv()).listen(4021);
```

## License

MIT
