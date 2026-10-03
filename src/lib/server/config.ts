import { join } from 'node:path';
import {
  ADMIN_API_TOKEN, ADMIN_WALLETS, CORS_ORIGIN, DATA_FILE, PRICE_PER_TOKEN, PRIVY_APP_ID, PUBLIC_APP_URL, RESEND_API_KEY, RESEND_FROM,
  SOLANA_CLUSTER, SOLANA_FEE_PAYER_SECRET, SOLANA_MINTER_SECRET, SOLANA_PAY_RECIPIENT, SOLANA_PROGRAM_ID, SOLANA_RPC_URL, USDC_MINT
} from 'astro:env/server';
import { isWalletAddress } from '../validation';
import { solanaConfigFromEnv } from './solana';

// USDC on each cluster (Circle's mints). USDC_MINT overrides it, for a test token of your own.
const USDC_MINTS: Record<string, string> = {
  'mainnet-beta': 'EPjFWdd5AufqSSqeM2qcxNxHntGF5ByhZCt8uLgr5Lyx',
  devnet: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
};

const cluster = SOLANA_CLUSTER || 'devnet';

// An empty line in .env (KEY=) means the value is not set.
export const config = {
  payments: {
    // Treasury wallet: receives the USDC of each batch through Solana Pay and never signs anything on the server.
    recipient: SOLANA_PAY_RECIPIENT || '',
    mint: USDC_MINT || USDC_MINTS[cluster] || '',
    // Price per token, in USDC. A value that is not a positive number falls back to 1 instead of pricing every batch
    // as "NaN".
    pricePerToken: Number(PRICE_PER_TOKEN) > 0 ? String(Number(PRICE_PER_TOKEN)) : '1'
  },
  privyAppId: PRIVY_APP_ID || '',
  // Email of the team invitations. Without a key, invitations still work in the panel and as links, just not by mail.
  resend: {
    apiKey: RESEND_API_KEY || '',
    from: RESEND_FROM || 'Verifire <onboarding@resend.dev>'
  },
  adminApiToken: ADMIN_API_TOKEN || '',
  // Who verifies companies: only these wallets, and only with their signature (see verification-actions.ts).
  adminWallets: (ADMIN_WALLETS ?? '').split(/[\s,;]+/).filter(isWalletAddress),
  corsOrigin: CORS_ORIGIN || '',
  publicAppUrl: PUBLIC_APP_URL?.replace(/\/$/, '') || '',
  // Relative to where the server is started, which is the project root for every npm script.
  dataFile: DATA_FILE || join(process.cwd(), 'data', 'verifire-state.json'),
  network: cluster,
  // The program the products are registered in.
  contractId: SOLANA_PROGRAM_ID || null,
  solana: solanaConfigFromEnv({ SOLANA_PROGRAM_ID, SOLANA_MINTER_SECRET, SOLANA_FEE_PAYER_SECRET, SOLANA_RPC_URL, SOLANA_CLUSTER })
};

// The only values a page may pass to a component that runs in the browser. `config` holds the issuing key and the
// payment credentials, so pages import this instead.
export const publicConfig = {
  privyAppId: config.privyAppId,
  solanaCluster: cluster,
  pricePerToken: config.payments.pricePerToken
};

// Base of the links inside QR codes: PUBLIC_APP_URL when set, otherwise the address this request reached.
export const publicBaseUrl = (requestUrl: URL) => config.publicAppUrl || requestUrl.origin;
