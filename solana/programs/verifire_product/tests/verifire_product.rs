// Tests del programa ejecutado de forma nativa con solana-program-test (incluye la verificación real de
// Ed25519SigVerify y el sysvar Instructions): emisión, activación, transferencias, separación de llaves, cooldown
// y firmas para otro producto o cuenta.
use anchor_lang::{
    prelude::Pubkey, solana_program::bpf_loader_upgradeable, solana_program::instruction::Instruction,
    AccountDeserialize, InstructionData, ToAccountMetas,
};
use ed25519_dalek::{Signer as _, SigningKey};
use sha2::{Digest, Sha256};
use solana_account::Account;
use solana_clock::Clock;
use solana_keypair::Keypair;
use solana_program_test::{processor, ProgramTest, ProgramTestContext};
use solana_signer::Signer;
use solana_transaction::Transaction;
mod stubs;

use verifire_product::{
    accounts, instruction, signed_message, Config, Product, ProductArgs, ACTIVATION_DOMAIN, CONFIG_SEED, PRODUCT_SEED,
    TRANSFER_DOMAIN, TRANSFER_LINK_SECONDS,
};

const ID: Pubkey = verifire_product::ID;
const START: i64 = 1_800_000_000;

// El entrypoint de Anchor pide que las cuentas vivan 'info; el runtime nativo de los tests las presta por menos.
fn entry(program_id: &Pubkey, accounts: &[anchor_lang::prelude::AccountInfo], data: &[u8]) -> anchor_lang::solana_program::entrypoint::ProgramResult {
    let accounts = unsafe { std::mem::transmute::<&[anchor_lang::prelude::AccountInfo], &[anchor_lang::prelude::AccountInfo]>(accounts) };
    verifire_product::entry(program_id, accounts, data)
}

/// seed = sha256("<dominio>:" + secreto), igual que src/lib/activation.ts y el navegador.
fn key_for(domain: &[u8], secret: &str) -> SigningKey {
    let mut hasher = Sha256::new();
    hasher.update(domain);
    hasher.update(b":");
    hasher.update(secret.as_bytes());
    SigningKey::from_bytes(&hasher.finalize().into())
}

fn config_pda() -> Pubkey {
    Pubkey::find_program_address(&[CONFIG_SEED], &ID).0
}

fn product_pda(code: &str) -> Pubkey {
    Pubkey::find_program_address(&[PRODUCT_SEED, code.as_bytes()], &ID).0
}

fn ed25519_ix(key: &SigningKey, message: &[u8]) -> Instruction {
    let signature = key.sign(message).to_bytes();
    let ix = solana_ed25519_program::new_ed25519_instruction_with_signature(message, &signature, &key.verifying_key().to_bytes());
    Instruction { program_id: ix.program_id, accounts: vec![], data: ix.data }
}

struct Env {
    ctx: ProgramTestContext,
    admin: Keypair,
    minter: Keypair,
}

fn funded() -> Account {
    Account { lamports: 10_000_000_000, ..Account::default() }
}

/// ProgramData del loader upgradeable con `authority` como autoridad de upgrade (bincode de UpgradeableLoaderState).
fn program_data(authority: &Pubkey) -> Account {
    let mut data = 3u32.to_le_bytes().to_vec();
    data.extend_from_slice(&0u64.to_le_bytes());
    data.push(1);
    data.extend_from_slice(authority.as_ref());
    Account { lamports: 1_000_000_000, data, owner: bpf_loader_upgradeable::ID, executable: false, rent_epoch: 0 }
}

async fn start() -> Env {
    let admin = Keypair::new();
    let minter = Keypair::new();
    let mut test = ProgramTest::new("verifire_product", ID, processor!(entry));
    test.prefer_bpf(false);
    test.add_account(admin.pubkey(), funded());
    test.add_account(minter.pubkey(), funded());
    test.add_account(bpf_loader_upgradeable::get_program_data_address(&ID), program_data(&admin.pubkey()));
    let ctx = test.start_with_context().await;
    stubs::bridge();
    let mut env = Env { ctx, admin, minter };
    env.set_time(START);
    env
}

impl Env {
    fn set_time(&mut self, unix_timestamp: i64) {
        self.ctx.set_sysvar(&Clock { unix_timestamp, ..Clock::default() });
    }

