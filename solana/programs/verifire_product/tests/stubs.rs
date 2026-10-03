// anchor-lang 1.2 usa solana-sysvar 3.x y solana-program-test 4.2 instala sus stubs nativos (Clock, Rent, CPI, logs)
// solo en solana-sysvar 4.x. Este puente hace que las llamadas del programa por la 3.x lleguen a los stubs del test.
use solana_account_info::AccountInfo;
use solana_instruction::Instruction;
use solana_program_error::ProgramResult;
use solana_pubkey::Pubkey;
use std::sync::{Arc, Once};
use sysvar_v3::program_stubs::SyscallStubs as V3;
use sysvar_v4::program_stubs::SyscallStubs as V4;

struct Bridge(Arc<Box<dyn V4>>);

macro_rules! delegate {
    ($trait:ident) => {
        impl $trait for Bridge {
            fn sol_log(&self, message: &str) { self.0.sol_log(message) }
            fn sol_log_compute_units(&self) { self.0.sol_log_compute_units() }
            fn sol_remaining_compute_units(&self) -> u64 { self.0.sol_remaining_compute_units() }
            fn sol_invoke_signed(&self, instruction: &Instruction, account_infos: &[AccountInfo], signers_seeds: &[&[&[u8]]]) -> ProgramResult {
                self.0.sol_invoke_signed(instruction, account_infos, signers_seeds)
            }
            fn sol_get_sysvar(&self, sysvar_id_addr: *const u8, var_addr: *mut u8, offset: u64, length: u64) -> u64 {
                self.0.sol_get_sysvar(sysvar_id_addr, var_addr, offset, length)
            }
            fn sol_get_clock_sysvar(&self, var_addr: *mut u8) -> u64 { self.0.sol_get_clock_sysvar(var_addr) }
            fn sol_get_epoch_schedule_sysvar(&self, var_addr: *mut u8) -> u64 { self.0.sol_get_epoch_schedule_sysvar(var_addr) }
            fn sol_get_fees_sysvar(&self, var_addr: *mut u8) -> u64 { self.0.sol_get_fees_sysvar(var_addr) }
            fn sol_get_rent_sysvar(&self, var_addr: *mut u8) -> u64 { self.0.sol_get_rent_sysvar(var_addr) }
            fn sol_get_epoch_rewards_sysvar(&self, var_addr: *mut u8) -> u64 { self.0.sol_get_epoch_rewards_sysvar(var_addr) }
            fn sol_get_last_restart_slot(&self, var_addr: *mut u8) -> u64 { self.0.sol_get_last_restart_slot(var_addr) }
            fn sol_get_epoch_stake(&self, vote_address: *const u8) -> u64 { self.0.sol_get_epoch_stake(vote_address) }
            unsafe fn sol_memcpy(&self, dst: *mut u8, src: *const u8, n: usize) { unsafe { self.0.sol_memcpy(dst, src, n) } }
            unsafe fn sol_memmove(&self, dst: *mut u8, src: *const u8, n: usize) { unsafe { self.0.sol_memmove(dst, src, n) } }
            unsafe fn sol_memcmp(&self, s1: *const u8, s2: *const u8, n: usize, result: *mut i32) { unsafe { self.0.sol_memcmp(s1, s2, n, result) } }
            unsafe fn sol_memset(&self, s: *mut u8, c: u8, n: usize) { unsafe { self.0.sol_memset(s, c, n) } }
            fn sol_get_return_data(&self) -> Option<(Pubkey, Vec<u8>)> { self.0.sol_get_return_data() }
            fn sol_set_return_data(&self, data: &[u8]) { self.0.sol_set_return_data(data) }
            fn sol_log_data(&self, fields: &[&[u8]]) { self.0.sol_log_data(fields) }
            fn sol_get_processed_sibling_instruction(&self, index: usize) -> Option<Instruction> { self.0.sol_get_processed_sibling_instruction(index) }
            fn sol_get_stack_height(&self) -> u64 { self.0.sol_get_stack_height() }
        }
    };
}

delegate!(V3);
delegate!(V4);

struct Placeholder;
impl V4 for Placeholder {}

/// Llamar después de ProgramTest::start*, que es cuando el test instala sus stubs 4.x.
pub fn bridge() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        let program_test_stubs = Arc::new(sysvar_v4::program_stubs::set_syscall_stubs(Box::new(Placeholder)));
        sysvar_v4::program_stubs::set_syscall_stubs(Box::new(Bridge(program_test_stubs.clone())));
        sysvar_v3::program_stubs::set_syscall_stubs(Box::new(Bridge(program_test_stubs)));
    });
}
