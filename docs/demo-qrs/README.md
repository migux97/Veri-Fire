# Demo QR codes for the jury

Six sealed, unclaimed demo products from a verified VeriFire batch (`BATCH-2AE2B16669`, "VF-2026-D874B52B"),
issued so anyone can try the full flow without installing anything.

Each product has **two files**: its public QR (`-qr-publico.svg`) and its secret QR (`-qr-secreto.svg`).

| Token | Public QR | Secret QR |
| --- | --- | --- |
| VF-36SYSDVR | `VF-36SYSDVR-qr-publico.svg` | `VF-36SYSDVR-qr-secreto.svg` |
| VF-4WEHX2YC | `VF-4WEHX2YC-qr-publico.svg` | `VF-4WEHX2YC-qr-secreto.svg` |
| VF-5JK6D9XM | `VF-5JK6D9XM-qr-publico.svg` | `VF-5JK6D9XM-qr-secreto.svg` |
| VF-96YE4N48 | `VF-96YE4N48-qr-publico.svg` | `VF-96YE4N48-qr-secreto.svg` |
| VF-PDCHX5ZP | `VF-PDCHX5ZP-qr-publico.svg` | `VF-PDCHX5ZP-qr-secreto.svg` |
| VF-D5MB996H | `VF-D5MB996H-qr-publico.svg` | `VF-D5MB996H-qr-secreto.svg` |

## How to try it

1. **Anyone, no account:** open the public QR (or `https://verifire-solana.cosmosapp.lat/verify?token=<TOKEN>` with any
   token above) to see the product and its issuer, marked "Producto original" because VeriFire verified this company.
2. **To activate one:** go to `https://verifire-solana.cosmosapp.lat/app`, sign in with your own email, and upload or
   paste the matching secret QR image. The warranty gets registered on Solana in your name, and Verifire pays the fee.
3. Scan the same product's public QR again afterwards: it now shows as activated.

## Important

- **Each secret QR works only once.** Give each juror a different pair (there are 6). Once used, that unit
  cannot be activated again by anyone else.
- `VF-D5MB996H` is reserved for the team's own demo recording; use one of the other five for the jury.
- These are real Solana **devnet** transactions, not simulated data: each certificate links to Solana Explorer.
