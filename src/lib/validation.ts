export const isStellarAddress = (value: unknown): value is string => /^G[A-Z2-7]{55}$/.test(String(value ?? ''));

// Base58 of a 32-byte public key. Solana addresses are checked fully (on-curve or not) where they reach the network.
export const isSolanaAddressFormat = (value: unknown): value is string => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(value ?? ''));

// Product tokens and batch ids are case-insensitive: "vf-001" finds VF-001.
export const normalizeId = (value: unknown): string => String(value ?? '').trim().toUpperCase();
