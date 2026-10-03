// The user's Privy wallet as the flows that sign see it. Transactions travel as the base64 wire transactions the server
// answers and come back signed the same way; the server adds its signature as fee payer.
import { base64ToBytes, bytesToBase64 } from './bytes';
import { privyBridge } from './privy-registry';

export type Progress = (message: string) => void;

export interface Signer {
  address: string;
  signTransaction: (tx: string) => Promise<string>;
  // Proof of the wallet for the server (see wallet-auth.ts): the signature of the nonce and the key that made it.
  signMessage: (nonce: string) => Promise<{ signature: Uint8Array; publicKey: string }>;
}

export const connectSigner = async (expectedAddress: string, onProgress?: Progress): Promise<Signer> => {
  onProgress?.('Conectando tu wallet...');
  const privy = await privyBridge();
  const address = privy.address();
  if (address !== expectedAddress) {
    throw new Error('La wallet de esta sesión no coincide con la de tu cuenta. Cerrá sesión y volvé a entrar.');
  }
  return {
    address,
    signTransaction: async (tx) => bytesToBase64(await privy.signTransaction(base64ToBytes(tx))),
    signMessage: async (nonce) => ({ signature: await privy.signMessage(new TextEncoder().encode(nonce)), publicKey: address })
  };
};
