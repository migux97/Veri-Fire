// Access to the VeriFire program on Solana (solana/programs/verifire_product). The Solana counterpart of stellar.ts,
// with the same flows: the server registers products, and builds the transactions a user's wallet signs, paying their
// fees. Holds the minter key: never import it in the browser.
// Products are addressed by their public code (the program's PDA seed), so there is no second token id to keep in sync.
import {
  address, appendTransactionMessageInstructions, compileTransaction, createKeyPairSignerFromBytes, createSolanaRpc,
  createTransactionMessage, decompileTransactionMessage, getBase58Decoder, getBase58Encoder, getBase64EncodedWireTransaction,
  getBase64Encoder, getCompiledTransactionMessageDecoder, getPublicKeyFromAddress, getTransactionDecoder, isAddress,
  partiallySignTransaction, pipe, setTransactionMessageFeePayer, setTransactionMessageLifetimeUsingBlockhash,
  signatureBytes, verifySignature,
  type Address, type Base64EncodedWireTransaction, type Blockhash, type Instruction, type KeyPairSigner, type Transaction
} from '@solana/kit';
import { HttpError } from './errors.ts';
import { messages } from './messages.ts';
import {
  ED25519_PROGRAM, activationMessage, configAddress, decodeConfig, decodeProduct, ed25519Instruction, instructions, productAddress,
  programErrorName, transferMessage, type OnChainProduct, type ProductArgs, type ProgramError
} from './solana-program.ts';
import { activationKeyFor } from './solana-keys.ts';

export { activationKeyFor };

const DEFAULT_RPC_URL = 'https://api.devnet.solana.com';

export interface SolanaConfig {
  programId: string;
  // Registers products. It is not the program's admin (who can import owners and change the config) nor its upgrade
  // authority: those keys stay off the server.
  minterSecret: string;
  // Pays rent and every fee of the users' transactions. Defaults to the minter.
  feePayerSecret?: string | undefined;
  rpcUrl?: string | undefined;
  cluster?: string | undefined;
}

export const solanaConfigFromEnv = (env: Record<string, string | undefined>): SolanaConfig => ({
  programId: env['SOLANA_PROGRAM_ID'] || '',
  minterSecret: env['SOLANA_MINTER_SECRET'] || '',
  feePayerSecret: env['SOLANA_FEE_PAYER_SECRET'] || undefined,
  rpcUrl: env['SOLANA_RPC_URL'] || undefined,
  cluster: env['SOLANA_CLUSTER'] || undefined
});

/** A keypair as written by solana-keygen (JSON array of 64 numbers) or as a base58 string of the same 64 bytes. */
export const keypairFromSecret = (secret: string): Promise<KeyPairSigner> => {
  const trimmed = secret.trim();
  const bytes = trimmed.startsWith('[') ? Uint8Array.from(JSON.parse(trimmed) as number[]) : new Uint8Array(getBase58Encoder().encode(trimmed));
  if (bytes.length !== 64) throw new Error('La clave de Solana debe tener 64 bytes (formato de solana-keygen).');
  return createKeyPairSignerFromBytes(bytes);
};

export const isSolanaAddress = (value: unknown): value is Address => typeof value === 'string' && isAddress(value);
export const isTxSignature = (value: unknown) => /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(String(value ?? ''));
export const explorerTxUrl = (signature: string, cluster = 'devnet') =>
  `https://explorer.solana.com/tx/${signature}${cluster === 'mainnet-beta' ? '' : `?cluster=${cluster}`}`;

const programMessages: Partial<Record<ProgramError, string>> = {
  AlreadyClaimed: messages.alreadyClaimedOnChain,
  NotOwner: messages.notOwner,
  NoOpenTransfer: messages.linkClosed,
  AlreadyOwner: messages.alreadyYours,
  TransferExpired: messages.linkExpired,
  OfferTooSoon: messages.linkTooSoon,
  InvalidSignature: messages.invalidSignature
};

// Transaction errors arrive as { InstructionError: [index, { Custom: code }] }; the program's own codes become
// messages safe to show to the client.
export const programErrorOf = (error: unknown): ProgramError | null => {
  const detail = (error as { InstructionError?: [number, unknown] } | null)?.InstructionError?.[1];
  const custom = (detail as { Custom?: number | bigint } | null)?.Custom;
  return custom === undefined ? null : programErrorName(Number(custom));
};

