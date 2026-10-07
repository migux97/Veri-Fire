// Certificados de VeriFire en Solana.
//
// Un lote se registra con una sola cuenta PDA ["batch", código del lote] que guarda la raíz de un árbol de Merkle con
// una hoja por unidad: (índice, clave de activación, código público). Mientras una unidad está sellada no ocupa
// ninguna cuenta propia, así que no paga rent. Al activarla se crea su certificado, una cuenta chica
// ["certificate", código público] con el dueño, y quien activa presenta la prueba de Merkle de su hoja.
//
// La clave de activación es la clave pública ed25519 derivada del secreto impreso dentro de la caja:
// seed = sha256("verifire-activation-v1:" + secreto), la misma derivación que usa el navegador, así que el secreto
// nunca viaja a la red. Quien activa demuestra que tiene el secreto firmando, con esa clave, un mensaje que ata este
// programa, el certificado y su propia cuenta (anti front-running). La firma la verifica el programa nativo
// Ed25519SigVerify en la instrucción anterior de la misma transacción; este programa la lee por introspección del
// sysvar Instructions. Los links de transferencia funcionan igual con su propio dominio.
use anchor_lang::prelude::*;
use solana_sha256_hasher::hashv;

mod ed25519;

declare_id!("6a6EMSNxCrFzcLA38Q5WwcPWgyDPqdghaoaWhvHAEnj8");

