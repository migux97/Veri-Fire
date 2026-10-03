// Which emails already have a Verifire account, so registering again with one is sent to the login instead of creating
// a second, broken account (the wallet of an email is always the same one, and its key is already saved with the first
// password). Accounts live in each browser, so this is the only place that knows it across devices.
//
// Only a keyed hash of each email is kept, never the email: the key is random and stays in the data file. An email is
// recorded by the account's own panel, signed with its wallet (see /api/workspace). A wrong record would only send
// someone to the login, and logging in with the email and its code reaches that email's own account anyway.
import { createHmac } from 'node:crypto';
import { isWalletAddress } from '../validation';
import { saveState, store } from './store';

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

const normalize = (email: unknown) => (typeof email === 'string' ? email.trim().toLowerCase() : '');

const keyOf = (email: string) => createHmac('sha256', store.accountsKey).update(email).digest('hex');

export const isRegistered = (email: unknown) => {
  const normalized = normalize(email);
  return EMAIL.test(normalized) && store.accounts.has(keyOf(normalized));
};

// Called with every signed sync of an account's panel: it records the email once and changes nothing afterwards.
export const recordAccount = (email: unknown, owner: string) => {
  const normalized = normalize(email);
  if (!EMAIL.test(normalized) || !isWalletAddress(owner)) return;
  const key = keyOf(normalized);
  if (store.accounts.has(key)) return;
  store.accounts.set(key, { owner, at: new Date().toISOString() });
  try {
    saveState();
  } catch (error) {
    // Not worth failing the sync for: the next one records it.
    store.accounts.delete(key);
    console.warn('No se pudo registrar el correo de la cuenta:', error);
  }
};
