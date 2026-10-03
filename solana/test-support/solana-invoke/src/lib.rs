#![cfg_attr(not(target_os = "solana"), allow(dead_code))]
#![doc = include_str!("../README.md")]
#![allow(unexpected_cfgs)]

use solana_account_info::AccountInfo;
use solana_instruction::Instruction;
use solana_program_entrypoint::ProgramResult;

mod stable_instruction_borrowed;

pub fn invoke(instruction: &Instruction, account_infos: &[AccountInfo]) -> ProgramResult {
    invoke_signed(instruction, account_infos, &[])
}

pub fn invoke_unchecked(instruction: &Instruction, account_infos: &[AccountInfo]) -> ProgramResult {
    invoke_signed_unchecked(instruction, account_infos, &[])
}

pub fn invoke_signed(
    instruction: &Instruction,
    account_infos: &[AccountInfo],
    signers_seeds: &[&[&[u8]]],
) -> ProgramResult {
    // Check that the account RefCells are consistent with the request
    for account_meta in instruction.accounts.iter() {
        for account_info in account_infos.iter() {
            if account_meta.pubkey == *account_info.key {
                if account_meta.is_writable {
                    let _ = account_info.try_borrow_mut_lamports()?;
                    let _ = account_info.try_borrow_mut_data()?;
                } else {
                    let _ = account_info.try_borrow_lamports()?;
                    let _ = account_info.try_borrow_data()?;
                }
                break;
            }
        }
    }

    invoke_signed_unchecked(instruction, account_infos, signers_seeds)
}

#[cfg(target_os = "solana")]
use solana_define_syscall::definitions::sol_invoke_signed_rust;


// VeriFire: fuera de SBF (tests nativos con solana-program-test) la CPI va a los stubs de solana-sysvar en vez de
// fallar con unimplemented!. En target_os = "solana" este crate es idéntico al original solana-invoke 0.5.0.
#[cfg(not(target_os = "solana"))]
pub fn invoke_signed_unchecked(
    instruction: &Instruction,
    account_infos: &[AccountInfo],
    signers_seeds: &[&[&[u8]]],
) -> ProgramResult {
    solana_sysvar::program_stubs::sol_invoke_signed(instruction, account_infos, signers_seeds)
}

#[cfg(target_os = "solana")]
pub fn invoke_signed_unchecked(
    instruction: &Instruction,
    account_infos: &[AccountInfo],
    signers_seeds: &[&[&[u8]]],
) -> ProgramResult {
    use stable_instruction_borrowed::StableInstructionBorrowed;
    let stable = StableInstructionBorrowed::new(instruction);
    let instruction_addr = stable.instruction_addr();

    let result = unsafe {
        sol_invoke_signed_rust(
            instruction_addr,
            account_infos as *const _ as *const u8,
            account_infos.len() as u64,
            signers_seeds as *const _ as *const u8,
            signers_seeds.len() as u64,
        )
    };

    match result {
        solana_program_entrypoint::SUCCESS => Ok(()),
        _ => Err(result.into()),
    }
}
