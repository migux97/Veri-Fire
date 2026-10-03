// The user's Solana wallet, held by Privy (see privy-registry.ts). Its address is remembered beside the session, so the
// panels can read warranties before Privy finishes loading.
import { isWalletAddress } from '../validation';
import { storedUser } from './account';
import { privyBridge } from './privy-registry';
import { userSession, WALLET_KEY, WALLET_UPDATED_EVENT } from './session';
import { readStored, writeStored } from './storage';

export const rememberWallet = (address: string | undefined) => {
  if (isWalletAddress(address)) {
    writeStored(localStorage, WALLET_KEY, { address, connectedAt: new Date().toISOString() });
    window.dispatchEvent(new Event(WALLET_UPDATED_EVENT));
  }
};

// The address of the account logged in.
export const resolveWalletAddress = async () => {
  const cached = readStored<{ address?: unknown }>(localStorage, WALLET_KEY);
  if (isWalletAddress(cached?.address)) return cached.address;
  const account = storedUser();
  if (isWalletAddress(account?.walletAddress) && account.email === userSession.email()) {
    rememberWallet(account.walletAddress);
    return account.walletAddress;
  }
  const address = (await privyBridge()).address();
  if (!address) throw new Error('No encontramos tu wallet en este navegador. Cerrá sesión y volvé a entrar.');
  rememberWallet(address);
  return address;
};
