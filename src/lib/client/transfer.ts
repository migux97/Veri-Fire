// Transfer links from the buyer's panel: the owner passes a product on, whoever opens the link accepts it.
// The link's secret becomes an ed25519 key here (TRANSFER_DOMAIN, same derivation as the contract). Only its public key
// and signatures reach the server; the secret travels only inside the link, after the #.
import { TRANSFER_DOMAIN } from '../activation';
import type { PreparedTransfer, UnsignedTransaction, Warranty } from '../types';
import { postJson } from './api';
import { deriveSigningKey, signWith, type SigningKey } from './activation';
import { bytesToBase64Url } from './bytes';
import { accountKey } from './session';
import { readStored, writeStored } from './storage';
import { connectSigner, type Progress, type Signer } from './signer';

type Step = UnsignedTransaction | { warranty: Warranty };

// token -> secret of the link this browser opened, so the owner can share it again after reloading.
const linksKey = () => accountKey('transfer-links', 'verifireTransferLinks');

const savedLinks = () => readStored<Record<string, string>>(localStorage, linksKey()) ?? {};

const saveLink = (token: string, secret: string | null) => {
  const links = savedLinks();
  if (secret) links[token] = secret;
  else delete links[token];
  writeStored(localStorage, linksKey(), links);
};

export const transferLinkUrl = (secret: string) => `${window.location.origin}/app#t=${secret}`;

// The open link of a product, if it was opened in this browser.
export const savedTransferLink = (token: string) => {
  const secret = savedLinks()[token];
  return secret ? transferLinkUrl(secret) : null;
};

// Both requests of a call the user's wallet signs: the unsigned transaction first, then the signed one.
const signedCall = async (url: string, body: Record<string, string>, wallet: Signer, fallback: string, onProgress: Progress) => {
  const unsigned = await postJson<Step>(url, body, fallback);
  if (!('tx' in unsigned)) throw new Error(fallback);
  onProgress(`Autorizando con tu wallet...`);
  const signedTx = await wallet.signTransaction(unsigned.tx);
  onProgress(`Registrando el cambio en Solana. Puede tardar unos segundos...`);
  const done = await postJson<Step>(url, { ...body, signedTx }, fallback);
  if (!('warranty' in done)) throw new Error(fallback);
  return done.warranty;
};

const connect = (address: string, onProgress: Progress) => connectSigner(address, onProgress);

// Opens a new link for the product. It replaces the previous one, which stops working.
export const offerTransfer = async (token: string, owner: string, onProgress: Progress) => {
  const secret = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(16)));
  const key = await deriveSigningKey(TRANSFER_DOMAIN, secret);
  const wallet = await connect(owner, onProgress);
  const warranty = await signedCall('/api/transfers/offer', { token, owner, transferKey: key.publicKey }, wallet, 'No se pudo abrir el link de transferencia.', onProgress);
  saveLink(token, secret);
  return { warranty, link: transferLinkUrl(secret) };
};

export const cancelTransfer = async (token: string, owner: string, onProgress: Progress) => {
  const wallet = await connect(owner, onProgress);
  const warranty = await signedCall('/api/transfers/cancel', { token, owner }, wallet, 'No se pudo cancelar la transferencia.', onProgress);
  saveLink(token, null);
  return warranty;
};

export interface IncomingTransfer extends PreparedTransfer {
  key: SigningKey;
}

// What the link offers, before the recipient accepts.
export const readTransferLink = async (secret: string, recipient: string): Promise<IncomingTransfer> => {
  const key = await deriveSigningKey(TRANSFER_DOMAIN, secret);
  const prepared = await postJson<PreparedTransfer>('/api/transfers/prepare', { transferKey: key.publicKey, recipient }, 'No se pudo leer el link de transferencia.');
  // The countdown runs on this device's clock, from the time the server says is left (older servers: its date).
  const expiresAt = Number.isFinite(prepared.expiresInMs) ? new Date(Date.now() + prepared.expiresInMs).toISOString() : prepared.expiresAt;
  return { ...prepared, expiresAt, key };
};

export const acceptTransfer = async (incoming: IncomingTransfer, recipient: string, onProgress: Progress) => {
  const wallet = await connect(recipient, onProgress);
  const signature = await signWith(incoming.key, incoming.message);
  return signedCall('/api/transfers/accept', { transferKey: incoming.key.publicKey, recipient, signature }, wallet, 'No se pudo completar la transferencia.', onProgress);
};
