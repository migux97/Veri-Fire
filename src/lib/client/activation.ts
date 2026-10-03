// Warranty activation from the buyer's panel.
// The secret QR becomes an ed25519 key here (same derivation as the contract and the Solana program). The
// browser signs the activation with it and sends only the public key and the signature: the secret never leaves the page.
import { ACTIVATION_DOMAIN } from '../activation';
import type { ClaimPreview, PreparedClaim, UnsignedTransaction, Warranty } from '../types';
import { ApiError, postJson } from './api';
import { base64ToBytes, base64UrlToBytes, bytesToBase64, bytesToHex } from './bytes';
import type { ScannedClaim } from '../qr-codes';
import { chainLabel, walletLabel } from './chain';
import { connectSigner, type Progress } from './signer';

export type { Progress };

export interface SigningKey {
  privateKey: CryptoKey;
  // Hex of the raw 32-byte public key.
  publicKey: string;
}

// PKCS#8 header for a raw 32-byte Ed25519 private key, which WebCrypto cannot import as "raw".
const ED25519_PKCS8_HEADER = [0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20];

// Same decoding as secretFromQrKey + normalizeId on the server.
const secretFromClaim = (claim: ScannedClaim) => {
  try {
    if ('secret' in claim) return claim.secret.trim().toUpperCase();
    if (claim.qr.startsWith('.')) return new TextDecoder().decode(base64UrlToBytes(claim.qr.slice(1))).trim().toUpperCase();
    const bytes = base64UrlToBytes(claim.qr);
    return bytes.length === 10 ? `VF-SECRET-${bytesToHex(bytes).toUpperCase()}` : '';
  } catch {
    return '';
  }
};

// seed = sha256("<domain>:" + secret), the same derivation as the contract. Used for the secret QR and transfer links.
export const deriveSigningKey = async (domain: string, secret: string): Promise<SigningKey> => {
  if (!window.crypto?.subtle) throw new Error('Abrí Verifire con https:// o desde localhost para usar tu wallet.');
  const seed = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${domain}:${secret}`)));
  try {
    const privateKey = await crypto.subtle.importKey('pkcs8', new Uint8Array([...ED25519_PKCS8_HEADER, ...seed]), { name: 'Ed25519' }, true, ['sign']);
    const { x = '' } = await crypto.subtle.exportKey('jwk', privateKey);
    return { privateKey, publicKey: bytesToHex(base64UrlToBytes(x)) };
  } catch {
    throw new Error('Este navegador no puede firmar con claves ed25519. Actualizalo o probá con una versión reciente de Chrome, Edge, Firefox o Safari.');
  }
};

export const signWith = async (key: SigningKey, messageBase64: string) =>
  bytesToBase64(new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, key.privateKey, base64ToBytes(messageBase64))));

// What the product behind a scanned secret QR looks like, before activating it. Null for a QR that does not lead to a
// product with a key (the seed product): there is nothing to preview and it cannot be shown on the home page.
export const previewClaim = async (claim: ScannedClaim): Promise<ClaimPreview | null> => {
  const secret = secretFromClaim(claim);
  if (!secret) return null;
  try {
    const activation = await deriveSigningKey(ACTIVATION_DOMAIN, secret);
    return await postJson<ClaimPreview>('/api/warranties/preview', { activationKey: activation.publicKey }, 'No se pudo consultar el producto.');
  } catch {
    // Without the preview the activation itself still works: it only lacks the choice of the home page.
    return null;
  }
};

const activateOnChain = async (
  appId: string,
  activation: SigningKey,
  owner: string,
  prepared: Extract<PreparedClaim, { onChain: true }>,
  showcase: boolean,
  onProgress: Progress
) => {
  const request = { activationKey: activation.publicKey, owner };
  const wallet = await connectSigner(appId, owner, onProgress);
  await wallet.prepare(onProgress);
  const signature = await signWith(activation, prepared.message);
  const unsigned = await postJson<UnsignedTransaction>('/api/warranties/transaction', { ...request, signature }, `No se pudo preparar la activación en ${chainLabel()}.`);
  onProgress(`Autorizando la activación con ${walletLabel()}...`);
  const signedTx = await wallet.signTransaction(unsigned.tx);
  onProgress(`Registrando tu garantía en ${chainLabel()}. Puede tardar unos segundos...`);
  return postJson<Warranty>('/api/warranties', { ...request, signedTx, showcase }, `No se pudo registrar la activación en ${chainLabel()}.`);
};

// Uses the contract when the server has one. Without it, or for the seed product that has no secret code (the server
// does not know its key and answers 404), falls back to the demo claim stored only in the server.
// showcase: the buyer agreed to show the product on the home page (the server ignores it without a photo).
export const activateWarranty = async (appId: string, claim: ScannedClaim, owner: string, showcase: boolean, onProgress: Progress) => {
  const secret = secretFromClaim(claim);
  if (secret) {
    const activation = await deriveSigningKey(ACTIVATION_DOMAIN, secret);
    let prepared: PreparedClaim | null = null;
    try {
      prepared = await postJson<PreparedClaim>('/api/warranties/prepare', { activationKey: activation.publicKey, owner }, 'No se pudo preparar la activación.');
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) throw error;
    }
    if (prepared?.onChain) return activateOnChain(appId, activation, owner, prepared, showcase, onProgress);
  }
  return postJson<Warranty>('/api/warranties', { ...claim, owner, showcase }, 'No se pudo activar la garantía.');
};
