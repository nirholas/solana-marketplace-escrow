#!/usr/bin/env bash
#
# Build and deploy the keyless-escrow program to a Solana cluster.
#
# Usage:  bash scripts/deploy.sh [devnet|mainnet-beta|localnet]
#
# Requires: rust, the Solana (Agave) CLI, and Anchor. The deployer wallet
# (~/.config/solana/id.json) must hold enough SOL for program rent (~2 SOL for
# this program on devnet/mainnet).
set -euo pipefail

CLUSTER="${1:-devnet}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/program"

case "$CLUSTER" in
  devnet)        RPC="https://api.devnet.solana.com" ;;
  mainnet-beta)  RPC="https://api.mainnet-beta.solana.com" ;;
  localnet)      RPC="http://127.0.0.1:8899" ;;
  *) echo "unknown cluster '$CLUSTER'"; exit 1 ;;
esac

echo "▸ Building SBF program…"
if command -v anchor >/dev/null 2>&1; then
  anchor build
else
  cargo-build-sbf
fi

PROGRAM_ID="$(solana address -k target/deploy/keyless_escrow-keypair.json)"
echo "▸ Program id: $PROGRAM_ID"
echo "  Ensure declare_id! (programs/keyless-escrow/src/lib.rs), Anchor.toml, and"
echo "  DEFAULT_PROGRAM_ID (packages/sdk/src/backends/program.ts) all equal this id."

echo "▸ Deployer: $(solana address)  balance: $(solana balance --url "$RPC")"
echo "▸ Deploying to $CLUSTER ($RPC)…"
solana program deploy target/deploy/keyless_escrow.so \
  --program-id target/deploy/keyless_escrow-keypair.json \
  --url "$RPC"

echo "✅ Deployed $PROGRAM_ID to $CLUSTER"
