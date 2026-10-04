import type { IssuanceOptions } from '../issuance';
// Products, batches and purchases, kept in memory and saved to a JSON file after every change.
import { createHash, randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config';
import { HttpError } from './errors';
import { singleton } from './singleton';
import type { TeamRole } from '../types';

export interface ProductFields {
  configuration?: IssuanceOptions;
  model: string;
  lot: string;
  destination: string;
}

// Events stored as they happen. Registration and activation come from the product's own fields (see historyOf).
export interface StoredEvent {
  kind: 'shipped' | 'verified' | 'rejected' | 'transferred';
  at: string;
  tx?: string;
  // Transfers: previous and new owner. Rejected claims: the account that tried.
  from?: string;
  to?: string;
  by?: string;
}

// Who the buyer contacts for support and how long a warranty lasts, set by the company (see support.ts).
export interface SupportSettings {
  companyName: string;
  email: string;
  warrantyMonths: number;
}

export interface Product extends ProductFields {
  tokenId: number;
  token: string;
  batchId?: string;
  // Absent only on the seed product, which keeps the local demo claim.
  secretCode?: string;
  secretHash: string;
  claimed: boolean;
  owner: string | null;
  createdAt?: string;
  claimedAt?: string;
  // The warranty's length, fixed when it was activated. Absent on products activated before it could be chosen (12).
  warrantyMonths?: number;
  claimTransaction?: string;
  // Hex public key derived from the secret code (see activationKeyOf).
  activationKey?: string;
  // Set once the product is registered in the program. contractId is the program it was registered in.
  chain?: { tokenId: number; mintTx: string; contractId?: string; at?: string };
  events?: StoredEvent[];
  // Open transfer link: the public key of its secret, who offered it and when it expires.
  transfer?: { key: string; from: string; offeredAt: string; expiresAt?: string };
  // The owner chose to show this product on the home page, and when. Only possible when its batch has a photo, and it
  // ends by itself when the product changes owner: the next one did not choose it.
  showcase?: { at: string };
}

export interface Batch extends ProductFields {
  batchId: string;
  tokens: Product[];
  amount: string;
  txHash: string | null;
  shippedAt?: string;
  support?: SupportSettings;
}

export interface Purchase extends ProductFields {
  purchaseId: string;
  // Wallet of the company that bought it. Older purchases have none until a browser that holds their id says so.
  owner?: string;
  quantity: number;
  total: string;
  // Solana Pay reference key: the payment of this purchase carries it, which is how it is found on-chain.
  reference: string;
  // Exact amount for a transfer made by hand, which carries no reference: the total plus a few millionths no other
  // pending purchase uses, so the payment is recognized by its amount (see purchases.ts).
  transferAmount?: string;
  createdAt?: string;
  paymentQr: string | null;
  paymentUri: string | null;
  batchId?: string;
  txHash?: string | null;
  support?: SupportSettings;
  // The photo of the batch, as a data URL (see photos.ts), and a short hash that changes with it.
  photo?: string;
  photoVersion?: string;
}

// What a company shows to its buyers on each warranty (see brands.ts). The logo is a PNG data URL, served at
// /api/brand/<slug>/logo.png.
export interface Brand {
  slug: string;
  name: string;
  website?: string;
  description?: string;
  supportEmail?: string;
  supportPhone?: string;
  logo?: string;
  logoVersion?: string;
  updatedAt: string;
}

// Whether Verifire confirmed who a company is (see verification.ts). It is decided by hand by an administrator, never by
// the company: `name` is the trade name that was checked, and the verification only counts while the company shows that
// same name to its buyers.
export interface Verification {
  status: 'pending' | 'verified' | 'rejected';
  // When the company asked, and what it wrote for whoever reviews it.
  requestedAt?: string;
  message?: string;
  // The decision: when, by which administrator wallet, and for what name and site.
  decidedAt?: string;
  by?: string;
  name?: string;
  domain?: string;
  // Why it was rejected: the company reads it.
  note?: string;
}

// What a company account keeps beside its wallet, so another browser finds the same panel (see workspaces.ts).
export interface Workspace {
  owner: string;
  purchaseIds: string[];
  accountType?: 'personal' | 'business';
  companyName?: string;
  // What the company configured (team, agenda, templates, profile), each kind with the moment it was last written:
  // the newest copy wins over the one another browser sends. The server never looks inside a value.
  data?: Record<string, { value: unknown; updatedAt: string }>;
  brand?: Brand;
  verification?: Verification;
  updatedAt: string;
}

// An invitation to a company's team (see invitations.ts). The token is the secret carried by the link and the QR.
export interface Invitation {
  id: string;
  token: string;
  companyName: string;
  inviterName: string;
  inviterEmail: string;
  // Lower case. Empty for an open link, which whoever opens it can accept.
  email: string;
  role: TeamRole;
  status: 'pending' | 'accepted' | 'declined' | 'revoked';
  createdAt: string;
  expiresAt: string;
  respondedAt?: string;
  // Who accepted an open link.
  acceptedBy?: string;
}

// Same format the file has always had: batches list their products by token.
interface SavedState {
  nextTokenId?: number;
  nextBatchId?: number;
  products?: Product[];
  batches?: (Omit<Batch, 'tokens'> & { tokens: string[] })[];
  purchases?: Purchase[];
  workspaces?: Workspace[];
  invitations?: Invitation[];
  // Old public code -> current code, for products renamed because their code was taken in the contract.
  productAliases?: Record<string, string>;
  // Emails that already have an account, as keyed hashes (see accounts.ts), and the secret key of those hashes.
  accounts?: Record<string, RegisteredAccount>;
  accountsKey?: string;
}

// An email that has an account: the wallet that said so, signing, and when.
export interface RegisteredAccount {
  owner: string;
  at: string;
}

export const hashSecret = (secret: string) => createHash('sha256').update(secret).digest('hex');

const SAMPLE_SECRET_HASH = hashSecret('VF-SECRET-DEMO-001');

const createState = () => {
  const state = {
    nextTokenId: 1,
    nextBatchId: 1,
    // Only real products: every one of them comes from a paid batch.
    products: new Map<string, Product>(),
    batches: new Map<string, Batch>(),
    purchases: new Map<string, Purchase>(),
    workspaces: new Map<string, Workspace>(),
    invitations: new Map<string, Invitation>(),
    productAliases: new Map<string, string>(),
    accounts: new Map<string, RegisteredAccount>(),
    // Created once and kept with the data: without it, the hash of a guessed email could be checked against the file.
    accountsKey: randomBytes(32).toString('hex')
  };

  const readSaved = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as SavedState;
  const backup = `${config.dataFile}.bak`;
  let saved: SavedState;
  try {
    saved = readSaved(config.dataFile);
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
    // A first start has neither file. A missing file with a copy beside it, or a file cut in half by a crash, is
    // recovered from the copy the previous save left: starting empty there would overwrite every purchase at the next save.
    if (missing && !existsSync(backup)) return state;
    try {
      saved = readSaved(backup);
      console.warn(`${config.dataFile} ${missing ? 'no existe' : 'está dañado'}: se cargó la copia anterior ${backup}.`);
    } catch {
      throw new Error(`No se pudo leer ${config.dataFile}. Revisalo o borralo antes de iniciar el servidor.`, { cause: error });
    }
  }
  for (const product of saved.products ?? []) {
    // The invented sample product earlier versions created on their own (VF-001, "Smartwatch X9 Pro") is dropped
    // unless someone activated it.
    if (product.token === 'VF-001' && !product.secretCode && !product.claimed && product.secretHash === SAMPLE_SECRET_HASH) continue;
    state.products.set(product.token, product);
  }
  for (const batch of saved.batches ?? []) {
    const tokens = batch.tokens.map((token) => state.products.get(token)).filter((product) => product !== undefined);
    state.batches.set(batch.batchId, { ...batch, tokens });
  }
  for (const purchase of saved.purchases ?? []) {
    // A purchase left unpaid for a day does not keep a photo (anyone can create one): it is dropped on the next start.
    if (!purchase.batchId && purchase.photo && Date.now() - Date.parse(purchase.createdAt ?? '') > 24 * 60 * 60 * 1000) {
      delete purchase.photo;
      delete purchase.photoVersion;
    }
    state.purchases.set(purchase.purchaseId, purchase);
  }
  for (const workspace of saved.workspaces ?? []) state.workspaces.set(workspace.owner, workspace);
  for (const invitation of saved.invitations ?? []) state.invitations.set(invitation.id, invitation);
  for (const [previous, current] of Object.entries(saved.productAliases ?? {})) state.productAliases.set(previous, current);
  for (const [key, account] of Object.entries(saved.accounts ?? {})) state.accounts.set(key, account);
  if (saved.accountsKey) state.accountsKey = saved.accountsKey;
  state.nextTokenId = Math.max(state.nextTokenId, Number(saved.nextTokenId) || 0);
  state.nextBatchId = Math.max(state.nextBatchId, Number(saved.nextBatchId) || 0);
  return state;
};

export const store = singleton('store', createState);
// A state created by an older version of this module (the dev server keeps it across reloads) lacks the lists added
// since; they start empty instead of breaking every request that reads them.
store.invitations ??= new Map<string, Invitation>();
store.productAliases ??= new Map<string, string>();
store.accounts ??= new Map<string, RegisteredAccount>();
store.accountsKey ??= randomBytes(32).toString('hex');

// On Windows, replacing a file fails for a moment while another program has it open (the antivirus, the search
// indexer, an editor showing it). A few short retries get past it instead of failing the user's change.
const renameWithRetry = (from: string, to: string) => {
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 10 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * (attempt + 1));
    }
  }
};

