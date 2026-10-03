// ed25519 keys derived from a printed secret or a transfer link: seed = sha256("<domain>:" + secret), the same
// derivation as the browser (src/lib/client/activation.ts) and the Stellar contract, so the QR already printed keep
// working on Solana. Only the server and scripts import this file.
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { ACTIVATION_DOMAIN } from '../activation.ts';

// PKCS#8 header for a raw 32-byte Ed25519 private key.
const ED25519_PKCS8_HEADER = Buffer.from('302e020100300506032b657004220420', 'hex');

const privateKeyFromSeed = (seed: Uint8Array) =>
  createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_HEADER, seed]), format: 'der', type: 'pkcs8' });

const seedFor = (domain: string, secret: string) => createHash('sha256').update(`${domain}:${secret}`, 'utf8').digest();

/** Raw 32-byte public key of a 32-byte ed25519 seed. */
export const publicKeyOfSeed = (seed: Uint8Array): Buffer =>
  createPublicKey(privateKeyFromSeed(seed)).export({ format: 'der', type: 'spki' }).subarray(12);

// Public key derived from the secret inside the package; only this key is registered on-chain.
export const activationKeyFor = (secret: string): Buffer => publicKeyOfSeed(seedFor(ACTIVATION_DOMAIN, secret));

/** Signature of `message` with the key derived from `secret` (what the browser does with WebCrypto). */
export const signWithSecret = (domain: string, secret: string, message: Uint8Array): Buffer =>
  sign(null, message, privateKeyFromSeed(seedFor(domain, secret)));
