# Deployment runbook (devnet & mainnet)

The `program` backend requires the escrow program to be deployed and the SDK's
`DEFAULT_PROGRAM_ID` (or a `programId` passed to `ProgramBackend`) to match.

> **Mainnet holds real funds.** Do not deploy to mainnet without an independent
> audit and a deliberate upgrade-authority decision. See
> [../program/AUDIT.md](../program/AUDIT.md).

## Prerequisites

- Rust, the Solana (Agave) CLI, and (optionally) Anchor.
- A funded deployer wallet: **~2.5 SOL** on the target cluster (the deploy
  creates a temporary buffer of ~2 SOL that converts into program rent).

## 1. Choose the program address

The id is baked into `declare_id!`, `Anchor.toml`, and the SDK. Decide before
deploying:

- **Keep the current id** — nothing to do.
- **Vanity id** — grind a keypair, then sync it everywhere:
  ```bash
  solana-keygen grind --starts-with Escrow:1
  mv Escrow*.json program/target/deploy/keyless_escrow-keypair.json
  # then set that pubkey in:
  #   program/programs/keyless-escrow/src/lib.rs  (declare_id!)
  #   program/Anchor.toml                         (both entries)
  #   packages/sdk/src/backends/program.ts        (DEFAULT_PROGRAM_ID)
  # (or run `anchor keys sync`), then rebuild.
  ```

## 2. Build

```bash
cd program && cargo-build-sbf     # or: anchor build
```

### Verifiable build (recommended for mainnet)

So anyone can confirm the on-chain bytecode matches this source:

```bash
cargo install solana-verify
solana-verify build            # reproducible container build
# after deploy:
solana-verify verify-from-repo -u <rpc> --program-id <ID> https://github.com/nirholas/solana-marketplace-escrow
```

## 3. Deploy

Fund the deployer, then:

```bash
bash scripts/deploy.sh devnet          # or mainnet-beta
```

The deployer becomes the initial upgrade authority. **Immediately** move it to a
secure authority (next step) — never leave a throwaway/CI key as the authority.

## 4. Set the upgrade authority

Pick one:

- **Squads multisig (recommended).** Transfer authority to your multisig vault:
  ```bash
  solana program set-upgrade-authority <PROGRAM_ID> \
    --new-upgrade-authority <SQUADS_VAULT_PUBKEY> --url <rpc>
  ```
- **Immutable.** Renounce upgrades entirely (do this only post-audit):
  ```bash
  solana program set-upgrade-authority <PROGRAM_ID> --final --url <rpc>
  ```
- **Single wallet.** Set `--new-upgrade-authority <YOUR_SECURE_PUBKEY>` (a
  hardware wallet). Single-key risk.

Only a **pubkey** is needed to receive authority — never share the private key.

## 5. Point the SDK at the deployment

Set `DEFAULT_PROGRAM_ID` in `packages/sdk/src/backends/program.ts` to the
deployed id (or pass `programId` per call), rebuild the SDK, and run the live
example:

```bash
npm run build -w keyless-escrow
SOLANA_RPC=<rpc> PROGRAM_ID=<ID> node --experimental-strip-types examples/program-devnet-lifecycle.ts
```

## Cost reference

On devnet the deploy buffer was ~1.97 SOL for this ~282 KB program; budget
**~2.5 SOL** including fees. Mainnet is the same in SOL terms.
