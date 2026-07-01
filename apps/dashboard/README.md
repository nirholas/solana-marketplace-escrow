# keyless-escrow-dashboard

An admin / moderator **web console** for releasing escrow — the `nirholas/atomic`
pattern applied to a marketplace.

- The **platform** holds a **master wallet** (SOL for fees + Jito tip) and each
  escrow wallet's key, **server-side**.
- **Moderators** sign in and click **"Release → seller"** or **"Refund → buyer"**.
  They hold **no keys**.
- Each action fires **one atomic transaction** (optionally a Jito bundle): the
  master pays the fee, the escrow key signs the transfer — the master acting *on
  behalf of* the escrow wallet. Keys never leave the server; the browser only
  calls the API.

Trust model: **custodial at the platform level** (the backend holds the keys).
For a trust-free vault, use the `program` / `presign` backends instead.

## Run

```bash
npm install                       # from the repo root
ADMIN_PASSCODE=... MODERATOR_PASSCODE=... \
MASTER_SECRET=<base58 funded master> \
BUYER_SECRET=<base58 funded buyer, holds the mint>  \
SOLANA_RPC=https://api.devnet.solana.com \
npm start -w keyless-escrow-dashboard
# open http://localhost:4040
```

| Var | Purpose |
|-----|---------|
| `MASTER_SECRET` | Master wallet (pays fees + tips). Omit in dev → an ephemeral one is generated (fund it). |
| `BUYER_SECRET` | Wallet that funds admin-created escrows (must hold the mint). |
| `ADMIN_PASSCODE` / `MODERATOR_PASSCODE` | Sign-in passcodes → roles. **Set these.** |
| `SOLANA_RPC` | Cluster (default devnet). |
| `DASHBOARD_STORE` | JSON file for escrow records (default `.escrows.json`). |
| `PORT` | HTTP port (default 4040). |

## API

| Method & path | Role | Action |
|---------------|------|--------|
| `POST /api/login` | — | passcode → role + token |
| `GET /api/session` | any | role, master address, cluster |
| `GET /api/escrows` | any | list (secrets redacted) |
| `POST /api/escrows` | admin | create + fund an escrow |
| `POST /api/escrows/:id/release` | any | atomic release → seller |
| `POST /api/escrows/:id/refund` | any | atomic refund → buyer |

Escrow secret keys are stored server-side and **never** sent to the browser.

## License

MIT
