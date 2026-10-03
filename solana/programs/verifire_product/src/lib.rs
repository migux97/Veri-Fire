// Certificados de VeriFire en Solana: port del contrato Soroban de contracts/verifire_product.
//
// Cada producto es una cuenta PDA ["product", código público]. Al emitir solo se registra la clave pública ed25519
// derivada del secreto impreso dentro de la caja: seed = sha256("verifire-activation-v1:" + secreto), igual que en
// Stellar, así que los QR ya impresos siguen sirviendo. Quien activa demuestra que tiene el secreto firmando, con esa
// clave, un mensaje que ata este programa, el producto y su propia cuenta (anti front-running). La firma la verifica
// el programa nativo Ed25519SigVerify en la instrucción anterior de la misma transacción; este programa la lee por
// introspección del sysvar Instructions. Los links de transferencia funcionan igual con su propio dominio.
use anchor_lang::prelude::*;

mod ed25519;

declare_id!("F6YopjFsuhvDxUmyCPLbovkqXJ6e5DRXpuf7qRWP3Sx4");

pub const CONFIG_SEED: &[u8] = b"config";
pub const PRODUCT_SEED: &[u8] = b"product";
/// Dominio del mensaje que firma la clave de activación. Debe coincidir con ACTIVATION_DOMAIN en src/lib/activation.ts.
pub const ACTIVATION_DOMAIN: &[u8] = b"verifire-activation-v1";
/// Dominio del mensaje que firma la clave de un link de transferencia (TRANSFER_DOMAIN en src/lib/activation.ts).
pub const TRANSFER_DOMAIN: &[u8] = b"verifire-transfer-v1";
/// Debe coincidir con TRANSFER_LINK_MS en src/lib/server/products.ts.
pub const TRANSFER_LINK_SECONDS: i64 = 15 * 60;

// Límites en bytes UTF-8. El servidor valida en caracteres (modelo 120, lote 60, destino 40): un carácter con tilde
// ocupa dos bytes, de ahí el doble.
pub const MAX_CODE_LEN: usize = 32;
pub const MAX_MODEL_LEN: usize = 240;
pub const MAX_LOT_LEN: usize = 120;
pub const MAX_DESTINATION_LEN: usize = 80;

#[program]
pub mod verifire_product {
    use super::*;

    /// Crea la configuración. Solo la puede llamar la autoridad de upgrade del programa, para que nadie se adelante
    /// entre el deploy y la inicialización y se quede como admin.
    pub fn initialize(ctx: Context<Initialize>, minter: Pubkey, offer_cooldown_seconds: i64) -> Result<()> {
        require!(offer_cooldown_seconds >= 0, VerifireError::InvalidCooldown);
        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.minter = minter;
        config.next_token_id = 1;
        config.offer_cooldown_seconds = offer_cooldown_seconds;
        config.bump = ctx.bumps.config;
        Ok(())
    }

    /// Cambia el admin, la cuenta que emite o la espera entre links de transferencia. Solo el admin.
    pub fn update_config(
        ctx: Context<UpdateConfig>,
        new_admin: Option<Pubkey>,
        new_minter: Option<Pubkey>,
        offer_cooldown_seconds: Option<i64>,
    ) -> Result<()> {
        let config = &mut ctx.accounts.config;
        if let Some(admin) = new_admin {
            config.admin = admin;
        }
        if let Some(minter) = new_minter {
            config.minter = minter;
        }
        if let Some(cooldown) = offer_cooldown_seconds {
            require!(cooldown >= 0, VerifireError::InvalidCooldown);
            config.offer_cooldown_seconds = cooldown;
        }
        emit!(ConfigUpdated { admin: config.admin, minter: config.minter, offer_cooldown_seconds: config.offer_cooldown_seconds });
        Ok(())
    }

