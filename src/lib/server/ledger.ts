// The VeriFire program as the rest of the server uses it: claims, transfers and registration (see solana.ts).
//
// Every call that changes a product on behalf of a user goes in two requests: build answers the unsigned transaction
// (a base64 wire transaction) for the user's wallet, and submit takes it back signed, checks it is exactly that call,
// pays its fee and sends it.
import { createSolanaClient, isSolanaAddress, isTxSignature, explorerTxUrl, type BatchToRegister, type SolanaConfig, type UnitOnChain } from './solana';
import { activationKeyFor } from './solana-keys';
import { leafHash, merkleTree } from './solana-program';

export type { BatchToRegister };

// A registered product: the program addresses it by its public code (its certificate's PDA seed); the token id is its
// serial number.
export interface ProductRef {
  tokenId: number;
  code: string;
}

export type BatchUnit = BatchToRegister['units'][number];

// A unit and every unit of its registered batch, in their order: what its activation proof is built from.
export interface UnitInBatch {
  batchCode: string;
  index: number;
  units: BatchUnit[];
}

// Root of the batch's Merkle tree and the proof of each unit (see merkleTree in solana-program.ts).
export const batchTree = (units: readonly BatchUnit[]) =>
  merkleTree(units.map((unit, index) => leafHash(index, activationKeyFor(unit.secretCode), unit.token)));

export interface LedgerProduct {
  claimed: boolean;
  owner: string | null;
  transferKey: Uint8Array | null;
}

export interface Ledger {
  enabled: boolean;
  // The program this server registers products in.
  deploymentId: string;
  isAddress: (value: unknown) => value is string;
  isTxId: (value: unknown) => value is string;
  explorerTxUrl: (tx: string) => string;
  activationKeyFor: (secret: string) => Buffer;
  // The registered batch with this code, or null.
  batchByCode: (batchCode: string) => Promise<{ root: Buffer; count: number; firstTokenId: number } | null>;
  // Sealed (no certificate yet) until it is activated.
  readProduct: (ref: ProductRef) => Promise<LedgerProduct>;
  registerBatch: (batch: BatchToRegister) => Promise<{ firstTokenId: number; tx: string }>;
  activationMessage: (ref: ProductRef, claimant: string) => Promise<Buffer>;
  buildActivation: (call: { ref: ProductRef; unit: UnitInBatch; claimant: string; signature: Uint8Array }) => Promise<string>;
  submitActivation: (call: { ref: ProductRef; unit: UnitInBatch; claimant: string; signedTx: string }) => Promise<string>;
  buildTransferOffer: (call: { ref: ProductRef; owner: string; transferKey: Uint8Array }) => Promise<string>;
  submitTransferOffer: (call: { ref: ProductRef; owner: string; transferKey: Uint8Array; signedTx: string }) => Promise<string>;
  buildTransferCancel: (call: { ref: ProductRef; owner: string }) => Promise<string>;
  submitTransferCancel: (call: { ref: ProductRef; owner: string; signedTx: string }) => Promise<string>;
  transferMessage: (ref: ProductRef, recipient: string) => Promise<Buffer>;
  buildTransferAccept: (call: { ref: ProductRef; recipient: string; signature: Uint8Array }) => Promise<string>;
  submitTransferAccept: (call: { ref: ProductRef; recipient: string; signedTx: string }) => Promise<string>;
}

export const solanaLedger = (config: SolanaConfig): Ledger => {
  const client = createSolanaClient(config);
  // Addresses reach here already checked with isAddress.
  const solana = (value: string) => value as Parameters<typeof client.activationMessage>[1];
  const unitOnChain = ({ code }: ProductRef, { batchCode, index, units }: UnitInBatch): UnitOnChain => {
    const unit = units[index];
    if (!unit || unit.token !== code) throw new Error(`El producto ${code} no está en la posición ${index} del lote ${batchCode}.`);
    return { code, batchCode, index, activationKey: activationKeyFor(unit.secretCode), proof: batchTree(units).proofs[index] ?? [] };
  };
  return {
    enabled: client.enabled,
    deploymentId: config.programId,
    isAddress: isSolanaAddress,
    isTxId: (value: unknown): value is string => isTxSignature(value),
    explorerTxUrl: (tx) => explorerTxUrl(tx, client.cluster),
    activationKeyFor,
    batchByCode: async (batchCode) => {
      const batch = await client.readBatch(batchCode);
      return batch ? { root: Buffer.from(batch.root), count: batch.count, firstTokenId: batch.firstTokenId } : null;
    },
    readProduct: async ({ code }) => {
      const certificate = await client.readCertificate(code);
      return certificate
        ? { claimed: true, owner: certificate.owner, transferKey: certificate.transferKey }
        : { claimed: false, owner: null, transferKey: null };
    },
    registerBatch: client.registerBatch,
    activationMessage: ({ code }, claimant) => client.activationMessage(code, solana(claimant)),
    buildActivation: ({ ref, unit, claimant, signature }) => client.buildActivation({ unit: unitOnChain(ref, unit), claimant: solana(claimant), signature }),
    submitActivation: ({ ref, unit, claimant, signedTx }) => client.submitActivation({ unit: unitOnChain(ref, unit), claimant: solana(claimant), signedTx }),
    buildTransferOffer: ({ ref, owner, transferKey }) => client.buildTransferOffer({ code: ref.code, owner: solana(owner), transferKey }),
    submitTransferOffer: ({ ref, owner, transferKey, signedTx }) =>
      client.submitTransferOffer({ code: ref.code, owner: solana(owner), transferKey, signedTx }),
    buildTransferCancel: ({ ref, owner }) => client.buildTransferCancel({ code: ref.code, owner: solana(owner) }),
    submitTransferCancel: ({ ref, owner, signedTx }) => client.submitTransferCancel({ code: ref.code, owner: solana(owner), signedTx }),
    transferMessage: ({ code }, recipient) => client.transferMessage(code, solana(recipient)),
    buildTransferAccept: ({ ref, recipient, signature }) => client.buildTransferAccept({ code: ref.code, recipient: solana(recipient), signature }),
    submitTransferAccept: ({ ref, recipient, signedTx }) => client.submitTransferAccept({ code: ref.code, recipient: solana(recipient), signedTx })
  };
};