export const saveState = () => {
  const saved: SavedState = {
    nextTokenId: store.nextTokenId,
    nextBatchId: store.nextBatchId,
    products: [...store.products.values()],
    batches: [...store.batches.values()].map((batch) => ({ ...batch, tokens: batch.tokens.map((product) => product.token) })),
    purchases: [...store.purchases.values()],
    workspaces: [...store.workspaces.values()],
    invitations: [...store.invitations.values()],
    productAliases: Object.fromEntries(store.productAliases),
    accounts: Object.fromEntries(store.accounts),
    accountsKey: store.accountsKey
  };
  // Written beside the file and renamed over it: a rename replaces the file atomically, so a crash leaves either the
  // previous state or the new one, never half of either and never no file at all. The previous state is copied to .bak
  // first (the file itself stays in place) for the case where the disk itself lied.
  const temporary = `${config.dataFile}.tmp`;
  try {
    mkdirSync(dirname(config.dataFile), { recursive: true });
    writeFileSync(temporary, JSON.stringify(saved, null, 2));
    if (existsSync(config.dataFile)) copyFileSync(config.dataFile, `${config.dataFile}.bak`);
    renameWithRetry(temporary, config.dataFile);
  } catch (error) {
    // The caller answers the request anyway, so what it just promised the user has to be visible in the log.
    console.error('No se pudo guardar el estado de Verifire:', error);
    // An HttpError, so the client reads this message (and may retry) instead of the generic one of the operation.
    const failure = new HttpError(503, 'No se pudo guardar el cambio. Intentá de nuevo en unos segundos.', { retryable: true });
    failure.cause = error;
    throw failure;
  }
};