    async fn send(&mut self, ixs: &[Instruction], signers: &[&Keypair]) -> Result<(), String> {
        let blockhash = self.ctx.get_new_latest_blockhash().await.unwrap();
        self.ctx.last_blockhash = blockhash;
        let payer = self.ctx.payer.insecure_clone();
        let mut all: Vec<&Keypair> = vec![&payer];
        all.extend_from_slice(signers);
        let tx = Transaction::new_signed_with_payer(ixs, Some(&payer.pubkey()), &all, blockhash);
        self.ctx.banks_client.process_transaction(tx).await.map_err(|error| format!("{error:?}"))
    }

    async fn new_user(&mut self) -> Keypair {
        // Las cuentas de los usuarios no necesitan SOL: firman y el servidor paga.
        Keypair::new()
    }

    async fn initialize(&mut self, signer: &Keypair, cooldown: i64) -> Result<(), String> {
        let ix = Instruction {
            program_id: ID,
            accounts: accounts::Initialize {
                config: config_pda(),
                admin: signer.pubkey(),
                program_data: bpf_loader_upgradeable::get_program_data_address(&ID),
                system_program: anchor_lang::system_program::ID,
            }
            .to_account_metas(None),
            data: instruction::Initialize { minter: self.minter.pubkey(), offer_cooldown_seconds: cooldown }.data(),
        };
        let signer = signer.insecure_clone();
        self.send(&[ix], &[&signer]).await
    }

    async fn ready(cooldown: i64) -> Env {
        let mut env = start().await;
        let admin = env.admin.insecure_clone();
        env.initialize(&admin, cooldown).await.unwrap();
        env
    }

    async fn mint_as(&mut self, signer: &Keypair, code: &str, secret: &str) -> Result<(), String> {
        let ix = Instruction {
            program_id: ID,
            accounts: accounts::MintProduct {
                config: config_pda(),
                minter: signer.pubkey(),
                product: product_pda(code),
                payer: self.ctx.payer.pubkey(),
                system_program: anchor_lang::system_program::ID,
            }
            .to_account_metas(None),
            data: instruction::MintProduct { args: args(code, secret) }.data(),
        };
        let signer = signer.insecure_clone();
        self.send(&[ix], &[&signer]).await
    }

    async fn mint(&mut self, code: &str, secret: &str) {
        let minter = self.minter.insecure_clone();
        self.mint_as(&minter, code, secret).await.unwrap();
    }

    async fn import_as(&mut self, signer: &Keypair, code: &str, secret: &str, owner: Pubkey) -> Result<(), String> {
        let ix = Instruction {
            program_id: ID,
            accounts: accounts::ImportClaimedProduct {
                config: config_pda(),
                admin: signer.pubkey(),
                product: product_pda(code),
                payer: self.ctx.payer.pubkey(),
                system_program: anchor_lang::system_program::ID,
            }
            .to_account_metas(None),
            data: instruction::ImportClaimedProduct { args: args(code, secret), owner }.data(),
        };
        let signer = signer.insecure_clone();
        self.send(&[ix], &[&signer]).await
    }

    /// Activa firmando con `key` el mensaje de `signed_for` (normalmente el mismo claimant).
    async fn activate_with(&mut self, code: &str, key: &SigningKey, claimant: &Keypair, signed_for: &Pubkey, with_signature: bool) -> Result<(), String> {
        let product = product_pda(code);
        let activate = Instruction {
            program_id: ID,
            accounts: accounts::ActivateProduct {
                product,
                claimant: claimant.pubkey(),
                instructions: solana_sdk_ids_instructions(),
            }
            .to_account_metas(None),
            data: instruction::ActivateProduct {}.data(),
        };
        let message = signed_message(ACTIVATION_DOMAIN, &product, signed_for);
        let ixs = if with_signature { vec![ed25519_ix(key, &message), activate] } else { vec![activate] };
        self.send(&ixs, &[claimant]).await
    }

    async fn activate(&mut self, code: &str, secret: &str, claimant: &Keypair) -> Result<(), String> {
        let key = key_for(ACTIVATION_DOMAIN, secret);
        self.activate_with(code, &key, claimant, &claimant.pubkey(), true).await
    }

