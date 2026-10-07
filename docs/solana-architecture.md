# VeriFire on Solana: design, security and pending work

## Program (`solana/programs/verifire_product`)

- **Accounts:** each batch is a PDA `["batch", code]` with the Merkle root of its units, its first token id, its size
  and its model, lot and destination; it only takes the bytes its texts use (about 130, roughly 0.0018 SOL of rent).
  A sealed unit has no account. Activating it creates its certificate, a PDA `["certificate", public code]` of 98
  bytes (owner, open transfer link, cooldown): 1,572,960 lamports, about 0.0016 SOL. The previous version used one
  619-byte account per product (0.0052 SOL each, paid for every printed label). The config is a PDA `["config"]` with
  `admin`, `minter`, `next_token_id` and `offer_cooldown_seconds`.
- **Merkle tree:** leaf = `sha256(0x00 ‖ index u32 LE ‖ activation key ‖ public code)`, node =
  `sha256(0x01 ‖ smaller ‖ larger)` (sorted pairs, so a proof needs no positions); on an odd level the last node moves
  up unpaired. The index fixes the unit's token id (`first_token_id + index`). The server keeps every unit of a batch,
  so it builds the proof itself, with no indexer. Batches are capped at 4,096 units so the activation transaction, with
  a 12-level proof and the signature instruction, stays under 1,232 bytes (1,115).
- **QR signature:** the activation key is derived from the printed secret, `sha256("verifire-activation-v1:" + secret)`
  → ed25519 key pair. The program never stores it: the batch root commits to it. Whoever activates passes the public
  key and its Merkle proof, and signs `domain ‖ program_id ‖ certificate PDA ‖ account`; that signature is verified by
  the native `Ed25519SigVerify` program in the previous instruction, and the program reads it by introspecting the
  Instructions sysvar (`src/ed25519.rs`), requiring exactly one signature, the expected key and the expected message.
  The certificate is created with `init_if_needed` so that a second activation fails with `AlreadyClaimed`.
- **Separate keys:** `minter` (the server) can only issue; `admin` imports owners and changes the config; `initialize` can
  only be called by the upgrade authority (checked against ProgramData).
- **Transfer links:** their key and expiry live in the same account, so every link expires; opening another one requires
  waiting `offer_cooldown_seconds`, so nobody can make the fee payer pay by opening and cancelling in a loop.
- **Events** on batch registration, import, activation, offer, cancellation and acceptance.
- **Tests:** 22 native tests with `solana-program-test` (`npm run test:solana`) and shared vectors
  (`solana/fixtures/vectors.json`) that check Rust and TypeScript at once, so the client and the program cannot diverge.
  `solana/test-support/solana-invoke` only changes outside SBF, so that CPIs reach the test runtime.

## Server

- `src/lib/server/solana.ts` (on `@solana/kit`) registers batches and builds the transactions the user signs. The
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
| The units of each batch (public code and activation key per leaf) live only in the server's store, and an activation needs all of them to build its proof. | Back the store up, and publish each batch's leaves (they are not secret) so anyone can rebuild the proofs. |
| An activated unit still pays 0.0016 SOL of rent for its certificate. | Compressed state (account compression or Bubblegum cNFTs) would bring it close to the transaction fee. |

## Deploy to devnet

```bash
cd solana
anchor build
anchor keys sync                        # writes your keypair's program id into lib.rs and Anchor.toml
anchor deploy --provider.cluster devnet
cd .. && npm run solana:init            # SOLANA_PROGRAM_ID and SOLANA_MINTER_SECRET in .env; --cooldown (60 s by default)
```

**Upgrading the program already deployed** (same program id, so existing links keep working):

```bash
cd solana
anchor build
solana program deploy target/deploy/verifire_product.so --program-id 6a6EMSNxCrFzcLA38Q5WwcPWgyDPqdghaoaWhvHAEnj8 --url devnet
# if it says the program account is too small: solana program extend 6a6EMSNxCrFzcLA38Q5WwcPWgyDPqdghaoaWhvHAEnj8 20000 --url devnet
```

The config account does not change, so `solana:init` is not run again. When the server starts, products registered as
per-product accounts of the first version count as unregistered: the sealed ones are registered again, one transaction
per batch. Products activated in the first version keep their old account on-chain but are not carried over.

Then, in `.env`: `SOLANA_PAY_RECIPIENT` (the treasury, with its USDC account created), `PRICE_PER_TOKEN` and
`PRIVY_APP_ID`. Devnet USDC is free at faucet.circle.com and devnet SOL with `solana airdrop`.
