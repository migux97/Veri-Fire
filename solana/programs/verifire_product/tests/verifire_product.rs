// Tests del programa ejecutado de forma nativa con solana-program-test (incluye la verificación real de
// Ed25519SigVerify y el sysvar Instructions): registro por lote con prueba de Merkle, activación, transferencias,
// separación de llaves, cooldown y firmas para otro producto o cuenta.
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
    accounts, instruction, leaf_hash, node_hash, signed_message, ActivationArgs, Batch, BatchArgs, Certificate, Config,
    ACTIVATION_DOMAIN, BATCH_SEED, CERTIFICATE_SEED, CONFIG_SEED, TRANSFER_DOMAIN, TRANSFER_LINK_SECONDS,
};
use std::collections::HashMap;

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

fn activation_key(secret: &str) -> [u8; 32] {
    key_for(ACTIVATION_DOMAIN, secret).verifying_key().to_bytes()
}

fn config_pda() -> Pubkey {
    Pubkey::find_program_address(&[CONFIG_SEED], &ID).0
}

fn batch_pda(code: &str) -> Pubkey {
    Pubkey::find_program_address(&[BATCH_SEED, code.as_bytes()], &ID).0
}

fn certificate_pda(code: &str) -> Pubkey {
    Pubkey::find_program_address(&[CERTIFICATE_SEED, code.as_bytes()], &ID).0
}

/// Árbol de Merkle del lote, igual que merkleTree en src/lib/server/solana-program.ts: pares ordenados y, en un nivel
/// impar, el último nodo sube sin pareja. Devuelve la raíz y la prueba de cada hoja.
fn merkle(leaves: &[[u8; 32]]) -> ([u8; 32], Vec<Vec<[u8; 32]>>) {
    let mut proofs = vec![Vec::new(); leaves.len()];
    let mut positions: Vec<usize> = (0..leaves.len()).collect();
    let mut level = leaves.to_vec();
    while level.len() > 1 {
        for (leaf, position) in positions.iter_mut().enumerate() {
            let sibling = *position ^ 1;
            if sibling < level.len() {
                proofs[leaf].push(level[sibling]);
            }
            *position /= 2;
        }
        level = level.chunks(2).map(|pair| if pair.len() == 2 { node_hash(&pair[0], &pair[1]) } else { pair[0] }).collect();
    }
    (level[0], proofs)
}

fn ed25519_ix(key: &SigningKey, message: &[u8]) -> Instruction {
    let signature = key.sign(message).to_bytes();
    let ix = solana_ed25519_program::new_ed25519_instruction_with_signature(message, &signature, &key.verifying_key().to_bytes());
    Instruction { program_id: ix.program_id, accounts: vec![], data: ix.data }
}

/// Dónde quedó una unidad registrada: su lote, su índice y la prueba de su hoja.
#[derive(Clone)]
struct Unit {
    batch: Pubkey,
    index: u32,
    proof: Vec<[u8; 32]>,
}

struct Env {
    ctx: ProgramTestContext,
    admin: Keypair,
    minter: Keypair,
    units: HashMap<String, Unit>,
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
    let mut env = Env { ctx, admin, minter, units: HashMap::new() };
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

    /// Registra un lote con las unidades (código, secreto) en ese orden.
    async fn register_as(&mut self, signer: &Keypair, batch_code: &str, units: &[(&str, &str)]) -> Result<(), String> {
        let leaves: Vec<[u8; 32]> =
            units.iter().enumerate().map(|(index, (code, secret))| leaf_hash(index as u32, &activation_key(secret), code)).collect();
        let (root, proofs) = if leaves.is_empty() { ([0; 32], vec![]) } else { merkle(&leaves) };
        let ix = Instruction {
            program_id: ID,
            accounts: accounts::RegisterBatch {
                config: config_pda(),
                minter: signer.pubkey(),
                batch: batch_pda(batch_code),
                payer: self.ctx.payer.pubkey(),
                system_program: anchor_lang::system_program::ID,
            }
            .to_account_metas(None),
            data: instruction::RegisterBatch { args: batch_args(batch_code, root, units.len() as u32) }.data(),
        };
        let signer = signer.insecure_clone();
        self.send(&[ix], &[&signer]).await?;
        for (index, ((code, _), proof)) in units.iter().zip(proofs).enumerate() {
            self.units.insert(code.to_string(), Unit { batch: batch_pda(batch_code), index: index as u32, proof });
        }
        Ok(())
    }