    async fn offer(&mut self, code: &str, owner: &Keypair, link_secret: &str) -> Result<(), String> {
        let key = key_for(TRANSFER_DOMAIN, link_secret);
        let ix = Instruction {
            program_id: ID,
            accounts: accounts::OwnerAction { config: config_pda(), product: product_pda(code), owner: owner.pubkey() }.to_account_metas(None),
            data: instruction::OfferTransfer { transfer_key: key.verifying_key().to_bytes() }.data(),
        };
        self.send(&[ix], &[owner]).await
    }

    async fn cancel(&mut self, code: &str, owner: &Keypair) -> Result<(), String> {
        let ix = Instruction {
            program_id: ID,
            accounts: accounts::OwnerAction { config: config_pda(), product: product_pda(code), owner: owner.pubkey() }.to_account_metas(None),
            data: instruction::CancelTransfer {}.data(),
        };
        self.send(&[ix], &[owner]).await
    }

    async fn accept_with(&mut self, code: &str, key: &SigningKey, recipient: &Keypair, signed_for: &Pubkey) -> Result<(), String> {
        let product = product_pda(code);
        let accept = Instruction {
            program_id: ID,
            accounts: accounts::AcceptTransfer { product, recipient: recipient.pubkey(), instructions: solana_sdk_ids_instructions() }
                .to_account_metas(None),
            data: instruction::AcceptTransfer {}.data(),
        };
        let message = signed_message(TRANSFER_DOMAIN, &product, signed_for);
        self.send(&[ed25519_ix(key, &message), accept], &[recipient]).await
    }

    async fn accept(&mut self, code: &str, link_secret: &str, recipient: &Keypair) -> Result<(), String> {
        let key = key_for(TRANSFER_DOMAIN, link_secret);
        self.accept_with(code, &key, recipient, &recipient.pubkey()).await
    }

    async fn product(&mut self, code: &str) -> Product {
        let account = self.ctx.banks_client.get_account(product_pda(code)).await.unwrap().expect("product account");
        Product::try_deserialize(&mut account.data.as_slice()).unwrap()
    }

    async fn config(&mut self) -> Config {
        let account = self.ctx.banks_client.get_account(config_pda()).await.unwrap().expect("config account");
        Config::try_deserialize(&mut account.data.as_slice()).unwrap()
    }
}

fn solana_sdk_ids_instructions() -> Pubkey {
    Pubkey::from_str_const("Sysvar1nstructions1111111111111111111111111")
}

fn args(code: &str, secret: &str) -> ProductArgs {
    ProductArgs {
        public_code: code.to_string(),
        model: "Taladro Percutor 750W".to_string(),
        lot: "L-2026-09".to_string(),
        destination: "Argentina".to_string(),
        activation_key: key_for(ACTIVATION_DOMAIN, secret).verifying_key().to_bytes(),
    }
}

fn assert_err(result: Result<(), String>, code: &str) {
    let error = result.expect_err("la transacción debía fallar");
    // Los errores de Anchor llegan como Custom(6000 + índice); comparamos por número para no depender del texto.
    let index = [
        "NotUpgradeAuthority", "NotAdmin", "NotMinter", "InvalidCode", "InvalidField", "InvalidCooldown", "Overflow",
        "AlreadyClaimed", "NotOwner", "NoOpenTransfer", "AlreadyOwner", "TransferExpired", "OfferTooSoon", "InvalidSignature",
    ]
    .iter()
    .position(|name| *name == code)
    .expect("error conocido");
    let expected = format!("Custom({})", 6000 + index);
    assert!(error.contains(&expected), "se esperaba {code} ({expected}), llegó {error}");
}

const SECRET: &str = "VF-SECRET-00112233445566778899";
const CODE: &str = "VF-ABCDEFGH";