const failure = (error: unknown, what: string): Error => {
  const name = programErrorOf(error);
  const message = name ? programMessages[name] : undefined;
  if (message) return new HttpError(409, message);
  return new Error(`${what} falló en Solana: ${JSON.stringify(error, (_, value: unknown) => (typeof value === 'bigint' ? value.toString() : value))}`);
};

const invalidSignedCall = () => new HttpError(400, 'La transacción firmada no corresponde a la operación pedida sobre este producto.');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const base64 = getBase64Encoder();

export const createSolanaClient = ({ programId: programIdText, minterSecret, feePayerSecret, rpcUrl = DEFAULT_RPC_URL, cluster = 'devnet' }: SolanaConfig) => {
  const enabled = Boolean(programIdText && minterSecret);
  const rpc = createSolanaRpc(rpcUrl);
  const programId = () => address(programIdText);
  let minter: Promise<KeyPairSigner> | null = null;
  let feePayer: Promise<KeyPairSigner> | null = null;
  const minterKey = () => (minter ??= keypairFromSecret(minterSecret));
  const feePayerKey = () => (feePayer ??= feePayerSecret ? keypairFromSecret(feePayerSecret) : minterKey());

  const accountData = async (account: Address) => {
    const { value } = await rpc.getAccountInfo(account, { encoding: 'base64', commitment: 'confirmed' }).send();
    if (!value || value.owner !== programId()) return null;
    return new Uint8Array(base64.encode(value.data[0]));
  };

  const readProduct = async (code: string): Promise<OnChainProduct | null> => {
    const data = await accountData(await productAddress(programId(), code));
    return data ? decodeProduct(data) : null;
  };

  const requireProduct = async (code: string) => {
    const product = await readProduct(code);
    if (!product) throw new HttpError(409, 'Este producto no está registrado en el programa de Solana.');
    return product;
  };

  const readConfig = async () => {
    const data = await accountData(await configAddress(programId()));
    return data ? decodeConfig(data) : null;
  };

  // Message with the server as fee payer, so a user holding no SOL can still use the program.
  // With a blockhash it rebuilds the message of an existing transaction (the block height is not part of the bytes).
  const compile = async (instructionList: Instruction[], blockhash?: Blockhash) => {
    const payer = (await feePayerKey()).address;
    const lifetime = blockhash
      ? { blockhash, lastValidBlockHeight: 0n }
      : (await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send()).value;
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayer(payer, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(lifetime, tx),
      (tx) => appendTransactionMessageInstructions(instructionList, tx)
    );
    return compileTransaction(message);
  };

  const waitForSignature = async (signature: string, what: string) => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const { value } = await rpc.getSignatureStatuses([signature as Parameters<typeof rpc.getSignatureStatuses>[0][number]]).send();
      const status = value[0];
      if (status?.err) throw failure(status.err, what);
      if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') return;
      await sleep(1500);
    }
    throw new Error(`Solana no confirmó la transacción ${signature} a tiempo.`);
  };

  const send = async (tx: Transaction, what: string) => {
    const wire = getBase64EncodedWireTransaction(tx);
    try {
      await rpc.sendTransaction(wire, { encoding: 'base64', preflightCommitment: 'confirmed' }).send();
    } catch (error) {
      // A failed preflight carries the transaction error, with the program's code.
      const cause = (error as { context?: { err?: unknown } }).context;
      throw cause?.err ? failure(cause.err, what) : error;
    }
    // The fee payer's signature is the transaction id, shown base58-encoded.
    const feePayerSignature = tx.signatures[(await feePayerKey()).address];
    if (!feePayerSignature) throw new Error('Falta la firma del pagador de comisiones.');
    const id = getBase58Decoder().decode(feePayerSignature);
    await waitForSignature(id, what);
    return id;
  };

  // Runs the program's checks before anyone signs, so a wrong QR or link fails with its message.
  const simulate = async (tx: Transaction, what: string) => {
    const { value } = await rpc.simulateTransaction(getBase64EncodedWireTransaction(tx), {
      encoding: 'base64', sigVerify: false, replaceRecentBlockhash: false, commitment: 'confirmed'
    }).send();
    if (value.err) throw failure(value.err, what);
  };

  // Transactions the server signs alone (registering products).
  const submitServerCall = async (instructionList: Instruction[], signers: KeyPairSigner[], what: string) => {
    const tx = await compile(instructionList);
    const signed = await partiallySignTransaction([...new Set([await feePayerKey(), ...signers])].map((signer) => signer.keyPair), tx);
    return send(signed, what);
  };

  // Unsigned transaction for a user's wallet, already simulated.
  const buildUserCall = async (instructionList: Instruction[], what: string) => {
    const tx = await compile(instructionList);
    await simulate(tx, what);
    return getBase64EncodedWireTransaction(tx);
  };

  // A transaction the user's wallet signed. Its message must be exactly the one the server would build for this call
  // with the same blockhash (only the signature instruction is taken from it, and the program checks that one), so
  // the fee payer never signs anything else. Then the server adds its signature as fee payer and sends it.
  const submitUserCall = async (
    signedTx: string,
    user: Address,
    expected: (signatureInstruction: Instruction | null) => Promise<Instruction[]>,
    what: string
  ) => {
    let tx: Transaction;
    try {
      tx = getTransactionDecoder().decode(base64.encode(signedTx as Base64EncodedWireTransaction));
    } catch {
      throw invalidSignedCall();
    }
    const compiled = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
    const message = decompileTransactionMessage(compiled);
    const first = message.instructions[0];
    // One signature only: the fee payer also pays per signature the native program checks.
    const signatureInstruction = first && first.programAddress === ED25519_PROGRAM && !first.accounts?.length && first.data?.[0] === 1
      ? (first as Instruction)
      : null;
    const rebuilt = await compile(await expected(signatureInstruction), compiled.lifetimeToken as Blockhash);
    if (!Buffer.from(rebuilt.messageBytes).equals(Buffer.from(tx.messageBytes))) throw invalidSignedCall();
    const userSignature = tx.signatures[user];
    if (!userSignature || !(await verifySignature(await getPublicKeyFromAddress(user), signatureBytes(userSignature), tx.messageBytes))) {
      throw invalidSignedCall();
    }
    const signed = await partiallySignTransaction([(await feePayerKey()).keyPair], tx);
    // A transaction that fails on-chain still costs its fee: run it once more before paying for it.
    await simulate(signed, what);
    return send(signed, what);
  };

  const productArgs = (product: ProductToMint): ProductArgs => ({
    publicCode: product.token,
    model: product.model,
    lot: product.lot,
    destination: product.destination,
    activationKey: activationKeyFor(product.secretCode)
  });

  const assertOwnedBy = async (code: string, owner: Address) => {
    if ((await requireProduct(code)).owner !== owner) throw new HttpError(409, messages.notOwner);
  };

  const signatureFor = (key: Uint8Array, signature: Uint8Array, message: Uint8Array) => ed25519Instruction(key, signature, message);

  return {
    rpc,
    enabled,
    cluster,
    programId: programIdText,
    readProduct,
    readConfig,
    explorerTxUrl: (signature: string) => explorerTxUrl(signature, cluster),
    productAddress: (code: string) => productAddress(programId(), code),

    // Registers a sealed product. Answers with the program's token id and the transaction signature.
    mintProduct: async (product: ProductToMint) => {
      const signer = await minterKey();
      const instruction = await instructions.mintProduct(programId(), signer.address, (await feePayerKey()).address, productArgs(product));
      const mintTx = await submitServerCall([instruction], [signer], 'El registro del producto');
      const registered = await requireProduct(product.token);
      return { tokenId: registered.tokenId, mintTx };
    },

    // Carries over an activated product with its owner. Signed by the admin key, which the migration script loads
    // locally: it is not part of the server's configuration.
    importClaimedProduct: async (product: ProductToMint, owner: Address, admin: KeyPairSigner) => {
      const instruction = await instructions.importClaimedProduct(programId(), admin.address, (await feePayerKey()).address, productArgs(product), owner);
      const mintTx = await submitServerCall([instruction], [admin], 'La importación del producto');
      const registered = await requireProduct(product.token);
      return { tokenId: registered.tokenId, mintTx };
    },

    // Bytes the activation key signs in the browser. No network call: they only bind program, product and claimant.
    activationMessage: async (code: string, claimant: Address) =>
      Buffer.from(activationMessage(programId(), await productAddress(programId(), code), claimant)),

    buildActivation: async ({ code, claimant, signature }: { code: string; claimant: Address; signature: Uint8Array }) => {
      const product = await requireProduct(code);
      if (product.claimed) throw new HttpError(409, messages.alreadyClaimedOnChain);
      const account = await productAddress(programId(), code);
      return buildUserCall([
        signatureFor(product.activationKey, signature, activationMessage(programId(), account, claimant)),
        instructions.activateProduct(programId(), account, claimant)
      ], 'La activación');
    },

    // Returns the signature once the program shows the new owner.
    submitActivation: async ({ code, claimant, signedTx }: { code: string; claimant: Address; signedTx: string }) => {
      const account = await productAddress(programId(), code);
      const signature = await submitUserCall(signedTx, claimant, async (signed) => {
        if (!signed) throw invalidSignedCall();
        return [signed, instructions.activateProduct(programId(), account, claimant)];
      }, 'La activación');
      if ((await requireProduct(code)).owner !== claimant) throw new Error(`La transacción ${signature} no dejó la garantía a nombre de ${claimant}.`);
      return signature;
    },

    // The owner opens a transfer link: only the public key of its secret reaches the program.
    buildTransferOffer: async ({ code, owner, transferKey }: { code: string; owner: Address; transferKey: Uint8Array }) => {
      await assertOwnedBy(code, owner);
      const account = await productAddress(programId(), code);
      return buildUserCall([await instructions.offerTransfer(programId(), account, owner, transferKey)], 'El link de transferencia');
    },

    submitTransferOffer: async ({ code, owner, transferKey, signedTx }: { code: string; owner: Address; transferKey: Uint8Array; signedTx: string }) => {
      const account = await productAddress(programId(), code);
      const signature = await submitUserCall(signedTx, owner, async () => [await instructions.offerTransfer(programId(), account, owner, transferKey)], 'El link de transferencia');
      const offered = (await requireProduct(code)).transferKey;
      if (!offered || !Buffer.from(offered).equals(Buffer.from(transferKey))) throw new Error(`La transacción ${signature} no abrió el link de transferencia.`);
      return signature;
    },

    buildTransferCancel: async ({ code, owner }: { code: string; owner: Address }) => {
      await assertOwnedBy(code, owner);
      const account = await productAddress(programId(), code);
      return buildUserCall([await instructions.cancelTransfer(programId(), account, owner)], 'La cancelación del link');
    },

    submitTransferCancel: async ({ code, owner, signedTx }: { code: string; owner: Address; signedTx: string }) => {
      const account = await productAddress(programId(), code);
      const signature = await submitUserCall(signedTx, owner, async () => [await instructions.cancelTransfer(programId(), account, owner)], 'La cancelación del link');
      if ((await requireProduct(code)).transferKey) throw new Error(`La transacción ${signature} no cerró el link de transferencia.`);
      return signature;
    },

    // [expires_at, last_offer_at] of the product's transfer link, in unix seconds (0 when there is none).
    transferTimes: async (code: string) => {
      const product = await requireProduct(code);
      return [product.transferExpiresAt, product.lastOfferAt] as [number, number];
    },

    // Bytes the transfer key signs in the recipient's browser.
    transferMessage: async (code: string, recipient: Address) =>
      Buffer.from(transferMessage(programId(), await productAddress(programId(), code), recipient)),

    buildTransferAccept: async ({ code, recipient, signature }: { code: string; recipient: Address; signature: Uint8Array }) => {
      const product = await requireProduct(code);
      if (!product.transferKey) throw new HttpError(409, messages.linkClosed);
      if (product.owner === recipient) throw new HttpError(409, messages.alreadyYours);
      const account = await productAddress(programId(), code);
      try {
        return await buildUserCall([
          signatureFor(product.transferKey, signature, transferMessage(programId(), account, recipient)),
          instructions.acceptTransfer(programId(), account, recipient)
        ], 'La transferencia');
      } catch (error) {
        // The program's signature check fails the same way for a QR and for a link: name the link here.
        if (error instanceof HttpError && error.message === messages.invalidSignature) {
          throw new HttpError(409, 'La firma del link de transferencia no corresponde a este producto.');
        }
        throw error;
      }
    },

    submitTransferAccept: async ({ code, recipient, signedTx }: { code: string; recipient: Address; signedTx: string }) => {
      const account = await productAddress(programId(), code);
      const signature = await submitUserCall(signedTx, recipient, async (signed) => {
        if (!signed) throw invalidSignedCall();
        return [signed, instructions.acceptTransfer(programId(), account, recipient)];
      }, 'La transferencia');
      if ((await requireProduct(code)).owner !== recipient) throw new Error(`La transacción ${signature} no dejó el producto a nombre de ${recipient}.`);
      return signature;
    }
  };
};

export interface ProductToMint {
  token: string;
  model: string;
  lot: string;
  destination: string;
  secretCode: string;
}

export type SolanaClient = ReturnType<typeof createSolanaClient>;
