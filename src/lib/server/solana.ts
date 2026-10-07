// Access to the VeriFire program on Solana (solana/programs/verifire_product): the server registers products, and
// builds the transactions a user's wallet signs, paying their fees. Holds the minter key: never import it in the browser.
// A batch is registered as one account holding the Merkle root of its units, so a sealed product takes no account of its
// own. Activating one creates its certificate (PDA by public code), with a proof that the unit is in its batch.
import {
  address, appendTransactionMessageInstructions, compileTransaction, createKeyPairSignerFromBytes, createSolanaRpc,
  createTransactionMessage, decompileTransactionMessage, getBase58Decoder, getBase58Encoder, getBase64EncodedWireTransaction,
  getBase64Encoder, getCompiledTransactionMessageDecoder, getPublicKeyFromAddress, getTransactionDecoder, isAddress,
  partiallySignTransaction, pipe, setTransactionMessageFeePayer, setTransactionMessageLifetimeUsingBlockhash,
  signatureBytes, verifySignature,
  type Address, type Base64EncodedWireTransaction, type Blockhash, type Instruction, type KeyPairSigner, type Signature, type Transaction
} from '@solana/kit';
import { fetchMint, findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { HttpError } from './errors.ts';
import { messages } from './messages.ts';
import {
  ED25519_PROGRAM, activationMessage, batchAddress, certificateAddress, configAddress, decodeBatch, decodeCertificate, decodeConfig,
  ed25519Instruction, instructions, leafHash, merkleTree, programErrorName, transferMessage, type OnChainBatch, type OnChainCertificate,
  type ProgramError
} from './solana-program.ts';
import { activationKeyFor } from './solana-keys.ts';

export { activationKeyFor };

const DEFAULT_RPC_URL = 'https://api.devnet.solana.com';
// Each proof adds 32 bytes per level to the activation transaction, which must fit in 1232 bytes with the signature
// instruction: 4096 units (12 levels) take 1115. Purchases are capped well below (MAX_QUANTITY in purchases.ts). Must
// match MAX_BATCH_UNITS in the program.
const MAX_BATCH_UNITS = 4096;

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
  InvalidSignature: messages.invalidSignature,
  InvalidProof: messages.qrNotFound
};

// Transaction errors arrive as { InstructionError: [index, { Custom: code }] }; the program's own codes become
// messages safe to show to the client.
export const programErrorOf = (error: unknown): ProgramError | null => {
  const detail = (error as { InstructionError?: [number, unknown] } | null)?.InstructionError?.[1];
  const custom = (detail as { Custom?: number | bigint } | null)?.Custom;
  return custom === undefined ? null : programErrorName(Number(custom));
};

// A transaction is valid for about a minute after the server builds it. When the user takes longer to approve it in the
// wallet, its blockhash is gone: nothing happened on-chain and the user only has to try again.
const EXPIRED = 'Pasó más de un minuto antes de aprobar la transacción y venció. No se registró nada: volvé a intentarlo y aprobala apenas aparezca.';

