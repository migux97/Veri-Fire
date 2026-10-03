// Lectura de la instrucción Ed25519SigVerify que precede a activate_product y accept_transfer.
//
// El runtime ya rechaza la transacción entera si la firma de esa instrucción es inválida; acá solo se comprueba que
// exista, que sea la inmediatamente anterior, y que haya firmado exactamente la clave y el mensaje esperados con los
// datos dentro de su propia instrucción (no apuntando a otra, que podría contener otra cosa).
use anchor_lang::prelude::*;
use solana_instructions_sysvar::{load_current_index_checked, load_instruction_at_checked};

use crate::VerifireError;

const SIGNATURE_OFFSETS_START: usize = 2;
const SIGNATURE_OFFSETS_SIZE: usize = 14;
const PUBKEY_SIZE: usize = 32;
const SIGNATURE_SIZE: usize = 64;
/// Índice de instrucción que significa "esta misma instrucción".
const CURRENT_INSTRUCTION: u16 = u16::MAX;

fn read_u16(data: &[u8], at: usize) -> Result<u16> {
    let bytes = data.get(at..at + 2).ok_or(VerifireError::InvalidSignature)?;
    Ok(u16::from_le_bytes([bytes[0], bytes[1]]))
}

fn slice(data: &[u8], offset: u16, len: usize) -> Result<&[u8]> {
    let start = offset as usize;
    Ok(data.get(start..start + len).ok_or(VerifireError::InvalidSignature)?)
}

/// Comprueba la firma ed25519 de `public_key` sobre `message` en los datos de una instrucción Ed25519SigVerify.
pub fn check_ed25519_data(data: &[u8], public_key: &[u8; 32], message: &[u8]) -> Result<()> {
    require!(data.len() >= SIGNATURE_OFFSETS_START + SIGNATURE_OFFSETS_SIZE, VerifireError::InvalidSignature);
    require!(data[0] == 1, VerifireError::InvalidSignature);
    let at = SIGNATURE_OFFSETS_START;
    let signature_offset = read_u16(data, at)?;
    let signature_ix = read_u16(data, at + 2)?;
    let pubkey_offset = read_u16(data, at + 4)?;
    let pubkey_ix = read_u16(data, at + 6)?;
    let message_offset = read_u16(data, at + 8)?;
    let message_size = read_u16(data, at + 10)?;
    let message_ix = read_u16(data, at + 12)?;
    require!(
        signature_ix == CURRENT_INSTRUCTION && pubkey_ix == CURRENT_INSTRUCTION && message_ix == CURRENT_INSTRUCTION,
        VerifireError::InvalidSignature
    );
    slice(data, signature_offset, SIGNATURE_SIZE)?;
    require!(slice(data, pubkey_offset, PUBKEY_SIZE)? == public_key.as_slice(), VerifireError::InvalidSignature);
    require!(slice(data, message_offset, message_size as usize)? == message, VerifireError::InvalidSignature);
    Ok(())
}

pub fn verify_previous_instruction(instructions: &AccountInfo, public_key: &[u8; 32], message: &[u8]) -> Result<()> {
    let current = load_current_index_checked(instructions)?;
    require!(current > 0, VerifireError::InvalidSignature);
    let previous = load_instruction_at_checked(current as usize - 1, instructions)?;
    require!(
        previous.program_id == solana_sdk_ids::ed25519_program::ID && previous.accounts.is_empty(),
        VerifireError::InvalidSignature
    );
    check_ed25519_data(&previous.data, public_key, message)
}