#[tokio::test]
async fn only_the_upgrade_authority_initializes() {
    let mut env = start().await;
    let intruder = Keypair::new();
    // Con fondos, para que lo que falle sea el control de autoridad y no el pago del rent.
    let mut data = 2u32.to_le_bytes().to_vec();
    data.extend_from_slice(&1_000_000_000u64.to_le_bytes());
    let fund = Instruction {
        program_id: anchor_lang::system_program::ID,
        accounts: vec![
            anchor_lang::prelude::AccountMeta::new(env.ctx.payer.pubkey(), true),
            anchor_lang::prelude::AccountMeta::new(intruder.pubkey(), false),
        ],
        data,
    };
    env.send(&[fund], &[]).await.unwrap();
    assert_err(env.initialize(&intruder, 0).await, "NotUpgradeAuthority");
    let admin = env.admin.insecure_clone();
    env.initialize(&admin, 0).await.unwrap();
    let config = env.config().await;
    assert_eq!(config.admin, admin.pubkey());
    assert_eq!(config.minter, env.minter.pubkey());
    assert_eq!(config.next_token_id, 1);
    assert!(env.initialize(&admin, 0).await.is_err(), "no se inicializa dos veces");
}

#[tokio::test]
async fn mint_and_claim() {
    let mut env = Env::ready(0).await;
    env.mint(CODE, SECRET).await;
    let product = env.product(CODE).await;
    assert_eq!(product.token_id, 1);
    assert_eq!(product.public_code, CODE);
    assert!(product.owner.is_none());
    let buyer = env.new_user().await;
    env.activate(CODE, SECRET, &buyer).await.unwrap();
    assert_eq!(env.product(CODE).await.owner, Some(buyer.pubkey()));
    env.mint("VF-SECOND01", "VF-SECRET-OTHER").await;
    assert_eq!(env.product("VF-SECOND01").await.token_id, 2);
}

#[tokio::test]
async fn only_the_minter_mints_and_codes_are_unique() {
    let mut env = Env::ready(0).await;
    let intruder = Keypair::new();
    assert_err(env.mint_as(&intruder, CODE, SECRET).await, "NotMinter");
    // El admin tampoco emite: son llaves separadas.
    let admin = env.admin.insecure_clone();
    assert_err(env.mint_as(&admin, CODE, SECRET).await, "NotMinter");
    env.mint(CODE, SECRET).await;
    let minter = env.minter.insecure_clone();
    assert!(env.mint_as(&minter, CODE, "VF-SECRET-OTHER").await.is_err(), "el código ya existe");
}

#[tokio::test]
async fn cannot_claim_twice() {
    let mut env = Env::ready(0).await;
    env.mint(CODE, SECRET).await;
    let buyer = env.new_user().await;
    env.activate(CODE, SECRET, &buyer).await.unwrap();
    let other = env.new_user().await;
    assert_err(env.activate(CODE, SECRET, &other).await, "AlreadyClaimed");
}

#[tokio::test]
async fn wrong_secret_is_rejected() {
    let mut env = Env::ready(0).await;
    env.mint(CODE, SECRET).await;
    let buyer = env.new_user().await;
    assert_err(env.activate(CODE, "VF-SECRET-WRONG", &buyer).await, "InvalidSignature");
}

#[tokio::test]
async fn activation_requires_the_signature_instruction() {
    let mut env = Env::ready(0).await;
    env.mint(CODE, SECRET).await;
    let buyer = env.new_user().await;
    let key = key_for(ACTIVATION_DOMAIN, SECRET);
    assert_err(env.activate_with(CODE, &key, &buyer, &buyer.pubkey(), false).await, "InvalidSignature");
}

#[tokio::test]
async fn front_runner_cannot_reuse_signature() {
    let mut env = Env::ready(0).await;
    env.mint(CODE, SECRET).await;
    let buyer = env.new_user().await;
    let attacker = env.new_user().await;
    let key = key_for(ACTIVATION_DOMAIN, SECRET);
    // El atacante copia la firma que el comprador hizo para su propia cuenta.
    assert_err(env.activate_with(CODE, &key, &attacker, &buyer.pubkey(), true).await, "InvalidSignature");
    env.activate(CODE, SECRET, &buyer).await.unwrap();
}

