# Demo script (3:00)

Record on the Solana version with `SOLANA_PROGRAM_ID` set (not local demo mode). Use a fictional winery and a small
lot, and label the screen "Solana devnet · test USDC".

| Time | On screen | What to say |
| --- | --- | --- |
| 0:00 to 0:15 | Landing in English (`/en/`) | "This is VeriFire: a Solana identity for every physical product, starting with wine." |
| 0:15 to 0:45 | Company panel: buy a batch, Solana Pay QR, payment confirmed | "A winery buys a batch of labels and pays in USDC with Solana Pay, from any Solana wallet. When the payment confirms, every unit is registered in our Anchor program." |
| 0:45 to 1:00 | Label sheet: public QR outside, secret QR inside | "Each unit gets two QRs: a public one for the outside of the box and a secret one under the seal." |
| 1:00 to 1:25 | Phone scans the public QR: `/verify` shows the product sealed and the verified issuer | "Anyone in a store scans the public QR: no app, no account. It shows the lot, the verified winery and that the unit is still sealed." |
| 1:25 to 2:00 | `/app`: sign in with email, scan the secret QR, sign the activation | "After buying, the customer scans the secret QR and signs in with an email. Privy creates a Solana wallet for them and we pay the fee, so they never need SOL." |
| 2:00 to 2:20 | The activation transaction open in Solana Explorer (devnet): `Ed25519SigVerify` + `activate_product` | "Here is the transaction on Solana devnet: the native ed25519 program checks the sealed QR's signature and our program makes the buyer the owner. It can only happen once." |
| 2:20 to 2:45 | Warranty card: transfer link; second account accepts it | "If they resell the bottle, they open a transfer link and the next owner accepts it: ownership and warranty move together, on-chain." |
| 2:45 to 3:00 | `/verify` again: activated, owners count, history with Explorer links | "Scanning the public QR now shows it was claimed, when, and how many owners it has had. A copied label shows up as a warning." |