    /// Registra un producto sellado. Lo firma la cuenta emisora (minter); el rent lo paga `payer`.
    pub fn mint_product(ctx: Context<MintProduct>, args: ProductArgs) -> Result<()> {
        let config = &mut ctx.accounts.config;
        let token_id = config.next_token_id;
        config.next_token_id = token_id.checked_add(1).ok_or(VerifireError::Overflow)?;
        ctx.accounts.product.init(token_id, args, None, ctx.bumps.product)?;
        emit!(ProductMinted { token_id, product: ctx.accounts.product.key(), public_code: ctx.accounts.product.public_code.clone() });
        Ok(())
    }

    /// Trae un producto ya activado con su dueño (migración desde Stellar o desde otro deploy). Solo el admin, no la
    /// cuenta emisora: es la operación que asigna un dueño sin firma del secreto.
    pub fn import_claimed_product(ctx: Context<ImportClaimedProduct>, args: ProductArgs, owner: Pubkey) -> Result<()> {
        let config = &mut ctx.accounts.config;
        let token_id = config.next_token_id;
        config.next_token_id = token_id.checked_add(1).ok_or(VerifireError::Overflow)?;
        ctx.accounts.product.init(token_id, args, Some(owner), ctx.bumps.product)?;
        emit!(ProductImported { token_id, product: ctx.accounts.product.key(), owner });
        Ok(())
    }

    /// Activa la garantía a nombre de `claimant`. La instrucción anterior debe ser Ed25519SigVerify con la firma de
    /// la clave de activación sobre activation_message(producto, claimant).
    pub fn activate_product(ctx: Context<ActivateProduct>) -> Result<()> {
        let product = &mut ctx.accounts.product;
        require!(product.owner.is_none(), VerifireError::AlreadyClaimed);
        let claimant = ctx.accounts.claimant.key();
        let message = signed_message(ACTIVATION_DOMAIN, &product.key(), &claimant);
        ed25519::verify_previous_instruction(&ctx.accounts.instructions, &product.activation_key, &message)?;
        product.owner = Some(claimant);
        emit!(ProductActivated { token_id: product.token_id, product: product.key(), owner: claimant });
        Ok(())
    }

    /// Abre un link de transferencia; uno nuevo reemplaza al anterior. Vence TRANSFER_LINK_SECONDS después.
    pub fn offer_transfer(ctx: Context<OwnerAction>, transfer_key: [u8; 32]) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let cooldown = ctx.accounts.config.offer_cooldown_seconds;
        let product = &mut ctx.accounts.product;
        if product.last_offer_at > 0 {
            require!(now >= product.last_offer_at.saturating_add(cooldown), VerifireError::OfferTooSoon);
        }
        product.transfer_key = Some(transfer_key);
        product.transfer_expires_at = now + TRANSFER_LINK_SECONDS;
        product.last_offer_at = now;
        emit!(TransferOffered { token_id: product.token_id, product: product.key(), expires_at: product.transfer_expires_at });
        Ok(())
    }

    pub fn cancel_transfer(ctx: Context<OwnerAction>) -> Result<()> {
        let product = &mut ctx.accounts.product;
        require!(product.transfer_key.is_some(), VerifireError::NoOpenTransfer);
        product.transfer_key = None;
        product.transfer_expires_at = 0;
        emit!(TransferCancelled { token_id: product.token_id, product: product.key() });
        Ok(())
    }

    /// Acepta un link abierto. La instrucción anterior debe ser Ed25519SigVerify con la firma de la clave del link
    /// sobre transfer_message(producto, recipient).
    pub fn accept_transfer(ctx: Context<AcceptTransfer>) -> Result<()> {
        let product = &mut ctx.accounts.product;
        let transfer_key = product.transfer_key.ok_or(VerifireError::NoOpenTransfer)?;
        let recipient = ctx.accounts.recipient.key();
        require!(product.owner != Some(recipient), VerifireError::AlreadyOwner);
        // A diferencia de la versión Soroban, el vencimiento vive en la misma cuenta que la clave: un link nunca
        // queda abierto sin fecha de vencimiento.
        require!(Clock::get()?.unix_timestamp <= product.transfer_expires_at, VerifireError::TransferExpired);
        let message = signed_message(TRANSFER_DOMAIN, &product.key(), &recipient);
        ed25519::verify_previous_instruction(&ctx.accounts.instructions, &transfer_key, &message)?;
        let previous = product.owner;
        product.owner = Some(recipient);
        product.transfer_key = None;
        product.transfer_expires_at = 0;
        emit!(ProductTransferred { token_id: product.token_id, product: product.key(), previous, owner: recipient });
        Ok(())
    }
}

