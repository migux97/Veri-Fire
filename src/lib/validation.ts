// A Solana address: base58 of a 32-byte public key. It is checked fully (on-curve or not) where it reaches the network.
export const isWalletAddress = (value: unknown): value is string => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(value ?? ''));

// Product tokens and batch ids are case-insensitive: "vf-001" finds VF-001.
export const normalizeId = (value: unknown): string => String(value ?? '').trim().toUpperCase();
