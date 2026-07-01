# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-07-01

Initial release: non-custodial, arbiter-mediated escrow for Solana where the
vault has no usable private key.

### Added

- **`keyless-escrow` SDK** — the `presign` backend (ephemeral vault + durable-
  nonce pre-signed fixed-destination outcomes + vault-key destruction), the
  `program` backend (on-chain PDA vault), Jito bundle settlement, and
  `serializeEscrow`/`deserializeEscrow`. 22 offline security-invariant tests.
- **`program`** — Anchor PDA escrow program (`initialize` / `release` / `refund`),
  Token-2022 compatible, with the vault authority as a keyless PDA and
  program-constrained destinations. Compiles to SBF; integration tests included.
- **`keyless-escrow-mcp`** — MCP server exposing the escrow lifecycle as agent
  tools; only settles outcomes whose authorizer key it holds.
- **`keyless-escrow-x402`** — x402 v2 pay-per-use escrow-as-a-service API with
  native Solana settlement.
- **`demo`** — Vite browser demo of the full lifecycle on devnet.
- Docs: flagship README, [`specs/protocol.md`](specs/protocol.md), per-package
  READMEs, `SECURITY.md`, `CONTRIBUTING.md`, and a devnet example.
- CI: build + test all workspaces and an SBF build of the program.

[0.1.0]: https://github.com/nirholas/solana-marketplace-escrow/releases/tag/v0.1.0
