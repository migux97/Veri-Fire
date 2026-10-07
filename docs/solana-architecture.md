# VeriFire on Solana: design, security and pending work

## Program (`solana/programs/verifire_product`)

- **Accounts:** each product is a PDA `["product", code]`; the config is a PDA `["config"]` with `admin`, `minter`,
  `next_token_id` and `offer_cooldown_seconds`. The PDA's `init` fails if the code already exists, so no separate index
  is needed. Each product takes 619 bytes: about 0.0052 SOL of rent, recoverable.
- **QR signature:** the activation key is derived from the printed secret, `sha256("verifire-activation-v1:" + secret)`
  → ed25519 key pair. The program stores only the public key. Whoever activates signs `domain ‖ program_id ‖ PDA ‖
  account`, and that signature is verified by the native `Ed25519SigVerify` program in the previous instruction; the
  program reads it by introspecting the Instructions sysvar (`src/ed25519.rs`) and requires exactly one signature, the
  expected key and the expected message.
- **Separate keys:** `minter` (the server) can only issue; `admin` imports owners and changes the config; `initialize` can
  only be called by the upgrade authority (checked against ProgramData).
- **Transfer links:** their key and expiry live in the same account, so every link expires; opening another one requires
  waiting `offer_cooldown_seconds`, so nobody can make the fee payer pay by opening and cancelling in a loop.
- **Events** on issue, import, activation, offer, cancellation and acceptance.
- **Tests:** 20 native tests with `solana-program-test` (`npm run test:solana`) and shared vectors
  (`solana/fixtures/vectors.json`) that check Rust and TypeScript at once, so the client and the program cannot diverge.
  `solana/test-support/solana-invoke` only changes outside SBF, so that CPIs reach the test runtime.

## Server

- `src/lib/server/solana.ts` (on `@solana/kit`) registers products and builds the transactions the user signs. The
  server is the `feePayer`: when it receives a signed transaction it rebuilds the message with the same blockhash and
  requires it to be identical byte for byte, to carry exactly one ed25519 signature and to pass simulation, and only then
  co-signs.
- `wallet-auth.ts`: simple Sign-In With Solana. The browser signs a single-use nonce with its wallet and the server
  verifies the ed25519 signature against the address itself.
- **Payments (Solana Pay):** each purchase gets a new `reference` key. The QR is a transfer request
  `solana:<treasury>?amount=…&spl-token=<USDC>&reference=…` that any Solana wallet can pay. The panel shows the QR and
  the same request as a payment link, to open in the device's wallet or send to whoever pays; it does not carry the
  purchase id, so sharing it gives no access to the batch or its codes. The server finds the payment with
  `getSignaturesForAddress(reference)` and only accepts it if the treasury received at least the total in that token.
- **Copied labels:** every public check records the visitor's country (from Cloudflare's `cf-ipcountry`, never the
  address). `src/lib/scan-signals.ts` flags a product when its secret QR is used after it already has an owner, or when
  its public QR is checked from two countries within 48 hours, and `/verify` shows the warning.

## Client

- Privy (`@privy-io/react-auth`) provides email or Google login and an embedded Solana wallet. `PrivyBridge` mounts once
  per page and registers login and signing in `privy-registry.ts`; `signer.ts` is what every signing flow uses. The QR
  secret is turned into an ed25519 key in the browser (WebCrypto) and never leaves the page.

## Pending security work

| Finding | Proposal |
| --- | --- |
| The server stores each product's secret in plain text and returns it from `POST /api/purchases/detail` with only the `purchaseId`. | Store only the public key and hand out the labels once, or generate them in the company's browser. |
| `GET /api/warranties?owner=` is public. | Require the wallet proof, as `/api/workspace` does. |
| State in a JSON file: only one instance is possible. | Postgres or SQLite before mainnet. |
| Upgrade authority and `admin` on a single key. | A Squads multisig for both. |

## Deploy to devnet

```bash
cd solana
anchor build
anchor keys sync                        # writes your keypair's program id into lib.rs and Anchor.toml
anchor deploy --provider.cluster devnet
cd .. && npm run solana:init            # SOLANA_PROGRAM_ID and SOLANA_MINTER_SECRET in .env; --cooldown (60 s by default)
```

Then, in `.env`: `SOLANA_PAY_RECIPIENT` (the treasury, with its USDC account created), `PRICE_PER_TOKEN` and
`PRIVY_APP_ID`. Devnet USDC is free at faucet.circle.com and devnet SOL with `solana airdrop`.