#[tokio::test]
async fn signature_for_another_product_is_rejected() {
    let mut env = Env::ready(0).await;
    env.mint(CODE, SECRET).await;
    env.mint("VF-OTHER001", SECRET).await;
    let buyer = env.new_user().await;
    let key = key_for(ACTIVATION_DOMAIN, SECRET);
    let product = product_pda("VF-OTHER001");
    let message = signed_message(ACTIVATION_DOMAIN, &product, &buyer.pubkey());
    let activate = Instruction {
        program_id: ID,
        accounts: accounts::ActivateProduct { product: product_pda(CODE), claimant: buyer.pubkey(), instructions: solana_sdk_ids_instructions() }
            .to_account_metas(None),
        data: instruction::ActivateProduct {}.data(),
    };
    assert_err(env.send(&[ed25519_ix(&key, &message), activate], &[&buyer]).await, "InvalidSignature");
}

#[tokio::test]
async fn transfer_with_link_secret() {
    let mut env = Env::ready(0).await;
    env.mint(CODE, SECRET).await;
    let owner = env.new_user().await;
    let recipient = env.new_user().await;
    env.activate(CODE, SECRET, &owner).await.unwrap();
    env.offer(CODE, &owner, "link-1").await.unwrap();
    let offered = env.product(CODE).await;
    assert_eq!(offered.transfer_expires_at, START + TRANSFER_LINK_SECONDS);
    env.accept(CODE, "link-1", &recipient).await.unwrap();
    let product = env.product(CODE).await;
    assert_eq!(product.owner, Some(recipient.pubkey()));
    assert!(product.transfer_key.is_none());
    // Un solo uso.
    let third = env.new_user().await;
    assert_err(env.accept(CODE, "link-1", &third).await, "NoOpenTransfer");
}

#[tokio::test]
async fn only_owner_offers_and_sealed_cannot_be_offered() {
    let mut env = Env::ready(0).await;
    env.mint(CODE, SECRET).await;
    let someone = env.new_user().await;
    assert_err(env.offer(CODE, &someone, "link").await, "NotOwner");
    env.activate(CODE, SECRET, &someone).await.unwrap();
    let other = env.new_user().await;
    assert_err(env.offer(CODE, &other, "link").await, "NotOwner");
    assert_err(env.cancel(CODE, &other).await, "NotOwner");
}

#[tokio::test]
async fn cancelled_or_replaced_link_stops_working() {
    let mut env = Env::ready(0).await;
    env.mint(CODE, SECRET).await;
    let owner = env.new_user().await;
    let recipient = env.new_user().await;
    env.activate(CODE, SECRET, &owner).await.unwrap();
    env.offer(CODE, &owner, "link-1").await.unwrap();
    env.offer(CODE, &owner, "link-2").await.unwrap();
    assert_err(env.accept(CODE, "link-1", &recipient).await, "InvalidSignature");
    env.cancel(CODE, &owner).await.unwrap();
    assert_err(env.accept(CODE, "link-2", &recipient).await, "NoOpenTransfer");
    assert_err(env.cancel(CODE, &owner).await, "NoOpenTransfer");
}

#[tokio::test]
async fn transfer_signature_not_reusable_by_another_account() {
    let mut env = Env::ready(0).await;
    env.mint(CODE, SECRET).await;
    let owner = env.new_user().await;
    let recipient = env.new_user().await;
    let attacker = env.new_user().await;
    env.activate(CODE, SECRET, &owner).await.unwrap();
    env.offer(CODE, &owner, "link").await.unwrap();
    let key = key_for(TRANSFER_DOMAIN, "link");
    assert_err(env.accept_with(CODE, &key, &attacker, &recipient.pubkey()).await, "InvalidSignature");
    env.accept(CODE, "link", &recipient).await.unwrap();
}

#[tokio::test]
async fn activation_secret_cannot_accept_transfer() {
    let mut env = Env::ready(0).await;
    env.mint(CODE, SECRET).await;
    let owner = env.new_user().await;
    let recipient = env.new_user().await;
    env.activate(CODE, SECRET, &owner).await.unwrap();
    env.offer(CODE, &owner, "link").await.unwrap();
    // Firma con la clave de activación (dominio distinto) sobre el mensaje de transferencia.
    let activation_key = key_for(ACTIVATION_DOMAIN, SECRET);
    assert_err(env.accept_with(CODE, &activation_key, &recipient, &recipient.pubkey()).await, "InvalidSignature");
}

