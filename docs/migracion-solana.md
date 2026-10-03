# Migración de VeriFire a Solana

Este documento resume la revisión del código actual y el plan para pasar VeriFire de Stellar (Soroban) a Solana. La
fase 1 (programa on-chain y cliente del servidor) está en esta rama; el resto está ordenado por dependencia.

## 1. Dónde estamos

- **Cadena actual:** Stellar testnet con el contrato Soroban `contracts/verifire_product` (v2
  `CDFW7UROVQAU462KD2HI2XTOTP7BFSIQE3Q32K3FRN7ONPKGYIQV2EI6`). No hay nada en EVM.
- **App:** Astro 7 + React 19 en un solo proceso Node. El estado vive en un JSON (`DATA_FILE`) reescrito entero en cada
  cambio, con nonces, locks y rate-limit en memoria: una sola instancia.
- **Wallets:** Cavos kit (wallet Stellar embebida con login por email/Google) para compradores y empresas; Freighter solo
  para pagar. Pagos de lotes con Cosmos Pay en XLM.
- **Lo que está bien y se conserva:** el secreto del QR nunca viaja a la red (solo la clave pública derivada), la firma ata
  contrato + producto + cuenta (anti front-running), dominios separados para activación y transferencia, validación
  estricta de la transacción firmada antes de pagarla, escritura atómica del estado.

## 2. Equivalencias Stellar → Solana

| Stellar / Soroban | Solana / Anchor (esta rama) |
| --- | --- |
| Contrato `verifire_product` (Rust, soroban-sdk) | Programa Anchor `solana/programs/verifire_product` (anchor-lang 1.2) |
| `Product` en storage persistente + índice `TokenByCode` | Cuenta PDA `["product", código]`: el `init` falla si el código existe, no hace falta índice aparte |
| `Admin`, `NextTokenId` en instance storage | Cuenta PDA `["config"]` con `admin`, `minter`, `next_token_id`, `offer_cooldown_seconds` |
| `env.crypto().ed25519_verify` | Programa nativo `Ed25519SigVerify` en la instrucción anterior + introspección del sysvar Instructions |
| Mensaje `dominio ‖ XDR(contrato) ‖ token_id ‖ XDR(cuenta)` | `dominio ‖ program_id ‖ PDA del producto ‖ cuenta` |
| `require_auth` + fee-bump del emisor | La cuenta del usuario firma; el servidor es `feePayer` y co-firma al enviar |
| `upgrade(wasm_hash)` | Autoridad de upgrade del loader de Solana (idealmente un multisig Squads) |
| TTL de entradas persistentes | Rent: ~0,0052 SOL por producto (619 bytes), recuperable si se cierra la cuenta |
| `stellar.ts` | `src/lib/server/solana.ts` (+ `solana-program.ts`, `solana-keys.ts`) con `@solana/kit` |
| stellar.expert | Solana Explorer (`explorerTxUrl`) |

**Los QR ya impresos siguen sirviendo:** la derivación `sha256("verifire-activation-v1:" + secreto)` → par ed25519 no
depende de la cadena, y Solana usa las mismas claves ed25519. Solo cambia el mensaje que se firma, que arma el servidor.

## 3. Problemas encontrados y cómo quedan

| # | Hallazgo | En esta rama |
| --- | --- | --- |
| 1 | El servidor guarda en claro el secreto de cada producto (`store.ts:41`) y lo devuelve por `POST /api/purchases/detail` solo con el `purchaseId`. | **Pendiente (fase 3).** Propuesta: guardar solo la clave pública y entregar las etiquetas una única vez, o generarlas en el navegador de la empresa. |
| 2 | Una sola llave caliente es admin, emisor y autoridad de upgrade. | **Resuelto en el programa:** `minter` (servidor) solo emite; `admin` (fuera del servidor) importa dueños y cambia config; el upgrade queda en el loader. `initialize` solo lo puede llamar la autoridad de upgrade. |
| 3 | El emisor paga todo y nada frena abrir/cancelar links en bucle (`LastTransferOffer` se guardaba pero no se usaba). | **Resuelto:** `offer_cooldown_seconds` en la config (60 s por defecto en `solana:init`), configurable por el admin. |
| 4 | Productos archivados por TTL que el servidor toma como "código libre" (`stellar.ts:156`). | **Desaparece:** en Solana no hay TTL; `readProduct` devuelve `null` solo si la cuenta no existe. |
| 5 | Un link sin `TransferExpiry` nunca vence. | **Resuelto:** el vencimiento vive en la misma cuenta que la clave del link y siempre se comprueba. |
| 6 | Sin eventos de emisión, oferta ni cancelación. | **Resuelto:** eventos para todas las operaciones. |
| 7 | `GET /api/warranties?owner=` es público. | Pendiente (fase 3), independiente de la cadena. |
| 8 | Red de prueba fija en varios archivos. | El cliente Solana toma `SOLANA_RPC_URL` y `SOLANA_CLUSTER` del entorno. |
| 10 | Persistencia en un JSON. | Pendiente (fase 4): Postgres o SQLite. |
| 11 | Dos ids de token. | El cliente Solana direcciona por código público; `token_id` queda solo como número de serie. |
| 12 | QR secretos de demo en el repo público. | Esos 6 productos no se migran como sellados, o se re-emiten. |

## 4. Fases

### Fase 1: programa y cliente del servidor (esta rama)

- `solana/programs/verifire_product`: programa Anchor con `initialize`, `update_config`, `mint_product`,
  `import_claimed_product`, `activate_product`, `offer_transfer`, `cancel_transfer`, `accept_transfer`.
- 20 tests que corren el programa con `solana-program-test`, incluida la verificación real de Ed25519SigVerify: los 15
  casos del contrato Soroban más inicialización, separación de llaves, cooldown y firma para otro producto.
