// The user's wallet as the flows that sign see it, whichever network the server runs on: a Cavos wallet on Stellar,
// a Privy one on Solana (see chain.ts). Transactions travel as the strings the server answers (XDR on Stellar, a base64
// wire transaction on Solana) and come back signed the same way.
import type { CavosStellar } from '@cavos/kit';
import { base64ToBytes, bytesToBase64 } from './bytes';
import { onSolana, walletLabel } from './chain';
import { privyBridge } from './privy-registry';
import { connectSigningWallet, createAccountOnChain, storedDeviceCode } from './wallet';

export type Progress = (message: string) => void;

export interface Signer {
  address: string;
  // Whatever the account needs before its first transaction (Stellar: create it on-chain).
  prepare: (onProgress: Progress) => Promise<void>;
  signTransaction: (tx: string) => Promise<string>;
  // Proof of the wallet for the server (see wallet-auth.ts): the signature of the nonce and the key that made it.
  signMessage: (nonce: string) => Promise<{ signature: Uint8Array; publicKey: string }>;
}

// The contract can only authorize an account that exists on-chain. Logins create it; an account whose login could not
// is created here, with the multi-device factor of this session's password when there is one.
const ensureAccountCreated = async (wallet: CavosStellar, onProgress: Progress) => {
  if (wallet.status !== 'undeployed') return;
  onProgress('Creando tu cuenta en Stellar por única vez...');
  const deviceCode = storedDeviceCode();
  if (deviceCode) await wallet.setupRecovery(deviceCode);
  await createAccountOnChain(wallet);
};

const cavosSigner = (wallet: CavosStellar): Signer => ({
  address: wallet.address,
  prepare: (onProgress) => ensureAccountCreated(wallet, onProgress),
  signTransaction: (xdr) => wallet.signXdr(xdr),
  signMessage: async (nonce) => {
    const { signature, publicKey } = await wallet.signMessage(nonce);
    return { signature, publicKey };
  }
});

// On Solana the account needs nothing on-chain before signing: the server pays the fees and the product's rent.
const privySigner = async (expectedAddress: string): Promise<Signer> => {
  const privy = await privyBridge();
  const address = privy.address();
  if (address !== expectedAddress) {
    throw new Error('La wallet de esta sesión no coincide con la de tu cuenta. Cerrá sesión y volvé a entrar.');
  }
  return {
    address,
    prepare: async () => {},
    signTransaction: async (tx) => bytesToBase64(await privy.signTransaction(base64ToBytes(tx))),
    signMessage: async (nonce) => ({ signature: await privy.signMessage(new TextEncoder().encode(nonce)), publicKey: address })
  };
};

export const connectSigner = async (appId: string, expectedAddress: string, onProgress?: Progress): Promise<Signer> => {
  onProgress?.(`Conectando ${walletLabel()}...`);
  return onSolana() ? privySigner(expectedAddress) : cavosSigner(await connectSigningWallet(appId, expectedAddress));
};
