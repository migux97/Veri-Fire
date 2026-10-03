// Proof that a request comes from the owner of a Stellar account, without any password or server-side session.
//
// The browser asks for a nonce, signs it with its Cavos wallet (`wallet.signMessage`) and sends the signature back.
// Cavos signs with the account's *control key*, which is a different address from the account itself, so a signature
// is accepted only when that key is a signer of the account on-chain. Each nonce works once and for a few minutes, so
// a captured signature cannot be replayed.
//
// On Solana (CHAIN=solana) the wallet is a plain ed25519 key held by Privy: it signs the nonce's bytes as they are,
// and the key that signs is the address itself, so there is nothing to look up on-chain.
import { createPublicKey, randomUUID, verify } from 'node:crypto';
import { getAddressEncoder, isAddress } from '@solana/kit';
import { Keypair } from '@stellar/stellar-sdk';
import { chainKind, isOwnerAddress } from './chain-kind';
import { HttpError } from './errors';
import { messages } from './messages';
import { singleton } from './singleton';

const CAVOS_MESSAGE_PREFIX = 'Cavos Signed Message:\n';
const NONCE_TTL_MS = 5 * 60 * 1000;
const MAX_PENDING_NONCES = 2000;
const HORIZON_URL = 'https://horizon-testnet.stellar.org';

const nonces = singleton('wallet-auth-nonces', () => new Map<string, { owner: string; until: number }>());

const dropExpired = (now: number) => {
  for (const [nonce, pending] of nonces) if (pending.until <= now) nonces.delete(nonce);
};

export const issueNonce = (owner: string): string => {
  if (!isOwnerAddress(owner)) throw new HttpError(400, messages.invalidOwner);
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

// What Cavos actually signs: the message with its domain prefix and its length.
const prefixed = (message: string) => {
  const body = Buffer.from(message, 'utf8');
  return Buffer.concat([Buffer.from(`${CAVOS_MESSAGE_PREFIX}${body.length}\n`, 'utf8'), body]);
};

// Whether `key` may act for `account`: the account itself, or one of its signers.
const signsFor = async (account: string, key: string): Promise<boolean> => {
  if (account === key) return true;
  const response = await fetch(`${HORIZON_URL}/accounts/${encodeURIComponent(account)}`);
  if (response.status === 404) return false;
  if (!response.ok) throw new HttpError(503, 'No se pudo comprobar tu cuenta en Stellar. Intentá de nuevo en unos segundos.', { retryable: true });
  const { signers } = (await response.json()) as { signers?: { key: string; weight: number }[] };
  return (signers ?? []).some((signer) => signer.key === key && signer.weight > 0);
};

interface WalletProof {
  owner: string;
  nonce: string;
  // Base64, as the browser sends it.
  signature: string;
  // The control key that signed, in G… form.
  publicKey: string;
}

// SubjectPublicKeyInfo header of a raw 32-byte Ed25519 public key.
const ED25519_SPKI_HEADER = Buffer.from('302a300506032b6570032100', 'hex');

const verifiesOnSolana = (owner: string, message: string, signature: Buffer) => {
  if (!isAddress(owner)) return false;
  const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_HEADER, Uint8Array.from(getAddressEncoder().encode(owner))]), format: 'der', type: 'spki' });
  return verify(null, Buffer.from(message, 'utf8'), key, signature);
};

// Throws unless the signature proves that whoever sent it holds the wallet of `owner`.
export const assertWalletOwner = async ({ owner, nonce, signature, publicKey }: WalletProof) => {
  const invalid = () => new HttpError(401, 'No pudimos comprobar que esta wallet sea tuya. Volvé a intentarlo.');
  const onSolana = chainKind() === 'solana';
  // On Solana the signing key is the address; publicKey may be omitted or must repeat it.
  if (!isOwnerAddress(owner) || (onSolana ? publicKey && publicKey !== owner : !isOwnerAddress(publicKey))) throw invalid();
  const pending = nonces.get(nonce);
  // Single use: the nonce is spent whether or not the signature turns out to be good.
  nonces.delete(nonce);
  if (!pending || pending.owner !== owner || pending.until <= Date.now()) throw invalid();

  const bytes = Buffer.from(signature, 'base64');
  if (bytes.length !== 64) throw invalid();
  if (onSolana) {
    let valid = false;
    try {
      valid = verifiesOnSolana(owner, nonce, bytes);
    } catch {
      // A malformed key or signature is the same as a wrong one.
    }
    if (!valid) throw invalid();
    return;
  }
  try {
    if (!Keypair.fromPublicKey(publicKey).verify(prefixed(nonce), bytes)) throw invalid();
  } catch {
    throw invalid();
  }
  if (!(await signsFor(owner, publicKey))) throw invalid();
};
