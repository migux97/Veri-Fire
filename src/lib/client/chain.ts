// The blockchain this server certifies on, as the page says it (BaseLayout's verifire-chain meta tag): Stellar with a Cavos wallet,
// or Solana with a Privy one.
import { isSolanaAddressFormat, isStellarAddress } from '../validation';

export type ChainKind = 'stellar' | 'solana';

const meta = (name: string) => document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content ?? '';

export const chainKind = (): ChainKind => (typeof document !== 'undefined' && meta('verifire-chain') === 'solana' ? 'solana' : 'stellar');

export const onSolana = () => chainKind() === 'solana';

// As people read them in progress messages.
export const chainLabel = () => (onSolana() ? 'Solana' : 'Stellar');
export const walletLabel = () => (onSolana() ? 'tu wallet' : 'tu wallet Cavos');

// An account address of the network in use.
export const isWalletAddress = (value: unknown): value is string => (onSolana() ? isSolanaAddressFormat(value) : isStellarAddress(value));
