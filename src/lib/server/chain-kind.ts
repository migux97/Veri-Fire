// Which blockchain this server certifies on: CHAIN=solana, or Stellar (the default, as before the migration).
// config.ts sets it from astro:env; scripts and tests run without Astro and read process.env directly.
import { isSolanaAddressFormat, isStellarAddress } from '../validation';

export type ChainKind = 'stellar' | 'solana';

const parse = (value: string | undefined): ChainKind => (value?.trim().toLowerCase() === 'solana' ? 'solana' : 'stellar');

let current: ChainKind = parse(process.env['CHAIN']);

export const setChainKind = (value: string | undefined) => {
  current = parse(value);
};

export const chainKind = () => current;

// The network's name as people read it in messages.
export const chainLabel = () => (current === 'solana' ? 'Solana' : 'Stellar');

// An account address of the network in use: who owns a warranty, a company panel, an admin.
export const isOwnerAddress = (value: unknown): value is string =>
  current === 'solana' ? isSolanaAddressFormat(value) : isStellarAddress(value);