pub const CONFIG_SEED: &[u8] = b"config";
pub const BATCH_SEED: &[u8] = b"batch";
pub const CERTIFICATE_SEED: &[u8] = b"certificate";
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
/// Unidades por lote. La prueba de Merkle suma 32 bytes por nivel a la transacción de activación, que con la
/// instrucción de firma tiene que entrar en 1232 bytes: con 4096 (12 niveles) ocupa 1115. El servidor vende hasta 500
/// por compra (9 niveles, 1019 bytes). Debe coincidir con MAX_BATCH_UNITS en src/lib/server/solana.ts.
pub const MAX_BATCH_UNITS: u32 = 4096;
pub const MAX_PROOF_LEN: usize = 12;

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

    /// Registra un lote sellado: una cuenta con la raíz de Merkle de sus unidades. Lo firma la cuenta emisora
    /// (minter); el rent lo paga `payer`. Cada unidad toma el token id first_token_id + su índice.
    pub fn register_batch(ctx: Context<RegisterBatch>, args: BatchArgs) -> Result<()> {
        require!(args.count > 0 && args.count <= MAX_BATCH_UNITS, VerifireError::InvalidBatch);
        require!(!args.batch_code.is_empty() && args.batch_code.len() <= MAX_CODE_LEN, VerifireError::InvalidCode);
        require!(!args.model.is_empty() && args.model.len() <= MAX_MODEL_LEN, VerifireError::InvalidField);
        require!(!args.lot.is_empty() && args.lot.len() <= MAX_LOT_LEN, VerifireError::InvalidField);
        require!(!args.destination.is_empty() && args.destination.len() <= MAX_DESTINATION_LEN, VerifireError::InvalidField);
        let config = &mut ctx.accounts.config;
        let first_token_id = config.next_token_id;
        config.next_token_id = first_token_id.checked_add(args.count as u64).ok_or(VerifireError::Overflow)?;
        let batch = &mut ctx.accounts.batch;
        batch.root = args.root;
        batch.first_token_id = first_token_id;
        batch.count = args.count;
        batch.bump = ctx.bumps.batch;
        batch.batch_code = args.batch_code;
        batch.model = args.model;
        batch.lot = args.lot;
        batch.destination = args.destination;
        emit!(BatchRegistered { batch: batch.key(), first_token_id, count: batch.count, root: batch.root });
        Ok(())
    }

    /// Crea el certificado de un producto ya activado con su dueño (migración desde otro deploy). Solo el admin, no
    /// la cuenta emisora: es la operación que asigna un dueño sin firma del secreto.
    pub fn import_claimed_product(ctx: Context<ImportClaimedProduct>, public_code: String, owner: Pubkey) -> Result<()> {
        require!(!public_code.is_empty() && public_code.len() <= MAX_CODE_LEN, VerifireError::InvalidCode);
        let config = &mut ctx.accounts.config;
        let token_id = config.next_token_id;
        config.next_token_id = token_id.checked_add(1).ok_or(VerifireError::Overflow)?;
        let certificate = &mut ctx.accounts.certificate;
        certificate.init(token_id, owner, ctx.bumps.certificate);
        emit!(ProductImported { token_id, certificate: certificate.key(), owner });
        Ok(())
    }

    /// Activa la garantía a nombre de `claimant`: prueba que la unidad está en el lote y crea su certificado. La
    /// instrucción anterior debe ser Ed25519SigVerify con la firma de la clave de activación sobre
    /// signed_message(ACTIVATION_DOMAIN, certificado, claimant).
    pub fn activate_product(ctx: Context<ActivateProduct>, args: ActivationArgs) -> Result<()> {
        let certificate = &mut ctx.accounts.certificate;
        // init_if_needed: un certificado que ya existe es un producto ya activado, con su error propio.
        require!(certificate.token_id == 0, VerifireError::AlreadyClaimed);
        let batch = &ctx.accounts.batch;
        require!(args.index < batch.count && args.proof.len() <= MAX_PROOF_LEN, VerifireError::InvalidProof);
        let leaf = leaf_hash(args.index, &args.activation_key, &args.public_code);
        require!(merkle_root(leaf, &args.proof) == batch.root, VerifireError::InvalidProof);
        let claimant = ctx.accounts.claimant.key();
        let message = signed_message(ACTIVATION_DOMAIN, &certificate.key(), &claimant);
        ed25519::verify_previous_instruction(&ctx.accounts.instructions, &args.activation_key, &message)?;
        let token_id = batch.first_token_id + args.index as u64;
        certificate.init(token_id, claimant, ctx.bumps.certificate);
        emit!(ProductActivated { token_id, batch: batch.key(), certificate: certificate.key(), owner: claimant });
        Ok(())
    }

    /// Abre un link de transferencia; uno nuevo reemplaza al anterior. Vence TRANSFER_LINK_SECONDS después.
    pub fn offer_transfer(ctx: Context<OwnerAction>, transfer_key: [u8; 32]) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let cooldown = ctx.accounts.config.offer_cooldown_seconds;
        let certificate = &mut ctx.accounts.certificate;
        if certificate.last_offer_at > 0 {
            require!(now >= certificate.last_offer_at.saturating_add(cooldown), VerifireError::OfferTooSoon);
        }
        certificate.transfer_key = Some(transfer_key);
        certificate.transfer_expires_at = now + TRANSFER_LINK_SECONDS;
        certificate.last_offer_at = now;
        emit!(TransferOffered { token_id: certificate.token_id, certificate: certificate.key(), expires_at: certificate.transfer_expires_at });
        Ok(())
    }

    pub fn cancel_transfer(ctx: Context<OwnerAction>) -> Result<()> {
        let certificate = &mut ctx.accounts.certificate;
        require!(certificate.transfer_key.is_some(), VerifireError::NoOpenTransfer);
        certificate.transfer_key = None;
        certificate.transfer_expires_at = 0;
        emit!(TransferCancelled { token_id: certificate.token_id, certificate: certificate.key() });
        Ok(())
    }

    /// Acepta un link abierto. La instrucción anterior debe ser Ed25519SigVerify con la firma de la clave del link
    /// sobre signed_message(TRANSFER_DOMAIN, certificado, recipient).
    pub fn accept_transfer(ctx: Context<AcceptTransfer>) -> Result<()> {
        let certificate = &mut ctx.accounts.certificate;
        let transfer_key = certificate.transfer_key.ok_or(VerifireError::NoOpenTransfer)?;
        let recipient = ctx.accounts.recipient.key();
        require!(certificate.owner != recipient, VerifireError::AlreadyOwner);
        // El vencimiento vive en la misma cuenta que la clave: un link nunca queda abierto sin fecha de vencimiento.
        require!(Clock::get()?.unix_timestamp <= certificate.transfer_expires_at, VerifireError::TransferExpired);
        let message = signed_message(TRANSFER_DOMAIN, &certificate.key(), &recipient);
        ed25519::verify_previous_instruction(&ctx.accounts.instructions, &transfer_key, &message)?;
        let previous = certificate.owner;
        certificate.owner = recipient;
        certificate.transfer_key = None;
        certificate.transfer_expires_at = 0;
        emit!(ProductTransferred { token_id: certificate.token_id, certificate: certificate.key(), previous, owner: recipient });
        Ok(())
    }
}

/// Bytes que firma una clave de activación o de transferencia: dominio || programa || certificado || cuenta.
/// La cuenta va en el mensaje, así una firma vista en la red no le sirve a otra cuenta para adelantarse.
pub fn signed_message(domain: &[u8], certificate: &Pubkey, account: &Pubkey) -> Vec<u8> {
    let mut message = Vec::with_capacity(domain.len() + 96);
    message.extend_from_slice(domain);
    message.extend_from_slice(crate::ID.as_ref());
    message.extend_from_slice(certificate.as_ref());
    message.extend_from_slice(account.as_ref());
    message
}

/// Hoja de una unidad: sha256(0x00 || índice u32 LE || clave de activación || código público). El índice fija su
/// token id; el prefijo distingue hojas de nodos internos.
pub fn leaf_hash(index: u32, activation_key: &[u8; 32], public_code: &str) -> [u8; 32] {
    hashv(&[&[0u8][..], &index.to_le_bytes()[..], &activation_key[..], public_code.as_bytes()]).to_bytes()
}

/// Nodo interno: sha256(0x01 || menor || mayor). Los pares van ordenados, así la prueba no necesita posiciones.
pub fn node_hash(a: &[u8; 32], b: &[u8; 32]) -> [u8; 32] {
    let (low, high) = if a <= b { (a, b) } else { (b, a) };
    hashv(&[&[1u8][..], &low[..], &high[..]]).to_bytes()
}

