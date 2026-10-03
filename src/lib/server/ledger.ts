// The VeriFire program as the rest of the server uses it: claims, transfers and registration (see solana.ts).
//
// Every call that changes a product on behalf of a user goes in two requests: build answers the unsigned transaction
// (a base64 wire transaction) for the user's wallet, and submit takes it back signed, checks it is exactly that call,
// pays its fee and sends it.
import { createSolanaClient, isSolanaAddress, isTxSignature, explorerTxUrl, type SolanaConfig } from './solana';
import { activationKeyFor } from './solana-keys';

// A registered product: the program addresses it by its public code (its PDA seed); the token id is its serial number.
export interface ProductRef {
  tokenId: number;
  code: string;
}

export interface ProductToRegister {
  token: string;
  model: string;
  lot: string;
  destination: string;
  secretCode: string;
}

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
  productByCode: (code: string) => Promise<{ tokenId: number; activationKey: Buffer } | null>;
  readProduct: (ref: ProductRef) => Promise<LedgerProduct>;
  mintProduct: (product: ProductToRegister) => Promise<{ tokenId: number; mintTx: string }>;
  activationMessage: (ref: ProductRef, claimant: string) => Promise<Buffer>;
  buildActivation: (call: { ref: ProductRef; claimant: string; signature: Uint8Array }) => Promise<string>;
  submitActivation: (call: { ref: ProductRef; claimant: string; signedTx: string }) => Promise<string>;
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
  return {
    enabled: client.enabled,
    deploymentId: config.programId,
    isAddress: isSolanaAddress,
    isTxId: (value: unknown): value is string => isTxSignature(value),
    explorerTxUrl: (tx) => explorerTxUrl(tx, client.cluster),
    activationKeyFor,
    productByCode: async (code) => {
      const product = await client.readProduct(code);
      return product ? { tokenId: product.tokenId, activationKey: Buffer.from(product.activationKey) } : null;
    },
    readProduct: async ({ code }) => {
      const product = await client.readProduct(code);
      if (!product) throw new Error(`El producto ${code} no está registrado en el programa de Solana.`);
      return { claimed: product.claimed, owner: product.owner, transferKey: product.transferKey };
    },
    mintProduct: client.mintProduct,
    activationMessage: ({ code }, claimant) => client.activationMessage(code, solana(claimant)),
    buildActivation: ({ ref, claimant, signature }) => client.buildActivation({ code: ref.code, claimant: solana(claimant), signature }),
    submitActivation: ({ ref, claimant, signedTx }) => client.submitActivation({ code: ref.code, claimant: solana(claimant), signedTx }),
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
