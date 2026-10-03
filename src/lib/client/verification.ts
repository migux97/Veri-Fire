// The verification of a company, from the browser. Verifire decides it by hand (see the server's verification.ts): a company
// only asks, and an administrator reads the list and decides. Every call is signed with the wallet, like any change to an
// account, so nobody can ask or decide in someone else's name.
import type { CompanyForReview, VerificationState } from '../types';
import { postJson } from './api';
import { bytesToBase64 } from './bytes';
import { accountKey } from './session';
import { readStored, writeStored } from './storage';
import { connectSigner } from './signer';
import { resolveWalletAddress } from './wallet';

// Where the company's panel keeps what the server last said about it, so the settings show it without asking again.
export const VERIFICATION_EVENT = 'verifire:verification';

export const readVerification = () => readStored<VerificationState>(localStorage, accountKey('verification'));

export const writeVerification = (state: VerificationState | null | undefined) => {
  if (!state) return;
  writeStored(localStorage, accountKey('verification'), state);
  window.dispatchEvent(new Event(VERIFICATION_EVENT));
};

// Whether this account administers Verifire, as the server said when the account synced: it only decides whether the menu
// offers the review of companies (the server checks the wallet on every call anyway).
export const isAdminAccount = () => readStored<boolean>(localStorage, accountKey('admin')) === true;

export const writeAdmin = (admin: boolean | undefined) => {
  if (admin === undefined) return;
  writeStored(localStorage, accountKey('admin'), admin);
  window.dispatchEvent(new Event(VERIFICATION_EVENT));
};

const signed = async <T>(appId: string, body: Record<string, unknown>, fallbackError: string): Promise<T> => {
  const owner = await resolveWalletAddress(appId);
  const { nonce } = await postJson<{ nonce: string }>('/api/workspace/challenge', { owner }, 'No se pudo preparar la comprobación de tu wallet.');
  const wallet = await connectSigner(appId, owner);
  const { signature, publicKey } = await wallet.signMessage(nonce);
  return postJson<T>('/api/verification', { owner, nonce, signature: bytesToBase64(signature), publicKey, ...body }, fallbackError);
};

export const requestVerification = async (appId: string, message: string) => {
  const { verification } = await signed<{ verification: VerificationState }>(appId, { action: 'request', message }, 'No se pudo enviar la solicitud.');
  writeVerification(verification);
  return verification;
};

// Administrators only: a 403 means this account is not one.
export const listCompaniesForReview = async (appId: string) =>
  (await signed<{ companies: CompanyForReview[] }>(appId, { action: 'list' }, 'No se pudo leer la lista de empresas.')).companies;

export const approveCompany = async (appId: string, target: string, decision: { name: string; domain: string }) =>
  (await signed<{ verification: VerificationState }>(appId, { action: 'approve', target, ...decision }, 'No se pudo aprobar la empresa.')).verification;

export const rejectCompany = async (appId: string, target: string, note: string) =>
  (await signed<{ verification: VerificationState }>(appId, { action: 'reject', target, note }, 'No se pudo rechazar la empresa.')).verification;
