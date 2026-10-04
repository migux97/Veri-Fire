# VeriFire en Solana: diseño, seguridad y pendientes

## Programa (`solana/programs/verifire_product`)

- **Cuentas:** cada producto es una PDA `["product", código]`; la config es una PDA `["config"]` con `admin`, `minter`,
  `next_token_id` y `offer_cooldown_seconds`. El `init` de la PDA falla si el código ya existe, así que no hace falta un
  índice aparte. Cada producto ocupa 619 bytes: unos 0,0052 SOL de rent, recuperables.
- **Firma del QR:** la clave de activación se deriva del secreto impreso, `sha256("verifire-activation-v1:" + secreto)`
  → par ed25519. El programa guarda solo la clave pública. Quien activa firma `dominio ‖ program_id ‖ PDA ‖ cuenta`, y
  esa firma la verifica el programa nativo `Ed25519SigVerify` en la instrucción anterior; el programa la lee por
  introspección del sysvar Instructions (`src/ed25519.rs`) y exige una sola firma, la clave y el mensaje esperados.
- **Llaves separadas:** `minter` (el servidor) solo emite; `admin` importa dueños y cambia la config; `initialize` solo lo
  puede llamar la autoridad de upgrade (se comprueba contra ProgramData).
- **Links de transferencia:** su clave y su vencimiento viven en la misma cuenta, así que todo link vence; abrir otro
  exige esperar `offer_cooldown_seconds`, para que nadie haga pagar al fee payer abriendo y cancelando en bucle.
- **Eventos** en emisión, importación, activación, oferta, cancelación y aceptación.
- **Tests:** 20 tests nativos con `solana-program-test` (`npm run test:solana`) y vectores compartidos
  (`solana/fixtures/vectors.json`) que comprueban a la vez Rust y TypeScript, así el cliente y el programa no divergen.
  `solana/test-support/solana-invoke` solo cambia fuera de SBF, para que las CPI lleguen al runtime de los tests.

## Servidor

- `src/lib/server/solana.ts` (sobre `@solana/kit`) registra productos y arma las transacciones que firma el usuario. El
  servidor es el `feePayer`: al recibir una transacción firmada reconstruye el mensaje con el mismo blockhash y exige que
  sea idéntico byte a byte, que tenga una sola firma ed25519 y que la simulación pase, y recién entonces co-firma.
- `wallet-auth.ts`: Sign-In With Solana simple. El navegador firma un nonce de un solo uso con su wallet y el servidor
  verifica la firma ed25519 con la dirección misma.
- **Pagos (Solana Pay):** cada compra tiene una clave `reference` nueva. El QR es un transfer request
  `solana:<tesorería>?amount=…&spl-token=<USDC>&reference=…`, que paga cualquier wallet de Solana. El panel muestra el QR
  y el mismo pedido como link de pago, para abrirlo en la wallet del dispositivo o mandárselo a quien paga; no lleva el id
  de la compra, así que compartirlo no da acceso al lote ni a sus códigos. El servidor encuentra el pago con
  `getSignaturesForAddress(reference)` y solo lo acepta si la tesorería recibió al menos el total en ese token.

## Cliente

- Privy (`@privy-io/react-auth`) da login por correo o Google y una wallet de Solana embebida. `PrivyBridge` se monta una
  vez por página y registra en `privy-registry.ts` el login y las firmas; `signer.ts` es lo que usan todos los flujos
  que firman. El secreto del QR se convierte en clave ed25519 en el navegador (WebCrypto) y nunca sale de la página.

## Pendientes de seguridad

| Hallazgo | Propuesta |
| --- | --- |
| El servidor guarda en claro el secreto de cada producto y lo devuelve en `POST /api/purchases/detail` con solo el `purchaseId`. | Guardar solo la clave pública y entregar las etiquetas una única vez, o generarlas en el navegador de la empresa. |
| `GET /api/warranties?owner=` es público. | Exigir la prueba de wallet, como `/api/workspace`. |
| Estado en un JSON: una sola instancia posible. | Postgres o SQLite antes de mainnet. |
| Autoridad de upgrade y `admin` en una sola llave. | Un multisig de Squads para las dos. |

## Desplegar en devnet

```bash
cd solana
anchor build
anchor keys sync                        # pone el program id de tu keypair en lib.rs y Anchor.toml
anchor deploy --provider.cluster devnet
cd .. && npm run solana:init            # SOLANA_PROGRAM_ID y SOLANA_MINTER_SECRET en .env; --cooldown (60 s por defecto)
```

Después, en `.env`: `SOLANA_PAY_RECIPIENT` (la tesorería, con su cuenta de USDC creada), `PRICE_PER_TOKEN` y
`PRIVY_APP_ID`. El USDC de devnet se pide gratis en faucet.circle.com y el SOL de devnet con `solana airdrop`.
