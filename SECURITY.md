# Security Policy

## Reporting a vulnerability

Please report suspected vulnerabilities privately via GitHub Security Advisories
(**Security → Report a vulnerability**) on
[nirholas/solana-marketplace-escrow](https://github.com/nirholas/solana-marketplace-escrow/security/advisories/new),
or by opening a minimal private channel with the maintainers. Do not open a
public issue for an unpatched vulnerability. We aim to acknowledge within 72
hours.

## What this project guarantees

The security claim is narrow and specific: **a moderator (arbiter) can release
escrowed funds to a trade party but can never redirect them to an address of
their choosing.** This is enforced structurally, and covered by tests:

- The complete outcome set is fixed (four outcomes; see [specs/protocol.md](specs/protocol.md)).
- Every outcome's destination is bound at funding time, not at settlement time.
- No outcome pays the arbiter; no signer can pay themselves.
- `packages/sdk` ships offline invariant tests that prove the construction:
  required signers are exactly `{vault, authorizer}`, a destination change breaks
  the signed message, and only the designated authorizer can settle.

## Trust assumptions

| Backend | Vault keyless… | Residual trust |
|---------|----------------|----------------|
| `program` | by construction | The deployed program is the audited source; the upgrade authority (if retained) can change program logic. Deploy immutable, or behind a multisig/timelock, for production. |
| `presign` | by convention | Relies on the ephemeral vault secret key being destroyed. The SDK generates it ephemerally, never persists/returns it, and overwrites it after signing, but JS managed memory cannot *prove* zeroization. Use `program` where that proof matters. |

Additional operational notes:

- **Program upgrade authority.** For the `program` backend, a retained upgrade
  authority is a trust vector. Production deployments SHOULD set the program
  immutable or place the upgrade authority behind a multisig + timelock.
- **Arbiter selection.** The arbiter can still *choose the wrong winner*. This
  project removes theft, not the need to pick a trustworthy arbiter (which MAY
  itself be a multisig / DAO).
- **Operator keys.** The MCP server and x402 service load operator secret keys
  from environment variables only, never from tool calls, and can only settle
  outcomes whose authorizer key they hold.

## Scope

In scope: the SDK, the on-chain program, the MCP server, and the x402 service in
this repository. Out of scope: third-party facilitators, RPC providers, and the
security of keys held by integrators.
