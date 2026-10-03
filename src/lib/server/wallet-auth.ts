// Proof that a request comes from the owner of a Solana wallet, without any password or server-side session
// (Sign-In With Solana, in its simplest form).
//
// The browser asks for a nonce, its Privy wallet signs the nonce's bytes as they are, and the browser sends the
// signature back. On Solana the key that signs is the address itself, so there is nothing to look up on-chain. Each
// nonce works once and for a few minutes, so a captured signature cannot be replayed.
import { createPublicKey, randomUUID, verify } from 'node:crypto';
import { getAddressEncoder, isAddress } from '@solana/kit';
import { isWalletAddress } from '../validation';
import { HttpError } from './errors';
import { messages } from './messages';
import { singleton } from './singleton';

const NONCE_TTL_MS = 5 * 60 * 1000;
const MAX_PENDING_NONCES = 2000;

const nonces = singleton('wallet-auth-nonces', () => new Map<string, { owner: string; until: number }>());

const dropExpired = (now: number) => {
  for (const [nonce, pending] of nonces) if (pending.until <= now) nonces.delete(nonce);
};

export const issueNonce = (owner: string): string => {
  if (!isWalletAddress(owner)) throw new HttpError(400, messages.invalidOwner);
  const now = Date.now();
  dropExpired(now);
  // Oldest first (a Map keeps insertion order): a flood of requests cannot wipe the challenges users are signing.
  for (const oldest of nonces.keys()) {
    if (nonces.size <= MAX_PENDING_NONCES) break;
    nonces.delete(oldest);
  }
  const nonce = `verifire-${randomUUID()}`;
  nonces.set(nonce, { owner, until: now + NONCE_TTL_MS });
  return nonce;
};

interface WalletProof {
  owner: string;
  nonce: string;
  // Base64, as the browser sends it.
  signature: string;
  // The key that signed: on Solana the address itself, so it may be omitted.
  publicKey?: string;
}

// SubjectPublicKeyInfo header of a raw 32-byte Ed25519 public key.
const ED25519_SPKI_HEADER = Buffer.from('302a300506032b6570032100', 'hex');

const verifies = (owner: string, message: string, signature: Buffer) => {
  if (!isAddress(owner)) return false;
  const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_HEADER, Uint8Array.from(getAddressEncoder().encode(owner))]), format: 'der', type: 'spki' });
  return verify(null, Buffer.from(message, 'utf8'), key, signature);
};

// Throws unless the signature proves that whoever sent it holds the wallet of `owner`.
export const assertWalletOwner = async ({ owner, nonce, signature, publicKey }: WalletProof) => {
  const invalid = () => new HttpError(401, 'No pudimos comprobar que esta wallet sea tuya. Volvé a intentarlo.');
  if (!isWalletAddress(owner) || (publicKey && publicKey !== owner)) throw invalid();
  const pending = nonces.get(nonce);
  // Single use: the nonce is spent whether or not the signature turns out to be good.
  nonces.delete(nonce);
  if (!pending || pending.owner !== owner || pending.until <= Date.now()) throw invalid();

  const bytes = Buffer.from(signature, 'base64');
  if (bytes.length !== 64) throw invalid();
  let valid = false;
  try {
    valid = verifies(owner, nonce, bytes);
  } catch {
    // A malformed key or signature is the same as a wrong one.
  }
  if (!valid) throw invalid();
};