/// Bytes que firma una clave de activación o de transferencia: dominio || programa || producto || cuenta.
/// La cuenta va en el mensaje, así una firma vista en la red no le sirve a otra cuenta para adelantarse.
pub fn signed_message(domain: &[u8], product: &Pubkey, account: &Pubkey) -> Vec<u8> {
    let mut message = Vec::with_capacity(domain.len() + 96);
    message.extend_from_slice(domain);
    message.extend_from_slice(crate::ID.as_ref());
    message.extend_from_slice(product.as_ref());
    message.extend_from_slice(account.as_ref());
    message
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ProductArgs {
    pub public_code: String,
    pub model: String,
    pub lot: String,
    pub destination: String,
    /// Clave pública ed25519 derivada del secreto de adentro de la caja.
    pub activation_key: [u8; 32],
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub minter: Pubkey,
    pub next_token_id: u64,
    /// Segundos mínimos entre dos links de transferencia del mismo producto. El servidor paga las comisiones, así que
    /// esto evita que un dueño abra y cancele links en bucle para vaciar su cuenta.
    pub offer_cooldown_seconds: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Product {
    pub token_id: u64,
    #[max_len(MAX_CODE_LEN)]
    pub public_code: String,
    #[max_len(MAX_MODEL_LEN)]
    pub model: String,
    #[max_len(MAX_LOT_LEN)]
    pub lot: String,
    #[max_len(MAX_DESTINATION_LEN)]
    pub destination: String,
    pub activation_key: [u8; 32],
    /// None mientras el producto está sellado.
    pub owner: Option<Pubkey>,
    /// Clave pública del link de transferencia abierto, si hay uno.
    pub transfer_key: Option<[u8; 32]>,
    /// Unix timestamp hasta el que se puede aceptar el link abierto; 0 sin link.
    pub transfer_expires_at: i64,
    /// Unix timestamp del último link abierto; 0 si nunca hubo.
    pub last_offer_at: i64,
    pub bump: u8,
}

impl Product {
    fn init(&mut self, token_id: u64, args: ProductArgs, owner: Option<Pubkey>, bump: u8) -> Result<()> {
        require!(!args.public_code.is_empty() && args.public_code.len() <= MAX_CODE_LEN, VerifireError::InvalidCode);
        require!(!args.model.is_empty() && args.model.len() <= MAX_MODEL_LEN, VerifireError::InvalidField);
        require!(!args.lot.is_empty() && args.lot.len() <= MAX_LOT_LEN, VerifireError::InvalidField);
        require!(!args.destination.is_empty() && args.destination.len() <= MAX_DESTINATION_LEN, VerifireError::InvalidField);
        self.token_id = token_id;
        self.public_code = args.public_code;
        self.model = args.model;
        self.lot = args.lot;
        self.destination = args.destination;
        self.activation_key = args.activation_key;
        self.owner = owner;
        self.transfer_key = None;
        self.transfer_expires_at = 0;
        self.last_offer_at = 0;
        self.bump = bump;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = admin, space = 8 + Config::INIT_SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        address = anchor_lang::solana_program::bpf_loader_upgradeable::get_program_data_address(&crate::ID)
            @ VerifireError::NotUpgradeAuthority,
        constraint = program_data.upgrade_authority_address == Some(admin.key()) @ VerifireError::NotUpgradeAuthority,
    )]
    pub program_data: Account<'info, ProgramData>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ VerifireError::NotAdmin)]
    pub config: Account<'info, Config>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(args: ProductArgs)]
pub struct MintProduct<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = minter @ VerifireError::NotMinter)]
    pub config: Account<'info, Config>,
    pub minter: Signer<'info>,
    // `init` falla si el código ya existe: es el índice único por código que en Soroban era TokenByCode.
    #[account(init, payer = payer, space = 8 + Product::INIT_SPACE, seeds = [PRODUCT_SEED, args.public_code.as_bytes()], bump)]
    pub product: Account<'info, Product>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(args: ProductArgs)]