- `solana/fixtures/vectors.json`: vectores que comprueban a la vez los tests de Rust y `tests/solana-program.test.mjs`,
  así el cliente TypeScript y el programa no pueden divergir.
- `src/lib/server/solana.ts`: misma API que `stellar.ts` (registrar, importar, activar, ofrecer, cancelar, aceptar). Al
  enviar una transacción firmada por el usuario, el servidor reconstruye el mensaje con el mismo blockhash y exige que
  sea idéntico byte a byte antes de firmar como `feePayer`.
- `npm run solana:init`, `npm run test:solana` y un workflow de GitHub Actions.

La app sigue funcionando sobre Stellar: nada de esta fase cambia su comportamiento.

### Fase 2: wallets y conexión de la app (rama solana-fase-2)

Con `CHAIN=solana` la app entera pasa a Solana; sin esa variable sigue igual que antes, sobre Stellar.

1. **Servidor:** `src/lib/server/ledger.ts` define una sola interfaz para las dos cadenas (`stellarLedger` y
   `solanaLedger`) y `chain.ts` elige una según `CHAIN`. `claims.ts`, `transfers.ts`, `products.ts`, `chain-sync.ts` y
   las rutas `/api/warranties/*` y `/api/transfers/*` usan esa interfaz. El flujo en dos pasos se mantiene: el servidor
   responde `{ tx }` (en Stellar también `xdr`, por compatibilidad) y recibe `signedTx` (acepta `signedXdr` igual).
2. **Prueba de wallet** (`wallet-auth.ts`): en Solana es Sign-In With Solana simple, la firma ed25519 del nonce
   verificada con la dirección misma, sin consultar la red.
3. **Wallet:** Privy reemplaza a Cavos. `PrivyBridge` se monta una vez por página (en `BaseLayout`) y registra en
   `privy-registry.ts` el login, la firma de transacciones y la de mensajes. `src/lib/client/signer.ts` le da a los flujos
   (activar, transferir, portada, sincronizar la empresa, verificación) la misma interfaz con Cavos o con Privy.
4. **Login:** en Solana `/login` muestra `PrivyAuthPanel` (correo con código o Google, sin contraseña). Al entrar guarda
   la misma cuenta y sesión que el login de Cavos, y al cerrar sesión también cierra la de Privy.
5. Variables nuevas: `PRIVY_APP_ID` (dashboard.privy.io; en el dashboard hay que habilitar email, Google y las wallets
   embebidas de Solana, y agregar el dominio de la app a los orígenes permitidos).

Queda para más adelante: los pagos de lotes siguen en Stellar con Cosmos Pay (fase 3), y en Solana el servidor no
importa dueños existentes (`importClaimedProduct`): eso lo hace el script de migración con la llave de admin (fase 4).

### Fase 3: pagos y seguridad

1. **Cosmos Pay:** confirmar si cobra en Solana (SOL o USDC SPL). Si no, Solana Pay con USDC es la alternativa directa.
2. Dejar de guardar el secreto en claro (hallazgo 1) y cerrar `GET /api/warranties` (hallazgo 7).
3. Autoridad de upgrade y `admin` en un multisig (Squads).

### Fase 4: migración de datos y corte

1. Desplegar en devnet: `anchor build && anchor keys sync && anchor deploy`, luego `npm run solana:init`.
2. Script de migración: los productos sellados se registran con `mint_product` (mismo código y misma clave de
   activación). Los activados se importan con `import_claimed_product`, pero **sus dueños son direcciones Stellar `G...`**:
   necesitan una dirección Solana. Opciones: que cada dueño reclame su producto iniciando sesión una vez (el servidor lo
   importa a su nueva wallet), o, si el proveedor de wallet deriva ambas cuentas de la misma identidad, mapearlas solas.
3. Persistencia en una base de datos (hallazgo 10) antes de pasar a mainnet.
4. Mainnet: fondear el `feePayer` (rent ~0,0052 SOL por producto más comisiones de ~0,000005 SOL por firma).

## 5. Decisiones pendientes

1. ~~Proveedor de wallet que reemplaza a Cavos (fase 2).~~ Privy.
2. Si Cosmos Pay cobra en Solana o se pasa a Solana Pay con USDC (fase 3).
3. Cómo se asignan las direcciones Solana a los dueños actuales de Stellar (fase 4).
4. Cuentas PDA (esta rama, simple y barato para miles de productos) o NFTs comprimidos con Bubblegum, si se quiere que
   el producto aparezca como coleccionable en las wallets. Recomendación: PDA ahora; cNFT solo si hay un caso de negocio.

## 6. Cómo probar

```bash
npm test            # incluye los vectores compartidos con el programa
npm run test:solana # 21 tests del programa (Rust, sin toolchain de Solana)
```

Para compilar y desplegar el programa hace falta la toolchain de Solana y Anchor 1.2 (`avm install 1.2.0`):

```bash
cd solana
anchor build
anchor keys sync   # pone el program id de tu keypair en lib.rs y Anchor.toml
anchor deploy --provider.cluster devnet
cd .. && npm run solana:init
```

Variables nuevas en `.env`: `SOLANA_PROGRAM_ID`, `SOLANA_MINTER_SECRET` (keypair del servidor, formato solana-keygen),
`SOLANA_FEE_PAYER_SECRET` (opcional), `SOLANA_RPC_URL`, `SOLANA_CLUSTER`, y solo para `solana:init`
`SOLANA_ADMIN_KEYPAIR`.

`solana/test-support/solana-invoke` es una copia de `solana-invoke 0.5.0` que solo cambia fuera de SBF: hace que las CPI
del programa lleguen al runtime de `solana-program-test` en los tests nativos. Compilado para Solana es idéntico al
original.
