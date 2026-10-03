// The Verifire account lives in this browser (there are no server-side user accounts).
import { readStored, writeStored } from './storage';

export interface StoredUser {
  name: string;
  email: string;
  accountType?: 'personal' | 'business';
  companyName?: string;
  // The Solana wallet Privy holds for this account.
  walletAddress?: string;
  emailVerifiedAt?: number;
}

const USER_KEY = 'verifireUser';

export const storedUser = () => readStored<StoredUser>(localStorage, USER_KEY);

export const persistUser = (user: StoredUser) => writeStored(localStorage, USER_KEY, user);

// Announced so what is already on screen (the profile menu) follows a change made elsewhere.
export const ACCOUNT_UPDATED_EVENT = 'verifire:account-updated';

export const updateStoredUser = (changes: Partial<StoredUser>) => {
  const user = storedUser();
  if (!user) return;
  persistUser({ ...user, ...changes });
  window.dispatchEvent(new CustomEvent(ACCOUNT_UPDATED_EVENT));
};