#[tokio::test]
async fn owner_cannot_accept_own_link() {
    let mut env = Env::ready(0).await;
    env.mint(CODE, SECRET).await;
    let owner = env.new_user().await;
    env.activate(CODE, SECRET, &owner).await.unwrap();
    env.offer(CODE, &owner, "link").await.unwrap();
    assert_err(env.accept(CODE, "link", &owner).await, "AlreadyOwner");
}

#[tokio::test]
async fn import_keeps_owner_and_is_admin_only() {
    let mut env = Env::ready(0).await;
    let owner = Keypair::new();
    let minter = env.minter.insecure_clone();
    assert_err(env.import_as(&minter, CODE, SECRET, owner.pubkey()).await, "NotAdmin");
    let admin = env.admin.insecure_clone();
    env.import_as(&admin, CODE, SECRET, owner.pubkey()).await.unwrap();
    let product = env.product(CODE).await;
    assert_eq!(product.owner, Some(owner.pubkey()));
    let buyer = env.new_user().await;
    assert_err(env.activate(CODE, SECRET, &buyer).await, "AlreadyClaimed");
    // El dueño importado puede transferir.
    env.offer(CODE, &owner, "link").await.unwrap();
}

#[tokio::test]
async fn expired_link_is_rejected_and_accepted_until_expiry() {
    let mut env = Env::ready(0).await;
    env.mint(CODE, SECRET).await;
    let owner = env.new_user().await;
    let recipient = env.new_user().await;
    env.activate(CODE, SECRET, &owner).await.unwrap();
    env.offer(CODE, &owner, "link").await.unwrap();
    env.set_time(START + TRANSFER_LINK_SECONDS + 1);
    assert_err(env.accept(CODE, "link", &recipient).await, "TransferExpired");
    env.offer(CODE, &owner, "link-2").await.unwrap();
    env.set_time(START + 2 * TRANSFER_LINK_SECONDS + 1);
    env.accept(CODE, "link-2", &recipient).await.unwrap();
}

#[tokio::test]
async fn reopen_link_immediately_without_cooldown() {
    let mut env = Env::ready(0).await;
    env.mint(CODE, SECRET).await;
    let owner = env.new_user().await;
    env.activate(CODE, SECRET, &owner).await.unwrap();
    env.offer(CODE, &owner, "link-1").await.unwrap();
    env.cancel(CODE, &owner).await.unwrap();
    env.offer(CODE, &owner, "link-2").await.unwrap();
}

#[tokio::test]
async fn cooldown_limits_new_links() {
    let mut env = Env::ready(60).await;
    env.mint(CODE, SECRET).await;
    let owner = env.new_user().await;
    env.activate(CODE, SECRET, &owner).await.unwrap();
    env.offer(CODE, &owner, "link-1").await.unwrap();
    env.cancel(CODE, &owner).await.unwrap();
    assert_err(env.offer(CODE, &owner, "link-2").await, "OfferTooSoon");
    env.set_time(START + 60);
    env.offer(CODE, &owner, "link-2").await.unwrap();
}

#[tokio::test]
async fn admin_updates_config() {
    let mut env = Env::ready(0).await;
    let new_minter = Keypair::new();
    let intruder = Keypair::new();
    let update = |admin: Pubkey| Instruction {
        program_id: ID,
        accounts: accounts::UpdateConfig { config: config_pda(), admin }.to_account_metas(None),
        data: instruction::UpdateConfig { new_admin: None, new_minter: Some(new_minter.pubkey()), offer_cooldown_seconds: Some(30) }.data(),
    };
    assert_err(env.send(&[update(intruder.pubkey())], &[&intruder]).await, "NotAdmin");
    let admin = env.admin.insecure_clone();
    env.send(&[update(admin.pubkey())], &[&admin]).await.unwrap();
    let config = env.config().await;
    assert_eq!(config.minter, new_minter.pubkey());
    assert_eq!(config.offer_cooldown_seconds, 30);
    // La cuenta emisora anterior ya no puede emitir.
    assert_err(env.mint_as(&env.minter.insecure_clone(), CODE, SECRET).await, "NotMinter");
}

#[tokio::test]
async fn empty_code_is_rejected() {
    let mut env = Env::ready(0).await;
    assert_err(env.mint_as(&env.minter.insecure_clone(), "", SECRET).await, "InvalidCode");
}