    async fn register(&mut self, batch_code: &str, units: &[(&str, &str)]) {
        let minter = self.minter.insecure_clone();
        self.register_as(&minter, batch_code, units).await.unwrap();
    }

    /// Un lote de una unidad, como en la mayoría de los tests.
    async fn mint(&mut self, code: &str, secret: &str) {
        self.register(&format!("BATCH-{code}"), &[(code, secret)]).await;
    }

    async fn import_as(&mut self, signer: &Keypair, code: &str, owner: Pubkey) -> Result<(), String> {
        let ix = Instruction {
            program_id: ID,
            accounts: accounts::ImportClaimedProduct {
                config: config_pda(),
                admin: signer.pubkey(),
                certificate: certificate_pda(code),
                payer: self.ctx.payer.pubkey(),
                system_program: anchor_lang::system_program::ID,
            }
            .to_account_metas(None),
            data: instruction::ImportClaimedProduct { public_code: code.to_string(), owner }.data(),
        };
        let signer = signer.insecure_clone();
        self.send(&[ix], &[&signer]).await
    }

    fn activate_ix(&self, code: &str, unit: &Unit, secret_key: [u8; 32], claimant: &Pubkey) -> Instruction {
        Instruction {
            program_id: ID,
            accounts: accounts::ActivateProduct {
                batch: unit.batch,
                certificate: certificate_pda(code),
                claimant: *claimant,
                payer: self.ctx.payer.pubkey(),
                instructions: solana_sdk_ids_instructions(),
                system_program: anchor_lang::system_program::ID,
            }
            .to_account_metas(None),
            data: instruction::ActivateProduct {
                args: ActivationArgs { public_code: code.to_string(), index: unit.index, activation_key: secret_key, proof: unit.proof.clone() },
            }
            .data(),
        }
    }

    /// Activa firmando con `key` el mensaje de `signed_for` (normalmente el mismo claimant).
    async fn activate_with(&mut self, code: &str, key: &SigningKey, claimant: &Keypair, signed_for: &Pubkey, with_signature: bool) -> Result<(), String> {
        let unit = self.units[code].clone();
        let activate = self.activate_ix(code, &unit, key.verifying_key().to_bytes(), &claimant.pubkey());
        let message = signed_message(ACTIVATION_DOMAIN, &certificate_pda(code), signed_for);
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
            accounts: accounts::OwnerAction { config: config_pda(), certificate: certificate_pda(code), owner: owner.pubkey() }.to_account_metas(None),
            data: instruction::OfferTransfer { transfer_key: key.verifying_key().to_bytes() }.data(),
        };
        self.send(&[ix], &[owner]).await
    }

    async fn cancel(&mut self, code: &str, owner: &Keypair) -> Result<(), String> {
        let ix = Instruction {
            program_id: ID,
            accounts: accounts::OwnerAction { config: config_pda(), certificate: certificate_pda(code), owner: owner.pubkey() }.to_account_metas(None),
            data: instruction::CancelTransfer {}.data(),
        };
        self.send(&[ix], &[owner]).await
    }

    async fn accept_with(&mut self, code: &str, key: &SigningKey, recipient: &Keypair, signed_for: &Pubkey) -> Result<(), String> {
        let certificate = certificate_pda(code);
        let accept = Instruction {
            program_id: ID,
            accounts: accounts::AcceptTransfer { certificate, recipient: recipient.pubkey(), instructions: solana_sdk_ids_instructions() }
                .to_account_metas(None),
            data: instruction::AcceptTransfer {}.data(),
        };
        let message = signed_message(TRANSFER_DOMAIN, &certificate, signed_for);
        self.send(&[ed25519_ix(key, &message), accept], &[recipient]).await
    }

    async fn accept(&mut self, code: &str, link_secret: &str, recipient: &Keypair) -> Result<(), String> {
        let key = key_for(TRANSFER_DOMAIN, link_secret);
        self.accept_with(code, &key, recipient, &recipient.pubkey()).await
    }

    async fn certificate_account(&mut self, code: &str) -> Option<Account> {
        self.ctx.banks_client.get_account(certificate_pda(code)).await.unwrap()
    }

    async fn certificate(&mut self, code: &str) -> Certificate {
        let account = self.certificate_account(code).await.expect("certificate account");
        Certificate::try_deserialize(&mut account.data.as_slice()).unwrap()
    }

    async fn batch(&mut self, batch_code: &str) -> Batch {
        let account = self.ctx.banks_client.get_account(batch_pda(batch_code)).await.unwrap().expect("batch account");
        Batch::try_deserialize(&mut account.data.as_slice()).unwrap()
    }

    async fn config(&mut self) -> Config {
        let account = self.ctx.banks_client.get_account(config_pda()).await.unwrap().expect("config account");
        Config::try_deserialize(&mut account.data.as_slice()).unwrap()
    }
}

