import node from '@astrojs/node';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, envField, fontProviders } from 'astro/config';

// Every variable is declared `secret`, even the ones that are not: only secret server variables are read at runtime
// (from `node --env-file=.env` in production); public ones are frozen into the build. So one build serves any
// configuration, and none of them reaches the browser: pages pass what the client needs as props.
const runtimeVar = () => envField.string({ context: 'server', access: 'secret', optional: true });

export default defineConfig({
  i18n: {
    defaultLocale: 'es',
    locales: ['es', 'en'],
    routing: { prefixDefaultLocale: false }
  },
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
    // Dependencies imported lazily (the wallet on login, QR codes and the camera scanner when first used) are prepared
    // up front: discovered mid-session, Vite re-optimizes and reloads the page, cutting off whatever was running (such
    // as turning on the company panel's demo mode).
    optimizeDeps: { include: ['@privy-io/react-auth', '@privy-io/react-auth/solana', 'qrcode', 'jsqr', 'nanostores', '@nanostores/react'] }
  },
  // Accounts and sessions live in each browser; the server keeps no per-user state.
  session: false,
  // The public server (verifire.cosmosapp.lat) sits behind Cloudflare and a reverse proxy. Only for requests to this
  // domain is the proxy's X-Forwarded-For trusted, so the per-minute limits of the API count per visitor instead of all
  // of them together as the proxy's address. No protocol here on purpose: the proxy reaches Node over plain http, and a
  // pattern with https would never match it.
  security: {
    allowedDomains: [{ hostname: 'verifire.cosmosapp.lat' }]
  },
  // The address the public server and Privy's allowed origins already use.
  server: {
    port: 5501,
    // The dev server only answers to hosts it knows. The public server has run `astro dev` behind nginx, which passes
    // verifire.cosmosapp.lat as the host; without this every request there is refused.
    allowedHosts: ['verifire.cosmosapp.lat']
  },
  fonts: [
    {
      provider: fontProviders.fontsource(),
      name: 'Urbanist',
      cssVariable: '--font-urbanist',
      weights: [500, 600, 700, 800, 900],
      styles: ['normal'],
      subsets: ['latin']
    }
  ],
  env: {
    schema: {
      // Privy App ID (dashboard.privy.io): logs buyers and companies in and holds their Solana wallet.
      PRIVY_APP_ID: runtimeVar(),
      // Enables POST /api/products with `Authorization: Bearer <token>`.
      ADMIN_API_TOKEN: runtimeVar(),
      // Solana wallets of the people who verify companies, separated by commas: they open /verificacion.
      ADMIN_WALLETS: runtimeVar(),
      CORS_ORIGIN: runtimeVar(),
      // Base of the links printed in the QR labels. Defaults to the address the request came from.
      PUBLIC_APP_URL: runtimeVar(),
      DATA_FILE: runtimeVar(),
      SOLANA_PROGRAM_ID: runtimeVar(),
      // Keypair of the server (solana-keygen JSON or base58): registers products. Not the program's admin.
      SOLANA_MINTER_SECRET: runtimeVar(),
      // Pays rent and the users' fees. Defaults to the minter.
      SOLANA_FEE_PAYER_SECRET: runtimeVar(),
      SOLANA_RPC_URL: runtimeVar(),
      // devnet (default), testnet or mainnet-beta.
      SOLANA_CLUSTER: runtimeVar(),
      // Solana Pay: the treasury wallet that receives each batch payment, the price per token in USDC, and the token
      // mint when it is not Circle's USDC of the cluster.
      SOLANA_PAY_RECIPIENT: runtimeVar(),
      PRICE_PER_TOKEN: runtimeVar(),
      USDC_MINT: runtimeVar(),
      // Resend (resend.com): sends the team invitations by email. The sender must belong to a domain verified there.
      RESEND_API_KEY: runtimeVar(),
      RESEND_FROM: runtimeVar()
    }
  }
});
