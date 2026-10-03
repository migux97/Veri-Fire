// The company side of an account, shared with the server so another browser finds the same batches.
//
// Warranties already follow the wallet, because the contract records their owner. Purchases do not: their id is the
// key to the secret codes of a batch, so they were kept only in the browser that bought them. Here the wallet signs a
// nonce and the server answers with (and stores) that account's purchases and what kind of account it is.
import type { PublicBrand } from '../brand';
import type { AccountDataEntry } from './account-data';
import { bytesToBase64 } from './bytes';
import { postJson } from './api';
import type { VerificationState } from '../types';
import { connectSigner } from './signer';

export interface RemoteWorkspace {
  owner: string;
  purchaseIds: string[];
  accountType: 'personal' | 'business' | null;
  companyName: string | null;
  // What the company configured: the team, the agenda, the templates, the profile (see account-data.ts).
  data?: Record<string, AccountDataEntry>;
  // Its published brand, if any: the slug that names it and the public address of its logo.
  brand: { slug: string; logoUrl: string | null } | null;
  // Where its verification stands, as Verifire decided it.
  verification?: VerificationState;
  // Whether this wallet is one of the administrators of Verifire.
  admin?: boolean;
}

interface WorkspaceChanges {
  // The email of the account: the server keeps only a keyed hash of it, to know it already has an account.
  email?: string;
  purchaseIds?: string[];
  removedPurchaseIds?: string[];
  accountType?: 'personal' | 'business';
  companyName?: string;
  data?: Record<string, AccountDataEntry>;
  // An object publishes or replaces the brand, null takes it down, absent leaves it as it is.
  brand?: PublicBrand | null;
}

// Signing needs the wallet, which needs the Gmail confirmed: the panel keeps working on its own copy when it cannot.
export const syncWorkspace = async (appId: string, owner: string, changes: WorkspaceChanges = {}): Promise<RemoteWorkspace> => {
  const { nonce } = await postJson<{ nonce: string }>('/api/workspace/challenge', { owner }, 'No se pudo preparar la comprobación de tu wallet.');
  const wallet = await connectSigner(appId, owner);
  const { signature, publicKey } = await wallet.signMessage(nonce);
  return postJson<RemoteWorkspace>(
    '/api/workspace',
    { owner, nonce, signature: bytesToBase64(signature), publicKey, ...changes },
    'No se pudo sincronizar tu cuenta de empresa.'
  );
};
