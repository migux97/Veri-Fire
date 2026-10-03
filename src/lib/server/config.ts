import { join } from 'node:path';
import {
  ADMIN_API_TOKEN, ADMIN_WALLETS, CAVOS_APP_ID, CHAIN, CORS_ORIGIN, COSMOS_PAY_AMOUNT, COSMOS_PAY_API_KEY, COSMOS_PAY_DESTINATION, DATA_FILE,
  PRIVY_APP_ID, PUBLIC_APP_URL, RESEND_API_KEY, RESEND_FROM, STELLAR_ADMIN_SECRET, STELLAR_CONTRACT_ID, STELLAR_ISSUER_SECRET, STELLAR_NETWORK,
  SOLANA_CLUSTER, SOLANA_FEE_PAYER_SECRET, SOLANA_MINTER_SECRET, SOLANA_PROGRAM_ID, SOLANA_RPC_URL, STELLAR_PREVIOUS_CONTRACT_ID, STELLAR_RPC_URL
} from 'astro:env/server';
import { chainKind, isOwnerAddress, setChainKind } from './chain-kind';
import { solanaConfigFromEnv } from './solana';
import { stellarConfigFromEnv } from './stellar';

setChainKind(CHAIN);
const onSolana = chainKind() === 'solana';

// An empty line in .env (KEY=) means the value is not set.
export const config = {
  cosmosPay: {
    apiKey: COSMOS_PAY_API_KEY || '',
    // Treasury account: receives the payment of each batch and never signs on-chain.
    destination: COSMOS_PAY_DESTINATION || '',
    // Test amount per token, in XLM. A value that is not a positive number falls back to 5 instead of pricing every
    // batch as "NaN".
    amountPerToken: Number(COSMOS_PAY_AMOUNT) > 0 ? String(Number(COSMOS_PAY_AMOUNT)) : '5'
  },
  cavosAppId: CAVOS_APP_ID || '',
  privyAppId: PRIVY_APP_ID || '',
  // Email of the team invitations. Without a key, invitations still work in the panel and as links, just not by mail.
  resend: {
    apiKey: RESEND_API_KEY || '',
    from: RESEND_FROM || 'Verifire <onboarding@resend.dev>'
  },
  adminApiToken: ADMIN_API_TOKEN || '',
  // Who verifies companies: only these wallets, and only with their signature (see verification-actions.ts).
  adminWallets: (ADMIN_WALLETS ?? '').split(/[\s,;]+/).filter(isOwnerAddress),
  corsOrigin: CORS_ORIGIN || '',
  publicAppUrl: PUBLIC_APP_URL?.replace(/\/$/, '') || '',
  // Relative to where the server is started, which is the project root for every npm script.
  dataFile: DATA_FILE || join(process.cwd(), 'data', 'verifire-state.json'),
  chain: chainKind(),
  network: onSolana ? SOLANA_CLUSTER || 'devnet' : STELLAR_NETWORK || 'local-demo',
  // Contract (Stellar) or program (Solana) the products are registered in.
  contractId: (onSolana ? SOLANA_PROGRAM_ID : STELLAR_CONTRACT_ID) || null,
  // Contract replaced by the last deploy. Products registered before contract ids were saved belong to it.
  previousContractId: (onSolana ? null : STELLAR_PREVIOUS_CONTRACT_ID) || null,
  stellar: stellarConfigFromEnv({ STELLAR_CONTRACT_ID, STELLAR_ISSUER_SECRET, STELLAR_ADMIN_SECRET, STELLAR_RPC_URL }),
  solana: solanaConfigFromEnv({ SOLANA_PROGRAM_ID, SOLANA_MINTER_SECRET, SOLANA_FEE_PAYER_SECRET, SOLANA_RPC_URL, SOLANA_CLUSTER })
};

// The only values a page may pass to a component that runs in the browser. `config` holds the issuing key and the
// payment credentials, so pages import this instead.
export const publicConfig = {
  cavosAppId: config.cavosAppId,
  chain: config.chain,
  privyAppId: config.privyAppId,
  solanaCluster: config.solana.cluster || 'devnet',
  pricePerToken: config.cosmosPay.amountPerToken
};

// Base of the links inside QR codes: PUBLIC_APP_URL when set, otherwise the address this request reached.
export const publicBaseUrl = (requestUrl: URL) => config.publicAppUrl || requestUrl.origin;
