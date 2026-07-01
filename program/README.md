# keyless-escrow program

The on-chain Anchor program behind the SDK's **`program` backend** — the
keyless-*by-construction* vault.

Program id (devnet): `E8SpoXKxgfKA8m2YVnsNSUHW5boBtK9RjWKaWKYDCkda`

## Why it's keyless

Funds live in a token account owned by the **`escrow` PDA**. A Program Derived
Address is bumped off the ed25519 curve, so **no private key exists** for it —
nobody can sign for the vault directly. Funds move only through this program's
instructions, and each instruction **hard-codes the destination**:

| Instruction | Pays | Authorized by | Destination constraint |
|-------------|------|---------------|------------------------|
| `initialize(seed, amount)` | — | buyer | deposits into the PDA vault |
| `release` | seller | buyer **or** arbiter | `address = escrow.seller`'s ATA |
| `refund` | buyer | seller **or** arbiter | `address = escrow.buyer`'s ATA |

The arbiter can pick the winner (buyer→seller or refund→buyer) but the
destination is fixed by the account constraints, not chosen at call time, so the
arbiter can never redirect funds — not even to themselves.

## Accounts

`Escrow` (PDA, seeds `["escrow", buyer, seed]`): `buyer`, `seller`, `arbiter`,
`mint`, `amount`, `seed`, `bump`, `state` (`0=active`, `1=released`,
`2=refunded`). The vault is the associated token account of the `Escrow` PDA and
is closed on settlement, returning rent to the buyer. Token-2022 compatible
(`token_interface`).

## Build

```bash
# With Anchor:
anchor build
# Or with just the Solana CLI (no Anchor):
cargo-build-sbf
```

Output: `target/deploy/keyless_escrow.so` + `target/deploy/keyless_escrow-keypair.json`.

## Deploy

```bash
# fund ~/.config/solana/id.json with ~2 SOL on the target cluster, then:
bash ../scripts/deploy.sh devnet
```

After deploying to a **new** id, sync it in three places (or run `anchor keys sync`):
`declare_id!` in `programs/keyless-escrow/src/lib.rs`, both entries in
`Anchor.toml`, and `DEFAULT_PROGRAM_ID` in `packages/sdk/src/backends/program.ts`.

## Test

```bash
anchor test            # spins up a local validator, deploys, runs tests/keyless-escrow.ts
```

The suite covers: buyer-confirmed release, arbiter release (dispute → seller),
arbiter refund (dispute → buyer), and that an **unauthorized signer cannot
release** (the seller can't pay themselves).

## License

MIT
