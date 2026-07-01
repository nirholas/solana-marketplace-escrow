# Security model

## The claim

A moderator (arbiter) can **release** escrowed funds to a trade party but can
**never redirect** them — not to a third address, not to themselves. This is a
structural property, not a policy.

## Threat model

| Adversary | Capability | Mitigation |
|-----------|-----------|------------|
| Rogue / compromised arbiter | Signs settlement transactions | Can only trigger a fixed-destination outcome (`release`→seller or `refund`→buyer). No outcome pays the arbiter; destinations are bound at funding time. |
| Rogue buyer | Wants a refund without the seller's consent | No `refund` outcome is authorized by the buyer. The buyer can only push funds toward the seller. |
| Rogue seller | Wants payment without delivering | No `release` outcome is authorized by the seller. The seller can only push funds toward the buyer. |
| Backend / server compromise (`presign`) | Holds pre-signed transactions | Each is single-destination and single-signer-missing; a stolen prepared transaction can only send to the party the buyer fixed, and only with that party's signature. |
| Stolen operator key (MCP/x402) | Signs as one party | Can only settle outcomes that party authorizes; still bound to fixed destinations. |
| Program upgrade authority (`program`) | Can change program logic | Deploy immutable, or place the upgrade authority behind a multisig + timelock. |

## What is NOT protected

- **Arbiter choosing the wrong winner.** This removes theft, not the need for a
  trustworthy arbiter. Use a multisig/DAO arbiter for higher assurance.
- **Off-chain delivery disputes.** Whether the seller actually delivered is a
  human/oracle judgment the protocol cannot make.
- **Key management by integrators.** If a party's own key leaks, that party's
  authority leaks with it.

## Backend comparison

| | `program` | `presign` |
|---|-----------|-----------|
| Vault keyless | by construction (PDA has no key) | by convention (ephemeral key destroyed) |
| Requires deploy | yes | no |
| Residual trust | program upgrade authority | vault-key destruction (unprovable in JS memory) |
| Recommended for | production / high value | fast integration / low friction |

## Why not the obvious alternatives

- **Hot-key escrow wallet** (a `Keypair` with the funds): one leak drains every
  escrow. This is the exact anti-pattern the project replaces.
- **Multisig** (e.g. Squads): removes single-key risk but a quorum can still send
  funds anywhere — it bounds *who signs*, not *where money goes*.
- **Jito bundle / atomic swap**: solve atomicity/ordering, not authorization. A
  bundle still needs every signature; an atomic swap can't express a deferred
  third-party dispute. Both ship as first-class features here — Jito for atomic
  settlement delivery, atomic swaps for the instant-trade happy path — they're
  just not the custody mechanism.

See [specs/protocol.md](../specs/protocol.md) for the normative invariants.
