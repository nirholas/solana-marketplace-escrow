/**
 * keyless-escrow — non-custodial, arbiter-mediated escrow for Solana.
 *
 * The escrow vault has no usable private key. A moderator (arbiter) can RELEASE
 * funds to a participant but can NEVER steal them, because every possible
 * outcome is fixed to a destination the buyer chose at funding time and the
 * arbiter's signature can only *select* among those outcomes.
 *
 * Two interchangeable backends:
 *  - `presign` — zero-deploy. Ephemeral vault + durable-nonce pre-signed
 *                outcomes + key destruction. Keyless *by convention*.
 *  - `program` — production. Anchor PDA escrow program. Keyless *by construction*
 *                (a PDA has no private key in existence).
 *
 * @example
 * import { Connection, Keypair, PublicKey } from '@solana/web3.js';
 * import { PresignBackend, standardOutcomes } from 'keyless-escrow';
 *
 * const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
 * const escrowSvc = new PresignBackend({ connection });
 *
 * const escrow = await escrowSvc.open(buyer, {
 *   parties: { buyer: buyer.publicKey, seller: sellerPk, arbiter: arbiterPk },
 *   mint: usdcMint,
 *   amount: 1_000_000n, // 1.0 of a 6-decimal token
 * });
 *
 * // Dispute resolved for the seller — only the arbiter can do this, and it can
 * // only ever pay the seller, never the arbiter.
 * await escrowSvc.settle(escrow, 'release:by-arbiter', arbiter, { viaBundle: true });
 */

export type {
  Party,
  Parties,
  OutcomeKind,
  Outcome,
  PreparedOutcome,
  CreateEscrowParams,
  KeylessEscrow,
  SettlementResult,
} from './types.js';

export { standardOutcomes, buildOutcomeTransaction, ataFor } from './outcomes.js';
export type { BuildOutcomeArgs } from './outcomes.js';

export { createNonceAccount, readNonce } from './nonce.js';

export {
  sendJitoBundle,
  sendBundleAndConfirm,
  getBundleStatuses,
  getJitoTipAccounts,
  jitoTipInstruction,
  randomTipAccount,
  withTip,
  JITO_BLOCK_ENGINES,
  JITO_TIP_ACCOUNTS,
  DEFAULT_TIP_LAMPORTS,
} from './jito.js';
export type { SendBundleOptions, JitoOptions, BundleStatus } from './jito.js';

export { buildAtomicSwapTransaction, AtomicSwapClient } from './atomic-swap.js';
export type { SwapLeg, AtomicSwapParams, AtomicSwapResult } from './atomic-swap.js';

export { PresignBackend } from './backends/presign.js';
export type { PresignBackendOptions } from './backends/presign.js';

export { ProgramBackend, DEFAULT_PROGRAM_ID } from './backends/program.js';
export type { ProgramBackendOptions, ProgramEscrow } from './backends/program.js';

export { serializeEscrow, deserializeEscrow } from './serialize.js';
export type { SerializedEscrow } from './serialize.js';

export { CustodialBackend, buildCustodialSettle } from './backends/custodial.js';
export type { CustodialEscrow, CustodialSettleArgs } from './backends/custodial.js';