fn solana_sdk_ids_instructions() -> Pubkey {
    Pubkey::from_str_const("Sysvar1nstructions1111111111111111111111111")
}

fn batch_args(batch_code: &str, root: [u8; 32], count: u32) -> BatchArgs {
    BatchArgs {
        batch_code: batch_code.to_string(),
        root,
        count,
        model: "Taladro Percutor 750W".to_string(),
        lot: "L-2026-09".to_string(),
        destination: "Argentina".to_string(),
    }
}

fn assert_err(result: Result<(), String>, code: &str) {
    let error = result.expect_err("la transacción debía fallar");
    // Los errores de Anchor llegan como Custom(6000 + índice); comparamos por número para no depender del texto.
    let index = [
        "NotUpgradeAuthority", "NotAdmin", "NotMinter", "InvalidCode", "InvalidField", "InvalidCooldown", "Overflow",
        "AlreadyClaimed", "NotOwner", "NoOpenTransfer", "AlreadyOwner", "TransferExpired", "OfferTooSoon", "InvalidSignature",
        "InvalidProof", "InvalidBatch",
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
async fn register_batch_and_claim() {
    let mut env = Env::ready(0).await;
    let units = [("VF-UNIT0001", "VF-SECRET-A"), ("VF-UNIT0002", "VF-SECRET-B"), ("VF-UNIT0003", "VF-SECRET-C")];
    env.register("BATCH-ONE", &units).await;
    let batch = env.batch("BATCH-ONE").await;
    assert_eq!((batch.first_token_id, batch.count, batch.model.as_str()), (1, 3, "Taladro Percutor 750W"));
    assert_eq!(env.config().await.next_token_id, 4);
    // Selladas no ocupan cuenta: nada que pague rent por unidad.
    assert!(env.certificate_account("VF-UNIT0002").await.is_none());
    let buyer = env.new_user().await;
    env.activate("VF-UNIT0002", "VF-SECRET-B", &buyer).await.unwrap();
    let certificate = env.certificate("VF-UNIT0002").await;
    assert_eq!((certificate.token_id, certificate.owner), (2, buyer.pubkey()));
    // Las demás unidades del lote se activan con sus propias pruebas.
    env.activate("VF-UNIT0003", "VF-SECRET-C", &buyer).await.unwrap();
    env.activate("VF-UNIT0001", "VF-SECRET-A", &buyer).await.unwrap();
    env.mint("VF-SECOND01", "VF-SECRET-OTHER").await;
    assert_eq!(env.batch("BATCH-VF-SECOND01").await.first_token_id, 4);
}

#[tokio::test]
async fn certificate_rent_is_the_only_cost_per_unit() {
    let mut env = Env::ready(0).await;
    env.mint(CODE, SECRET).await;
    let buyer = env.new_user().await;
    env.activate(CODE, SECRET, &buyer).await.unwrap();
    let account = env.certificate_account(CODE).await.unwrap();
    // 98 bytes: (128 + 98) * 6960 = 1_572_960 lamports, contra 619 bytes y 5_199_120 de la cuenta por producto anterior.
    assert_eq!(account.data.len(), 98);
    assert_eq!(account.lamports, 1_572_960);
}

#[tokio::test]
async fn only_the_minter_registers_and_batch_codes_are_unique() {
    let mut env = Env::ready(0).await;
    let intruder = Keypair::new();
    assert_err(env.register_as(&intruder, "BATCH-A", &[(CODE, SECRET)]).await, "NotMinter");
    // El admin tampoco emite: son llaves separadas.
    let admin = env.admin.insecure_clone();
    assert_err(env.register_as(&admin, "BATCH-A", &[(CODE, SECRET)]).await, "NotMinter");
    env.register("BATCH-A", &[(CODE, SECRET)]).await;
    let minter = env.minter.insecure_clone();
    assert!(env.register_as(&minter, "BATCH-A", &[("VF-OTHER001", SECRET)]).await.is_err(), "el lote ya existe");
}

#[tokio::test]
async fn invalid_batches_are_rejected() {
    let mut env = Env::ready(0).await;
    let minter = env.minter.insecure_clone();
    assert_err(env.register_as(&minter, "", &[(CODE, SECRET)]).await, "InvalidCode");
    assert_err(env.register_as(&minter, "BATCH-EMPTY", &[]).await, "InvalidBatch");
}

#[tokio::test]
async fn units_outside_the_batch_are_rejected() {
    let mut env = Env::ready(0).await;
    env.register("BATCH-A", &[(CODE, SECRET), ("VF-UNIT0002", "VF-SECRET-B")]).await;
    env.mint("VF-OTHER001", "VF-SECRET-OTHER").await;
    let buyer = env.new_user().await;
    let key = key_for(ACTIVATION_DOMAIN, SECRET);
    let message = signed_message(ACTIVATION_DOMAIN, &certificate_pda(CODE), &buyer.pubkey());
    let unit = env.units[CODE].clone();
    // Otro índice: la hoja cambia.
    let moved = Unit { index: 1, ..unit.clone() };
    let ix = env.activate_ix(CODE, &moved, key.verifying_key().to_bytes(), &buyer.pubkey());
    assert_err(env.send(&[ed25519_ix(&key, &message), ix], &[&buyer]).await, "InvalidProof");
    // Índice fuera del lote.
    let outside = Unit { index: 2, ..unit.clone() };
    let ix = env.activate_ix(CODE, &outside, key.verifying_key().to_bytes(), &buyer.pubkey());
    assert_err(env.send(&[ed25519_ix(&key, &message), ix], &[&buyer]).await, "InvalidProof");
    // La prueba de un lote contra la raíz de otro.
    let elsewhere = Unit { batch: env.units["VF-OTHER001"].batch, ..unit.clone() };
    let ix = env.activate_ix(CODE, &elsewhere, key.verifying_key().to_bytes(), &buyer.pubkey());
    assert_err(env.send(&[ed25519_ix(&key, &message), ix], &[&buyer]).await, "InvalidProof");
    // Un código que no está en el lote, con la prueba de otra unidad.
    let message = signed_message(ACTIVATION_DOMAIN, &certificate_pda("VF-FAKE0001"), &buyer.pubkey());
    let ix = env.activate_ix("VF-FAKE0001", &unit, key.verifying_key().to_bytes(), &buyer.pubkey());
    assert_err(env.send(&[ed25519_ix(&key, &message), ix], &[&buyer]).await, "InvalidProof");
    env.activate(CODE, SECRET, &buyer).await.unwrap();
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
    // Su clave no es la de ninguna hoja del lote.
    assert_err(env.activate(CODE, "VF-SECRET-WRONG", &buyer).await, "InvalidProof");
    // La clave correcta, pero la firma de otra.
    let unit = env.units[CODE].clone();
    let wrong = key_for(ACTIVATION_DOMAIN, "VF-SECRET-WRONG");
    let message = signed_message(ACTIVATION_DOMAIN, &certificate_pda(CODE), &buyer.pubkey());
    let ix = env.activate_ix(CODE, &unit, activation_key(SECRET), &buyer.pubkey());
    assert_err(env.send(&[ed25519_ix(&wrong, &message), ix], &[&buyer]).await, "InvalidSignature");
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
    env.register("BATCH-A", &[(CODE, SECRET), ("VF-OTHER001", SECRET)]).await;
    let buyer = env.new_user().await;
    let key = key_for(ACTIVATION_DOMAIN, SECRET);
    let message = signed_message(ACTIVATION_DOMAIN, &certificate_pda("VF-OTHER001"), &buyer.pubkey());
    let unit = env.units[CODE].clone();
    let activate = env.activate_ix(CODE, &unit, activation_key(SECRET), &buyer.pubkey());
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
    let offered = env.certificate(CODE).await;
    assert_eq!(offered.transfer_expires_at, START + TRANSFER_LINK_SECONDS);
    env.accept(CODE, "link-1", &recipient).await.unwrap();
    let product = env.certificate(CODE).await;
    assert_eq!(product.owner, recipient.pubkey());
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
    // Sellado: todavía no tiene certificado.
    assert!(env.offer(CODE, &someone, "link").await.is_err());
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
    env.mint(CODE, SECRET).await;
    let owner = Keypair::new();
    let minter = env.minter.insecure_clone();
    assert_err(env.import_as(&minter, CODE, owner.pubkey()).await, "NotAdmin");
    let admin = env.admin.insecure_clone();
    env.import_as(&admin, CODE, owner.pubkey()).await.unwrap();
    let certificate = env.certificate(CODE).await;
    assert_eq!(certificate.owner, owner.pubkey());
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
    assert_err(env.register_as(&env.minter.insecure_clone(), "BATCH-A", &[(CODE, SECRET)]).await, "NotMinter");
}