/// Raíz que resulta de subir desde `leaf` con los hermanos de `proof`, de abajo hacia arriba.
pub fn merkle_root(leaf: [u8; 32], proof: &[[u8; 32]]) -> [u8; 32] {
    proof.iter().fold(leaf, |node, sibling| node_hash(&node, sibling))
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct BatchArgs {
    pub batch_code: String,
    /// Raíz del árbol de hojas leaf_hash(índice, clave de activación, código) de las unidades del lote.
    pub root: [u8; 32],
    pub count: u32,
    pub model: String,
    pub lot: String,
    pub destination: String,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ActivationArgs {
    pub public_code: String,
    pub index: u32,
    /// Clave pública ed25519 derivada del secreto de adentro de la caja.
    pub activation_key: [u8; 32],
    pub proof: Vec<[u8; 32]>,
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

/// Un lote sellado. Ocupa solo lo que miden sus textos.
#[account]
pub struct Batch {
    pub root: [u8; 32],
    pub first_token_id: u64,
    pub count: u32,
    pub bump: u8,
    pub batch_code: String,
    pub model: String,
    pub lot: String,
    pub destination: String,
}

impl Batch {
    pub fn space(args: &BatchArgs) -> usize {
        8 + 32 + 8 + 4 + 1 + 4 * 4 + args.batch_code.len() + args.model.len() + args.lot.len() + args.destination.len()
    }
}

/// El certificado de un producto activado: lo único que paga rent por unidad.
#[account]
#[derive(InitSpace)]
pub struct Certificate {
    pub token_id: u64,
    pub owner: Pubkey,
    /// Clave pública del link de transferencia abierto, si hay uno.
    pub transfer_key: Option<[u8; 32]>,
    /// Unix timestamp hasta el que se puede aceptar el link abierto; 0 sin link.
    pub transfer_expires_at: i64,
    /// Unix timestamp del último link abierto; 0 si nunca hubo.
    pub last_offer_at: i64,
    pub bump: u8,
}

impl Certificate {
    fn init(&mut self, token_id: u64, owner: Pubkey, bump: u8) {
        self.token_id = token_id;
        self.owner = owner;
        self.transfer_key = None;
        self.transfer_expires_at = 0;
        self.last_offer_at = 0;
        self.bump = bump;
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
#[instruction(args: BatchArgs)]
pub struct RegisterBatch<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = minter @ VerifireError::NotMinter)]
    pub config: Account<'info, Config>,
    pub minter: Signer<'info>,
    // `init` falla si el código del lote ya existe.
    #[account(init, payer = payer, space = Batch::space(&args), seeds = [BATCH_SEED, args.batch_code.as_bytes()], bump)]
    pub batch: Account<'info, Batch>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(public_code: String)]
pub struct ImportClaimedProduct<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ VerifireError::NotAdmin)]
    pub config: Account<'info, Config>,
    pub admin: Signer<'info>,
    #[account(init, payer = payer, space = 8 + Certificate::INIT_SPACE, seeds = [CERTIFICATE_SEED, public_code.as_bytes()], bump)]
    pub certificate: Account<'info, Certificate>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(args: ActivationArgs)]
pub struct ActivateProduct<'info> {
    pub batch: Account<'info, Batch>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + Certificate::INIT_SPACE,
        seeds = [CERTIFICATE_SEED, args.public_code.as_bytes()],
        bump,
    )]
    pub certificate: Account<'info, Certificate>,
    pub claimant: Signer<'info>,
    /// Paga el rent del certificado: el servidor, que también paga la comisión.
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: se valida la dirección; es el sysvar Instructions.
    #[account(address = solana_sdk_ids::sysvar::instructions::ID)]
    pub instructions: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct OwnerAction<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, constraint = certificate.owner == owner.key() @ VerifireError::NotOwner)]
    pub certificate: Account<'info, Certificate>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct AcceptTransfer<'info> {
    #[account(mut)]
    pub certificate: Account<'info, Certificate>,
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
pub struct BatchRegistered {
    pub batch: Pubkey,
    pub first_token_id: u64,
    pub count: u32,
    pub root: [u8; 32],
}

#[event]
pub struct ProductImported {
    pub token_id: u64,
    pub certificate: Pubkey,
    pub owner: Pubkey,
}

#[event]
pub struct ProductActivated {
    pub token_id: u64,
    pub batch: Pubkey,
    pub certificate: Pubkey,
    pub owner: Pubkey,
}

#[event]
pub struct TransferOffered {
    pub token_id: u64,
    pub certificate: Pubkey,
    pub expires_at: i64,
}

#[event]
pub struct TransferCancelled {
    pub token_id: u64,
    pub certificate: Pubkey,
}

#[event]
pub struct ProductTransferred {
    pub token_id: u64,
    pub certificate: Pubkey,
    pub previous: Pubkey,
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
    #[msg("the unit is not in this batch")]
    InvalidProof,
    #[msg("invalid batch size")]
    InvalidBatch,
}
