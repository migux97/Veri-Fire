// Vectores compartidos con src/lib/server/solana-program.ts (tests/solana-program.test.mjs): direcciones, datos de
// instrucciones, mensajes firmados y el formato de la cuenta Product. Si cambian a propósito, regenerarlos con
// UPDATE_VECTORS=1 cargo test --test vectors.
use anchor_lang::{prelude::Pubkey, solana_program::bpf_loader_upgradeable, AccountSerialize, InstructionData};
use ed25519_dalek::{Signer as _, SigningKey};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use verifire_product::{instruction, signed_message, Product, ProductArgs, ACTIVATION_DOMAIN, CONFIG_SEED, PRODUCT_SEED, TRANSFER_DOMAIN};

fn key_for(domain: &[u8], secret: &str) -> SigningKey {
    let mut hasher = Sha256::new();
    hasher.update(domain);
    hasher.update(b":");
    hasher.update(secret.as_bytes());
    SigningKey::from_bytes(&hasher.finalize().into())
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[test]
fn vectors_match_the_fixture() {
    let id = verifire_product::ID;
    let code = "VF-ABCDEFGH";
    let secret = "VF-SECRET-00112233445566778899";
    let claimant = Pubkey::new_from_array([7; 32]);
    let minter = Pubkey::new_from_array([9; 32]);
    let activation = key_for(ACTIVATION_DOMAIN, secret);
    let transfer = key_for(TRANSFER_DOMAIN, "link-secret");
    let product = Pubkey::find_program_address(&[PRODUCT_SEED, code.as_bytes()], &id).0;
    let args = ProductArgs {
        public_code: code.into(),
        model: "Taladro Percutor 750W ñ".into(),
        lot: "L-2026-09".into(),
        destination: "Argentina".into(),
        activation_key: activation.verifying_key().to_bytes(),
    };
    let activation_message = signed_message(ACTIVATION_DOMAIN, &product, &claimant);
    let signature = activation.sign(&activation_message).to_bytes();
    let ed25519 = solana_ed25519_program::new_ed25519_instruction_with_signature(
        &activation_message,
        &signature,
        &activation.verifying_key().to_bytes(),
    );
    let mut account = Vec::new();
    Product {
        token_id: 42,
        public_code: args.public_code.clone(),
        model: args.model.clone(),
        lot: args.lot.clone(),
        destination: args.destination.clone(),
        activation_key: args.activation_key,
        owner: Some(claimant),
        transfer_key: Some(transfer.verifying_key().to_bytes()),
        transfer_expires_at: 1_800_000_900,
        last_offer_at: 1_800_000_000,
        bump: 254,
    }
    .try_serialize(&mut account)
    .unwrap();

    let vectors: BTreeMap<&str, String> = BTreeMap::from([
        ("programId", id.to_string()),
        ("code", code.into()),
        ("secret", secret.into()),
        ("claimant", claimant.to_string()),
        ("minter", minter.to_string()),
        ("configAddress", Pubkey::find_program_address(&[CONFIG_SEED], &id).0.to_string()),
        ("productAddress", product.to_string()),
        ("programDataAddress", bpf_loader_upgradeable::get_program_data_address(&id).to_string()),
        ("activationKey", hex(&activation.verifying_key().to_bytes())),
        ("transferKey", hex(&transfer.verifying_key().to_bytes())),
        ("model", args.model.clone()),
        ("activationMessage", hex(&activation_message)),
        ("transferMessage", hex(&signed_message(TRANSFER_DOMAIN, &product, &claimant))),
        ("activationSignature", hex(&signature)),
        ("ed25519Data", hex(&ed25519.data)),
        ("initializeData", hex(&instruction::Initialize { minter, offer_cooldown_seconds: 60 }.data())),
        (
            "updateConfigData",
            hex(&instruction::UpdateConfig { new_admin: None, new_minter: Some(minter), offer_cooldown_seconds: Some(30) }.data()),
        ),
        ("mintProductData", hex(&instruction::MintProduct { args: args.clone() }.data())),
        ("importClaimedProductData", hex(&instruction::ImportClaimedProduct { args: args.clone(), owner: claimant }.data())),
        ("activateProductData", hex(&instruction::ActivateProduct {}.data())),
        ("offerTransferData", hex(&instruction::OfferTransfer { transfer_key: transfer.verifying_key().to_bytes() }.data())),
        ("cancelTransferData", hex(&instruction::CancelTransfer {}.data())),
        ("acceptTransferData", hex(&instruction::AcceptTransfer {}.data())),
        ("productAccount", hex(&account)),
    ]);
    let json = serde_json::to_string_pretty(&vectors).unwrap() + "\n";
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../fixtures/vectors.json");
    if std::env::var("UPDATE_VECTORS").is_ok() {
        std::fs::write(path, &json).unwrap();
    }
    let committed = std::fs::read_to_string(path).expect("falta solana/fixtures/vectors.json: correr con UPDATE_VECTORS=1");
    assert_eq!(committed, json, "los vectores cambiaron: revisar y regenerar con UPDATE_VECTORS=1");
}
