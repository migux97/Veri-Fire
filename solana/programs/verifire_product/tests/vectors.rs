// Vectores compartidos con src/lib/server/solana-program.ts (tests/solana-program.test.mjs): direcciones, datos de
// instrucciones, mensajes firmados, el árbol de Merkle de un lote y el formato de las cuentas Batch y Certificate.
// Si cambian a propósito, regenerarlos con UPDATE_VECTORS=1 cargo test --test vectors.
use anchor_lang::{prelude::Pubkey, solana_program::bpf_loader_upgradeable, AccountSerialize, InstructionData};
use ed25519_dalek::{Signer as _, SigningKey};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use verifire_product::{
    instruction, leaf_hash, merkle_root, node_hash, signed_message, ActivationArgs, Batch, BatchArgs, Certificate, ACTIVATION_DOMAIN,
    BATCH_SEED, CERTIFICATE_SEED, CONFIG_SEED, TRANSFER_DOMAIN,
};

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
    let batch_code = "BATCH-0011223344";
    let secret = "VF-SECRET-00112233445566778899";
    let claimant = Pubkey::new_from_array([7; 32]);
    let minter = Pubkey::new_from_array([9; 32]);
    let activation = key_for(ACTIVATION_DOMAIN, secret);
    let activation_key = activation.verifying_key().to_bytes();
    let transfer = key_for(TRANSFER_DOMAIN, "link-secret");
    let certificate = Pubkey::find_program_address(&[CERTIFICATE_SEED, code.as_bytes()], &id).0;
    let batch = Pubkey::find_program_address(&[BATCH_SEED, batch_code.as_bytes()], &id).0;

    // Lote de tres: la unidad del vector es la última (índice 2), que en el primer nivel sube sin pareja.
    let leaves = [
        leaf_hash(0, &key_for(ACTIVATION_DOMAIN, "VF-SECRET-A").verifying_key().to_bytes(), "VF-UNIT0001"),
        leaf_hash(1, &key_for(ACTIVATION_DOMAIN, "VF-SECRET-B").verifying_key().to_bytes(), "VF-UNIT0002"),
        leaf_hash(2, &activation_key, code),
    ];
    let proof = vec![node_hash(&leaves[0], &leaves[1])];
    let root = merkle_root(leaves[2], &proof);
    assert_eq!(root, node_hash(&node_hash(&leaves[0], &leaves[1]), &leaves[2]));

    let batch_args = BatchArgs {
        batch_code: batch_code.into(),
        root,
        count: 3,
        model: "Taladro Percutor 750W ñ".into(),
        lot: "L-2026-09".into(),
        destination: "Argentina".into(),
    };
    let activation_args = ActivationArgs { public_code: code.into(), index: 2, activation_key, proof: proof.clone() };
    let activation_message = signed_message(ACTIVATION_DOMAIN, &certificate, &claimant);
    let signature = activation.sign(&activation_message).to_bytes();
    let ed25519 = solana_ed25519_program::new_ed25519_instruction_with_signature(&activation_message, &signature, &activation_key);
    let mut certificate_account = Vec::new();
    Certificate {
        token_id: 42,
        owner: claimant,
        transfer_key: Some(transfer.verifying_key().to_bytes()),
        transfer_expires_at: 1_800_000_900,
        last_offer_at: 1_800_000_000,
        bump: 254,
    }
    .try_serialize(&mut certificate_account)
    .unwrap();
    let mut batch_account = Vec::new();
    Batch {
        root,
        first_token_id: 40,
        count: 3,
        bump: 253,
        batch_code: batch_args.batch_code.clone(),
        model: batch_args.model.clone(),
        lot: batch_args.lot.clone(),
        destination: batch_args.destination.clone(),
    }
    .try_serialize(&mut batch_account)
    .unwrap();
    assert_eq!(batch_account.len(), Batch::space(&batch_args));

    let vectors: BTreeMap<&str, String> = BTreeMap::from([
        ("programId", id.to_string()),
        ("code", code.into()),
        ("batchCode", batch_code.into()),
        ("secret", secret.into()),
        ("claimant", claimant.to_string()),
        ("minter", minter.to_string()),
        ("configAddress", Pubkey::find_program_address(&[CONFIG_SEED], &id).0.to_string()),
        ("batchAddress", batch.to_string()),
        ("certificateAddress", certificate.to_string()),
        ("programDataAddress", bpf_loader_upgradeable::get_program_data_address(&id).to_string()),
        ("activationKey", hex(&activation_key)),
        ("transferKey", hex(&transfer.verifying_key().to_bytes())),
        ("model", batch_args.model.clone()),
        ("merkleLeaves", leaves.iter().map(|leaf| hex(leaf)).collect::<Vec<_>>().join(",")),
        ("merkleRoot", hex(&root)),
        ("merkleProof", proof.iter().map(|node| hex(node)).collect::<Vec<_>>().join(",")),
        ("activationMessage", hex(&activation_message)),
        ("transferMessage", hex(&signed_message(TRANSFER_DOMAIN, &certificate, &claimant))),
        ("activationSignature", hex(&signature)),
        ("ed25519Data", hex(&ed25519.data)),
        ("initializeData", hex(&instruction::Initialize { minter, offer_cooldown_seconds: 60 }.data())),
        (
            "updateConfigData",
            hex(&instruction::UpdateConfig { new_admin: None, new_minter: Some(minter), offer_cooldown_seconds: Some(30) }.data()),
        ),
        ("registerBatchData", hex(&instruction::RegisterBatch { args: batch_args.clone() }.data())),
        ("importClaimedProductData", hex(&instruction::ImportClaimedProduct { public_code: code.into(), owner: claimant }.data())),
        ("activateProductData", hex(&instruction::ActivateProduct { args: activation_args }.data())),
        ("offerTransferData", hex(&instruction::OfferTransfer { transfer_key: transfer.verifying_key().to_bytes() }.data())),
        ("cancelTransferData", hex(&instruction::CancelTransfer {}.data())),
        ("acceptTransferData", hex(&instruction::AcceptTransfer {}.data())),
        ("certificateAccount", hex(&certificate_account)),
        ("batchAccount", hex(&batch_account)),
    ]);
    let json = serde_json::to_string_pretty(&vectors).unwrap() + "\n";
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../fixtures/vectors.json");
    if std::env::var("UPDATE_VECTORS").is_ok() {
        std::fs::write(path, &json).unwrap();
    }
    let committed = std::fs::read_to_string(path).expect("falta solana/fixtures/vectors.json: correr con UPDATE_VECTORS=1");
    assert_eq!(committed, json, "los vectores cambiaron: revisar y regenerar con UPDATE_VECTORS=1");
}
