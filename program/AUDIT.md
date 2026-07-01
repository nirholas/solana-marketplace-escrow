# Audit scope — keyless-escrow program

This document orients an auditor. The program is small (one file,
[`programs/keyless-escrow/src/lib.rs`](programs/keyless-escrow/src/lib.rs)) and
intentionally minimal.

## What it does

A non-custodial escrow. Funds sit in a token account owned by the `escrow` PDA
(no private key exists for it). Three instructions:

- `initialize(seed, amount)` — buyer deposits into the PDA vault; records
  `buyer`, `seller`, `arbiter`, `mint`.
- `release()` — pays the **seller**; authorized by `buyer` or `arbiter`.
- `refund()` — pays the **buyer**; authorized by `seller` or `arbiter`.

## Security invariants to verify

1. **No third-party destination.** `release` can only pay `escrow.seller`;
   `refund` can only pay `escrow.buyer`. Destinations are pinned by
   `#[account(address = …)]` + `associated_token::authority` constraints. In
   particular, no path pays the arbiter.
2. **Authorization.** `release` requires `signer ∈ {buyer, arbiter}`; `refund`
   requires `signer ∈ {seller, arbiter}`. The seller can't release; the buyer
   can't refund.
3. **Single settlement.** `state` gates against double-settle
   (`require!(state == Active)`), and it is set **before** the token CPI
   (checks-effects-interactions), so a Token-2022 transfer hook cannot re-enter.
4. **No lock griefing.** `pay_out` transfers the **full live `vault.amount`**
   (not the recorded `amount`), so a donation to the vault ATA cannot block
   `close_account` and lock the escrow.
5. **PDA authority.** Vault transfers use `invoke_signed` with the `escrow`
   seeds only; no other signer can move the vault.
6. **Rent.** Vault rent returns to the buyer (`rent_recipient` is constrained to
   `escrow.buyer`).

## Trust assumptions (out of protocol scope)

- The **arbiter** can still choose the wrong winner. This removes theft, not the
  need for a trustworthy arbiter (consider a multisig/DAO arbiter).
- **Program upgrade authority.** For production, set the program immutable or
  behind a multisig + timelock. See [../docs/deployment.md](../docs/deployment.md).
- **Off-chain delivery** disputes are a human/oracle judgment the program cannot
  make.

## Test coverage

- On-chain, verified on a validator: happy release, arbiter release, arbiter
  refund, unauthorized-signer rejection, and the donation-griefing case
  ([tests/keyless-escrow.ts](tests/keyless-escrow.ts)).
- SDK-side offline invariant tests
  ([../packages/sdk/test](../packages/sdk/test)) prove the client can only build
  the four fixed-destination outcomes and never routes to the arbiter.

## Build / reproduce

```bash
cargo-build-sbf            # deterministic SBF build; artifact target/deploy/keyless_escrow.so
```

Anchor `0.31.1`, Solana `4.0.2`. For a verifiable on-chain build see
[../docs/deployment.md](../docs/deployment.md).

## Known non-issues / accepted behavior

- Donations to the vault accrue to the settlement recipient (swept on payout).
- `initialize` uses `init` on the escrow PDA, so an escrow id
  (`["escrow", buyer, seed]`) cannot be re-initialized while it exists.