pub struct ImportClaimedProduct<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ VerifireError::NotAdmin)]
    pub config: Account<'info, Config>,
    pub admin: Signer<'info>,
    #[account(init, payer = payer, space = 8 + Product::INIT_SPACE, seeds = [PRODUCT_SEED, args.public_code.as_bytes()], bump)]
    pub product: Account<'info, Product>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ActivateProduct<'info> {
    #[account(mut, seeds = [PRODUCT_SEED, product.public_code.as_bytes()], bump = product.bump)]
    pub product: Account<'info, Product>,
    pub claimant: Signer<'info>,
    /// CHECK: se valida la dirección; es el sysvar Instructions.
    #[account(address = solana_sdk_ids::sysvar::instructions::ID)]
    pub instructions: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct OwnerAction<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [PRODUCT_SEED, product.public_code.as_bytes()],
        bump = product.bump,
        constraint = product.owner == Some(owner.key()) @ VerifireError::NotOwner,
    )]
    pub product: Account<'info, Product>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct AcceptTransfer<'info> {
    #[account(mut, seeds = [PRODUCT_SEED, product.public_code.as_bytes()], bump = product.bump)]
    pub product: Account<'info, Product>,
    pub recipient: Signer<'info>,
    /// CHECK: se valida la dirección; es el sysvar Instructions.
    #[account(address = solana_sdk_ids::sysvar::instructions::ID)]
    pub instructions: UncheckedAccount<'info>,
}

#[event]
pub struct ConfigUpdated {
    pub admin: Pubkey,
    pub minter: Pubkey,
    pub offer_cooldown_seconds: i64,
}

#[event]
pub struct ProductMinted {
    pub token_id: u64,
    pub product: Pubkey,
    pub public_code: String,
}

#[event]
pub struct ProductImported {
    pub token_id: u64,
    pub product: Pubkey,
    pub owner: Pubkey,
}

#[event]
pub struct ProductActivated {
    pub token_id: u64,
    pub product: Pubkey,
    pub owner: Pubkey,
}

#[event]
pub struct TransferOffered {
    pub token_id: u64,
    pub product: Pubkey,
    pub expires_at: i64,
}

#[event]
pub struct TransferCancelled {
    pub token_id: u64,
    pub product: Pubkey,
}

#[event]
pub struct ProductTransferred {
    pub token_id: u64,
    pub product: Pubkey,
    pub previous: Option<Pubkey>,
    pub owner: Pubkey,
}

// Los mensajes se mapean a textos en español en src/lib/server/solana.ts (por nombre de error).
#[error_code]
pub enum VerifireError {
    #[msg("only the program upgrade authority can initialize")]
    NotUpgradeAuthority,
    #[msg("only the admin can do this")]
    NotAdmin,
    #[msg("only the minter can register products")]
    NotMinter,
    #[msg("invalid public code")]
    InvalidCode,
    #[msg("invalid product field")]
    InvalidField,
    #[msg("invalid cooldown")]
    InvalidCooldown,
    #[msg("token id overflow")]
    Overflow,
    #[msg("product is already claimed")]
    AlreadyClaimed,
    #[msg("only the owner can transfer the product")]
    NotOwner,
    #[msg("product has no open transfer")]
    NoOpenTransfer,
    #[msg("recipient already owns the product")]
    AlreadyOwner,
    #[msg("transfer link expired")]
    TransferExpired,
    #[msg("wait before opening another transfer link")]
    OfferTooSoon,
    #[msg("missing or invalid ed25519 signature instruction")]
    InvalidSignature,
}
