# Keyless Escrow Protocol Specification

Version 0.1.0 · status: draft

This document is the contract other code depends on. It defines the
authorization model both backends enforce, and the two wire formats (durable-
nonce pre-signed outcomes, and on-chain program instructions).

## 1. Roles

| Role | Symbol | Description |
|------|--------|-------------|
| Buyer | `B` | Funds the escrow (maker / depositor / payer). |
| Seller | `S` | Beneficiary; paid on success. |
| Arbiter | `A` | Neutral moderator; resolves disputes. |

## 2. Authorization model (normative)

The complete set of outcomes is exactly four. No other movement of the escrowed
funds is representable.

| Outcome id | Kind | Destination | Required signer |
|------------|------|-------------|-----------------|
| `release:by-buyer` | release | `S` | `B` |
| `release:by-arbiter` | release | `S` | `A` |
| `refund:by-seller` | refund | `B` | `S` |
| `refund:by-arbiter` | refund | `B` | `A` |

Invariants (MUST hold in every backend):

1. **Fixed destinations.** Each outcome's destination is bound at funding time.
   No signer chooses a destination at settlement time.
2. **No self-payment.** For every outcome, `destination ≠ signer`. In particular
   there is no outcome that pays `A`.
3. **Directional authority.** `B` can only push funds toward `S`; `S` can only
   push funds toward `B`; `A` may choose either party but neither is `A`.
4. **Single settlement.** At most one outcome can ever execute for a given
   escrow (mutual exclusivity).

A conforming implementation MUST reject a settlement whose signer is not the
outcome's required signer.

## 3. Backend A — `presign` (durable-nonce pre-signed outcomes)

### 3.1 Setup

1. Generate an ephemeral vault keypair `V` (Ed25519).
2. Create a durable **nonce account** `N` with nonce authority `V`.
3. `B` deposits `amount` of `mint` into `V`'s associated token account.
4. For each outcome, `V` builds and **partially signs** a transaction:
   * `feePayer = signer` (the outcome's required signer).
   * `recentBlockhash = nonce(N)` (the durable nonce value).
   * instructions, in order:
     1. `System.nonceAdvance(nonce = N, authority = V)`
     2. `AssociatedToken.createIdempotent(payer = signer, owner = destination)`
     3. `Token.transferChecked(source = V_ata, dest = destination_ata, authority = V, amount)`
     4. `Token.closeAccount(account = V_ata, dest = B, authority = V)`
5. `V`'s secret key is destroyed.

### 3.2 Properties

* Required signers of each prepared transaction are exactly `{V, signer}`. `V`
  is pre-applied; `signer` is added at settlement.
* Because the message (fee payer, destinations, amount) is fixed before `V`
  signs, the settling party cannot alter the destination without invalidating
  `V`'s signature, and `V`'s key no longer exists to re-sign.
* Settling any outcome advances `N`, invalidating the other three (§2.4).

### 3.3 Trust assumption

Keylessness is **by convention**: it relies on `V`'s secret key being destroyed.
The reference SDK generates `V` ephemerally, never persists or returns it, and
overwrites it after signing — but a runtime cannot *prove* zeroization. For a
provable guarantee, use Backend B.

### 3.4 Serialized form

`SerializedEscrow` (JSON): `{ backend, vault, nonceAccount, parties{buyer,
seller, arbiter}, mint, amount(string), vaultKeyDestroyed, memo?, outcomes[] }`
where each outcome is `{ id, kind, authorizer, destinationOwner, destinationAta,
description, serialized }` and `serialized` is the base58 wire form of the
partially-signed transaction.

## 4. Backend B — `program` (PDA)

### 4.1 Accounts

`Escrow` PDA, seeds `["escrow", B, seed_le_u64]`, fields: `buyer`, `seller`,
`arbiter`, `mint`, `amount`, `seed`, `bump`, `state ∈ {0 active, 1 released,
2 refunded}`. The vault is the associated token account owned by the `Escrow`
PDA — a PDA has no private key, so keylessness is **by construction**.

### 4.2 Instructions

Anchor discriminators are `sha256("global:<name>")[..8]`.

* `initialize(seed: u64, amount: u64)` — accounts: `buyer(signer,w)`, `seller`,
  `arbiter`, `mint`, `escrow(w,pda)`, `vault(w,pda-ata)`, `buyer_ata(w)`,
  `token_program`, `associated_token_program`, `system_program`.
* `release()` — accounts: `authority(signer,w)`, `escrow(w)`, `vault(w)`,
  `mint`, `seller`, `destination_ata(w)`, `rent_recipient(w = buyer)`,
  `token_program`, `associated_token_program`, `system_program`. Requires
  `authority ∈ {buyer, arbiter}` and `seller = escrow.seller`.
* `refund()` — as `release`, with `buyer` in place of `seller`; requires
  `authority ∈ {seller, arbiter}` and `buyer = escrow.buyer`.

The program enforces §2 on-chain: destinations are pinned by `address =
escrow.{seller,buyer}` account constraints; authority is checked against the
stored parties.

## 5. Settlement delivery

Either backend MAY deliver a settlement as a Jito bundle for atomic, ordered,
front-running-proof inclusion. A bundle changes delivery only — every
transaction in it still carries all required signatures per §2.
