// The blockchain that certifies products, behind one interface so claims, transfers and registration work the same on
// Stellar (stellar.ts) and on Solana (solana.ts). CHAIN picks one (see chain-kind.ts).
//
// Every call that changes a product on behalf of a user goes in two requests: build answers the unsigned transaction
// for the user's wallet, and submit takes it back signed, checks it is exactly that call, pays its fee and sends it.
// Stellar transactions travel as XDR and Solana ones as base64 wire transactions: both are just `tx` strings here.
import { isStellarAddress } from '../validation';
import type { ChainKind } from './chain-kind';
import { createSolanaClient, isSolanaAddress, isTxSignature, explorerTxUrl as solanaTxUrl, type SolanaConfig } from './solana';
import { activationKeyFor, createStellarClient, explorerTxUrl as stellarTxUrl, isTxHash, type StellarConfig } from './stellar';

// A registered product: Stellar addresses it by the contract's token id, Solana by its public code (its PDA seed).
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
  kind: ChainKind;
  // As people read it in messages.
  label: string;
  enabled: boolean;
  // Contract (Stellar) or program (Solana) this server registers products in.
  deploymentId: string;
  isAddress: (value: unknown) => value is string;
  isTxId: (value: unknown) => value is string;
  explorerTxUrl: (tx: string) => string;
  // Stellar only: an existing account the Cavos kit pays 1 stroop to when it creates a user's account.
  feeAccount: () => string | undefined;
  activationKeyFor: (secret: string) => Buffer;
  productByCode: (code: string) => Promise<{ tokenId: number; activationKey: Buffer } | null>;
  readProduct: (ref: ProductRef) => Promise<LedgerProduct>;
  mintProduct: (product: ProductToRegister) => Promise<{ tokenId: number; mintTx: string }>;
  // Solana keeps the admin key off the server: importing owners is done by the migration script, not here.
  importClaimedProduct: ((product: ProductToRegister, owner: string) => Promise<{ tokenId: number; mintTx: string }>) | null;
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

export const stellarLedger = (config: StellarConfig): Ledger => {
  const client = createStellarClient(config);
  return {
    kind: 'stellar',
    label: 'Stellar',
    enabled: client.enabled,
    deploymentId: config.contractId,
    isAddress: isStellarAddress,
    isTxId: isTxHash,
    explorerTxUrl: stellarTxUrl,
    feeAccount: () => client.issuerAddress(),
    activationKeyFor,
    productByCode: client.productByCode,
    readProduct: async ({ tokenId }) => {
      const product = await client.readProduct(tokenId);
      return { claimed: product.claimed, owner: product.owner, transferKey: product.transfer_key };
    },
    mintProduct: client.mintProduct,
    importClaimedProduct: client.importClaimedProduct,
    activationMessage: ({ tokenId }, claimant) => client.activationMessage(tokenId, claimant),
    buildActivation: ({ ref, claimant, signature }) => client.buildActivation({ tokenId: ref.tokenId, claimant, signature }),
    submitActivation: ({ ref, claimant, signedTx }) => client.submitActivation({ tokenId: ref.tokenId, claimant, signedXdr: signedTx }),
    buildTransferOffer: ({ ref, owner, transferKey }) => client.buildTransferOffer({ tokenId: ref.tokenId, owner, transferKey }),
    submitTransferOffer: ({ ref, owner, transferKey, signedTx }) =>
      client.submitTransferOffer({ tokenId: ref.tokenId, owner, transferKey, signedXdr: signedTx }),
    buildTransferCancel: ({ ref, owner }) => client.buildTransferCancel({ tokenId: ref.tokenId, owner }),
    submitTransferCancel: ({ ref, owner, signedTx }) => client.submitTransferCancel({ tokenId: ref.tokenId, owner, signedXdr: signedTx }),
    transferMessage: ({ tokenId }, recipient) => client.transferMessage(tokenId, recipient),
    buildTransferAccept: ({ ref, recipient, signature }) => client.buildTransferAccept({ tokenId: ref.tokenId, recipient, signature }),
    submitTransferAccept: ({ ref, recipient, signedTx }) => client.submitTransferAccept({ tokenId: ref.tokenId, recipient, signedXdr: signedTx })
  };
};

export const solanaLedger = (config: SolanaConfig): Ledger => {
  const client = createSolanaClient(config);
  // Addresses reach here already checked with isAddress.
  const solana = (value: string) => value as Parameters<typeof client.activationMessage>[1];
  const cluster = client.cluster;
  return {
    kind: 'solana',
    label: 'Solana',
    enabled: client.enabled,
    deploymentId: config.programId,
    isAddress: isSolanaAddress,
    isTxId: (value: unknown): value is string => isTxSignature(value),
    explorerTxUrl: (tx) => solanaTxUrl(tx, cluster),
    feeAccount: () => undefined,
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
    importClaimedProduct: null,
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