const failure = (error: unknown, what: string): Error => {
  const name = programErrorOf(error);
  const message = name ? programMessages[name] : undefined;
  if (message) return new HttpError(409, message);
  if (JSON.stringify(error ?? '').includes('BlockhashNotFound')) return new HttpError(409, EXPIRED, { retryable: true });
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

  // Null while the product is sealed: only an activated product has a certificate.
  const readCertificate = async (code: string): Promise<OnChainCertificate | null> => {
    const data = await accountData(await certificateAddress(programId(), code));
    return data ? decodeCertificate(data) : null;
  };

  const readBatch = async (batchCode: string): Promise<OnChainBatch | null> => {
    const data = await accountData(await batchAddress(programId(), batchCode));
    return data ? decodeBatch(data) : null;
  };

  const requireCertificate = async (code: string) => {
    const certificate = await readCertificate(code);
    if (!certificate) throw new HttpError(409, messages.notOwner);
    return certificate;
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

  const assertOwnedBy = async (code: string, owner: Address) => {
    if ((await requireCertificate(code)).owner !== owner) throw new HttpError(409, messages.notOwner);
  };

  const certificateOf = (code: string) => certificateAddress(programId(), code);

  const activationInstruction = async (unit: UnitOnChain, claimant: Address) =>
    instructions.activateProduct(programId(), await batchAddress(programId(), unit.batchCode), claimant, (await feePayerKey()).address, {
      publicCode: unit.code, index: unit.index, activationKey: unit.activationKey, proof: unit.proof
    });

  const signatureFor = (key: Uint8Array, signature: Uint8Array, message: Uint8Array) => ed25519Instruction(key, signature, message);

  // Decimals of each token mint, read once.
  const decimals = new Map<string, Promise<number>>();
  const decimalsOf = (mint: Address) => {
    if (!decimals.has(mint)) decimals.set(mint, fetchMint(rpc, mint).then((account) => account.data.decimals));
    return decimals.get(mint) as Promise<number>;
  };

  // What the recipient received in each confirmed transaction, read once: the treasury's history is checked on every poll.
  const received = new Map<string, Promise<bigint>>();
  const receivedIn = (signature: string, recipient: Address, mint: Address) => {
    const key = `${signature}:${recipient}:${mint}`;
    if (!received.has(key)) {
      const amount = rpc.getTransaction(signature as Signature, { commitment: 'confirmed', encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }).send()
        .then((tx) => (tx?.meta && !tx.meta.err ? receivedBy(tx.meta, recipient, mint) : 0n));
      // A failed read is not remembered: the next poll asks again.
      received.set(key, amount.catch((error: unknown) => {
        received.delete(key);
        throw error;
      }));
    }
    return received.get(key) as Promise<bigint>;
  };

  return {
    rpc,
    enabled,
    cluster,
    programId: programIdText,
    readCertificate,
    readBatch,
    readConfig,
    explorerTxUrl: (signature: string) => explorerTxUrl(signature, cluster),
    certificateAddress: certificateOf,

    // Registers a sealed batch: one account with the Merkle root of its units, in this order. Answers with the token id
    // of the first unit (the rest follow in order) and the transaction signature.
    registerBatch: async (batch: BatchToRegister) => {
      const signer = await minterKey();
      if (batch.units.length > MAX_BATCH_UNITS) throw new Error(`Un lote tiene como máximo ${MAX_BATCH_UNITS} unidades.`);
      const { root } = merkleTree(batch.units.map((unit, index) => leafHash(index, activationKeyFor(unit.secretCode), unit.token)));
      const instruction = await instructions.registerBatch(programId(), signer.address, (await feePayerKey()).address, {
        batchCode: batch.batchCode, root, count: batch.units.length, model: batch.model, lot: batch.lot, destination: batch.destination
      });
      const tx = await submitServerCall([instruction], [signer], 'El registro del lote');
      const registered = await readBatch(batch.batchCode);
      if (!registered || !Buffer.from(registered.root).equals(Buffer.from(root))) throw new Error(`La transacción ${tx} no registró el lote ${batch.batchCode}.`);
      return { firstTokenId: registered.firstTokenId, tx };
    },

    // Creates the certificate of an activated product with its owner. Signed by the admin key, which a migration script
    // loads locally: it is not part of the server's configuration.
    importClaimedProduct: async (code: string, owner: Address, admin: KeyPairSigner) => {
      const instruction = await instructions.importClaimedProduct(programId(), admin.address, (await feePayerKey()).address, code, owner);
      const tx = await submitServerCall([instruction], [admin], 'La importación del producto');
      return { tokenId: (await requireCertificate(code)).tokenId, tx };
    },

    // Bytes the activation key signs in the browser. No network call: they only bind program, certificate and claimant.
    activationMessage: async (code: string, claimant: Address) =>
      Buffer.from(activationMessage(programId(), await certificateOf(code), claimant)),

    buildActivation: async ({ unit, claimant, signature }: { unit: UnitOnChain; claimant: Address; signature: Uint8Array }) => {
      if (await readCertificate(unit.code)) throw new HttpError(409, messages.alreadyClaimedOnChain);
      return buildUserCall([
        signatureFor(unit.activationKey, signature, activationMessage(programId(), await certificateOf(unit.code), claimant)),
        await activationInstruction(unit, claimant)
      ], 'La activación');
    },

    // Returns the signature once the program shows the new owner.
    submitActivation: async ({ unit, claimant, signedTx }: { unit: UnitOnChain; claimant: Address; signedTx: string }) => {
      const signature = await submitUserCall(signedTx, claimant, async (signed) => {
        if (!signed) throw invalidSignedCall();
        return [signed, await activationInstruction(unit, claimant)];
      }, 'La activación');
      if ((await readCertificate(unit.code))?.owner !== claimant) throw new Error(`La transacción ${signature} no dejó la garantía a nombre de ${claimant}.`);
      return signature;
    },

    // The owner opens a transfer link: only the public key of its secret reaches the program.
    buildTransferOffer: async ({ code, owner, transferKey }: { code: string; owner: Address; transferKey: Uint8Array }) => {
      await assertOwnedBy(code, owner);
      const account = await certificateOf(code);
      return buildUserCall([await instructions.offerTransfer(programId(), account, owner, transferKey)], 'El link de transferencia');
    },

    submitTransferOffer: async ({ code, owner, transferKey, signedTx }: { code: string; owner: Address; transferKey: Uint8Array; signedTx: string }) => {
      const account = await certificateOf(code);
      const signature = await submitUserCall(signedTx, owner, async () => [await instructions.offerTransfer(programId(), account, owner, transferKey)], 'El link de transferencia');
      const offered = (await requireCertificate(code)).transferKey;
      if (!offered || !Buffer.from(offered).equals(Buffer.from(transferKey))) throw new Error(`La transacción ${signature} no abrió el link de transferencia.`);
      return signature;
    },

    buildTransferCancel: async ({ code, owner }: { code: string; owner: Address }) => {
      await assertOwnedBy(code, owner);
      const account = await certificateOf(code);
      return buildUserCall([await instructions.cancelTransfer(programId(), account, owner)], 'La cancelación del link');
    },

    submitTransferCancel: async ({ code, owner, signedTx }: { code: string; owner: Address; signedTx: string }) => {
      const account = await certificateOf(code);
      const signature = await submitUserCall(signedTx, owner, async () => [await instructions.cancelTransfer(programId(), account, owner)], 'La cancelación del link');
      if ((await requireCertificate(code)).transferKey) throw new Error(`La transacción ${signature} no cerró el link de transferencia.`);
      return signature;
    },

    // Bytes the transfer key signs in the recipient's browser.
    transferMessage: async (code: string, recipient: Address) =>
      Buffer.from(transferMessage(programId(), await certificateOf(code), recipient)),

    buildTransferAccept: async ({ code, recipient, signature }: { code: string; recipient: Address; signature: Uint8Array }) => {
      const product = await requireCertificate(code);
      if (!product.transferKey) throw new HttpError(409, messages.linkClosed);
      if (product.owner === recipient) throw new HttpError(409, messages.alreadyYours);
      const account = await certificateOf(code);
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
      const account = await certificateOf(code);
      const signature = await submitUserCall(signedTx, recipient, async (signed) => {
        if (!signed) throw invalidSignedCall();
        return [signed, instructions.acceptTransfer(programId(), account, recipient)];
      }, 'La transferencia');
      if ((await requireCertificate(code)).owner !== recipient) throw new Error(`La transacción ${signature} no dejó el producto a nombre de ${recipient}.`);
      return signature;
    },

    // Solana Pay (https://docs.solanapay.com): the payer's wallet sends a token transfer to the treasury that carries the
    // purchase's reference key as an extra read-only account, so the payment is found by that key whichever wallet sent it.
    tokenDecimals: (mint: Address) => decimalsOf(mint),

    // The signature of a confirmed transaction that carries the reference and moved at least `amount` of the token to
    // the recipient's wallet, or null when there is none yet.
    findPayment: async ({ recipient, mint, amount, reference }: Omit<TokenPayment, 'payer'>) => {
      const found = await rpc.getSignaturesForAddress(reference, { commitment: 'confirmed', limit: 20 }).send();
      for (const { signature, err } of found) {
        if (err) continue;
        const tx = await rpc.getTransaction(signature, { commitment: 'confirmed', encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }).send();
        if (!tx?.meta || tx.meta.err) continue;
        if (receivedBy(tx.meta, recipient, mint) >= amount) return signature as string;
      }
      return null;
    },

    // A transfer made by hand carries no reference: it is recognized by its exact amount. The signature of a confirmed
    // transaction after `since` (unix seconds) that moved exactly `amount` of the token to the recipient's wallet and is
    // not in `used` (payments other purchases already took), or null when there is none yet.
    findExactTransfer: async ({ recipient, mint, amount, since, used }: { recipient: Address; mint: Address; amount: bigint; since: number; used: Set<string> }) => {
      const [tokenAccount] = await findAssociatedTokenPda({ owner: recipient, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
      const found = await rpc.getSignaturesForAddress(tokenAccount, { commitment: 'confirmed', limit: 50 }).send();
      for (const { signature, err, blockTime } of found) {
        // Newest first: everything after this one is older than the purchase.
        if (blockTime !== null && Number(blockTime) < since) break;
        if (err || used.has(signature)) continue;
        if ((await receivedIn(signature, recipient, mint)) === amount) return signature as string;
      }
      return null;
    }
  };

};

export interface TokenPayment {
  payer: Address;
  recipient: Address;
  mint: Address;
  // In the token's base units (USDC has 6 decimals).
  amount: bigint;
  reference: Address;
}

interface TokenBalance {
  owner?: string;
  mint: string;
  uiTokenAmount: { amount: string };
}

// How much of `mint` the wallet `owner` received in a transaction, in base units.
export const receivedBy = (meta: { preTokenBalances?: readonly TokenBalance[] | null; postTokenBalances?: readonly TokenBalance[] | null }, owner: string, mint: string) => {
  const total = (balances: readonly TokenBalance[] | null | undefined) =>
    (balances ?? []).filter((balance) => balance.owner === owner && balance.mint === mint).reduce((sum, balance) => sum + BigInt(balance.uiTokenAmount.amount), 0n);
  return total(meta.postTokenBalances) - total(meta.preTokenBalances);
};

// A sealed batch as the program registers it: the Merkle root of its units, in this order.
export interface BatchToRegister {
  // Unique in the program: the batch account's PDA seed.
  batchCode: string;
  model: string;
  lot: string;
  destination: string;
  // In the order of their index in the batch.
  units: { token: string; secretCode: string }[];
}

// Where a sealed unit is in its registered batch, with the proof the program checks when it is activated.
export interface UnitOnChain {
  code: string;
  batchCode: string;
  index: number;
  activationKey: Uint8Array;
  proof: Uint8Array[];
}

export type SolanaClient = ReturnType<typeof createSolanaClient>;

// "12.5" with 6 decimals -> 12500000n. Digits beyond the token's decimals are dropped, never rounded up.
export const toBaseUnits = (amount: string, decimals: number) => {
  if (!/^\d+(\.\d+)?$/.test(amount)) throw new Error(`Monto inválido: ${amount}`);
  const [whole = '0', fraction = ''] = amount.split('.');
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction + '0'.repeat(decimals)).slice(0, decimals) || '0');
};
