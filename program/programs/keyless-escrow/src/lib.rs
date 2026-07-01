//! Keyless escrow — the `program` backend.
//!
//! Funds live in a token account owned by the `escrow` **PDA**. A PDA is off the
//! ed25519 curve, so **no private key exists** for it — nobody can sign for the
//! vault directly. Funds move only through this program's instructions, and each
//! instruction hard-codes the destination to a trade party:
//!
//! * `release` pays the escrow's **seller** — callable by the buyer (happy path)
//!   or the arbiter (dispute resolved for the seller).
//! * `refund` pays the escrow's **buyer** — callable by the seller (cancel) or
//!   the arbiter (dispute resolved for the buyer).
//!
//! The arbiter can therefore pick the winner but can never redirect funds: the
//! destination is fixed in the account constraints, not chosen at call time.
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{
        self, CloseAccount, Mint, TokenAccount, TokenInterface, TransferChecked,
    },
};

declare_id!("E8SpoXKxgfKA8m2YVnsNSUHW5boBtK9RjWKaWKYDCkda");

#[program]
pub mod keyless_escrow {
    use super::*;

    /// Open and fund a keyless escrow. Moves `amount` from the buyer into the
    /// PDA-owned vault and records the parties. `seed` lets one buyer open many
    /// concurrent escrows.
    pub fn initialize(ctx: Context<Initialize>, seed: u64, amount: u64) -> Result<()> {
        require!(amount > 0, EscrowError::ZeroAmount);

        let escrow = &mut ctx.accounts.escrow;
        escrow.buyer = ctx.accounts.buyer.key();
        escrow.seller = ctx.accounts.seller.key();
        escrow.arbiter = ctx.accounts.arbiter.key();
        escrow.mint = ctx.accounts.mint.key();
        escrow.amount = amount;
        escrow.seed = seed;
        escrow.bump = ctx.bumps.escrow;
        escrow.state = EscrowState::Active as u8;

        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.buyer_ata.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            amount,
            ctx.accounts.mint.decimals,
        )
    }

    /// Release the escrow to the SELLER. Authorized by the buyer or the arbiter.
    /// The destination is constrained to the seller's associated token account —
    /// the caller cannot choose it.
    pub fn release(ctx: Context<Release>) -> Result<()> {
        let escrow = &ctx.accounts.escrow;
        require!(escrow.state == EscrowState::Active as u8, EscrowError::NotActive);
        let signer = ctx.accounts.authority.key();
        require!(
            signer == escrow.buyer || signer == escrow.arbiter,
            EscrowError::Unauthorized
        );

        pay_out(
            &ctx.accounts.token_program,
            &ctx.accounts.vault,
            &ctx.accounts.mint,
            &ctx.accounts.destination_ata,
            escrow,
            &ctx.accounts.rent_recipient,
        )?;
        ctx.accounts.escrow.state = EscrowState::Released as u8;
        Ok(())
    }

    /// Refund the escrow to the BUYER. Authorized by the seller or the arbiter.
    /// The destination is constrained to the buyer's associated token account.
    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        let escrow = &ctx.accounts.escrow;
        require!(escrow.state == EscrowState::Active as u8, EscrowError::NotActive);
        let signer = ctx.accounts.authority.key();
        require!(
            signer == escrow.seller || signer == escrow.arbiter,
            EscrowError::Unauthorized
        );

        pay_out(
            &ctx.accounts.token_program,
            &ctx.accounts.vault,
            &ctx.accounts.mint,
            &ctx.accounts.destination_ata,
            escrow,
            &ctx.accounts.rent_recipient,
        )?;
        ctx.accounts.escrow.state = EscrowState::Refunded as u8;
        Ok(())
    }
}

/// Transfer the whole vault balance to `destination_ata`, then close the empty
/// vault and return its rent to `rent_recipient`. Signed by the escrow PDA.
fn pay_out<'info>(
    token_program: &Interface<'info, TokenInterface>,
    vault: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    destination_ata: &InterfaceAccount<'info, TokenAccount>,
    escrow: &Account<'info, Escrow>,
    rent_recipient: &UncheckedAccount<'info>,
) -> Result<()> {
    let buyer = escrow.buyer;
    let seed = escrow.seed.to_le_bytes();
    let bump = [escrow.bump];
    let signer_seeds: &[&[&[u8]]] = &[&[b"escrow", buyer.as_ref(), &seed, &bump]];

    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            TransferChecked {
                from: vault.to_account_info(),
                mint: mint.to_account_info(),
                to: destination_ata.to_account_info(),
                authority: escrow.to_account_info(),
            },
            signer_seeds,
        ),
        escrow.amount,
        mint.decimals,
    )?;

    token_interface::close_account(CpiContext::new_with_signer(
        token_program.to_account_info(),
        CloseAccount {
            account: vault.to_account_info(),
            destination: rent_recipient.to_account_info(),
            authority: escrow.to_account_info(),
        },
        signer_seeds,
    ))
}

#[derive(Accounts)]
#[instruction(seed: u64)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    /// CHECK: recorded as the beneficiary; never used as a signer.
    pub seller: UncheckedAccount<'info>,
    /// CHECK: recorded as the arbiter; never used as a signer.
    pub arbiter: UncheckedAccount<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        init,
        payer = buyer,
        space = 8 + Escrow::INIT_SPACE,
        seeds = [b"escrow", buyer.key().as_ref(), &seed.to_le_bytes()],
        bump
    )]
    pub escrow: Account<'info, Escrow>,
    #[account(
        init,
        payer = buyer,
        associated_token::mint = mint,
        associated_token::authority = escrow,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = buyer,
    )]
    pub buyer_ata: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Release<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"escrow", escrow.buyer.as_ref(), &escrow.seed.to_le_bytes()],
        bump = escrow.bump,
        has_one = mint,
    )]
    pub escrow: Account<'info, Escrow>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = escrow,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    pub mint: InterfaceAccount<'info, Mint>,
    /// CHECK: constrained to the escrow's designated seller.
    #[account(address = escrow.seller)]
    pub seller: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = authority,
        associated_token::mint = mint,
        associated_token::authority = seller,
    )]
    pub destination_ata: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: vault rent is returned to the buyer; constrained by address.
    #[account(mut, address = escrow.buyer)]
    pub rent_recipient: UncheckedAccount<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Refund<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"escrow", escrow.buyer.as_ref(), &escrow.seed.to_le_bytes()],
        bump = escrow.bump,
        has_one = mint,
    )]
    pub escrow: Account<'info, Escrow>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = escrow,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    pub mint: InterfaceAccount<'info, Mint>,
    /// CHECK: constrained to the escrow's designated buyer.
    #[account(address = escrow.buyer)]
    pub buyer: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = authority,
        associated_token::mint = mint,
        associated_token::authority = buyer,
    )]
    pub destination_ata: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: vault rent is returned to the buyer; constrained by address.
    #[account(mut, address = escrow.buyer)]
    pub rent_recipient: UncheckedAccount<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct Escrow {
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub arbiter: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub seed: u64,
    pub bump: u8,
    pub state: u8,
}

#[repr(u8)]
pub enum EscrowState {
    Active = 0,
    Released = 1,
    Refunded = 2,
}

#[error_code]
pub enum EscrowError {
    #[msg("amount must be greater than zero")]
    ZeroAmount,
    #[msg("escrow is not active")]
    NotActive,
    #[msg("signer is not authorized for this action")]
    Unauthorized,
}
