# VeriFire

**Verifiable product authenticity and warranties on Stellar.** A company registers each unit it sells with two QR codes;
anyone can check who issued a product, and the buyer activates the warranty with a wallet, so the warranty and the
ownership live on-chain and follow the product when it is resold.

- Live demo: **https://verifire.cosmosapp.lat** (English landing at `/en/`)
- Soroban contract (testnet): [`CDFW7UROVQAU462KD2HI2XTOTP7BFSIQE3Q32K3FRN7ONPKGYIQV2EI6`](https://stellar.expert/explorer/testnet/contract/CDFW7UROVQAU462KD2HI2XTOTP7BFSIQE3Q32K3FRN7ONPKGYIQV2EI6)
- Everything runs on **Stellar testnet**. No real money moves.

## The problem

When you buy electronics, watches, perfume or wine, you have to take the seller's word that the product is genuine and
that the warranty is real. A warranty is usually a paper or a message that gets lost, a claim can be faked, and when
the product is resold the record does not travel with it. Nobody outside the seller can check the history, and the
seller can change it afterwards.

## The solution

Each unit gets **two QR codes** and one record in a Soroban smart contract:

| QR | Where it goes | Who scans it | What it does |
| --- | --- | --- | --- |
| **Public QR** | Outside the product | Anyone, before or after buying | Opens `/verify`: model, batch, destination, state, and **who issued it** |
| **Secret QR** | Under a seal, inside the box | The buyer, once | Activates the warranty and makes the buyer's wallet the on-chain owner |

- The secret never travels in a transaction. The contract stores only the public key derived from it; the buyer's
  browser signs with it and sends the signature, so nobody can front-run the activation.
- The buyer needs **no XLM and no Stellar knowledge**: signing in with an email or Google creates a Cavos wallet, and the
  issuing account pays the network fees.
- The owner can hand the warranty to someone else with a **transfer link** (valid 15 minutes, single use), so a resold
  product keeps its proof. The short window limits the damage of a leaked link; both people have to be connected at the
  same moment, and the owner can open a new link if it expires.
- A public QR says **"Original product"** only if the issuer was **verified by a Verifire administrator**; otherwise it
  says **"Registered product"** and that the issuer was not verified. Verifire guarantees that a code is unique and was
  not copied. That the product is genuine is vouched for by the verified company that issued it.

## How it works: step by step for each user

### Company (the issuer)
1. Sign up, choose the company workspace and fill in the profile (legal name, tax ID, website).
2. Buy a batch of tokens at `/admin`. Payment is a Stellar testnet payment through Cosmos Pay.
3. When the payment is confirmed, the server registers every product on the contract (`mint_product`).
4. Print the labels (public QR outside, secret QR inside) and mark the batch as shipped from the batches panel.
5. Ask for verification from Settings → Verification. Until an administrator approves it, its products show as "registered".

### Verifire administrator
1. Sign in with a wallet listed in `ADMIN_WALLETS` and open `/verificacion`.
2. Review what each company declared (legal name, tax ID, website) and approve or reject it, signing with the wallet.
3. The approval stores the business name that was checked and only holds while the company keeps showing that name.

### Anyone in a shop (before buying)
1. Scan the public QR: `/verify?token=VF-XXXXXXXX` shows the product and its issuer, with no app and no account.

### Buyer
1. Scan the secret QR in `/app` and sign in (email or Google). A Cavos wallet is created if there is none.
2. Sign the activation. The warranty is registered on Stellar and the buyer gets a public certificate (the transaction).
3. Optionally allow the product to appear in the home page carousel (only products of verified companies can).
4. From "My warranties", open a transfer link to give the product to someone else.

### New owner
1. Open the transfer link, sign in, sign the acceptance. The contract moves the ownership and the warranty.

## Why Stellar

- **Soroban verifies the proof on-chain.** The contract checks the ed25519 signature derived from the secret QR and the
  buyer's authorization (`require_auth`), and it activates a product only once. The rule is enforced by the network,
  not by our server.
- **Fees are low and sponsored.** Each activation or transfer is one small transaction paid by the issuing account, so
  the buyer never holds XLM. Fees depend on the resources each operation uses; the server compares the fee of the
  signed transaction with its simulation before paying it.
- **Anyone can audit it.** Every activation has a transaction hash that opens in a public explorer. The public QR
  page and the certificate point to real transactions, never to a screenshot.
- **The ecosystem fits.** Payments (Cosmos Pay) and wallets (Cavos) are Stellar-native, so the whole flow
  (pay, register, activate, transfer) stays on one network.
- **Ownership follows the wallet.** The contract stores the owner, so warranties are recovered by signing in from any
  browser and survive a change of device.

## Install, run and test

Requires Node 22.18 or newer.

```bash
npm install
cp .env.example .env   # fill in the Cosmos Pay, Cavos and Stellar values
npm run dev            # http://localhost:5501
```

Port 5501 is fixed on purpose: Cavos stores each wallet's signing key per site address, and existing accounts were created there.

| Script | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run check` | Type check for `.astro`, `.ts` and `.tsx` |
| `npm test` | Pure-logic tests (`node --test`, no dependencies) |
| `npm run build` | Type check, tests and production build into `dist/` |
| `npm start` | Production server (reads `.env` on start) |
| `npm run contract:deploy` | Deploys the contract to testnet and writes its data to `.env` |
| `npm run contract:upgrade` | Replaces the contract code keeping its address and data |
| `npm run contract:test-activation` | End-to-end activation against testnet |

Without `STELLAR_CONTRACT_ID` the app runs in **demo mode**: warranties are stored only locally and the interface says
so. Set the contract and the issuing account to make them real.

**Try it without installing:**
1. Open a public verification page: [`/verify?token=VF-013`](https://verifire.cosmosapp.lat/verify?token=VF-013) (an activated product) or [`/verify?token=VF-011`](https://verifire.cosmosapp.lat/verify?token=VF-011).
2. Sign up at `/login?modo=registro`, choose the company workspace and follow the company steps above.
3. To see the carousel on the home page, a Verifire administrator has to approve the company that issued the products.
4. **Or activate a real one yourself:** [`docs/demo-qrs/`](docs/demo-qrs/) has six sealed, unclaimed demo products,
   each with its public and secret QR ready to use, and instructions for both.

**Reproduce the on-chain flow from a terminal:** `npm run contract:test-activation` registers a product, signs with the
derived key, authorizes as the buyer and activates it against testnet.

**Videos:** [full demo walkthrough](PITCH/video-demo.md) and [an external user activating a product with no help from
the team](PITCH/video-usuario-externo.md).

## Verifiable on-chain evidence

All of this is on Stellar **testnet**.

| What | Value |
| --- | --- |
| Contract v2 (current, with transfers) | [`CDFW7UROVQAU462KD2HI2XTOTP7BFSIQE3Q32K3FRN7ONPKGYIQV2EI6`](https://stellar.expert/explorer/testnet/contract/CDFW7UROVQAU462KD2HI2XTOTP7BFSIQE3Q32K3FRN7ONPKGYIQV2EI6) |
| Contract v1 (replaced; its products were re-registered in v2) | [`CCD42VVZ2KS4RXMKFDFSUY5EWG4CVYGSERAISO5D2WPCCXJEQWTEC3UL`](https://stellar.expert/explorer/testnet/contract/CCD42VVZ2KS4RXMKFDFSUY5EWG4CVYGSERAISO5D2WPCCXJEQWTEC3UL) |
| Issuing account (pays fees, signs registrations) | [`GB2F2OJPRY6CZ2CYW7I3WKQ5X4CLAZCEKOBYYIKDU4QXZLDR6MOHQAT5`](https://stellar.expert/explorer/testnet/account/GB2F2OJPRY6CZ2CYW7I3WKQ5X4CLAZCEKOBYYIKDU4QXZLDR6MOHQAT5) |

Warranty activations (each one is a real transaction, marked successful on Horizon testnet):

| Product | Activated | Transaction |
| --- | --- | --- |
| VF-005 | 2026-09-16 (first contract) | [`a350d5a2…f18c0`](https://stellar.expert/explorer/testnet/tx/a350d5a2cf45c2afd1c18f9abf84883ba076d10f01423afeeead90db4f3f18c0) |
| VF-009 | 2026-09-16 (first contract) | [`97cbdbfa…bb458`](https://stellar.expert/explorer/testnet/tx/97cbdbfa98daa4166c11b01beeacb7c5a8705f51f790be62932cf981777bb458) |
| VF-011 | 2026-09-19 | [`1127def7…dc0e`](https://stellar.expert/explorer/testnet/tx/1127def745cc38dcc0a271ba248f2dc5af0b61096013567ab0c653c5a081dc0e) |
| VF-013 | 2026-09-19 | [`9b48761c…827d`](https://stellar.expert/explorer/testnet/tx/9b48761c6169de3aad53c01e28717d56dae4b86365c1e6033b991409bd2a827d) |

Each activated product also shows its own "View on Stellar" link on its warranty card and history. The app only shows a
certificate link when a real transaction exists.

## Roadmap and future work

Planned, not built yet:

- **Simple mode for small sellers.** Today's company panel (batches, team, profile) is made for companies. Repair shops,
  resellers and small shops need "register a unit in three taps" from the phone.
- **Distributors and chain of custody.** Let a brand invite distributors who receive and hand over batches, so the
  history shows brand → distributor → shop → buyer, and diverted stock becomes visible.
- **Automatic company checks.** Validate the tax ID format and confirm the website through a `stellar.toml`, so the
  administrator reviews less by hand.
- **More flexible identifiers**, for example serial numbers of products that ship without a box.
- **A real database** in place of the JSON file, before the number of companies grows.
- **Mainnet** once the contract has been audited.
- **Manufacturers and official importers** as issuers, so "original" can mean "from the factory", which today is
  only vouched for by the verified company that issues the product.

## Architecture, stack and technical details

### Stack

- [Astro 7](https://docs.astro.build) with `server` output and the `@astrojs/node` adapter (standalone mode).
- React 19 islands in TSX for the interactive parts, with state shared between islands through `nanostores`.
- Strict TypeScript (`astro/tsconfigs/strictest`) across the project.
- Typed configuration with `astro:env`, the Astro Fonts API and Font Awesome icons served locally. Tailwind through Vite (`tw:` utilities, no Preflight).
- Soroban contract in Rust at `contracts/verifire_product` (see [`contracts/README.md`](contracts/README.md), in Spanish).
- Cavos for wallets and sign-in, Cosmos Pay for batch payments, Resend for team invitations (optional).
- A JSON file as the store (written atomically, previous version kept as `<DATA_FILE>.bak`).

### Contract

`initialize`, `mint_product`, `get_product`, `get_product_by_code`, `activation_message`, `activate_product`,
`offer_transfer`, `transfer_times`, `cancel_transfer`, `transfer_message`, `accept_transfer`, `import_claimed_product`
and `upgrade`. Activation and transfer emit the `activated` and `transfer` events. The details, and why the secret is
never sent in a transaction, are in [`contracts/README.md`](contracts/README.md).

### What lives on-chain and what does not

- **On the Soroban contract:** each product's record (public code, model, batch, destination), its owner, whether the
  warranty was activated, the open transfer offer and the `activated` and `transfer` events. This is what a buyer or a
  third party can audit without trusting Verifire.
- **In the server's JSON store:** accounts, company workspaces and profiles, batches and purchases, the verification
  decision for each company, the carousel opt-in and the secret codes of a batch until it is printed. It is a single
  file, fine for a pilot; it is not a replacement for a database (see the roadmap).

Everything on the contract is public: a product's record and its owner's wallet address can be read by anyone, and
every transaction is traceable in an explorer. Verifire keeps the owner's email out of the public pages, but the wallet
address is not private. Using a wallet the person does not have to manage is about convenience, not about privacy.

### Two separate Stellar accounts

- **Treasury** (`COSMOS_PAY_DESTINATION`): receives the Cosmos Pay payment for each batch. It never signs on-chain and never appears in what a buyer sees.
- **Issuing account** (`STELLAR_ISSUER_SECRET`): registers products, certifies warranties and pays their fees. If the treasury paid them, it would appear in every certificate and a customer could reach the company's finances.

The issuer secret lives only in the server's `.env`, never in the browser.

### Project structure

```text
src/
  pages/            Routes: .astro pages and API endpoints under pages/api
  layouts/          Base layout (head, fonts, session guard)
  components/       .astro layout components and .tsx islands per feature
  stores/           State shared between islands (nanostores)
  i18n/             Spanish and English texts of the landing and the buyer panel
  lib/
    client/         Browser code: session, Cavos wallet, activation, QR reading
    server/         Server code: state, Cosmos Pay, Stellar, business rules
    qr-codes.ts     What each QR means: no browser or server, covered by tests
    format.ts       Dates, addresses and numbers as displayed
    types.ts        API contract shared by server and client
  styles/           brand.css, global.css, landing*.css, auth.css, company.css, consumer.css
scripts/            Contract deploy and test scripts (TypeScript run by Node)
tests/              Pure-logic tests, run with `node --test`
contracts/          Soroban contract in Rust
docs/               Notes on the landing, languages and carousel (Spanish)
```

`lib/server` is never imported from the browser: pages pass islands only what `publicConfig` exposes
(`lib/server/config.ts`), so a key cannot reach the HTML by accident. `src/lib/server/stellar.ts` is the only file that
imports with a `.ts` extension, because `scripts/` run it directly with Node.

### Server notes

- **Warranties follow the wallet**, because the contract stores the owner. What the company configures is stored next to
  that wallet with `POST /api/workspace`, so signing in from another browser recovers the same batches and settings.
  Reading or writing it requires signing a nonce with the wallet (`src/lib/server/wallet-auth.ts`), because a purchase
  id opens the secret codes of its batch.
- **Verified companies.** Anyone can register a company and issue labels, so Verifire only promises that a code is unique
  and was not copied. An administrator reviews the company in `/verificacion` and approves or rejects it with a wallet
  listed in `ADMIN_WALLETS`. The approval holds only while the company shows the business name that was verified
  (`src/lib/server/verification.ts`). Public QR pages say "Original product" only for a verified issuer, and products
  of unverified companies cannot appear in the home carousel (`showcase-rules.ts`).
- Before activating or transferring, the server reads the contract: a transaction confirmed after the server stopped
  waiting for it (or during a restart) is adopted, instead of leaving the buyer without a warranty.
- The secret codes of a batch are requested with `POST /api/purchases/detail`, with the id in the body, not the URL.
- Open endpoints (`/api/purchases`, `/api/warranties` and the activation preparation) are rate limited per minute and per address.
- Company data (team, agenda, issuance templates, profile, permissions, notices) travels with the account: it is written with
  `writeAccountData` (`src/lib/client/account-data.ts`) and the newest copy of each item wins. To make a new feature follow
  the account, add its name to `ACCOUNT_DATA` and save with that helper.
- **New contract:** `npm run contract:deploy -- --force` keeps the replaced contract in `STELLAR_PREVIOUS_CONTRACT_ID`; on
  start the server registers the sealed and activated products again in the new one. Prefer `npm run contract:upgrade`.

### Routes

| Route | Page |
| --- | --- |
| `/` | Public landing (English at `/en/`) |
| `/login` | Sign in and sign up (`?modo=registro` opens sign up) |
| `/choose-workspace` | Choose between the personal account and a company workspace |
| `/company` | Company panel: summary, catalog, team and agenda |
| `/app` | Buyer panel: scan a QR and see warranties |
| `/batches` | Company panel: batches, labels and activations |
| `/admin` | Buy a batch with Cosmos Pay |
| `/verificacion` | Company review and approval (only wallets in `ADMIN_WALLETS`) |
| `/verify?token=VF-XXXXXXXX` | Public product verification (server-rendered) |
| `/batch?batch=BATCH-0001` | Public batch verification |

Old addresses (`verify.html`, `app.html#q=...`, `activate.html`, and so on) redirect to the new ones keeping their
parameters, so labels already printed keep working. The Google return URL is still `/index.html`, the one registered in
the Cavos dashboard, and it redirects to `/login`. For the public site, `https://verifire.cosmosapp.lat/index.html` must
be in Cavos' callback URLs.

### Production

Verifire runs at **https://verifire.cosmosapp.lat**: a Node server managed with PM2 behind a proxy and Cloudflare. The domain
is declared in `astro.config.ts` (`security.allowedDomains`) so the API rate limits count each visitor by their real
address; change it there if the domain changes. The server guide and install and update scripts live in a separate
folder outside this repository (`VeriFire-servidor`), together with the access profile, which must never be pushed to
GitHub. All `.env` variables are read at run time, so the same build serves any configuration.

### Languages and landing

The landing is in Spanish at `/` and English at `/en/`; the chosen language is kept in the `verifireLang` cookie and
read by `/app`, `/verify` and `/batch`. The company panel is Spanish only. Details of the translations and the
industry carousel are in [`docs/landing-notes.md`](docs/landing-notes.md).
