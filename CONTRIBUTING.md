# Contributing

Thanks for helping build keyless-escrow. This is security-critical code — the
whole product is a claim that a moderator can't steal — so correctness and tests
come first.

## Setup

```bash
npm install                     # installs all workspaces
npm test --workspaces --if-present
npm run build --workspaces --if-present
```

Monorepo layout:

- `packages/sdk` — the `keyless-escrow` SDK (presign + program backends). Pure,
  browser-safe; no `node:*` in the core.
- `packages/mcp`, `packages/x402` — servers that wrap the SDK (Node).
- `demo` — Vite browser demo.
- `program` — Anchor PDA program (Rust). Needs Rust + the Solana CLI; Anchor for
  `anchor test`.

## Working on the program

```bash
cd program
cargo-build-sbf          # build SBF bytecode (no Anchor CLI needed)
anchor test              # local validator + integration tests (needs Anchor)
```

If you change the program's public interface, update in lockstep:

1. `packages/sdk/src/backends/program.ts` (account order, discriminators),
2. `packages/sdk/test/program.test.ts`,
3. [`specs/protocol.md`](specs/protocol.md).

Anchor discriminators are `sha256("global:<ix>")[..8]` — recompute if you rename
an instruction.

## Ground rules

- **No mocks, no fake data, no placeholders.** Real APIs, real transactions.
- **Every change to the authorization model needs a test** proving the §2
  invariants in the spec still hold.
- Keep the SDK core browser-safe (the demo bundles it). Node-only helpers live in
  the server packages.
- Match the surrounding style; `.editorconfig` + Prettier defaults apply.
- Conventional-ish commit messages (`feat:`, `fix:`, `docs:`, `chore:`).

## Pull requests

- CI (`.github/workflows/ci.yml`) must pass: build + test all workspaces, and an
  SBF build of the program.
- Describe the security reasoning for any change touching custody, signing, or
  the outcome set.
